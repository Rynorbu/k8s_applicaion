/** Integration: ExpenseCreated events drive BudgetWarning/BudgetExceeded exactly once per period. */
import { randomUUID } from 'node:crypto';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { todayUtc, withTransaction } from '@spendwise/common';
import { createTestDatabase } from '@spendwise/common/testing';
import { createBudgetService } from '../../src/service.js';

const DB = process.env.TEST_DATABASE_URL;

describe.skipIf(!DB)('budget alerts with PostgreSQL', () => {
  let db;
  let service;
  const userId = randomUUID();
  const categoryId = 'c0000000-0000-4000-8000-000000000001';

  beforeAll(async () => {
    db = await createTestDatabase('budget_it', new URL('../../migrations', import.meta.url));
    service = createBudgetService({
      pool: db.pool,
      clients: { categories: { get: async () => ({ id: categoryId, type: 'expense', name: 'Food & Dining', color: '#f97316' }) } },
    });
    await service.create(userId, { name: 'Food', categoryId, amount: 100, period: 'monthly', alertThreshold: 80 });
  });

  afterAll(async () => db?.drop());

  const expense = (amountBase) => ({ expenseId: randomUUID(), userId, categoryId, amountBase, expenseDate: todayUtc(), version: 1 });
  const alerts = async () =>
    (await db.pool.query(`SELECT event_type FROM outbox WHERE event_type IN ('BudgetWarning','BudgetExceeded') ORDER BY created_at`)).rows.map((r) => r.event_type);

  it('emits a single warning when crossing the threshold', async () => {
    await withTransaction(db.pool, (c) => service.onExpenseUpserted(c, expense(50)));
    expect(await alerts()).toEqual([]);
    await withTransaction(db.pool, (c) => service.onExpenseUpserted(c, expense(35)));
    await withTransaction(db.pool, (c) => service.onExpenseUpserted(c, expense(5)));
    expect(await alerts()).toEqual(['BudgetWarning']);
  });

  it('emits BudgetExceeded once when going over 100%', async () => {
    await withTransaction(db.pool, (c) => service.onExpenseUpserted(c, expense(20)));
    await withTransaction(db.pool, (c) => service.onExpenseUpserted(c, expense(20)));
    expect(await alerts()).toEqual(['BudgetWarning', 'BudgetExceeded']);
    const { data } = await service.list(userId);
    expect(data[0].usage).toMatchObject({ spent: 130, status: 'exceeded' });
  });

  it('ignores stale (older version) updates', async () => {
    const e = expense(10);
    await withTransaction(db.pool, (c) => service.onExpenseUpserted(c, { ...e, version: 3 }));
    await withTransaction(db.pool, (c) => service.onExpenseUpserted(c, { ...e, amountBase: 999, version: 2 }));
    const { rows } = await db.pool.query('SELECT amount_base FROM budget_transactions WHERE expense_id = $1', [e.expenseId]);
    expect(rows[0].amount_base).toBe(10);
  });
});
