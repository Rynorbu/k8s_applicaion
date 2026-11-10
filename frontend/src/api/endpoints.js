import { api } from './client.js';

const data = (p) => p.then((r) => r.data);
const clean = (params) => Object.fromEntries(Object.entries(params ?? {}).filter(([, v]) => v !== '' && v !== undefined && v !== null));

export const authApi = {
  register: (body) => data(api.post('/auth/register', body)),
  login: (body) => data(api.post('/auth/login', body)),
  logout: () => data(api.post('/auth/logout')),
  logoutAll: () => data(api.post('/auth/logout-all')),
  me: () => data(api.get('/auth/me')),
  sessions: () => data(api.get('/auth/sessions')),
  revokeSession: (id) => data(api.delete(`/auth/sessions/${id}`)),
  forgotPassword: (email) => data(api.post('/auth/forgot-password', { email })),
  resetPassword: (body) => data(api.post('/auth/reset-password', body)),
  changePassword: (body) => data(api.post('/auth/change-password', body)),
};

export const profileApi = {
  get: () => data(api.get('/users/me')),
  update: (body) => data(api.patch('/users/me', body)),
};

const crud = (base) => ({
  list: (params) => data(api.get(base, { params: clean(params) })),
  get: (id) => data(api.get(`${base}/${id}`)),
  create: (body) => data(api.post(base, body)),
  update: (id, body) => data(api.patch(`${base}/${id}`, body)),
  remove: (id) => data(api.delete(`${base}/${id}`)),
});

export const expensesApi = crud('/expenses');
export const incomesApi = crud('/incomes');
export const categoriesApi = { ...crud('/categories'), suggest: (body) => data(api.post('/categories/suggest', body)) };
export const budgetsApi = { ...crud('/budgets'), summary: () => data(api.get('/budgets/summary')) };
export const recurringApi = {
  ...crud('/recurring'),
  upcoming: (days = 30) => data(api.get('/recurring/upcoming', { params: { days } })),
  pause: (id) => data(api.post(`/recurring/${id}/pause`)),
  resume: (id) => data(api.post(`/recurring/${id}/resume`)),
};
export const goalsApi = { ...crud('/goals'), contribute: (id, body) => data(api.post(`/goals/${id}/contributions`, body)) };

export const analyticsApi = {
  summary: (params) => data(api.get('/analytics/summary', { params: clean(params) })),
  trends: (params) => data(api.get('/analytics/trends', { params: clean(params) })),
  categories: (params) => data(api.get('/analytics/categories', { params: clean(params) })),
  incomeVsExpenses: (months) => data(api.get('/analytics/income-vs-expenses', { params: { months } })),
  patterns: (params) => data(api.get('/analytics/patterns', { params: clean(params) })),
};

export const dashboardApi = { get: () => data(api.get('/dashboard')) };
export const insightsApi = {
  overview: () => data(api.get('/insights/overview')),
  list: () => data(api.get('/insights')),
  dismiss: (id) => data(api.post(`/insights/${id}/dismiss`)),
};

export const notificationsApi = {
  list: (params) => data(api.get('/notifications', { params: clean(params) })),
  unreadCount: () => data(api.get('/notifications/unread-count')),
  markRead: (id) => data(api.patch(`/notifications/${id}/read`)),
  markAllRead: () => data(api.post('/notifications/read-all')),
  remove: (id) => data(api.delete(`/notifications/${id}`)),
  preferences: () => data(api.get('/notifications/preferences')),
  updatePreferences: (body) => data(api.put('/notifications/preferences', body)),
};

export const reportsApi = {
  list: (params) => data(api.get('/reports', { params: clean(params) })),
  create: (body) => data(api.post('/reports', body)),
  remove: (id) => data(api.delete(`/reports/${id}`)),
};

export const searchApi = {
  search: (params) => data(api.get('/search', { params: clean(params) })),
  suggest: (q) => data(api.get('/search/suggest', { params: { q } })),
};

export const currencyApi = {
  list: () => data(api.get('/currencies')),
  convert: (params) => data(api.get('/currencies/convert', { params })),
};

export const auditApi = { list: (params) => data(api.get('/audit', { params: clean(params) })) };

export const filesApi = {
  uploadReceipt: (file) => {
    const form = new FormData();
    form.append('file', file);
    return data(api.post('/files/receipts', form));
  },
  importTransactions: (file, options) => {
    const form = new FormData();
    Object.entries(options).forEach(([k, v]) => form.append(k, v));
    form.append('file', file);
    return data(api.post('/files/imports', form));
  },
  imports: (params) => data(api.get('/files/imports', { params: clean(params) })),
  receipts: (params) => data(api.get('/files/receipts', { params: clean(params) })),
  remove: (id) => data(api.delete(`/files/${id}`)),
};
