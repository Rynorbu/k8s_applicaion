import { ApiRouter, createApp, isoDate, todayUtc, uuid, z } from '@spendwise/common';
import { monthRange } from './periods.js';

/** Defaults to the current month; enforces from <= to and a bounded window. */
const rangeWith = (extra = {}) =>
  z
    .object({ ...extra, from: isoDate.optional(), to: isoDate.optional() })
    .transform((v) => ({ ...v, from: v.from ?? monthRange(todayUtc()).from, to: v.to ?? todayUtc() }))
    .refine((v) => v.from <= v.to, { message: '`from` must be before `to`', path: ['from'] })
    .refine((v) => (new Date(v.to) - new Date(v.from)) / 86_400_000 <= 3660, { message: 'Range cannot exceed 10 years', path: ['from'] });
const range = rangeWith();

export const trendsQuery = z
  .object({ granularity: z.enum(['day', 'week', 'month', 'year']).default('month'), from: isoDate.optional(), to: isoDate.optional() })
  .transform((v) => ({
    granularity: v.granularity,
    from: v.from ?? monthRange(todayUtc(), v.granularity === 'day' ? 0 : v.granularity === 'week' ? -2 : -11).from,
    to: v.to ?? todayUtc(),
  }))
  .refine((v) => v.from <= v.to, { message: '`from` must be before `to`', path: ['from'] })
  .refine((v) => v.granularity !== 'day' || (new Date(v.to) - new Date(v.from)) / 86_400_000 <= 366, {
    message: 'Daily granularity supports at most one year',
    path: ['granularity'],
  });

export function buildApp({ service, readiness = {}, enableDocs = true }) {
  const analytics = new ApiRouter({ prefix: '/api/v1/analytics', tags: ['Analytics'] });
  analytics.get('/dashboard', { summary: 'Dashboard KPIs, trends and category breakdown', handler: (req) => service.dashboard(req.user.id) });
  analytics.get('/summary', {
    summary: 'Income, expenses, savings and savings rate for a period',
    query: range,
    handler: (req) => service.summary(req.user.id, req.valid.query),
  });
  analytics.get('/trends', {
    summary: 'Daily / weekly / monthly / yearly income and expense series',
    query: trendsQuery,
    handler: (req) => service.trends(req.user.id, req.valid.query),
  });
  analytics.get('/categories', {
    summary: 'Spending (or income) by category',
    query: rangeWith({ type: z.enum(['expense', 'income']).default('expense') }),
    handler: (req) => service.categories(req.user.id, req.valid.query),
  });
  analytics.get('/income-vs-expenses', {
    summary: 'Monthly income vs expenses comparison',
    query: z.object({ months: z.coerce.number().int().min(1).max(36).default(12) }),
    handler: (req) => service.incomeVsExpenses(req.user.id, req.valid.query.months),
  });
  analytics.get('/patterns', {
    summary: 'Spending by weekday and top merchants',
    query: range,
    handler: (req) => service.patterns(req.user.id, req.valid.query),
  });

  const internal = new ApiRouter({ prefix: '/internal/analytics', tags: ['Internal'] });
  internal.get('/report', {
    auth: 'internal',
    summary: 'Aggregates for report generation',
    query: rangeWith({ userId: uuid }),
    handler: (req) => service.report(req.valid.query.userId, req.valid.query),
  });

  return createApp({
    name: 'analytics-service',
    description: 'Financial analytics read model (CQRS) built from transaction events.',
    routers: [analytics, internal],
    readiness,
    enableDocs,
  });
}
