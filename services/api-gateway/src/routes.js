/**
 * Route table: public path prefix -> downstream service. Only /api/v1/* paths are ever
 * proxied, so service-internal endpoints (/internal/*, /metrics) are unreachable from
 * the internet.
 */
export const SERVICES = [
  { name: 'auth', env: 'AUTH_SERVICE_URL', prefixes: ['/api/v1/auth'], public: true },
  { name: 'user', env: 'USER_SERVICE_URL', prefixes: ['/api/v1/users'] },
  { name: 'expense', env: 'EXPENSE_SERVICE_URL', prefixes: ['/api/v1/expenses'] },
  { name: 'income', env: 'INCOME_SERVICE_URL', prefixes: ['/api/v1/incomes'] },
  { name: 'category', env: 'CATEGORY_SERVICE_URL', prefixes: ['/api/v1/categories'] },
  { name: 'budget', env: 'BUDGET_SERVICE_URL', prefixes: ['/api/v1/budgets'] },
  { name: 'recurring', env: 'RECURRING_SERVICE_URL', prefixes: ['/api/v1/recurring'] },
  { name: 'goal', env: 'GOAL_SERVICE_URL', prefixes: ['/api/v1/goals'] },
  { name: 'analytics', env: 'ANALYTICS_SERVICE_URL', prefixes: ['/api/v1/analytics'] },
  { name: 'notification', env: 'NOTIFICATION_SERVICE_URL', prefixes: ['/api/v1/notifications'] },
  { name: 'report', env: 'REPORT_SERVICE_URL', prefixes: ['/api/v1/reports'] },
  { name: 'search', env: 'SEARCH_SERVICE_URL', prefixes: ['/api/v1/search'] },
  { name: 'currency', env: 'CURRENCY_SERVICE_URL', prefixes: ['/api/v1/currencies'] },
  { name: 'audit', env: 'AUDIT_SERVICE_URL', prefixes: ['/api/v1/audit'] },
  { name: 'ai', env: 'AI_SERVICE_URL', prefixes: ['/api/v1/insights'] },
  { name: 'file', env: 'FILE_SERVICE_URL', prefixes: ['/api/v1/files'] },
];

/** Auth endpoints that are reachable without an access token (the auth service protects the rest itself). */
export const PUBLIC_PATHS = [/^\/api\/v1\/auth(\/|$)/];

/** Brute-force sensitive endpoints get a much stricter per-IP limit. */
export const SENSITIVE_PATHS = [
  /^\/api\/v1\/auth\/login$/,
  /^\/api\/v1\/auth\/register$/,
  /^\/api\/v1\/auth\/forgot-password$/,
  /^\/api\/v1\/auth\/reset-password$/,
];

export const isPublic = (path) => PUBLIC_PATHS.some((re) => re.test(path));
export const isSensitive = (path) => SENSITIVE_PATHS.some((re) => re.test(path));

export function findService(path) {
  return SERVICES.find((s) => s.prefixes.some((p) => path === p || path.startsWith(`${p}/`)));
}
