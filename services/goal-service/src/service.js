import { BadRequest, Events, NotFound, businessEvents, enqueueEvent, round2, withTransaction } from '@spendwise/common';
import { computeProgress, crossedMilestones } from './progress.js';

const toGoal = (row) => {
  const goal = {
    id: row.id,
    userId: row.user_id,
    name: row.name,
    description: row.description,
    targetAmount: row.target_amount,
    currentAmount: row.current_amount,
    currency: row.currency.trim(),
    targetDate: row.target_date,
    icon: row.icon,
    color: row.color,
    priority: row.priority,
    status: row.status,
    completedAt: row.completed_at,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
  return { ...goal, progress: computeProgress(goal) };
};

export function createGoalService({ pool }) {
  async function getRow(db, userId, id, lock = false) {
    const { rows } = await db.query(`SELECT * FROM goals WHERE id = $1 AND user_id = $2 ${lock ? 'FOR UPDATE' : ''}`, [id, userId]);
    if (!rows[0]) throw NotFound('Goal not found');
    return rows[0];
  }

  return {
    async list(userId, { status }) {
      const { rows } = await pool.query(
        `SELECT * FROM goals WHERE user_id = $1 AND ($2::text IS NULL OR status = $2)
          ORDER BY CASE status WHEN 'active' THEN 0 WHEN 'completed' THEN 1 ELSE 2 END,
                   CASE priority WHEN 'high' THEN 0 WHEN 'medium' THEN 1 ELSE 2 END, target_date NULLS LAST`,
        [userId, status ?? null],
      );
      return { data: rows.map(toGoal) };
    },

    async summary(userId) {
      const { data } = await this.list(userId, {});
      const active = data.filter((g) => g.status === 'active');
      return {
        activeGoals: active.length,
        completedGoals: data.filter((g) => g.status === 'completed').length,
        totalTarget: round2(active.reduce((s, g) => s + g.targetAmount, 0)),
        totalSaved: round2(active.reduce((s, g) => s + g.currentAmount, 0)),
        overallPercentage: active.length
          ? round2((active.reduce((s, g) => s + g.currentAmount, 0) / active.reduce((s, g) => s + g.targetAmount, 0)) * 100)
          : 0,
        goals: active.slice(0, 5),
      };
    },

    async get(userId, id) {
      const goal = toGoal(await getRow(pool, userId, id));
      const [{ rows: contributions }, { rows: milestones }] = await Promise.all([
        pool.query('SELECT * FROM goal_contributions WHERE goal_id = $1 ORDER BY contribution_date DESC, created_at DESC LIMIT 100', [id]),
        pool.query('SELECT milestone, reached_at FROM goal_milestones WHERE goal_id = $1 ORDER BY milestone', [id]),
      ]);
      return {
        ...goal,
        contributions: contributions.map((c) => ({ id: c.id, amount: c.amount, note: c.note, date: c.contribution_date, createdAt: c.created_at })),
        milestones: milestones.map((m) => ({ milestone: m.milestone, reachedAt: m.reached_at })),
      };
    },

    async create(userId, input) {
      return withTransaction(pool, async (client) => {
        const { rows: settings } = await client.query('SELECT base_currency FROM user_settings WHERE user_id = $1', [userId]);
        const { rows } = await client.query(
          `INSERT INTO goals (user_id, name, description, target_amount, currency, target_date, icon, color, priority)
           VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9) RETURNING *`,
          [userId, input.name, input.description ?? null, input.targetAmount, settings[0]?.base_currency ?? 'USD', input.targetDate ?? null, input.icon, input.color, input.priority],
        );
        const goal = toGoal(rows[0]);
        await enqueueEvent(client, Events.GoalCreated, { goalId: goal.id, userId, name: goal.name, targetAmount: goal.targetAmount, currency: goal.currency, targetDate: goal.targetDate });
        if (input.initialAmount) await this.contribute(userId, goal.id, { amount: input.initialAmount, note: 'Initial amount' }, client);
        return toGoal(await getRow(client, userId, goal.id));
      });
    },

    async update(userId, id, changes) {
      await getRow(pool, userId, id);
      const { rows } = await pool.query(
        `UPDATE goals SET name = COALESCE($3, name), description = COALESCE($4, description), target_amount = COALESCE($5, target_amount),
                target_date = CASE WHEN $6::boolean THEN $7::date ELSE target_date END, icon = COALESCE($8, icon),
                color = COALESCE($9, color), priority = COALESCE($10, priority), status = COALESCE($11, status),
                completed_at = CASE WHEN $11 = 'completed' THEN COALESCE(completed_at, now()) WHEN $11 IS NOT NULL THEN NULL ELSE completed_at END,
                updated_at = now()
          WHERE id = $1 AND user_id = $2 RETURNING *`,
        [
          id, userId, changes.name ?? null, changes.description ?? null, changes.targetAmount ?? null, changes.targetDate !== undefined,
          changes.targetDate ?? null, changes.icon ?? null, changes.color ?? null, changes.priority ?? null, changes.status ?? null,
        ],
      );
      return toGoal(rows[0]);
    },

    async remove(userId, id) {
      const { rowCount } = await pool.query('DELETE FROM goals WHERE id = $1 AND user_id = $2', [id, userId]);
      if (rowCount === 0) throw NotFound('Goal not found');
    },

    /** Adds a contribution (or withdrawal) and announces newly reached milestones. */
    async contribute(userId, id, { amount, note, date }, existingClient) {
      const run = async (client) => {
        const row = await getRow(client, userId, id, true);
        if (row.status === 'cancelled') throw BadRequest('Cannot contribute to a cancelled goal');
        const before = row.current_amount;
        const after = round2(before + amount);
        if (after < 0) throw BadRequest('Withdrawal exceeds the saved amount');
        const contributionDate = date ?? new Date().toISOString().slice(0, 10);
        await client.query(
          'INSERT INTO goal_contributions (goal_id, user_id, amount, note, contribution_date) VALUES ($1,$2,$3,$4,$5)',
          [id, userId, amount, note ?? null, contributionDate],
        );
        const completed = after >= row.target_amount;
        await client.query(
          `UPDATE goals SET current_amount = $2, status = CASE WHEN $3 THEN 'completed' WHEN status = 'completed' THEN 'active' ELSE status END,
                  completed_at = CASE WHEN $3 THEN COALESCE(completed_at, now()) ELSE NULL END, updated_at = now() WHERE id = $1`,
          [id, after, completed],
        );
        await enqueueEvent(client, Events.GoalContributionAdded, { goalId: id, userId, amount, newBalance: after, targetAmount: row.target_amount, currency: row.currency.trim() });
        for (const milestone of crossedMilestones(row.target_amount, before, after)) {
          const inserted = await client.query('INSERT INTO goal_milestones (goal_id, milestone) VALUES ($1, $2) ON CONFLICT DO NOTHING', [id, milestone]);
          if (inserted.rowCount === 1) {
            await enqueueEvent(client, Events.GoalMilestoneReached, {
              goalId: id,
              userId,
              name: row.name,
              milestone,
              currentAmount: after,
              targetAmount: row.target_amount,
              currency: row.currency.trim(),
              completed: milestone === 100,
            });
            businessEvents.inc({ name: 'goal_milestone_reached' });
          }
        }
        return toGoal(await getRow(client, userId, id));
      };
      return existingClient ? run(existingClient) : withTransaction(pool, run);
    },

    async upsertSettings(client, { userId, baseCurrency }) {
      await client.query(
        `INSERT INTO user_settings (user_id, base_currency) VALUES ($1, $2)
         ON CONFLICT (user_id) DO UPDATE SET base_currency = EXCLUDED.base_currency, updated_at = now()`,
        [userId, baseCurrency ?? 'USD'],
      );
    },
  };
}
