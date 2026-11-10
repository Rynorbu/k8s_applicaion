import request from 'supertest';
import { describe, expect, it, beforeAll } from 'vitest';
import { z } from 'zod';
import {
  ApiRouter,
  buildOpenApi,
  createApp,
  escapeLike,
  isoDate,
  money,
  paginated,
  routingKeyFor,
  safeText,
  toErrorResponse,
  AppError,
} from '../../src/index.js';
import { setupTestAuth } from '../../src/testing.js';

describe('events', () => {
  it('derives topic routing keys from event names', () => {
    expect(routingKeyFor('ExpenseCreated')).toBe('expense.created');
    expect(routingKeyFor('RecurringTransactionDue')).toBe('recurring.transaction.due');
    expect(routingKeyFor('GoalMilestoneReached')).toBe('goal.milestone.reached');
  });
});

describe('schemas', () => {
  it('validates money with at most two decimals', () => {
    expect(money.parse('12.5')).toBe(12.5);
    expect(money.safeParse(12.345).success).toBe(false);
    expect(money.safeParse(-1).success).toBe(false);
    expect(money.safeParse(0).success).toBe(false);
  });

  it('rejects impossible calendar dates', () => {
    expect(isoDate.safeParse('2024-02-29').success).toBe(true);
    expect(isoDate.safeParse('2023-02-29').success).toBe(false);
    expect(isoDate.safeParse('2024-13-01').success).toBe(false);
  });

  it('strips control characters from free text', () => {
    expect(safeText(20).parse('  hi\u0000there ')).toBe('hithere');
  });

  it('escapes LIKE wildcards', () => {
    expect(escapeLike('50%_off\\')).toBe('50\\%\\_off\\\\');
  });

  it('builds pagination metadata', () => {
    expect(paginated([1], { page: 2, pageSize: 10 }, 25).pagination).toEqual({
      page: 2,
      pageSize: 10,
      total: 25,
      totalPages: 3,
    });
  });
});

describe('error mapping', () => {
  it('never leaks internal error messages', () => {
    const res = toErrorResponse(new Error('connection string postgres://secret'));
    expect(res.status).toBe(500);
    expect(res.message).not.toContain('secret');
  });

  it('maps unique violations to 409', () => {
    expect(toErrorResponse({ code: '23505' }).status).toBe(409);
  });
});

describe('ApiRouter + createApp', () => {
  let tokenFor;
  let internalToken;
  let app;

  beforeAll(async () => {
    ({ tokenFor, internalToken } = await setupTestAuth());
    const router = new ApiRouter({ prefix: '/api/v1/things', tags: ['Things'] });
    router.post('/', {
      summary: 'Create thing',
      status: 201,
      body: z.object({ name: z.string().min(2), amount: money }),
      handler: (req) => ({ ...req.valid.body, owner: req.user.id }),
    });
    router.get('/boom', { auth: 'none', handler: () => { throw new Error('db password leaked'); } });
    router.get('/conflict', { auth: 'none', handler: () => { throw new AppError(409, 'CONFLICT', 'nope'); } });
    const internal = new ApiRouter({ prefix: '/internal' });
    internal.get('/ping', { auth: 'internal', handler: () => ({ pong: true }) });
    app = createApp({ name: 'test-service', routers: [router, internal] });
  });

  it('rejects requests without a token', async () => {
    const res = await request(app).post('/api/v1/things').send({ name: 'ok', amount: 1 });
    expect(res.status).toBe(401);
    expect(res.body.error.code).toBe('UNAUTHORIZED');
  });

  it('validates bodies and returns structured errors', async () => {
    const token = await tokenFor();
    const res = await request(app).post('/api/v1/things').set('Authorization', `Bearer ${token}`).send({ name: 'x', amount: 'abc' });
    expect(res.status).toBe(400);
    expect(res.body.error.code).toBe('VALIDATION_ERROR');
    expect(res.body.error.details.map((d) => d.path)).toEqual(expect.arrayContaining(['name', 'amount']));
  });

  it('runs the handler for valid authenticated requests', async () => {
    const token = await tokenFor('11111111-1111-4111-8111-111111111111');
    const res = await request(app).post('/api/v1/things').set('Authorization', `Bearer ${token}`).send({ name: 'ok', amount: '9.99' });
    expect(res.status).toBe(201);
    expect(res.body).toEqual({ name: 'ok', amount: 9.99, owner: '11111111-1111-4111-8111-111111111111' });
    expect(res.headers['x-request-id']).toBeTruthy();
  });

  it('hides internal errors', async () => {
    const res = await request(app).get('/api/v1/things/boom');
    expect(res.status).toBe(500);
    expect(JSON.stringify(res.body)).not.toContain('password');
  });

  it('passes through application errors', async () => {
    const res = await request(app).get('/api/v1/things/conflict');
    expect(res.status).toBe(409);
  });

  it('protects internal routes with the internal token', async () => {
    expect((await request(app).get('/internal/ping')).status).toBe(401);
    const ok = await request(app).get('/internal/ping').set('x-internal-token', internalToken);
    expect(ok.body).toEqual({ pong: true });
  });

  it('propagates incoming correlation ids', async () => {
    const res = await request(app).get('/health/live').set('x-correlation-id', 'corr-12345678');
    expect(res.headers['x-correlation-id']).toBe('corr-12345678');
  });

  it('sets security headers', async () => {
    const res = await request(app).get('/health/live');
    expect(res.headers['x-content-type-options']).toBe('nosniff');
    expect(res.headers['x-powered-by']).toBeUndefined();
  });

  it('serves an OpenAPI document generated from route definitions', async () => {
    const res = await request(app).get('/docs/openapi.json');
    expect(res.body.openapi).toBe('3.0.3');
    expect(res.body.paths['/api/v1/things'].post.requestBody).toBeDefined();
  });
});

describe('buildOpenApi', () => {
  it('converts express params to OpenAPI path params', () => {
    const r = new ApiRouter({ prefix: '/x' });
    r.get('/:id', { params: z.object({ id: z.string().uuid() }), handler: () => ({}) });
    const spec = buildOpenApi({ title: 't', routers: [r] });
    expect(spec.paths['/x/{id}'].get.parameters[0]).toMatchObject({ name: 'id', in: 'path', required: true });
  });
});
