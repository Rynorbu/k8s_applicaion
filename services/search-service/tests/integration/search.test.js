/** Integration: full-text search over the projection in PostgreSQL. */
import { randomUUID } from 'node:crypto';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { withTransaction } from '@spendwise/common';
import { createTestDatabase } from '@spendwise/common/testing';
import { createSearchService } from '../../src/service.js';

const DB = process.env.TEST_DATABASE_URL;

describe.skipIf(!DB)('search with PostgreSQL', () => {
  let db;
  let service;
  const userId = randomUUID();
  const base = { userId, currency: 'USD', baseCurrency: 'USD', version: 1, tags: [] };

  beforeAll(async () => {
    db = await createTestDatabase('search_it', new URL('../../migrations', import.meta.url));
    service = createSearchService({ pool: db.pool });
    const docs = [
      ['expense', { ...base, expenseId: randomUUID(), amount: 4.5, amountBase: 4.5, description: 'Morning coffee', merchant: 'Starbucks', expenseDate: '2026-10-01', categoryName: 'Food & Dining', tags: ['work'] }],
      ['expense', { ...base, expenseId: randomUUID(), amount: 1200, amountBase: 1200, description: 'October rent', merchant: 'Landlord', expenseDate: '2026-10-01', categoryName: 'Housing' }],
      ['income', { ...base, incomeId: randomUUID(), amount: 5000, amountBase: 5000, description: 'Salary October', payer: 'ACME Corp', incomeDate: '2026-10-01', categoryName: 'Salary' }],
      ['expense', { ...base, userId: randomUUID(), expenseId: randomUUID(), amount: 3, amountBase: 3, description: 'Coffee (other user)', expenseDate: '2026-10-01' }],
    ];
    for (const [kind, doc] of docs) await withTransaction(db.pool, (c) => service.index(c, kind, doc));
  });

  afterAll(async () => db?.drop());

  it('finds by description, merchant and category name, scoped to the user', async () => {
    const coffee = await service.search(userId, { q: 'coffee', page: 1, pageSize: 10, sort: 'relevance' });
    expect(coffee.data).toHaveLength(1);
    expect(coffee.data[0].counterparty).toBe('Starbucks');
    expect((await service.search(userId, { q: 'starbucks', page: 1, pageSize: 10, sort: 'relevance' })).data).toHaveLength(1);
    expect((await service.search(userId, { q: 'housing', page: 1, pageSize: 10, sort: 'relevance' })).data).toHaveLength(1);
  });

  it('supports partial words via trigram fallback and facets', async () => {
    const res = await service.search(userId, { q: 'octo', page: 1, pageSize: 10, sort: 'relevance' });
    expect(res.pagination.total).toBe(2);
    expect(res.facets.type).toEqual({ expense: 1, income: 1 });
  });

  it('suggests terms', async () => {
    const res = await service.suggest(userId, 'sal');
    expect(res.suggestions).toContain('Salary October');
  });
});
