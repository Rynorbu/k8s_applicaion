import { ApiRouter, createApp, currencyCode, idParams, requiredText, safeText, z } from '@spendwise/common';

const isValidTimezone = (tz) => {
  try {
    new Intl.DateTimeFormat('en-US', { timeZone: tz });
    return true;
  } catch {
    return false;
  }
};

export const updateProfileSchema = z
  .object({
    name: requiredText(100).optional(),
    baseCurrency: currencyCode.optional(),
    timezone: z
      .string()
      .refine(isValidTimezone, 'Unknown IANA timezone')
      .optional(),
    locale: z.string().regex(/^[a-z]{2}(-[A-Z]{2})?$/, 'Locale like en-US').optional(),
    dateFormat: z.enum(['YYYY-MM-DD', 'DD/MM/YYYY', 'MM/DD/YYYY']).optional(),
    theme: z.enum(['light', 'dark', 'system']).optional(),
    monthlyIncomeTarget: z.coerce.number().min(0).max(1_000_000_000).nullable().optional(),
    bio: safeText(500).nullable().optional(),
    occupation: safeText(100).nullable().optional(),
  })
  .strict();

export function buildApp({ service, readiness = {}, enableDocs = true }) {
  const users = new ApiRouter({ prefix: '/api/v1/users', tags: ['Profile'] });
  users.get('/me', { summary: 'Get my profile and preferences', handler: (req) => service.get(req.user.id) });
  users.patch('/me', {
    summary: 'Update my profile and preferences',
    body: updateProfileSchema,
    handler: (req) => service.update(req.user.id, req.valid.body),
  });

  const internal = new ApiRouter({ prefix: '/internal/users', tags: ['Internal'] });
  internal.get('/:id', {
    auth: 'internal',
    summary: 'Get a profile (service-to-service)',
    params: idParams,
    handler: (req) => service.get(req.valid.params.id),
  });

  return createApp({
    name: 'user-service',
    description: 'User profiles and personal finance preferences.',
    routers: [users, internal],
    readiness,
    enableDocs,
  });
}
