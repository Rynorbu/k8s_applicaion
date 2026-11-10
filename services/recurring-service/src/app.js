import { ApiRouter, createApp, currencyCode, idParams, isoDate, money, requiredText, safeText, uuid, z } from '@spendwise/common';

const frequency = z.enum(['daily', 'weekly', 'biweekly', 'monthly', 'quarterly', 'yearly']);

export const createRecurringSchema = z
  .object({
    type: z.enum(['expense', 'income']),
    description: requiredText(255),
    amount: money,
    currency: currencyCode.optional(),
    categoryId: uuid.optional(),
    merchant: safeText(120).optional(),
    paymentMethod: z.enum(['cash', 'card', 'bank_transfer', 'mobile_wallet', 'other']).optional(),
    notes: safeText(1000).optional(),
    frequency,
    intervalCount: z.coerce.number().int().min(1).max(12).default(1),
    startDate: isoDate,
    endDate: isoDate.optional(),
    maxOccurrences: z.coerce.number().int().min(1).max(1000).optional(),
  })
  .refine((v) => !v.endDate || v.endDate >= v.startDate, { message: 'End date must be on or after the start date', path: ['endDate'] });

export const updateRecurringSchema = z
  .object({
    description: requiredText(255),
    amount: money,
    categoryId: uuid,
    merchant: safeText(120),
    notes: safeText(1000),
    endDate: isoDate.nullable(),
    maxOccurrences: z.coerce.number().int().min(1).max(1000).nullable(),
  })
  .partial()
  .refine((v) => Object.keys(v).length > 0, 'Provide at least one field');

export function buildApp({ service, readiness = {}, enableDocs = true }) {
  const recurring = new ApiRouter({ prefix: '/api/v1/recurring', tags: ['Recurring transactions'] });
  recurring.get('/', {
    summary: 'List recurring rules',
    query: z.object({ type: z.enum(['expense', 'income']).optional(), status: z.enum(['active', 'paused', 'completed']).optional() }),
    handler: (req) => service.list(req.user.id, req.valid.query),
  });
  recurring.get('/upcoming', {
    summary: 'Upcoming generated transactions (bills calendar)',
    query: z.object({ days: z.coerce.number().int().min(1).max(366).default(30) }),
    handler: (req) => service.upcoming(req.user.id, req.valid.query.days),
  });
  recurring.post('/', {
    summary: 'Create a recurring expense/income (publishes RecurringTransactionCreated)',
    status: 201,
    body: createRecurringSchema,
    handler: (req) => service.create(req.user.id, req.valid.body),
  });
  recurring.get('/:id', { summary: 'Rule detail with upcoming dates and history', params: idParams, handler: (req) => service.get(req.user.id, req.valid.params.id) });
  recurring.patch('/:id', {
    summary: 'Update a rule',
    params: idParams,
    body: updateRecurringSchema,
    handler: (req) => service.update(req.user.id, req.valid.params.id, req.valid.body),
  });
  recurring.post('/:id/pause', { summary: 'Pause a rule', params: idParams, handler: (req) => service.setStatus(req.user.id, req.valid.params.id, 'paused') });
  recurring.post('/:id/resume', { summary: 'Resume a rule', params: idParams, handler: (req) => service.setStatus(req.user.id, req.valid.params.id, 'active') });
  recurring.delete('/:id', { summary: 'Delete a rule', params: idParams, handler: (req) => service.remove(req.user.id, req.valid.params.id) });

  return createApp({
    name: 'recurring-service',
    description: 'Recurring expenses/income and the scheduler that generates RecurringTransactionDue events.',
    routers: [recurring],
    readiness,
    enableDocs,
  });
}
