/** Integration: the scheduler catches up missed occurrences exactly once. */
import { randomUUID } from 'node:crypto';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createTestDatabase } from '@spendwise/common/testing';
import { createRecurringService } from '../../src/service.js';

const DB = process.env.TEST_DATABASE_URL;

describe.skipIf(!DB)('recurring scheduler with PostgreSQL', () => {
  let db;
  let service;
  const userId = randomUUID();

  beforeAll(async () => {
    db = await createTestDatabase('recurring_it', new URL('../../migrations', import.meta.url));
    service = createRecurringService({ pool: db.pool, clients: { categories: { get: async () => ({}) } } });
  });

  afterAll(async () => db?.drop());

  it('generates all missed occurrences, emits events, and is idempotent', async () => {
    const rule = await service.create(userId, {
      type: 'expense', description: 'Gym', amount: 30, frequency: 'weekly', intervalCount: 1, startDate: '2026-09-01',
    });
    const first = await service.runDue('2026-09-29');
    expect(first).toBe(5); // Sep 1, 8, 15, 22, 29
    expect(await service.runDue('2026-09-29')).toBe(0);
    const { rows } = await db.pool.query(`SELECT count(*)::int AS n FROM outbox WHERE event_type = 'RecurringTransactionDue'`);
    expect(rows[0].n).toBe(5);
    const detail = await service.get(userId, rule.id);
    expect(detail.nextRunDate).toBe('2026-10-06');
    expect(detail.occurrencesGenerated).toBe(5);
  });

  it('completes rules that reach their max occurrences', async () => {
    const rule = await service.create(userId, {
      type: 'income', description: 'Bonus', amount: 100, frequency: 'monthly', intervalCount: 1, startDate: '2026-01-15', maxOccurrences: 2,
    });
    await service.runDue('2026-12-31');
    const detail = await service.get(userId, rule.id);
    expect(detail).toMatchObject({ status: 'completed', occurrencesGenerated: 2, nextRunDate: null });
  });
});
