import { Events } from '@spendwise/common';

export const escapeHtml = (value) =>
  String(value ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]);

export function formatMoney(amount, currency = 'USD') {
  try {
    return new Intl.NumberFormat('en-US', { style: 'currency', currency }).format(amount);
  } catch {
    return `${Number(amount).toFixed(2)} ${currency}`;
  }
}

function emailLayout(title, bodyHtml, cta) {
  const button = cta
    ? `<p style="margin:24px 0"><a href="${escapeHtml(cta.url)}" style="background:#4f46e5;color:#fff;padding:12px 20px;border-radius:8px;text-decoration:none;font-weight:600">${escapeHtml(cta.label)}</a></p>`
    : '';
  return `<!doctype html><html><body style="font-family:Segoe UI,Arial,sans-serif;background:#f8fafc;padding:24px;color:#0f172a">
  <div style="max-width:560px;margin:auto;background:#fff;border-radius:12px;padding:32px;border:1px solid #e2e8f0">
    <h2 style="margin-top:0;color:#4f46e5">SpendWise</h2>
    <h3>${escapeHtml(title)}</h3>
    ${bodyHtml}${button}
    <p style="color:#64748b;font-size:12px;margin-top:32px">You are receiving this because you have a SpendWise account. Manage email preferences in Settings.</p>
  </div></body></html>`;
}

const p = (text) => `<p style="line-height:1.6">${escapeHtml(text)}</p>`;

/**
 * Maps a domain event to an in-app notification and/or email.
 * `security: true` notifications ignore user mute preferences.
 */
export function render(event, { appUrl }) {
  const d = event.data ?? {};
  switch (event.type) {
    case Events.UserRegistered: {
      const message = `Welcome to SpendWise, ${d.name}! Start by adding an expense or setting a monthly budget.`;
      return {
        type: 'welcome',
        title: 'Welcome to SpendWise 🎉',
        message,
        severity: 'success',
        link: '/dashboard',
        email: { subject: 'Welcome to SpendWise', html: emailLayout('Welcome aboard!', p(message), { label: 'Open dashboard', url: `${appUrl}/dashboard` }) },
      };
    }
    case Events.PasswordResetRequested:
      return {
        type: 'password_reset',
        security: true,
        inApp: false,
        email: {
          subject: 'Reset your SpendWise password',
          html: emailLayout(
            'Password reset requested',
            p(`Hi ${d.name}, we received a request to reset your password. This link expires at ${new Date(d.expiresAt).toUTCString()}.`) +
              p('If you did not request this, you can ignore this email.'),
            { label: 'Reset password', url: d.resetUrl },
          ),
        },
      };
    case Events.PasswordChanged: {
      const message = 'Your password was changed. If this was not you, reset your password immediately.';
      return {
        type: 'security',
        security: true,
        title: 'Password changed',
        message,
        severity: 'warning',
        link: '/settings',
        email: { subject: 'Your SpendWise password was changed', html: emailLayout('Password changed', p(message)) },
      };
    }
    case Events.UserLoggedOut:
      if (d.reason !== 'refresh_token_reuse_detected') return null;
      return {
        type: 'security',
        security: true,
        title: 'Suspicious session activity',
        message: 'A previously used session token was replayed, so we signed that session out. Consider changing your password.',
        severity: 'danger',
        link: '/settings',
        email: { subject: 'Security alert: session revoked', html: emailLayout('Suspicious session activity', p('A previously used session token was replayed. We revoked the session to protect your account.')) },
      };
    case Events.BudgetWarning: {
      const message = `You've used ${d.percentage}% of your "${d.name}" budget (${formatMoney(d.spent, d.currency)} of ${formatMoney(d.amount, d.currency)}).`;
      return {
        type: 'budget_warning',
        title: `Budget alert: ${d.name}`,
        message,
        severity: 'warning',
        link: '/budgets',
        email: { subject: `Budget alert: ${d.name} at ${d.percentage}%`, html: emailLayout('Budget warning', p(message), { label: 'Review budgets', url: `${appUrl}/budgets` }) },
      };
    }
    case Events.BudgetExceeded: {
      const message = `You've exceeded your "${d.name}" budget: ${formatMoney(d.spent, d.currency)} spent of ${formatMoney(d.amount, d.currency)} (${d.percentage}%).`;
      return {
        type: 'budget_exceeded',
        title: `Budget exceeded: ${d.name}`,
        message,
        severity: 'danger',
        link: '/budgets',
        email: { subject: `Budget exceeded: ${d.name}`, html: emailLayout('Budget exceeded', p(message), { label: 'Review budgets', url: `${appUrl}/budgets` }) },
      };
    }
    case Events.GoalMilestoneReached: {
      const message = d.completed
        ? `Congratulations! You reached your goal "${d.name}" (${formatMoney(d.targetAmount, d.currency)}).`
        : `You're ${d.milestone}% of the way to "${d.name}" — ${formatMoney(d.currentAmount, d.currency)} saved.`;
      return {
        type: 'goal_milestone',
        title: d.completed ? 'Goal achieved! 🏆' : `Goal milestone: ${d.milestone}%`,
        message,
        severity: 'success',
        link: '/goals',
        email: d.completed ? { subject: `Goal achieved: ${d.name}`, html: emailLayout('Goal achieved!', p(message)) } : null,
      };
    }
    case Events.ReportGenerated:
      return {
        type: 'report_ready',
        title: 'Your report is ready',
        message: `${d.title} (${String(d.format).toUpperCase()}) is ready to download.`,
        severity: 'success',
        link: '/reports',
      };
    case Events.ReportFailed:
      return { type: 'report_failed', title: 'Report generation failed', message: `We couldn't generate "${d.title}". Please try again.`, severity: 'danger', link: '/reports' };
    case Events.FileImported:
      return {
        type: 'import_completed',
        title: 'Import completed',
        message: `Imported ${d.importedRows} of ${d.totalRows} rows from ${d.fileName}${d.failedRows ? ` (${d.failedRows} rows skipped)` : ''}.`,
        severity: d.failedRows ? 'warning' : 'success',
        link: '/import',
      };
    case Events.AnomalyDetected:
      return {
        type: 'anomaly',
        title: 'Unusual spending detected',
        message: d.message,
        severity: 'warning',
        link: '/analytics',
        email: { subject: 'Unusual spending detected', html: emailLayout('Unusual spending detected', p(d.message), { label: 'View insights', url: `${appUrl}/analytics` }) },
      };
    case Events.RecurringTransactionCreated:
      return {
        type: 'recurring_created',
        title: 'Recurring transaction scheduled',
        message: `"${d.description}" (${formatMoney(d.amount, d.currency ?? 'USD')}) will repeat ${d.frequency}, starting ${d.startDate}.`,
        severity: 'info',
        link: '/recurring',
      };
    case Events.ExpenseCreated:
    case Events.IncomeCreated: {
      if (d.origin !== 'recurring') return null;
      const kind = event.type === Events.ExpenseCreated ? 'expense' : 'income';
      return {
        type: 'recurring_posted',
        title: `Recurring ${kind} recorded`,
        message: `"${d.description}" for ${formatMoney(d.amount, d.currency)} was added automatically on ${d.expenseDate ?? d.incomeDate}.`,
        severity: 'info',
        link: kind === 'expense' ? '/expenses' : '/income',
      };
    }
    default:
      return null;
  }
}
