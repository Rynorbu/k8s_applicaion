import {
  AppError,
  BadRequest,
  Conflict,
  Events,
  NotFound,
  businessEvents,
  enqueueEvent,
  getLogger,
  todayUtc,
  withTransaction,
} from '@spendwise/common';
import { alertLevel, computeStatus, periodFor, shiftPeriod } from './period.js';

const toBudget = (row) => ({
  id: row.id,
  userId: row.user_id,
  name: row.name,
  category: row.category_id ? { id: row.category_id, name: row.category_name, color: row.category_color } : null,
  amount: row.amount,
  currency: row.currency.trim(),
  period: row.period,
  alertThreshold: row.alert_threshold,
  active: row.active,
  createdAt: row.created_at,
  updatedAt: row.updated_at,
});

export function createBudgetService({ pool, clients }) {
  const log = getLogger();

  async function spentIn(db, budget, { start, end }) {
    const { rows } = await db.query(
      `SELECT COALESCE(sum(amount_base), 0) AS spent FROM budget_transactions
        WHERE user_id = $1 AND expense_date BETWEEN $2 AND $3 AND ($4::uuid IS NULL OR category_id = $4)`,
      [budget.userId, start, end, budget.category?.id ?? null],
    );
    return rows[0].spent;
  }

  async function withStatus(db, budget, today = todayUtc()) {
    const period = periodFor(budget.period, today);
    return { ...budget, usage: computeStatus(budget, await spentIn(db, budget, period), period, today) };
  }

  async function getBudget(db, userId, id) {
    const { rows } = await db.query('SELECT * FROM budgets WHERE id = $1 AND user_id = $2', [id, userId]);
    if (!rows[0]) throw NotFound('Budget not found');
    return toBudget(rows[0]);
  }

  async function categorySnapshot(userId, categoryId) {
    if (!categoryId) return { id: null, name: null, color: null };
    try {
      const category = await clients.categories.get(`/internal/categories/${categoryId}`, { query: { userId } });
      if (category.type !== 'expense') throw BadRequest('Budgets can only target expense categories');
      return category;
    } catch (err) {
      if (err instanceof AppError && err.status === 404) throw BadRequest('Unknown category');
      throw err;
    }
  }

  /**
   * Re-evaluates the user's budgets affected by an expense and emits BudgetWarning /
   * BudgetExceeded at most once per budget period (enforced by a unique constraint).
   */
  async function evaluate(client, userId, categoryId, expenseDate) {
    const today = todayUtc();
    const { rows } = await client.query(
      `SELECT * FROM budgets WHERE user_id = $1 AND active AND (category_id IS NULL OR category_id = $2)`,
      [userId, categoryId],
    );
    for (const budget of rows.map(toBudget)) {
      const period = periodFor(budget.period, today);
      if (expenseDate < period.start || expenseDate > period.end) continue; // only the current period alerts
      const usage = computeStatus(budget, await spentIn(client, budget, period), period, today);
      const level = alertLevel(usage.percentage, budget.alertThreshold);
      if (!level) continue;
      const inserted = await client.query(
        `INSERT INTO budget_alerts (budget_id, period_start, level, spent, percentage) VALUES ($1, $2, $3, $4, $5)
         ON CONFLICT DO NOTHING RETURNING id`,
        [budget.id, period.start, level, usage.spent, usage.percentage],
      );
      if (inserted.rowCount === 0) continue;
      const payload = {
        budgetId: budget.id,
        userId,
        name: budget.name,
        categoryId: budget.category?.id ?? null,
        categoryName: budget.category?.name ?? 'All spending',
        amount: budget.amount,
        currency: budget.currency,
        spent: usage.spent,
        remaining: usage.remaining,
        percentage: usage.percentage,
        threshold: budget.alertThreshold,
        period: budget.period,
        periodStart: period.start,
        periodEnd: period.end,
      };
      await enqueueEvent(client, level === 'exceeded' ? Events.BudgetExceeded : Events.BudgetWarning, payload, { userId });
      businessEvents.inc({ name: `budget_${level}` });
      log.info({ budgetId: budget.id, level, percentage: usage.percentage }, 'budget alert raised');
    }
  }

  return {
    async list(userId) {
      const { rows } = await pool.query('SELECT * FROM budgets WHERE user_id = $1 AND active ORDER BY category_id NULLS FIRST, name', [userId]);
      return { data: await Promise.all(rows.map((r) => withStatus(pool, toBudget(r)))) };
    },

    async summary(userId) {
      const { data } = await this.list(userId);
      const overall = data.find((b) => !b.category && b.period === 'monthly');
      return {
        totalBudgets: data.length,
        onTrack: data.filter((b) => b.usage.status === 'on_track').length,
        warning: data.filter((b) => b.usage.status === 'warning').length,
        exceeded: data.filter((b) => b.usage.status === 'exceeded').length,
        monthlyOverall: overall ?? null,
        budgets: data,
      };
    },

    async get(userId, id) {
      const budget = await withStatus(pool, await getBudget(pool, userId, id));
      const today = todayUtc();
      const history = [];
      for (let n = 5; n >= 0; n -= 1) {
        const period = shiftPeriod(budget.period, today, n);
        history.push({ periodStart: period.start, periodEnd: period.end, spent: await spentIn(pool, budget, period), budgeted: budget.amount });
      }
      return { ...budget, history };
    },

    async create(userId, input) {
      const category = await categorySnapshot(userId, input.categoryId);
      try {
        return await withTransaction(pool, async (client) => {
          const { rows: settings } = await client.query('SELECT base_currency FROM user_settings WHERE user_id = $1', [userId]);
          const { rows } = await client.query(
            `INSERT INTO budgets (user_id, name, category_id, category_name, category_color, amount, currency, period, alert_threshold)
             VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9) RETURNING *`,
            [userId, input.name, category.id, category.name, category.color, input.amount, settings[0]?.base_currency ?? 'USD', input.period, input.alertThreshold],
          );
          const budget = toBudget(rows[0]);
          await enqueueEvent(client, Events.BudgetCreated, { budgetId: budget.id, userId, name: budget.name, amount: budget.amount, period: budget.period, categoryId: category.id }, { userId });
          return withStatus(client, budget);
        });
      } catch (err) {
        if (err.code === '23505') throw Conflict('An active budget already exists for this category and period');
        throw err;
      }
    },

    async update(userId, id, changes) {
      await getBudget(pool, userId, id);
      const { rows } = await pool.query(
        `UPDATE budgets SET name = COALESCE($3, name), amount = COALESCE($4, amount), alert_threshold = COALESCE($5, alert_threshold),
                active = COALESCE($6, active), updated_at = now()
          WHERE id = $1 AND user_id = $2 RETURNING *`,
        [id, userId, changes.name ?? null, changes.amount ?? null, changes.alertThreshold ?? null, changes.active ?? null],
      );
      // Thresholds/amounts changed: allow the current period to alert again.
      if (changes.amount || changes.alertThreshold) {
        await pool.query('DELETE FROM budget_alerts WHERE budget_id = $1 AND period_start = $2', [id, periodFor(rows[0].period, todayUtc()).start]);
      }
      return withStatus(pool, toBudget(rows[0]));
    },

    async remove(userId, id) {
      const { rowCount } = await pool.query('DELETE FROM budgets WHERE id = $1 AND user_id = $2', [id, userId]);
      if (rowCount === 0) throw NotFound('Budget not found');
    },

    // ---- event consumers -------------------------------------------------
    async upsertSettings(client, { userId, baseCurrency }) {
      await client.query(
        `INSERT INTO user_settings (user_id, base_currency) VALUES ($1, $2)
         ON CONFLICT (user_id) DO UPDATE SET base_currency = EXCLUDED.base_currency, updated_at = now()`,
        [userId, baseCurrency ?? 'USD'],
      );
    },

    async onExpenseUpserted(client, e) {
      // Version guard: ignore out-of-order (older) events.
      await client.query(
        `INSERT INTO budget_transactions (expense_id, user_id, category_id, amount_base, expense_date, version)
         VALUES ($1,$2,$3,$4,$5,$6)
         ON CONFLICT (expense_id) DO UPDATE SET category_id = EXCLUDED.category_id, amount_base = EXCLUDED.amount_base,
           expense_date = EXCLUDED.expense_date, version = EXCLUDED.version, updated_at = now()
         WHERE budget_transactions.version <= EXCLUDED.version`,
        [e.expenseId, e.userId, e.categoryId, e.amountBase, e.expenseDate, e.version ?? 1],
      );
      await evaluate(client, e.userId, e.categoryId, e.expenseDate);
    },

    async onExpenseDeleted(client, e) {
      await client.query('DELETE FROM budget_transactions WHERE expense_id = $1', [e.expenseId]);
    },

    async onCategoryUpdated(client, { categoryId, name, color }) {
      await client.query('UPDATE budgets SET category_name = $2, category_color = $3 WHERE category_id = $1', [categoryId, name, color]);
    },

    async onCategoryDeleted(client, { categoryId, type, fallbackCategory }) {
      if (type !== 'expense') return;
      await client.query('UPDATE budgets SET active = false, updated_at = now() WHERE category_id = $1', [categoryId]);
      await client.query('UPDATE budget_transactions SET category_id = $2 WHERE category_id = $1', [categoryId, fallbackCategory.id]);
    },
  };
}
