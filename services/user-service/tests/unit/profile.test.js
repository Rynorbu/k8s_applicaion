import request from 'supertest';
import { beforeAll, describe, expect, it, vi } from 'vitest';
import { setupTestAuth } from '@spendwise/common/testing';
import { buildApp, updateProfileSchema } from '../../src/app.js';
import { toProfile } from '../../src/service.js';

describe('profile validation', () => {
  it('accepts valid preferences and normalises currency', () => {
    expect(updateProfileSchema.parse({ baseCurrency: 'eur', timezone: 'Asia/Kathmandu', theme: 'dark' })).toEqual({
      baseCurrency: 'EUR',
      timezone: 'Asia/Kathmandu',
      theme: 'dark',
    });
  });

  it('rejects unknown timezones and unexpected fields (mass assignment)', () => {
    expect(updateProfileSchema.safeParse({ timezone: 'Mars/Olympus' }).success).toBe(false);
    expect(updateProfileSchema.safeParse({ email: 'evil@example.com' }).success).toBe(false);
    expect(updateProfileSchema.safeParse({ roles: ['admin'] }).success).toBe(false);
  });

  it('maps database rows to API shape', () => {
    expect(toProfile({ user_id: 'u', email: 'e', name: 'n', base_currency: 'USD' })).toMatchObject({
      userId: 'u',
      baseCurrency: 'USD',
    });
  });
});

describe('profile API', () => {
  let app;
  let tokenFor;
  const service = { get: vi.fn(), update: vi.fn() };

  beforeAll(async () => {
    ({ tokenFor } = await setupTestAuth());
    app = buildApp({ service });
  });

  it('returns the caller profile only', async () => {
    const userId = '22222222-2222-4222-8222-222222222222';
    service.get.mockResolvedValue({ userId });
    const res = await request(app).get('/api/v1/users/me').set('Authorization', `Bearer ${await tokenFor(userId)}`);
    expect(res.status).toBe(200);
    expect(service.get).toHaveBeenCalledWith(userId);
  });

  it('rejects invalid updates', async () => {
    const res = await request(app)
      .patch('/api/v1/users/me')
      .set('Authorization', `Bearer ${await tokenFor()}`)
      .send({ baseCurrency: 'DOLLARS' });
    expect(res.status).toBe(400);
  });
});
