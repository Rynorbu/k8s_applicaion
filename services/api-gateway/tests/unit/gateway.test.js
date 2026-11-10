import http from 'node:http';
import request from 'supertest';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import { setupTestAuth } from '@spendwise/common/testing';
import { buildGateway } from '../../src/app.js';
import { SERVICES, findService, isPublic, isSensitive } from '../../src/routes.js';

describe('route table', () => {
  it('maps public prefixes to services', () => {
    expect(findService('/api/v1/expenses/123').name).toBe('expense');
    expect(findService('/api/v1/expensesX')).toBeUndefined();
    expect(findService('/internal/expenses')).toBeUndefined();
    expect(SERVICES).toHaveLength(16); // + the gateway itself = 17 services
  });

  it('classifies public and sensitive paths', () => {
    expect(isPublic('/api/v1/auth/login')).toBe(true);
    expect(isPublic('/api/v1/expenses')).toBe(false);
    expect(isSensitive('/api/v1/auth/login')).toBe(true);
    expect(isSensitive('/api/v1/auth/me')).toBe(false);
  });
});

describe('gateway', () => {
  let upstream;
  let received = [];
  let app;
  let tokenFor;

  beforeAll(async () => {
    ({ tokenFor } = await setupTestAuth());
    // A fake downstream service that echoes what it received.
    upstream = http.createServer((req, res) => {
      received.push({ url: req.url, headers: req.headers });
      res.setHeader('content-type', 'application/json');
      res.end(JSON.stringify({ ok: true, url: req.url }));
    });
    await new Promise((r) => upstream.listen(0, r));
    const url = `http://127.0.0.1:${upstream.address().port}`;
    const targets = Object.fromEntries(SERVICES.map((s) => [s.name, url]));
    app = buildGateway({
      config: { CORS_ORIGINS: ['http://localhost:3000'], RATE_LIMIT_PER_MINUTE: 1000, USER_RATE_LIMIT_PER_MINUTE: 1000, AUTH_RATE_LIMIT_PER_15MIN: 3, ENABLE_DOCS: false },
      redis: null,
      targets,
      aggregator: { dashboard: vi.fn().mockResolvedValue({ analytics: {}, errors: {}, partial: false }) },
      docsFetcher: vi.fn(),
    });
  });

  afterAll(() => upstream?.close());

  it('rejects unauthenticated requests to protected services', async () => {
    const res = await request(app).get('/api/v1/expenses');
    expect(res.status).toBe(401);
    expect(received).toHaveLength(0);
  });

  it('proxies authenticated requests with tracing headers and strips spoofed internal headers', async () => {
    const res = await request(app)
      .get('/api/v1/expenses?page=2')
      .set('Authorization', `Bearer ${await tokenFor()}`)
      .set('x-internal-token', 'spoofed')
      .set('x-correlation-id', 'corr-from-browser-1');
    expect(res.status).toBe(200);
    expect(res.body.url).toBe('/api/v1/expenses?page=2');
    const last = received.at(-1);
    expect(last.headers['x-internal-token']).toBeUndefined();
    expect(last.headers['x-correlation-id']).toBe('corr-from-browser-1');
    expect(last.headers['x-request-id']).toBeTruthy();
  });

  it('lets auth endpoints through without a token', async () => {
    const res = await request(app).post('/api/v1/auth/refresh');
    expect(res.status).toBe(200);
  });

  it('never exposes internal endpoints', async () => {
    const res = await request(app).get('/internal/expenses');
    expect(res.status).toBe(401);
  });

  it('rate limits brute-force sensitive endpoints', async () => {
    const statuses = [];
    for (let i = 0; i < 5; i += 1) statuses.push((await request(app).post('/api/v1/auth/login').send({})).status);
    expect(statuses.slice(0, 3)).toEqual([200, 200, 200]);
    expect(statuses.at(-1)).toBe(429);
  });

  it('serves the aggregated dashboard', async () => {
    const res = await request(app).get('/api/v1/dashboard').set('Authorization', `Bearer ${await tokenFor()}`);
    expect(res.status).toBe(200);
    expect(res.body.partial).toBe(false);
  });

  it('applies the CORS allow-list', async () => {
    const allowed = await request(app).options('/api/v1/expenses').set('Origin', 'http://localhost:3000').set('Access-Control-Request-Method', 'GET');
    expect(allowed.headers['access-control-allow-origin']).toBe('http://localhost:3000');
    const denied = await request(app).options('/api/v1/expenses').set('Origin', 'https://evil.example').set('Access-Control-Request-Method', 'GET');
    expect(denied.headers['access-control-allow-origin']).toBeUndefined();
  });
});
