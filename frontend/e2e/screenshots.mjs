/**
 * Seeds a demo account through the public API and captures screenshots of key pages
 * (light + dark). Useful for README images and visual review.
 *
 *   node frontend/e2e/screenshots.mjs [outDir]
 */
import { chromium } from '@playwright/test';

const BASE = process.env.E2E_BASE_URL ?? 'http://localhost:3000';
const outDir = process.argv[2] ?? 'docs/screenshots';
const email = `demo-${Date.now()}@example.com`;
const password = 'DemoStr0ngPassw0rd';

async function api(path, { method = 'GET', body, token } = {}) {
  const res = await fetch(`${BASE}/api/v1${path}`, {
    method,
    headers: { 'content-type': 'application/json', 'x-requested-with': 'XMLHttpRequest', ...(token ? { authorization: `Bearer ${token}` } : {}) },
    body: body ? JSON.stringify(body) : undefined,
  });
  if (!res.ok) throw new Error(`${method} ${path} -> ${res.status} ${await res.text()}`);
  return res.status === 204 ? null : res.json();
}

const day = (offset) => {
  const d = new Date();
  d.setDate(d.getDate() + offset);
  return d.toISOString().slice(0, 10);
};

async function seed() {
  const { accessToken: token } = await api('/auth/register', { method: 'POST', body: { email, password, name: 'Demo User' } });
  const post = (p, body) => api(p, { method: 'POST', body, token });
  // Six months of history so trends and comparisons have shape.
  for (let m = 5; m >= 0; m -= 1) {
    const base = -m * 30;
    await post('/incomes', { amount: 4200 + m * 50, description: 'Salary payroll', payer: 'ACME Corp', incomeDate: day(base - 1) });
    if (m % 2 === 0) await post('/incomes', { amount: 650, description: 'Freelance invoice', payer: 'Client Co', incomeDate: day(base - 3) });
    await post('/expenses', { amount: 1400, description: 'Monthly rent', merchant: 'Landlord', expenseDate: day(base - 2) });
    await post('/expenses', { amount: 180 + m * 15, description: 'Groceries', merchant: 'Whole Foods', expenseDate: day(base - 4) });
    await post('/expenses', { amount: 95 + m * 10, description: 'Dinner restaurant', merchant: 'Bistro', expenseDate: day(base - 6) });
    await post('/expenses', { amount: 60, description: 'Fuel', merchant: 'Shell', expenseDate: day(base - 8) });
    await post('/expenses', { amount: 15.99, description: 'Netflix subscription', merchant: 'Netflix', expenseDate: day(base - 9) });
    await post('/expenses', { amount: 120 - m * 5, description: 'Electricity bill', expenseDate: day(base - 10) });
  }
  await post('/expenses', { amount: 480, description: 'Restaurant tasting menu', merchant: 'Bistro', expenseDate: day(0) });
  await post('/budgets', { name: 'Dining out', categoryId: 'c0000000-0000-4000-8000-000000000001', amount: 300, period: 'monthly' });
  await post('/budgets', { name: 'Groceries', categoryId: 'c0000000-0000-4000-8000-000000000002', amount: 400, period: 'monthly' });
  await post('/budgets', { name: 'Total spending', amount: 3000, period: 'monthly' });
  const goal = await post('/goals', { name: 'Emergency fund', targetAmount: 10000, targetDate: day(365), priority: 'high' });
  await post(`/goals/${goal.id}/contributions`, { amount: 4200 });
  await post('/goals', { name: 'Japan trip', targetAmount: 3500, initialAmount: 900, targetDate: day(200), color: '#3b82f6' });
  await post('/recurring', { type: 'expense', description: 'Gym membership', amount: 45, frequency: 'monthly', startDate: day(5) });
  await new Promise((r) => setTimeout(r, 4000)); // let projections converge
}

await seed();
const browser = await chromium.launch(process.env.PW_CHANNEL ? { channel: process.env.PW_CHANNEL } : {});
for (const theme of ['light', 'dark']) {
  const context = await browser.newContext({ viewport: { width: 1440, height: 1000 }, colorScheme: theme });
  const page = await context.newPage();
  await page.goto(`${BASE}/login`);
  await page.getByLabel('Email').fill(email);
  await page.getByLabel('Password').fill(password);
  await page.getByRole('button', { name: 'Sign in' }).click();
  await page.waitForURL('**/dashboard');
  for (const path of ['dashboard', 'analytics', 'budgets', 'goals', 'expenses']) {
    await page.goto(`${BASE}/${path}`);
    await page.waitForLoadState('networkidle');
    await page.waitForTimeout(2500); // let chart animations (1.5s) finish
    await page.screenshot({ path: `${outDir}/${path}-${theme}.png`, fullPage: true });
    console.log(`captured ${path}-${theme}.png`);
  }
  await context.close();
}
const mobile = await browser.newContext({ viewport: { width: 390, height: 844 }, deviceScaleFactor: 2 });
const page = await mobile.newPage();
await page.goto(`${BASE}/login`);
await page.getByLabel('Email').fill(email);
await page.getByLabel('Password').fill(password);
await page.getByRole('button', { name: 'Sign in' }).click();
await page.waitForURL('**/dashboard');
await page.waitForTimeout(1500);
await page.screenshot({ path: `${outDir}/dashboard-mobile.png`, fullPage: false });
console.log('captured dashboard-mobile.png');
await browser.close();
