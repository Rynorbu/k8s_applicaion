/** Integration: append-only enforcement and chain verification in PostgreSQL. */
import { randomUUID } from 'node:crypto';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { withTransaction } from '@spendwise/common';
import { createTestDatabase } from '@spendwise/common/testing';
import { createAuditService } from '../../src/service.js';

const DB = process.env.TEST_DATABASE_URL;

describe.skipIf(!DB)('audit log with PostgreSQL', () => {
  let db;
  let service;
  const userId = randomUUID();

  beforeAll(async () => {
    db = await createTestDatabase('audit_it', new URL('../../migrations', import.meta.url));
    service = createAuditService({ pool: db.pool });
    for (let i = 0; i < 5; i += 1) {
      const event = { id: randomUUID(), type: 'ExpenseCreated', source: 'expense-service', userId, occurredAt: new Date().toISOString(), correlationId: 'corr-audit-1', data: { amount: i, token: 'secret' } };
      await withTransaction(db.pool, (c) => service.record(c, event));
      await withTransaction(db.pool, (c) => service.record(c, event)); // duplicate delivery is ignored
    }
  });

  afterAll(async () => {
    // Triggers block DROP of rows but not of the schema.
    await db?.drop();
  });

  it('stores redacted, de-duplicated entries', async () => {
    const page = await service.list({ actorId: userId, page: 1, pageSize: 10 });
    expect(page.pagination.total).toBe(5);
    expect(page.data[0].payload.token).toBe('[REDACTED]');
  });

  it('verifies the chain', async () => {
    expect(await service.verify()).toMatchObject({ valid: true, checked: 5 });
  });

  it('rejects updates and deletes at the database level', async () => {
    await expect(db.pool.query(`UPDATE audit_logs SET payload = '{}'::jsonb`)).rejects.toThrow(/append-only/);
    await expect(db.pool.query('DELETE FROM audit_logs')).rejects.toThrow(/append-only/);
  });
});
