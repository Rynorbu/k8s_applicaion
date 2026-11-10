/** Integration test: expense lifecycle against PostgreSQL with stubbed downstream services. */
import { randomUUID } from 'node:crypto';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { withTransaction } from '@spendwise/common';
import { createTestDatabase } from '@spendwise/common/testing';
import { createExpenseService } from '../../src/service.js';

const DB = process.env.TEST_DATABASE_URL;

describe.skipIf(!DB)('expense service with PostgreSQL', () => {
  let db;
  let service;
  const userId = randomUUID();
  const food = { id: 'c0000000-0000-4000-8000-000000000001', type: 'expense', name: 'Food & Dining', color: '#f97316', icon: 'utensils' };
  const clients = {
    categories: { get: async () => food, post: async () => food },
    currency: { get: async (_path, { query }) => ({ converted: query.amount * 0.5, rate: 0.5 }) },
    files: { get: async () => ({ kind: 'receipt' }) },
  };

  beforeAll(async () => {
    db = await createTestDatabase('expense_it', new URL('../../migrations', import.meta.url));
    service = createExpenseService({ pool: db.pool, clients });
    await withTransaction(db.pool, (c) => service.upsertSettings(c, { userId, baseCurrency: 'USD' }));
  });

  afterAll(async () => db?.drop());

  const outboxTypes = async (expenseId) =>
    (await db.pool.query(`SELECT event_type FROM outbox WHERE payload->'data'->>'expenseId' = $1 ORDER BY created_at`, [expenseId])).rows.map(
      (r) => r.event_type,
    );

  it('creates, converts currency and writes ExpenseCreated to the outbox atomically', async () => {
    const expense = await service.create(userId, { amount: 20, currency: 'EUR', description: 'Dinner', expenseDate: '2026-10-01', tags: [] });
    expect(expense).toMatchObject({ amount: 20, currency: 'EUR', amountBase: 10, baseCurrency: 'USD' });
    expect(await outboxTypes(expense.id)).toEqual(['ExpenseCreated']);
  });

  it('updates with optimistic concurrency and deletes softly', async () => {
    const expense = await service.create(userId, { amount: 5, description: 'Snack', expenseDate: '2026-10-02', tags: [] });
    const updated = await service.update(userId, expense.id, { amount: 7, version: 1 });
    expect(updated).toMatchObject({ amount: 7, version: 2 });
    await expect(service.update(userId, expense.id, { amount: 8, version: 1 })).rejects.toMatchObject({ status: 409 });
    await service.remove(userId, expense.id);
    await expect(service.get(userId, expense.id)).rejects.toMatchObject({ status: 404 });
    expect(await outboxTypes(expense.id)).toEqual(['ExpenseCreated', 'ExpenseUpdated', 'ExpenseDeleted']);
  });

  it('isolates users from each other', async () => {
    const expense = await service.create(userId, { amount: 1, description: 'Private', expenseDate: '2026-10-03', tags: [] });
    await expect(service.get(randomUUID(), expense.id)).rejects.toMatchObject({ status: 404 });
  });

  it('generates recurring occurrences idempotently', async () => {
    const due = { type: 'expense', userId, recurringId: randomUUID(), occurrenceDate: '2026-10-05', amount: 15, currency: 'USD', description: 'Netflix' };
    await withTransaction(db.pool, (c) => service.onRecurringDue(c, due));
    await withTransaction(db.pool, (c) => service.onRecurringDue(c, due));
    const { rows } = await db.pool.query('SELECT count(*)::int AS n FROM expenses WHERE recurring_id = $1', [due.recurringId]);
    expect(rows[0].n).toBe(1);
  });

  it('filters and aggregates lists', async () => {
    const result = await service.list(userId, { page: 1, pageSize: 10, q: 'dinner', sort: 'date_desc' });
    expect(result.data).toHaveLength(1);
    expect(result.summary.totalAmountBase).toBe(10);
  });
});
