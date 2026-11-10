import request from 'supertest';
import { beforeAll, describe, expect, it, vi } from 'vitest';
import { setupTestAuth } from '@spendwise/common/testing';
import { buildApp, createExpenseSchema, listQuerySchema, updateExpenseSchema } from '../../src/app.js';
import { buildListQuery } from '../../src/service.js';

describe('expense validation', () => {
  it('normalises a valid expense', () => {
    const parsed = createExpenseSchema.parse({ amount: '12.50', currency: 'eur', description: '  Lunch ', expenseDate: '2026-10-01' });
    expect(parsed).toMatchObject({ amount: 12.5, currency: 'EUR', description: 'Lunch', paymentMethod: 'card', tags: [] });
  });

  it('rejects negative amounts, bad dates and oversize text', () => {
    expect(createExpenseSchema.safeParse({ amount: -5, description: 'x', expenseDate: '2026-10-01' }).success).toBe(false);
    expect(createExpenseSchema.safeParse({ amount: 5, description: 'x', expenseDate: '2026-02-30' }).success).toBe(false);
    expect(createExpenseSchema.safeParse({ amount: 5, description: 'x'.repeat(300), expenseDate: '2026-10-01' }).success).toBe(false);
  });

  it('requires at least one field on update', () => {
    expect(updateExpenseSchema.safeParse({}).success).toBe(false);
    expect(updateExpenseSchema.safeParse({ version: 2 }).success).toBe(false);
    expect(updateExpenseSchema.safeParse({ amount: 3 }).success).toBe(true);
  });

  it('validates date ranges', () => {
    expect(listQuerySchema.safeParse({ from: '2026-10-10', to: '2026-10-01' }).success).toBe(false);
  });
});

describe('buildListQuery', () => {
  it('parameterises every filter (no SQL injection surface)', () => {
    const q = buildListQuery('user-1', {
      from: '2026-01-01',
      categoryId: 'c1',
      minAmount: 10,
      q: "'; DROP TABLE expenses; --",
      sort: 'amount_desc',
    });
    expect(q.where).not.toContain('DROP');
    expect(q.params).toContain("%'; DROP TABLE expenses; --%");
    expect(q.where).toContain('description ILIKE $5');
    expect(q.orderBy).toBe('amount_base DESC, expense_date DESC');
  });

  it('falls back to a safe sort for unknown values', () => {
    expect(buildListQuery('u', { sort: 'id; DROP' }).orderBy).toBe('expense_date DESC, created_at DESC');
  });
});

describe('expense API', () => {
  let app;
  let tokenFor;
  const userId = '44444444-4444-4444-8444-444444444444';
  const service = {
    create: vi.fn().mockImplementation((uid, body) => ({ id: 'e1', userId: uid, ...body })),
    list: vi.fn().mockResolvedValue({ data: [], pagination: {} }),
    remove: vi.fn().mockResolvedValue(),
  };

  beforeAll(async () => {
    ({ tokenFor } = await setupTestAuth());
    app = buildApp({ service });
  });

  it('creates an expense for the authenticated user only', async () => {
    const res = await request(app)
      .post('/api/v1/expenses')
      .set('Authorization', `Bearer ${await tokenFor(userId)}`)
      .send({ amount: 9.99, description: 'Coffee', expenseDate: '2026-10-01', userId: 'someone-else' });
    expect(res.status).toBe(201);
    expect(service.create).toHaveBeenCalledWith(userId, expect.not.objectContaining({ userId: 'someone-else' }));
  });

  it('passes parsed filters to the service', async () => {
    await request(app)
      .get('/api/v1/expenses?page=2&pageSize=5&minAmount=10&sort=amount_asc')
      .set('Authorization', `Bearer ${await tokenFor(userId)}`);
    expect(service.list).toHaveBeenCalledWith(userId, expect.objectContaining({ page: 2, pageSize: 5, minAmount: 10, sort: 'amount_asc' }));
  });

  it('rejects malformed ids', async () => {
    const res = await request(app).delete('/api/v1/expenses/not-a-uuid').set('Authorization', `Bearer ${await tokenFor(userId)}`);
    expect(res.status).toBe(400);
  });

  it('returns 204 on delete', async () => {
    const res = await request(app)
      .delete('/api/v1/expenses/55555555-5555-4555-8555-555555555555')
      .set('Authorization', `Bearer ${await tokenFor(userId)}`);
    expect(res.status).toBe(204);
  });
});
