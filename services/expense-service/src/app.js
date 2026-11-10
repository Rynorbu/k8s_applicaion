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

const paymentMethod = z.enum(['cash', 'card', 'bank_transfer', 'mobile_wallet', 'other']);

export const createExpenseSchema = z.object({
  amount: money,
  currency: currencyCode.optional(),
  categoryId: uuid.optional(),
  description: requiredText(255),
  merchant: safeText(120).optional(),
  paymentMethod: paymentMethod.default('card'),
  expenseDate: isoDate,
  notes: safeText(1000).optional(),
  tags,
  receiptFileId: uuid.optional(),
});

export const updateExpenseSchema = z
  .object({
    amount: money,
    currency: currencyCode,
    categoryId: uuid,
    description: requiredText(255),
    merchant: safeText(120).nullable(),
    paymentMethod,
    expenseDate: isoDate,
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
    paymentMethod: paymentMethod.optional(),
    origin: z.enum(['manual', 'recurring', 'import']).optional(),
    tag: safeText(30).optional(),
    q: safeText(100).optional(),
    sort: z.enum(['date_desc', 'date_asc', 'amount_desc', 'amount_asc']).default('date_desc'),
  })
  .refine((v) => !v.from || !v.to || v.from <= v.to, { message: '`from` must be before `to`', path: ['from'] });

export function buildApp({ service, readiness = {}, enableDocs = true }) {
  const expenses = new ApiRouter({ prefix: '/api/v1/expenses', tags: ['Expenses'] });
  expenses.get('/', {
    summary: 'List expenses with filters, sorting and pagination',
    query: listQuerySchema,
    handler: (req) => service.list(req.user.id, req.valid.query),
  });
  expenses.post('/', {
    summary: 'Create an expense (publishes ExpenseCreated)',
    status: 201,
    body: createExpenseSchema,
    handler: (req) => service.create(req.user.id, req.valid.body),
  });
  expenses.get('/:id', { summary: 'Get an expense', params: idParams, handler: (req) => service.get(req.user.id, req.valid.params.id) });
  expenses.patch('/:id', {
    summary: 'Update an expense (optimistic concurrency via `version`; publishes ExpenseUpdated)',
    params: idParams,
    body: updateExpenseSchema,
    handler: (req) => service.update(req.user.id, req.valid.params.id, req.valid.body),
  });
  expenses.delete('/:id', {
    summary: 'Delete an expense (publishes ExpenseDeleted)',
    params: idParams,
    handler: (req) => service.remove(req.user.id, req.valid.params.id),
  });

  const internal = new ApiRouter({ prefix: '/internal/expenses', tags: ['Internal'] });
  internal.get('/', {
    auth: 'internal',
    summary: 'Expenses of a user for reporting',
    query: z.object({ userId: uuid, from: isoDate.optional(), to: isoDate.optional(), limit: z.coerce.number().int().min(1).max(10_000).default(5000) }),
    handler: (req) => service.listForUser(req.valid.query.userId, req.valid.query),
  });

  return createApp({
    name: 'expense-service',
    description: 'Expense system of record. Publishes ExpenseCreated/Updated/Deleted events.',
    routers: [expenses, internal],
    readiness,
    enableDocs,
  });
}
