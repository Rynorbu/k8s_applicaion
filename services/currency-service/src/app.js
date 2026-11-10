import { ApiRouter, createApp, currencyCode, isoDate, z } from '@spendwise/common';

const convertQuery = z.object({
  from: currencyCode,
  to: currencyCode,
  amount: z.coerce.number().min(0).max(1_000_000_000_000),
  date: isoDate.optional(),
});

export function buildApp({ service, readiness = {}, enableDocs = true }) {
  const currencies = new ApiRouter({ prefix: '/api/v1/currencies', tags: ['Currencies'] });
  currencies.get('/', { summary: 'Supported currencies with their latest USD rate', handler: () => service.list() });
  currencies.get('/rates', {
    summary: 'Exchange-rate table for a base currency',
    query: z.object({ base: currencyCode.default('USD'), date: isoDate.optional() }),
    handler: (req) => service.rates(req.valid.query.base, req.valid.query.date),
  });
  currencies.get('/convert', {
    summary: 'Convert an amount between currencies',
    query: convertQuery,
    handler: (req) => service.convert(req.valid.query),
  });
  currencies.post('/refresh', {
    auth: 'admin',
    summary: 'Refresh rates from the ECB now (admin)',
    handler: () => service.refresh(),
  });

  const internal = new ApiRouter({ prefix: '/internal', tags: ['Internal'] });
  internal.get('/currencies/:code', {
    auth: 'internal',
    summary: 'Validate a currency code',
    params: z.object({ code: currencyCode }),
    handler: (req) => service.get(req.valid.params.code),
  });
  internal.get('/convert', {
    auth: 'internal',
    summary: 'Convert an amount (historical rate when date is given)',
    query: convertQuery,
    handler: (req) => service.convert(req.valid.query),
  });

  return createApp({
    name: 'currency-service',
    description: 'Currencies, ECB exchange rates and conversion.',
    routers: [currencies, internal],
    readiness,
    enableDocs,
  });
}
