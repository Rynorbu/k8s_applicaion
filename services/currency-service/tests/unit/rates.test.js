import request from 'supertest';
import { beforeAll, describe, expect, it, vi } from 'vitest';
import { setupTestAuth } from '@spendwise/common/testing';
import { buildApp } from '../../src/app.js';
import { convertAmount, crossRate, parseProviderResponse, rebase } from '../../src/rates.js';

const rates = { USD: 1, EUR: 0.9, NPR: 133.5, JPY: 150 };

describe('rate math', () => {
  it('computes cross rates through USD', () => {
    expect(crossRate(rates, 'EUR', 'NPR')).toBeCloseTo(148.3333, 3);
    expect(crossRate(rates, 'USD', 'USD')).toBe(1);
    expect(crossRate(rates, 'USD', 'XXX')).toBeNull();
  });

  it('converts and rounds amounts', () => {
    expect(convertAmount(rates, { from: 'USD', to: 'EUR', amount: 10 })).toEqual({ rate: 0.9, converted: 9 });
    expect(convertAmount(rates, { from: 'EUR', to: 'USD', amount: 9 }).converted).toBe(10);
  });

  it('rebases a table', () => {
    expect(rebase(rates, 'EUR').USD).toBeCloseTo(1.1111, 3);
    expect(rebase(rates, 'EUR').EUR).toBe(1);
  });

  it('parses provider responses with a non-USD base', () => {
    const parsed = parseProviderResponse({ base: 'EUR', date: '2026-10-13', rates: { USD: 1.1, GBP: 0.85, BAD: 'x' } });
    expect(parsed.asOf).toBe('2026-10-13');
    expect(parsed.rates.USD).toBe(1);
    expect(parsed.rates.EUR).toBeCloseTo(0.909, 3);
    expect(parsed.rates.BAD).toBeUndefined();
  });

  it('rejects malformed provider responses', () => {
    expect(() => parseProviderResponse({ rates: {} })).toThrow();
  });
});

describe('currency API', () => {
  let app;
  let tokenFor;
  const service = { convert: vi.fn().mockResolvedValue({ converted: 1 }), refresh: vi.fn().mockResolvedValue({}) };

  beforeAll(async () => {
    ({ tokenFor } = await setupTestAuth());
    app = buildApp({ service });
  });

  it('validates conversion queries', async () => {
    const token = await tokenFor();
    const bad = await request(app).get('/api/v1/currencies/convert?from=US&to=EUR&amount=1').set('Authorization', `Bearer ${token}`);
    expect(bad.status).toBe(400);
    const ok = await request(app).get('/api/v1/currencies/convert?from=usd&to=eur&amount=5').set('Authorization', `Bearer ${token}`);
    expect(ok.status).toBe(200);
    expect(service.convert).toHaveBeenCalledWith({ from: 'USD', to: 'EUR', amount: 5 });
  });

  it('restricts manual refresh to admins', async () => {
    const user = await request(app).post('/api/v1/currencies/refresh').set('Authorization', `Bearer ${await tokenFor()}`);
    expect(user.status).toBe(403);
    const admin = await request(app)
      .post('/api/v1/currencies/refresh')
      .set('Authorization', `Bearer ${await tokenFor(undefined, { roles: ['user', 'admin'] })}`);
    expect(admin.status).toBe(200);
  });
});
