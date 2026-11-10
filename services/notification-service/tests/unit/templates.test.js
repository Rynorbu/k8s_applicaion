import { describe, expect, it, vi } from 'vitest';
import { preferencesSchema } from '../../src/app.js';
import { createNotificationService } from '../../src/service.js';
import { escapeHtml, formatMoney, render } from '../../src/templates.js';

const appUrl = 'http://app.test';

describe('templates', () => {
  it('escapes HTML in user-controlled values (XSS in emails)', () => {
    const r = render({ type: 'BudgetWarning', data: { name: '<img src=x onerror=alert(1)>', percentage: 85, spent: 85, amount: 100, currency: 'USD' } }, { appUrl });
    expect(r.email.html).not.toContain('<img src=x');
    expect(r.email.html).toContain('&lt;img src=x');
    expect(escapeHtml(`"'&`)).toBe('&quot;&#39;&amp;');
  });

  it('formats money with currency', () => {
    expect(formatMoney(1234.5, 'USD')).toBe('$1,234.50');
    expect(formatMoney(10, 'XXX1')).toBe('10.00 XXX1');
  });

  it('only notifies about recurring-generated transactions', () => {
    expect(render({ type: 'ExpenseCreated', data: { origin: 'manual' } }, { appUrl })).toBeNull();
    expect(render({ type: 'ExpenseCreated', data: { origin: 'recurring', description: 'Rent', amount: 1, currency: 'USD', expenseDate: '2026-10-01' } }, { appUrl }).type).toBe('recurring_posted');
  });

  it('sends password resets by email only, as a security notification', () => {
    const r = render({ type: 'PasswordResetRequested', data: { name: 'A', resetUrl: 'http://x/reset?token=t', expiresAt: '2026-10-14T10:00:00Z' } }, { appUrl });
    expect(r).toMatchObject({ security: true, inApp: false });
    expect(r.email.html).toContain('http://x/reset?token=t');
  });
});

describe('handleEvent', () => {
  const makeClient = (prefs) => {
    const queries = [];
    return {
      queries,
      query: vi.fn(async (sql, params) => {
        queries.push({ sql, params });
        if (sql.includes('FROM notification_preferences')) return { rows: prefs ? [prefs] : [] };
        if (sql.includes('FROM recipients')) return { rows: [{ email: 'user@example.com' }] };
        return { rows: [], rowCount: 1 };
      }),
    };
  };
  const mailer = { sendMail: vi.fn().mockResolvedValue({}) };
  const service = createNotificationService({ pool: null, mailer, config: { APP_URL: appUrl, EMAIL_FROM: 'x@y.z' } });
  const budgetEvent = { id: 'e1', type: 'BudgetExceeded', data: { userId: 'u1', name: 'Food', percentage: 120, spent: 120, amount: 100, currency: 'USD' } };

  it('creates an in-app notification and sends an email', async () => {
    const client = makeClient(null);
    await service.handleEvent(client, budgetEvent);
    expect(client.queries.some((q) => q.sql.includes('INSERT INTO notifications'))).toBe(true);
    expect(mailer.sendMail).toHaveBeenCalledWith(expect.objectContaining({ to: 'user@example.com', subject: 'Budget exceeded: Food' }));
  });

  it('respects muted types', async () => {
    mailer.sendMail.mockClear();
    const client = makeClient({ email_enabled: true, in_app_enabled: true, muted_types: ['budget_exceeded'] });
    await service.handleEvent(client, budgetEvent);
    expect(client.queries.some((q) => q.sql.includes('INSERT INTO notifications'))).toBe(false);
    expect(mailer.sendMail).not.toHaveBeenCalled();
  });

  it('validates preference updates', () => {
    expect(preferencesSchema.safeParse({ emailEnabled: true, inAppEnabled: true, mutedTypes: ['nope'] }).success).toBe(false);
  });
});
