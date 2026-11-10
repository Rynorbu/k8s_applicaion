import {
  ApiRouter,
  createApp,
  currencyCode,
  idParams,
  isoDate,
  money,
  pagination,
  requiredText,
  safeText,
  tags,
  uuid,
  z,
} from '@spendwise/common';

const receivedVia = z.enum(['cash', 'card', 'bank_transfer', 'mobile_wallet', 'other']);

export const createIncomeSchema = z.object({
  amount: money,
  currency: currencyCode.optional(),
  categoryId: uuid.optional(),
  description: requiredText(255),
  payer: safeText(120).optional(),
  receivedVia: receivedVia.default('bank_transfer'),
  incomeDate: isoDate,
  notes: safeText(1000).optional(),
  tags,
  receiptFileId: uuid.optional(),
});

export const updateIncomeSchema = z
  .object({
    amount: money,
    currency: currencyCode,
    categoryId: uuid,
    description: requiredText(255),
    payer: safeText(120).nullable(),
    receivedVia,
    incomeDate: isoDate,
    notes: safeText(1000).nullable(),
    tags: tags.removeDefault(),
    receiptFileId: uuid.nullable(),
    version: z.number().int().positive(),
  })
  .partial()
  .refine((v) => Object.keys(v).some((k) => k !== 'version'), 'Provide at least one field to update');

export const listQuerySchema = pagination
  .extend({
    from: isoDate.optional(),
    to: isoDate.optional(),
    categoryId: uuid.optional(),
    minAmount: z.coerce.number().min(0).optional(),
    maxAmount: z.coerce.number().min(0).optional(),
    receivedVia: receivedVia.optional(),
    origin: z.enum(['manual', 'recurring', 'import']).optional(),
    tag: safeText(30).optional(),
    q: safeText(100).optional(),
    sort: z.enum(['date_desc', 'date_asc', 'amount_desc', 'amount_asc']).default('date_desc'),
  })
  .refine((v) => !v.from || !v.to || v.from <= v.to, { message: '`from` must be before `to`', path: ['from'] });

export function buildApp({ service, readiness = {}, enableDocs = true }) {
  const incomes = new ApiRouter({ prefix: '/api/v1/incomes', tags: ['Incomes'] });
  incomes.get('/', {
    summary: 'List incomes with filters, sorting and pagination',
    query: listQuerySchema,
    handler: (req) => service.list(req.user.id, req.valid.query),
  });
  incomes.post('/', {
    summary: 'Create an income (publishes IncomeCreated)',
    status: 201,
    body: createIncomeSchema,
    handler: (req) => service.create(req.user.id, req.valid.body),
  });
  incomes.get('/:id', { summary: 'Get an income', params: idParams, handler: (req) => service.get(req.user.id, req.valid.params.id) });
  incomes.patch('/:id', {
    summary: 'Update an income (optimistic concurrency via `version`; publishes IncomeUpdated)',
    params: idParams,
    body: updateIncomeSchema,
    handler: (req) => service.update(req.user.id, req.valid.params.id, req.valid.body),
  });
  incomes.delete('/:id', {
    summary: 'Delete an income (publishes IncomeDeleted)',
    params: idParams,
    handler: (req) => service.remove(req.user.id, req.valid.params.id),
  });

  const internal = new ApiRouter({ prefix: '/internal/incomes', tags: ['Internal'] });
  internal.get('/', {
    auth: 'internal',
    summary: 'Incomes of a user for reporting',
    query: z.object({ userId: uuid, from: isoDate.optional(), to: isoDate.optional(), limit: z.coerce.number().int().min(1).max(10_000).default(5000) }),
    handler: (req) => service.listForUser(req.valid.query.userId, req.valid.query),
  });

  return createApp({
    name: 'income-service',
    description: 'Income system of record. Publishes IncomeCreated/Updated/Deleted events.',
    routers: [incomes, internal],
    readiness,
    enableDocs,
  });
}
