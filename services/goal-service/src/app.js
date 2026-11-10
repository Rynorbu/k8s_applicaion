import { ApiRouter, createApp, idParams, isoDate, money, requiredText, safeText, z } from '@spendwise/common';

const color = z.string().regex(/^#[0-9a-fA-F]{6}$/);
const icon = z.string().regex(/^[a-z0-9-]{1,40}$/);
const priority = z.enum(['low', 'medium', 'high']);

export const createGoalSchema = z.object({
  name: requiredText(80),
  description: safeText(500).optional(),
  targetAmount: money,
  initialAmount: money.optional(),
  targetDate: isoDate.optional(),
  icon: icon.default('piggy-bank'),
  color: color.default('#22c55e'),
  priority: priority.default('medium'),
});

export const updateGoalSchema = z
  .object({
    name: requiredText(80),
    description: safeText(500),
    targetAmount: money,
    targetDate: isoDate.nullable(),
    icon,
    color,
    priority,
    status: z.enum(['active', 'completed', 'cancelled']),
  })
  .partial()
  .refine((v) => Object.keys(v).length > 0, 'Provide at least one field');

export const contributionSchema = z.object({
  amount: z.coerce
    .number()
    .refine((v) => v !== 0 && Math.abs(v) <= 1_000_000_000, 'Amount must be non-zero')
    .refine((v) => Math.abs(Math.round(v * 100) - v * 100) < 1e-6, 'At most 2 decimal places'),
  note: safeText(255).optional(),
  date: isoDate.optional(),
});

export function buildApp({ service, readiness = {}, enableDocs = true }) {
  const goals = new ApiRouter({ prefix: '/api/v1/goals', tags: ['Financial goals'] });
  goals.get('/', {
    summary: 'List goals with progress analytics',
    query: z.object({ status: z.enum(['active', 'completed', 'cancelled']).optional() }),
    handler: (req) => service.list(req.user.id, req.valid.query),
  });
  goals.get('/summary', { summary: 'Goals summary for the dashboard', handler: (req) => service.summary(req.user.id) });
  goals.post('/', { summary: 'Create a savings goal (publishes GoalCreated)', status: 201, body: createGoalSchema, handler: (req) => service.create(req.user.id, req.valid.body) });
  goals.get('/:id', { summary: 'Goal detail with contributions and milestones', params: idParams, handler: (req) => service.get(req.user.id, req.valid.params.id) });
  goals.patch('/:id', { summary: 'Update a goal', params: idParams, body: updateGoalSchema, handler: (req) => service.update(req.user.id, req.valid.params.id, req.valid.body) });
  goals.delete('/:id', { summary: 'Delete a goal', params: idParams, handler: (req) => service.remove(req.user.id, req.valid.params.id) });
  goals.post('/:id/contributions', {
    summary: 'Add a contribution (negative = withdrawal); may publish GoalMilestoneReached',
    status: 201,
    params: idParams,
    body: contributionSchema,
    handler: (req) => service.contribute(req.user.id, req.valid.params.id, req.valid.body),
  });

  return createApp({
    name: 'goal-service',
    description: 'Savings and financial goals with milestone tracking.',
    routers: [goals],
    readiness,
    enableDocs,
  });
}
