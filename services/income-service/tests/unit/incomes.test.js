import request from 'supertest';
import { beforeAll, describe, expect, it, vi } from 'vitest';
import { setupTestAuth } from '@spendwise/common/testing';
import { buildApp, createIncomeSchema } from '../../src/app.js';
import { buildListQuery, toEventPayload, toIncome } from '../../src/service.js';

describe('income validation', () => {
  it('applies defaults and normalisation', () => {
    expect(createIncomeSchema.parse({ amount: '2500', description: 'October salary', incomeDate: '2026-10-01', payer: ' ACME ' })).toMatchObject({
      amount: 2500,
      receivedVia: 'bank_transfer',
      payer: 'ACME',
      tags: [],
    });
  });

  it('rejects invalid values', () => {
    expect(createIncomeSchema.safeParse({ amount: 0, description: 'x', incomeDate: '2026-10-01' }).success).toBe(false);
    expect(createIncomeSchema.safeParse({ amount: 10, description: '', incomeDate: '2026-10-01' }).success).toBe(false);
  });
});

describe('income mapping', () => {
  it('produces a complete event snapshot', () => {
    const income = toIncome({
      id: 'i1', user_id: 'u1', amount: 100, currency: 'USD', amount_base: 100, base_currency: 'USD', exchange_rate: 1,
      category_id: 'c', category_name: 'Salary', category_color: '#16a34a', category_icon: 'briefcase', description: 'Pay',
      payer: 'ACME', received_via: 'bank_transfer', income_date: '2026-10-01', tags: [], origin: 'manual', version: 1,
    });
    expect(toEventPayload(income)).toMatchObject({ incomeId: 'i1', userId: 'u1', amountBase: 100, categoryName: 'Salary', payer: 'ACME' });
  });

  it('searches description and payer', () => {
    expect(buildListQuery('u', { q: 'acme' }).where).toContain('payer ILIKE');
  });
});

describe('income API', () => {
  let app;
  let tokenFor;
  const service = { create: vi.fn().mockResolvedValue({ id: 'i1' }), get: vi.fn() };

  beforeAll(async () => {
    ({ tokenFor } = await setupTestAuth());
    app = buildApp({ service });
  });

  it('requires authentication', async () => {
    expect((await request(app).get('/api/v1/incomes')).status).toBe(401);
  });

  it('creates income', async () => {
    const res = await request(app)
      .post('/api/v1/incomes')
      .set('Authorization', `Bearer ${await tokenFor()}`)
      .send({ amount: 1000, description: 'Freelance project', incomeDate: '2026-10-02' });
    expect(res.status).toBe(201);
  });
});
