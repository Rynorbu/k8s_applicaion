import { ApiRouter, createApp, idParams, money, requiredText, uuid, z } from '@spendwise/common';

export const createBudgetSchema = z.object({
  name: requiredText(80),
  categoryId: uuid.optional(),
  amount: money,
  period: z.enum(['weekly', 'monthly', 'yearly']).default('monthly'),
  alertThreshold: z.coerce.number().int().min(1).max(100).default(80),
});

export const updateBudgetSchema = z
  .object({ name: requiredText(80), amount: money, alertThreshold: z.coerce.number().int().min(1).max(100), active: z.boolean() })
  .partial()
  .refine((v) => Object.keys(v).length > 0, 'Provide at least one field');

export function buildApp({ service, readiness = {}, enableDocs = true }) {
  const budgets = new ApiRouter({ prefix: '/api/v1/budgets', tags: ['Budgets'] });
  budgets.get('/', { summary: 'List active budgets with current-period usage', handler: (req) => service.list(req.user.id) });
  budgets.get('/summary', { summary: 'Budget health summary (dashboard)', handler: (req) => service.summary(req.user.id) });
  budgets.post('/', {
    summary: 'Create a monthly/weekly/yearly budget (overall or per category)',
    status: 201,
    body: createBudgetSchema,
    handler: (req) => service.create(req.user.id, req.valid.body),
  });
  budgets.get('/:id', {
    summary: 'Budget detail with usage and 6-period history',
    params: idParams,
    handler: (req) => service.get(req.user.id, req.valid.params.id),
  });
  budgets.patch('/:id', {
    summary: 'Update a budget',
    params: idParams,
    body: updateBudgetSchema,
    handler: (req) => service.update(req.user.id, req.valid.params.id, req.valid.body),
  });
  budgets.delete('/:id', { summary: 'Delete a budget', params: idParams, handler: (req) => service.remove(req.user.id, req.valid.params.id) });

  return createApp({
    name: 'budget-service',
    description: 'Budgets, usage tracking and BudgetWarning / BudgetExceeded alerts driven by expense events.',
    routers: [budgets],
    readiness,
    enableDocs,
  });
}
