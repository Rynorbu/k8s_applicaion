import { ApiRouter, createApp, idParams, requiredText, safeText, uuid, z } from '@spendwise/common';

const type = z.enum(['expense', 'income']);
const color = z.string().regex(/^#[0-9a-fA-F]{6}$/, 'Hex colour like #22c55e');
const icon = z.string().regex(/^[a-z0-9-]{1,40}$/, 'Icon name (lowercase, dashes)');
const keywords = z.array(safeText(40).pipe(z.string().min(2))).max(30);

export const createCategorySchema = z.object({
  type,
  name: requiredText(50),
  color: color.default('#64748b'),
  icon: icon.default('tag'),
  keywords: keywords.default([]),
});

export const updateCategorySchema = z
  .object({ name: requiredText(50), color, icon, keywords })
  .partial()
  .refine((v) => Object.keys(v).length > 0, 'Provide at least one field');

const suggestSchema = z.object({
  type: type.default('expense'),
  description: safeText(255).optional(),
  merchant: safeText(120).optional(),
});

export function buildApp({ service, readiness = {}, enableDocs = true }) {
  const categories = new ApiRouter({ prefix: '/api/v1/categories', tags: ['Categories'] });
  categories.get('/', {
    summary: 'List built-in and custom categories',
    query: z.object({ type: type.optional() }),
    handler: async (req) => ({ data: await service.list(req.user.id, req.valid.query.type) }),
  });
  categories.post('/', {
    summary: 'Create a custom category',
    status: 201,
    body: createCategorySchema,
    handler: (req) => service.create(req.user.id, req.valid.body),
  });
  categories.post('/suggest', {
    summary: 'Suggest a category for a description/merchant (auto-categorization)',
    body: suggestSchema,
    handler: (req) => service.suggest(req.user.id, req.valid.body),
  });
  categories.get('/:id', { summary: 'Get a category', params: idParams, handler: (req) => service.get(req.user.id, req.valid.params.id) });
  categories.patch('/:id', {
    summary: 'Update a custom category',
    params: idParams,
    body: updateCategorySchema,
    handler: (req) => service.update(req.user.id, req.valid.params.id, req.valid.body),
  });
  categories.delete('/:id', {
    summary: 'Delete a custom category (transactions move to "Other")',
    params: idParams,
    handler: (req) => service.remove(req.user.id, req.valid.params.id),
  });

  const internal = new ApiRouter({ prefix: '/internal/categories', tags: ['Internal'] });
  internal.get('/:id', {
    auth: 'internal',
    summary: 'Get a category visible to a user',
    params: idParams,
    query: z.object({ userId: uuid }),
    handler: (req) => service.get(req.valid.query.userId, req.valid.params.id),
  });
  internal.post('/resolve', {
    auth: 'internal',
    summary: 'Resolve a category by name or description (used by expense/income/import flows)',
    body: z.object({
      userId: uuid,
      type,
      name: safeText(50).nullish(),
      description: safeText(255).nullish(),
      merchant: safeText(120).nullish(),
    }),
    handler: (req) => service.resolve(req.valid.body),
  });

  return createApp({
    name: 'category-service',
    description: 'Built-in and custom categories with keyword-based auto-categorization.',
    routers: [categories, internal],
    readiness,
    enableDocs,
  });
}
