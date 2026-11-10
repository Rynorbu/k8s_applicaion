import { ApiRouter, createApp, isoDate, pagination, uuid, z } from '@spendwise/common';

const listQuery = pagination.extend({
  eventType: z.string().regex(/^[A-Za-z]{3,60}$/).optional(),
  from: isoDate.optional(),
  to: isoDate.optional(),
  correlationId: z.string().regex(/^[A-Za-z0-9._-]{8,128}$/).optional(),
});

export function buildApp({ service, readiness = {}, enableDocs = true }) {
  const audit = new ApiRouter({ prefix: '/api/v1/audit', tags: ['Audit log'] });
  audit.get('/', {
    summary: 'My security & activity audit trail',
    query: listQuery,
    handler: (req) => service.list({ ...req.valid.query, actorId: req.user.id }),
  });
  audit.get('/event-types', { summary: 'Event types in my audit trail', handler: (req) => service.eventTypes(req.user.id) });
  audit.get('/admin', {
    auth: 'admin',
    summary: 'Search the full audit log (admin)',
    query: listQuery.extend({ userId: uuid.optional() }),
    handler: (req) => service.list({ ...req.valid.query, actorId: req.valid.query.userId }),
  });
  audit.get('/verify', { auth: 'admin', summary: 'Verify the tamper-evident hash chain (admin)', handler: () => service.verify() });

  return createApp({
    name: 'audit-service',
    description: 'Append-only, hash-chained audit log of every domain event.',
    routers: [audit],
    readiness,
    enableDocs,
  });
}
