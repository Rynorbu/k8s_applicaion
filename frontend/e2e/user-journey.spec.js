import { expect, test } from '@playwright/test';

/** Full user journey through the real stack (docker compose up). */
test('register, add income & expense, set a budget and see the dashboard update', async ({ page }) => {
  const email = `e2e-${Date.now()}@example.com`;
  await page.goto('/register');
  await page.getByLabel('Full name').fill('E2E Tester');
  await page.getByLabel('Email').fill(email);
  await page.getByLabel('Password').fill('Str0ngPassw0rd!');
  await page.getByRole('button', { name: 'Create account' }).click();
  await expect(page).toHaveURL(/\/dashboard/);
  await expect(page.getByText('Hi E2E')).toBeVisible();

  await page.goto('/income');
  await page.getByRole('button', { name: /Add income/ }).first().click();
  await page.getByLabel('Amount').fill('5000');
  await page.getByLabel('Description').fill('October salary');
  await page.getByRole('button', { name: 'Save' }).click();
  await expect(page.getByText('October salary')).toBeVisible();

  await page.goto('/budgets');
  await page.getByRole('button', { name: /New budget/ }).click();
  await page.getByLabel('Name').fill('Monthly spending');
  await page.getByLabel('Limit').fill('100');
  await page.getByRole('button', { name: 'Create budget' }).click();
  await expect(page.getByRole('heading', { name: 'Monthly spending' })).toBeVisible();

  await page.goto('/expenses');
  await page.getByRole('button', { name: /Add expense/ }).first().click();
  await page.getByLabel('Amount').fill('95');
  await page.getByLabel('Description').fill('Groceries at the supermarket');
  await page.getByRole('button', { name: 'Save' }).click();
  await expect(page.getByText('Groceries at the supermarket')).toBeVisible();

  // Event-driven: the budget warning arrives asynchronously via RabbitMQ.
  await expect(async () => {
    await page.goto('/notifications');
    await expect(page.getByText(/Budget alert: Monthly spending/)).toBeVisible({ timeout: 2000 });
  }).toPass({ timeout: 30_000 });

  await page.goto('/dashboard');
  await expect(page.getByText('Income this month')).toBeVisible();
});
