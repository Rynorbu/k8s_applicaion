/** Integration: event projection + analytics queries against PostgreSQL. */
import { randomUUID } from 'node:crypto';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { withTransaction } from '@spendwise/common';
import { createTestDatabase } from '@spendwise/common/testing';
import { createAnalyticsService } from '../../src/service.js';

const DB = process.env.TEST_DATABASE_URL;

describe.skipIf(!DB)('analytics projection', () => {
  let db;
  let service;
  const userId = randomUUID();
  const food = { categoryId: randomUUID(), categoryName: 'Food', categoryColor: '#f97316' };

  beforeAll(async () => {
    db = await createTestDatabase('analytics_it', new URL('../../migrations', import.meta.url));
    service = createAnalyticsService({ pool: db.pool, redis: null });
    const run = (fn) => withTransaction(db.pool, fn);
    await run((c) => service.upsertTransaction(c, 'income', { incomeId: randomUUID(), userId, amountBase: 3000, baseCurrency: 'USD', incomeDate: '2026-09-01', version: 1 }));
    await run((c) => service.upsertTransaction(c, 'expense', { expenseId: randomUUID(), userId, amountBase: 100, baseCurrency: 'USD', expenseDate: '2026-09-05', merchant: 'Cafe', ...food, version: 1 }));
    const e = { expenseId: randomUUID(), userId, amountBase: 50, baseCurrency: 'USD', expenseDate: '2026-09-06', ...food, version: 1 };
    await run((c) => service.upsertTransaction(c, 'expense', e));
    await run((c) => service.upsertTransaction(c, 'expense', { ...e, amountBase: 400, version: 2 }));
    await run((c) => service.upsertTransaction(c, 'expense', { ...e, amountBase: 1, version: 1 })); // stale, ignored
    const deleted = { expenseId: randomUUID(), userId, amountBase: 999, baseCurrency: 'USD', expenseDate: '2026-09-07', ...food };
    await run((c) => service.deleteTransaction(c, 'expense', deleted)); // delete arrives first
    await run((c) => service.upsertTransaction(c, 'expense', { ...deleted, version: 1 })); // late create stays deleted
  });

  afterAll(async () => db?.drop());

  it('summarises a period', async () => {
    const s = await service.summary(userId, { from: '2026-09-01', to: '2026-09-30' });
    expect(s).toMatchObject({ totalIncome: 3000, totalExpenses: 500, net: 2500, savingsRate: 83.33, expenseCount: 2 });
  });

  it('breaks spending down by category', async () => {
    const c = await service.categories(userId, { type: 'expense', from: '2026-09-01', to: '2026-09-30' });
    expect(c.data[0]).toMatchObject({ name: 'Food', total: 500, percentage: 100 });
  });

  it('builds weekly trends', async () => {
    const t = await service.trends(userId, { granularity: 'week', from: '2026-09-01', to: '2026-09-14' });
    expect(t.data.map((p) => p.period)).toEqual(['2026-08-31', '2026-09-07', '2026-09-14']);
    expect(t.data[0]).toMatchObject({ income: 3000, expenses: 500 });
  });
});
