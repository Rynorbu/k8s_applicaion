import { createServiceClient, getLogger } from '@spendwise/common';
import { SERVICES } from './routes.js';

/**
 * Backend-for-frontend aggregation. The dashboard needs data from six services; the
 * gateway fetches them in parallel with the caller's token and degrades gracefully:
 * a failing widget returns an error entry instead of failing the whole page.
 */
export function createAggregator({ targets }) {
  const log = getLogger();
  const clients = Object.fromEntries(
    Object.entries(targets).map(([name, baseUrl]) => [name, createServiceClient({ name: `${name}-service`, baseUrl, timeoutMs: 5000, retries: 1 })]),
  );

  const widgets = {
    analytics: (t) => clients.analytics.get('/api/v1/analytics/dashboard', { bearer: t }),
    budgets: (t) => clients.budget.get('/api/v1/budgets/summary', { bearer: t }),
    goals: (t) => clients.goal.get('/api/v1/goals/summary', { bearer: t }),
    insights: (t) => clients.ai.get('/api/v1/insights/overview', { bearer: t }),
    recentTransactions: (t) => clients.search.get('/api/v1/search/recent', { bearer: t, query: { limit: 8 } }),
    notifications: (t) => clients.notification.get('/api/v1/notifications/unread-count', { bearer: t }),
    upcomingBills: (t) => clients.recurring.get('/api/v1/recurring/upcoming', { bearer: t, query: { days: 14 } }),
  };

  return {
    async dashboard(token) {
      const entries = Object.entries(widgets);
      const results = await Promise.allSettled(entries.map(([, fetcher]) => fetcher(token)));
      const data = {};
      const errors = {};
      results.forEach((result, i) => {
        const [name] = entries[i];
        if (result.status === 'fulfilled') data[name] = result.value;
        else {
          errors[name] = result.reason?.message ?? 'unavailable';
          log.warn({ widget: name, err: errors[name] }, 'dashboard widget failed');
        }
      });
      return { ...data, errors, partial: Object.keys(errors).length > 0 };
    },

    async status() {
      const checks = await Promise.all(
        SERVICES.map(async (s) => {
          const started = Date.now();
          try {
            const res = await fetch(new URL('/health/ready', targets[s.name]), { signal: AbortSignal.timeout(2000) });
            const body = await res.json().catch(() => ({}));
            return { service: s.name, status: res.ok ? 'up' : 'degraded', checks: body.checks, latencyMs: Date.now() - started };
          } catch {
            return { service: s.name, status: 'down', latencyMs: Date.now() - started };
          }
        }),
      );
      return { status: checks.every((c) => c.status === 'up') ? 'operational' : 'degraded', services: checks };
    },
  };
}

/** Fetches a service's OpenAPI document and strips internal endpoints before publishing. */
export function createDocsFetcher({ targets }) {
  return async (service) => {
    const res = await fetch(new URL('/docs/openapi.json', targets[service.name]), { signal: AbortSignal.timeout(3000) });
    if (!res.ok) throw new Error(`${service.name} docs unavailable`);
    const spec = await res.json();
    spec.paths = Object.fromEntries(Object.entries(spec.paths ?? {}).filter(([p]) => !p.startsWith('/internal') && !p.startsWith('/.well-known')));
    spec.servers = [{ url: '/' }];
    return spec;
  };
}
