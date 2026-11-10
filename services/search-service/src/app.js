import { ApiRouter, createApp, isoDate, pagination, safeText, uuid, z } from '@spendwise/common';

export const searchQuery = pagination
  .extend({
    q: safeText(200).optional(),
    type: z.enum(['expense', 'income']).optional(),
    categoryId: uuid.optional(),
    from: isoDate.optional(),
    to: isoDate.optional(),
    minAmount: z.coerce.number().min(0).optional(),
    maxAmount: z.coerce.number().min(0).optional(),
    tag: safeText(30).optional(),
    sort: z.enum(['relevance', 'date_desc', 'date_asc', 'amount_desc', 'amount_asc']).default('relevance'),
  })
  .refine((v) => !v.from || !v.to || v.from <= v.to, { message: '`from` must be before `to`', path: ['from'] })
  .refine((v) => v.minAmount === undefined || v.maxAmount === undefined || v.minAmount <= v.maxAmount, {
    message: 'minAmount must be <= maxAmount',
    path: ['minAmount'],
  });

export function buildApp({ service, readiness = {}, enableDocs = true }) {
  const search = new ApiRouter({ prefix: '/api/v1/search', tags: ['Search'] });
  search.get('/', {
    summary: 'Full-text search across expenses and income with filters and facets',
    query: searchQuery,
    handler: (req) => service.search(req.user.id, req.valid.query),
  });
  search.get('/suggest', {
    summary: 'Autocomplete suggestions (descriptions and merchants)',
    query: z.object({ q: safeText(100).pipe(z.string().min(2)) }),
    handler: (req) => service.suggest(req.user.id, req.valid.query.q),
  });
  search.get('/recent', {
    summary: 'Most recent transactions (expenses and income combined)',
    query: z.object({ limit: z.coerce.number().int().min(1).max(50).default(10) }),
    handler: (req) => service.recent(req.user.id, req.valid.query.limit),
  });

  return createApp({
    name: 'search-service',
    description: 'Transaction search index (PostgreSQL full-text + trigram) built from events.',
    routers: [search],
    readiness,
    enableDocs,
  });
}
