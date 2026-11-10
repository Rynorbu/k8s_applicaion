import { randomUUID } from 'node:crypto';
import {
  AppError,
  BadRequest,
  Events,
  NotFound,
  enqueueEvent,
  getLogger,
  runWithContext,
  todayUtc,
  withTransaction,
} from '@spendwise/common';
import { describeSchedule, firstOnOrAfter, isFinished, nextOccurrence, occurrencesBetween } from './schedule.js';

export const toRule = (row) => ({
  id: row.id,
  userId: row.user_id,
  type: row.type,
  description: row.description,
  amount: row.amount,
  currency: row.currency?.trim() ?? null,
  category: row.category_id ? { id: row.category_id, name: row.category_name } : null,
  merchant: row.merchant,
  paymentMethod: row.payment_method,
  notes: row.notes,
  frequency: row.frequency,
  intervalCount: row.interval_count,
  anchorDay: row.anchor_day,
  startDate: row.start_date,
  endDate: row.end_date,
  maxOccurrences: row.max_occurrences,
  nextRunDate: row.next_run_date,
  lastRunDate: row.last_run_date,
  occurrencesGenerated: row.occurrences_generated,
  status: row.status,
  schedule: describeSchedule({ frequency: row.frequency, intervalCount: row.interval_count }),
  createdAt: row.created_at,
  updatedAt: row.updated_at,
});

const MAX_CATCH_UP_PER_RULE = 60;

export function createRecurringService({ pool, clients }) {
  const log = getLogger();

  async function getRule(db, userId, id, lock = false) {
    const { rows } = await db.query(`SELECT * FROM recurring_rules WHERE id = $1 AND user_id = $2 ${lock ? 'FOR UPDATE' : ''}`, [id, userId]);
    if (!rows[0]) throw NotFound('Recurring transaction not found');
    return toRule(rows[0]);
  }

  async function validateCategory(userId, type, categoryId) {
    if (!categoryId) return { id: null, name: null };
    try {
      const category = await clients.categories.get(`/internal/categories/${categoryId}`, { query: { userId } });
      if (category.type !== type) throw BadRequest(`Category must be an ${type} category`);
      return category;
    } catch (err) {
      if (err instanceof AppError && err.status === 404) throw BadRequest('Unknown category');
      throw err;
    }
  }

  /** Generates every due occurrence of one (locked) rule and advances its schedule. */
  async function generateDue(client, rule, today) {
    let date = rule.nextRunDate;
    let generated = rule.occurrencesGenerated;
    let created = 0;
    while (date && date <= today && created < MAX_CATCH_UP_PER_RULE && !isFinished(rule, date, generated)) {
      const eventId = randomUUID();
      const inserted = await client.query(
        `INSERT INTO recurring_occurrences (rule_id, occurrence_date, event_id) VALUES ($1, $2, $3) ON CONFLICT DO NOTHING`,
        [rule.id, date, eventId],
      );
      if (inserted.rowCount === 1) {
        await enqueueEvent(
          client,
          Events.RecurringTransactionDue,
          {
            recurringId: rule.id,
            userId: rule.userId,
            type: rule.type,
            occurrenceDate: date,
            amount: rule.amount,
            currency: rule.currency,
            categoryId: rule.category?.id ?? null,
            description: rule.description,
            merchant: rule.merchant,
            paymentMethod: rule.paymentMethod,
            notes: rule.notes,
          },
          { userId: rule.userId },
        );
        created += 1;
        generated += 1;
      }
      date = nextOccurrence(rule, date);
    }
    const finished = isFinished(rule, date, generated);
    await client.query(
      `UPDATE recurring_rules SET next_run_date = $2, last_run_date = COALESCE($3, last_run_date),
              occurrences_generated = $4, status = $5, updated_at = now() WHERE id = $1`,
      [rule.id, finished ? null : date, created > 0 ? today : null, generated, finished ? 'completed' : rule.status],
    );
    return created;
  }

  return {
    async list(userId, { type, status }) {
      const { rows } = await pool.query(
        `SELECT * FROM recurring_rules WHERE user_id = $1 AND ($2::text IS NULL OR type = $2) AND ($3::text IS NULL OR status = $3)
          ORDER BY status, next_run_date NULLS LAST`,
        [userId, type ?? null, status ?? null],
      );
      return { data: rows.map(toRule) };
    },

    async get(userId, id) {
      const rule = await getRule(pool, userId, id);
      const { rows } = await pool.query(
        'SELECT occurrence_date, created_at FROM recurring_occurrences WHERE rule_id = $1 ORDER BY occurrence_date DESC LIMIT 24',
        [id],
      );
      const today = todayUtc();
      return {
        ...rule,
        upcoming: rule.status === 'active' ? occurrencesBetween(rule, today, '9999-12-31', 5) : [],
        history: rows.map((r) => ({ occurrenceDate: r.occurrence_date, generatedAt: r.created_at })),
      };
    },

    async upcoming(userId, days) {
      const today = todayUtc();
      const until = new Date(Date.now() + days * 86_400_000).toISOString().slice(0, 10);
      const { rows } = await pool.query(`SELECT * FROM recurring_rules WHERE user_id = $1 AND status = 'active'`, [userId]);
      const items = rows
        .map(toRule)
        .flatMap((rule) =>
          occurrencesBetween(rule, today, until, 50).map((date) => ({
            recurringId: rule.id,
            date,
            type: rule.type,
            description: rule.description,
            amount: rule.amount,
            currency: rule.currency,
            category: rule.category,
          })),
        )
        .sort((a, b) => a.date.localeCompare(b.date));
      const totals = items.reduce(
        (acc, i) => ({ ...acc, [i.type]: Math.round(((acc[i.type] ?? 0) + i.amount) * 100) / 100 }),
        { expense: 0, income: 0 },
      );
      return { from: today, until, totals, data: items };
    },

    async create(userId, input) {
      const category = await validateCategory(userId, input.type, input.categoryId);
      const anchorDay = Number(input.startDate.slice(8, 10));
      return withTransaction(pool, async (client) => {
        const { rows } = await client.query(
          `INSERT INTO recurring_rules (user_id, type, description, amount, currency, category_id, category_name, merchant, payment_method,
                                        notes, frequency, interval_count, anchor_day, start_date, end_date, max_occurrences, next_run_date)
           VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$14) RETURNING *`,
          [
            userId, input.type, input.description, input.amount, input.currency ?? null, category.id, category.name, input.merchant ?? null,
            input.paymentMethod ?? null, input.notes ?? null, input.frequency, input.intervalCount, anchorDay, input.startDate,
            input.endDate ?? null, input.maxOccurrences ?? null,
          ],
        );
        const rule = toRule(rows[0]);
        await enqueueEvent(client, Events.RecurringTransactionCreated, {
          recurringId: rule.id,
          userId,
          type: rule.type,
          description: rule.description,
          amount: rule.amount,
          currency: rule.currency,
          frequency: rule.frequency,
          intervalCount: rule.intervalCount,
          startDate: rule.startDate,
          nextRunDate: rule.nextRunDate,
        });
        return rule;
      });
    },

    async update(userId, id, changes) {
      const rule = await getRule(pool, userId, id);
      const category = changes.categoryId ? await validateCategory(userId, rule.type, changes.categoryId) : null;
      if (changes.endDate && changes.endDate < rule.startDate) throw BadRequest('End date must be after the start date');
      const { rows } = await pool.query(
        `UPDATE recurring_rules SET description = COALESCE($3, description), amount = COALESCE($4, amount),
                category_id = COALESCE($5, category_id), category_name = COALESCE($6, category_name),
                merchant = COALESCE($7, merchant), notes = COALESCE($8, notes),
                end_date = CASE WHEN $9::boolean THEN $10::date ELSE end_date END,
                max_occurrences = CASE WHEN $11::boolean THEN $12::int ELSE max_occurrences END, updated_at = now()
          WHERE id = $1 AND user_id = $2 RETURNING *`,
        [
          id, userId, changes.description ?? null, changes.amount ?? null, category?.id ?? null, category?.name ?? null,
          changes.merchant ?? null, changes.notes ?? null, changes.endDate !== undefined, changes.endDate ?? null,
          changes.maxOccurrences !== undefined, changes.maxOccurrences ?? null,
        ],
      );
      return toRule(rows[0]);
    },

    async setStatus(userId, id, status) {
      return withTransaction(pool, async (client) => {
        const rule = await getRule(client, userId, id, true);
        if (rule.status === 'completed') throw BadRequest('This recurring transaction has completed');
        // Resuming skips occurrences missed while paused instead of back-filling them.
        const next = status === 'active' ? firstOnOrAfter(rule, todayUtc()) : rule.nextRunDate;
        const { rows } = await client.query(
          'UPDATE recurring_rules SET status = $2, next_run_date = $3, updated_at = now() WHERE id = $1 RETURNING *',
          [id, status, next],
        );
        return toRule(rows[0]);
      });
    },

    async remove(userId, id) {
      const { rowCount } = await pool.query('DELETE FROM recurring_rules WHERE id = $1 AND user_id = $2', [id, userId]);
      if (rowCount === 0) throw NotFound('Recurring transaction not found');
    },

    /** Scheduler tick: safe to run on every replica concurrently (FOR UPDATE SKIP LOCKED). */
    async runDue(today = todayUtc(), batchSize = 50) {
      const correlationId = `scheduler-${randomUUID()}`;
      return runWithContext({ correlationId, requestId: correlationId }, () =>
        withTransaction(pool, async (client) => {
          const { rows } = await client.query(
            `SELECT * FROM recurring_rules WHERE status = 'active' AND next_run_date <= $1
              ORDER BY next_run_date LIMIT $2 FOR UPDATE SKIP LOCKED`,
            [today, batchSize],
          );
          let total = 0;
          for (const row of rows) total += await generateDue(client, toRule(row), today);
          if (total > 0) log.info({ rules: rows.length, occurrences: total }, 'recurring transactions generated');
          return total;
        }),
      );
    },

    async onCategoryDeleted(client, { categoryId, fallbackCategory }) {
      await client.query('UPDATE recurring_rules SET category_id = $2, category_name = $3 WHERE category_id = $1', [
        categoryId,
        fallbackCategory.id,
        fallbackCategory.name,
      ]);
    },

    async onCategoryUpdated(client, { categoryId, name }) {
      await client.query('UPDATE recurring_rules SET category_name = $2 WHERE category_id = $1', [categoryId, name]);
    },
  };
}
