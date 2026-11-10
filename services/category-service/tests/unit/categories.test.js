import request from 'supertest';
import { beforeAll, describe, expect, it, vi } from 'vitest';
import { setupTestAuth } from '@spendwise/common/testing';
import { buildApp, createCategorySchema } from '../../src/app.js';
import { confidenceOf, suggestCategory } from '../../src/suggest.js';

const categories = [
  { id: 'food', type: 'expense', name: 'Food & Dining', keywords: ['restaurant', 'coffee', 'starbucks'], userId: null },
  { id: 'transport', type: 'expense', name: 'Transportation', keywords: ['uber', 'taxi', 'fuel'], userId: null },
  { id: 'subs', type: 'expense', name: 'Subscriptions', keywords: ['netflix', 'spotify'], userId: null },
  { id: 'pets', type: 'expense', name: 'Pets', keywords: ['vet', 'dog food'], userId: 'u1' },
  { id: 'salary', type: 'income', name: 'Salary', keywords: ['payroll', 'salary'], userId: null },
];

describe('suggestCategory', () => {
  it('matches keywords in description or merchant', () => {
    expect(suggestCategory(categories, { type: 'expense', description: 'Morning coffee', merchant: 'Starbucks' }).category.id).toBe('food');
    expect(suggestCategory(categories, { type: 'expense', description: 'Uber to airport' }).category.id).toBe('transport');
  });

  it('respects the transaction type', () => {
    expect(suggestCategory(categories, { type: 'income', description: 'ACME payroll October' }).category.id).toBe('salary');
    expect(suggestCategory(categories, { type: 'income', description: 'Netflix' }).category).toBeNull();
  });

  it('prefers user categories and specific keywords', () => {
    expect(suggestCategory(categories, { type: 'expense', description: 'Dog food from pet store' }).category.id).toBe('pets');
  });

  it('returns no match for unrelated text', () => {
    const result = suggestCategory(categories, { type: 'expense', description: 'zzz qqq' });
    expect(result.category).toBeNull();
    expect(confidenceOf(result.score)).toBe('none');
  });
});

describe('category validation', () => {
  it('validates colours and icons', () => {
    expect(createCategorySchema.safeParse({ type: 'expense', name: 'Pets', color: 'red' }).success).toBe(false);
    expect(createCategorySchema.safeParse({ type: 'expense', name: 'Pets', icon: '<script>' }).success).toBe(false);
    expect(createCategorySchema.parse({ type: 'expense', name: ' Pets ' })).toMatchObject({ name: 'Pets', color: '#64748b' });
  });
});

describe('category API', () => {
  let app;
  let tokenFor;
  let internalToken;
  const service = { list: vi.fn().mockResolvedValue([]), resolve: vi.fn().mockResolvedValue({ id: 'x' }) };

  beforeAll(async () => {
    ({ tokenFor, internalToken } = await setupTestAuth());
    app = buildApp({ service });
  });

  it('lists categories for the authenticated user', async () => {
    const userId = '33333333-3333-4333-8333-333333333333';
    const res = await request(app).get('/api/v1/categories?type=income').set('Authorization', `Bearer ${await tokenFor(userId)}`);
    expect(res.status).toBe(200);
    expect(service.list).toHaveBeenCalledWith(userId, 'income');
  });

  it('exposes resolve only to internal callers', async () => {
    const body = { userId: '33333333-3333-4333-8333-333333333333', type: 'expense', name: 'Groceries' };
    expect((await request(app).post('/internal/categories/resolve').send(body)).status).toBe(401);
    const res = await request(app).post('/internal/categories/resolve').set('x-internal-token', internalToken).send(body);
    expect(res.status).toBe(200);
  });
});

describe('internal resolve contract', () => {
  it('accepts null optional fields from event-driven callers', async () => {
    const { internalToken } = await setupTestAuth();
    const service = { resolve: vi.fn().mockResolvedValue({ id: 'x' }) };
    const app = buildApp({ service });
    const res = await request(app)
      .post('/internal/categories/resolve')
      .set('x-internal-token', internalToken)
      .send({ userId: '33333333-3333-4333-8333-333333333333', type: 'expense', name: null, description: 'Netflix', merchant: null });
    expect(res.status).toBe(200);
  });
});
