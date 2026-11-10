/**
 * System end-to-end test: exercises the real, running stack through the API gateway
 * (docker compose up). Verifies synchronous REST paths AND the asynchronous,
 * event-driven flows across services (RabbitMQ), including correlation-id propagation.
 *
 *   GATEWAY_URL=http://localhost:8080 node --test tests/e2e/
 */
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { after, before, describe, it } from 'node:test';

const GATEWAY = process.env.GATEWAY_URL ?? 'http://localhost:8080';
const today = new Date().toISOString().slice(0, 10);

class Client {
  constructor() {
    this.token = null;
    this.cookie = null;
  }

  async call(method, path, { body, headers = {}, raw = false, form } = {}) {
    const res = await fetch(`${GATEWAY}/api/v1${path}`, {
      method,
      headers: {
        'x-requested-with': 'XMLHttpRequest',
        ...(body ? { 'content-type': 'application/json' } : {}),
        ...(this.token ? { authorization: `Bearer ${this.token}` } : {}),
        ...(this.cookie ? { cookie: this.cookie } : {}),
        ...headers,
      },
      body: form ?? (body ? JSON.stringify(body) : undefined),
    });
    const setCookie = res.headers.get('set-cookie');
    if (setCookie?.startsWith('sw_refresh=')) this.cookie = setCookie.split(';')[0];
    if (raw) return res;
    const text = await res.text();
    const data = text ? JSON.parse(text) : undefined;
    return { status: res.status, data, headers: res.headers };
  }

  get = (p, o) => this.call('GET', p, o);
  post = (p, body, o) => this.call('POST', p, { ...o, body });
  patch = (p, body, o) => this.call('PATCH', p, { ...o, body });
  del = (p, o) => this.call('DELETE', p, o);
}

/** Polls until `check` returns a truthy value (eventual consistency across services). */
async function eventually(check, { timeoutMs = 30_000, intervalMs = 500, label = 'condition' } = {}) {
  const start = Date.now();
  let last;
  while (Date.now() - start < timeoutMs) {
    try {
      last = await check();
      if (last) return last;
    } catch (err) {
      last = err;
    }
    await new Promise((r) => setTimeout(r, intervalMs));
  }
  throw new Error(`Timed out waiting for ${label}: ${last instanceof Error ? last.message : JSON.stringify(last)}`);
}

async function register(client, name) {
  const email = `e2e-${randomUUID().slice(0, 8)}@example.com`;
  const res = await client.post('/auth/register', { email, password: 'E2eStr0ngPassw0rd', name });
  assert.equal(res.status, 201, JSON.stringify(res.data));
  client.token = res.data.accessToken;
  client.user = res.data.user;
  return res.data;
}

describe('SpendWise end-to-end', { timeout: 300_000 }, () => {
  const alice = new Client();
  const mallory = new Client();
  let expense;

  before(async () => {
    await eventually(async () => (await fetch(`${GATEWAY}/health/ready`)).ok, { label: 'gateway ready', timeoutMs: 120_000 });
    await register(alice, 'Alice Example');
    await register(mallory, 'Mallory Attacker');
  });

  after(async () => {
    await alice.post('/auth/logout').catch(() => {});
  });

  it('creates the profile asynchronously from UserRegistered', async () => {
    const profile = await eventually(async () => {
      const res = await alice.get('/users/me');
      return res.status === 200 && res.data;
    }, { label: 'profile' });
    assert.equal(profile.baseCurrency, 'USD');
    assert.equal(profile.name, 'Alice Example');
  });

  it('rejects unauthenticated access and never exposes internal endpoints', async () => {
    const anon = await fetch(`${GATEWAY}/api/v1/expenses`);
    assert.equal(anon.status, 401);
    const internal = await fetch(`${GATEWAY}/internal/expenses?userId=${alice.user.id}`);
    assert.notEqual(internal.status, 200);
  });

  it('validates input', async () => {
    const res = await alice.post('/expenses', { amount: -5, description: '', expenseDate: 'yesterday' });
    assert.equal(res.status, 400);
    assert.equal(res.data.error.code, 'VALIDATION_ERROR');
  });

  it('creates a budget, income and an auto-categorized expense', async () => {
    const budget = await alice.post('/budgets', { name: 'Monthly spending', amount: 100, period: 'monthly', alertThreshold: 80 });
    assert.equal(budget.status, 201, JSON.stringify(budget.data));
    const income = await alice.post('/incomes', { amount: 3000, description: 'Salary payroll', incomeDate: today });
    assert.equal(income.status, 201, JSON.stringify(income.data));
    assert.equal(income.data.category.name, 'Salary');

    const res = await alice.post(
      '/expenses',
      { amount: 85, description: 'Weekly groceries at the supermarket', merchant: 'Whole Foods', expenseDate: today, tags: ['food'] },
      { headers: { 'x-correlation-id': 'e2e-correlation-0001' } },
    );
    assert.equal(res.status, 201, JSON.stringify(res.data));
    assert.equal(res.data.category.name, 'Groceries');
    assert.equal(res.headers.get('x-correlation-id'), 'e2e-correlation-0001');
    expense = res.data;
  });

  it('isolates tenants: another user cannot read or delete the expense', async () => {
    assert.equal((await mallory.get(`/expenses/${expense.id}`)).status, 404);
    assert.equal((await mallory.del(`/expenses/${expense.id}`)).status, 404);
  });

  it('ExpenseCreated -> budget-service emits BudgetWarning -> notification-service notifies', async () => {
    const notification = await eventually(async () => {
      const res = await alice.get('/notifications');
      return res.data?.data?.find((n) => n.type === 'budget_warning');
    }, { label: 'budget warning notification' });
    assert.match(notification.message, /85% of your "Monthly spending" budget/);
  });

  it('ExpenseCreated -> analytics & search projections', async () => {
    const summary = await eventually(async () => {
      const res = await alice.get(`/analytics/summary?from=${today}&to=${today}`);
      return res.data?.totalExpenses === 85 && res.data;
    }, { label: 'analytics projection' });
    assert.equal(summary.totalIncome, 3000);
    const search = await eventually(async () => {
      const res = await alice.get('/search?q=groceries');
      return res.data?.data?.length === 1 && res.data;
    }, { label: 'search index' });
    assert.equal(search.data[0].counterparty, 'Whole Foods');
  });

  it('propagates the correlation id from the client through RabbitMQ into the audit log', async () => {
    const entries = await eventually(async () => {
      const res = await alice.get('/audit?correlationId=e2e-correlation-0001');
      return res.data?.data?.length >= 1 && res.data.data;
    }, { label: 'audit entry by correlation id' });
    assert.ok(entries.some((e) => e.eventType === 'ExpenseCreated'));
  });

  it('updating past the limit emits BudgetExceeded', async () => {
    const res = await alice.patch(`/expenses/${expense.id}`, { amount: 120, version: expense.version });
    assert.equal(res.status, 200, JSON.stringify(res.data));
    const stale = await alice.patch(`/expenses/${expense.id}`, { amount: 1, version: expense.version });
    assert.equal(stale.status, 409, 'optimistic concurrency');
    await eventually(async () => (await alice.get('/notifications')).data?.data?.some((n) => n.type === 'budget_exceeded'), { label: 'budget exceeded' });
  });

  it('recurring rules generate transactions automatically', async () => {
    const rule = await alice.post('/recurring', { type: 'expense', description: 'Netflix subscription', amount: 15.99, frequency: 'monthly', startDate: today });
    assert.equal(rule.status, 201, JSON.stringify(rule.data));
    const generated = await eventually(async () => {
      const res = await alice.get('/expenses?origin=recurring');
      return res.data?.data?.find((e) => e.recurringId === rule.data.id);
    }, { label: 'generated recurring expense', timeoutMs: 60_000 });
    assert.equal(generated.category.name, 'Subscriptions');
  });

  it('goals announce milestones', async () => {
    const goal = await alice.post('/goals', { name: 'Emergency fund', targetAmount: 1000 });
    assert.equal(goal.status, 201);
    const contribution = await alice.post(`/goals/${goal.data.id}/contributions`, { amount: 600 });
    assert.equal(contribution.data.progress.percentage, 60);
    await eventually(async () => (await alice.get('/notifications')).data?.data?.some((n) => n.type === 'goal_milestone'), { label: 'goal milestone' });
  });

  it('imports transactions from CSV', async () => {
    const csv = `date,type,amount,description,category\n${today},expense,12.50,Coffee beans,Groceries\n${today},income,250,Freelance invoice,Freelance\nbad-date,expense,1,x,\n`;
    const form = new FormData();
    form.append('file', new Blob([csv], { type: 'text/csv' }), 'statement.csv');
    const res = await alice.call('POST', '/files/imports', { form });
    assert.equal(res.status, 201, JSON.stringify(res.data));
    assert.equal(res.data.validRows, 2);
    assert.equal(res.data.failedRows, 1);
    await eventually(async () => (await alice.get('/expenses?origin=import')).data?.data?.length === 1, { label: 'imported expense' });
    await eventually(async () => (await alice.get('/incomes?origin=import')).data?.data?.length === 1, { label: 'imported income' });
  });

  it('rejects disguised executables as receipts', async () => {
    const form = new FormData();
    form.append('file', new Blob([Buffer.from('MZ\x90\x00 this is not an image')], { type: 'image/png' }), 'receipt.png');
    const res = await alice.call('POST', '/files/receipts', { form });
    assert.equal(res.status, 400);
  });

  it('generates a CSV report asynchronously', async () => {
    const res = await alice.post('/reports', { format: 'csv', from: today, to: today });
    assert.equal(res.status, 202, JSON.stringify(res.data));
    await eventually(async () => (await alice.get(`/reports/${res.data.id}`)).data?.status === 'completed', { label: 'report completed' });
    const file = await alice.call('GET', `/reports/${res.data.id}/download`, { raw: true });
    assert.equal(file.status, 200);
    const content = await file.text();
    assert.match(content, /Weekly groceries at the supermarket/);
  });

  it('serves the aggregated dashboard and AI insights', async () => {
    const res = await alice.get('/dashboard');
    assert.equal(res.status, 200);
    assert.equal(res.data.partial, false, JSON.stringify(res.data.errors));
    assert.ok(res.data.analytics.totalBalance !== undefined);
    assert.ok(res.data.insights.healthScore.score >= 0);
  });

  it('rotates refresh tokens and revokes access tokens on logout', async () => {
    const oldCookie = alice.cookie;
    const refreshed = await alice.post('/auth/refresh');
    assert.equal(refreshed.status, 200);
    assert.notEqual(alice.cookie, oldCookie);
    alice.token = refreshed.data.accessToken;
    const token = alice.token;
    await alice.post('/auth/logout');
    const after = await fetch(`${GATEWAY}/api/v1/expenses`, { headers: { authorization: `Bearer ${token}` } });
    assert.equal(after.status, 401);
  });
});
