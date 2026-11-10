import { ApiRouter, createApp, idParams, pagination, z } from '@spendwise/common';

export const NOTIFICATION_TYPES = [
  'welcome',
  'budget_warning',
  'budget_exceeded',
  'goal_milestone',
  'report_ready',
  'report_failed',
  'import_completed',
  'anomaly',
  'recurring_created',
  'recurring_posted',
];

export const preferencesSchema = z.object({
  emailEnabled: z.boolean(),
  inAppEnabled: z.boolean(),
  mutedTypes: z.array(z.enum(NOTIFICATION_TYPES)).max(NOTIFICATION_TYPES.length).default([]),
});

export function buildApp({ service, readiness = {}, enableDocs = true }) {
  const notifications = new ApiRouter({ prefix: '/api/v1/notifications', tags: ['Notifications'] });
  notifications.get('/', {
    summary: 'List notifications',
    query: pagination.extend({ unreadOnly: z.enum(['true', 'false']).transform((v) => v === 'true').default('false') }),
    handler: (req) => service.list(req.user.id, req.valid.query),
  });
  notifications.get('/unread-count', { summary: 'Unread notification count', handler: (req) => service.unreadCount(req.user.id) });
  notifications.post('/read-all', { summary: 'Mark all notifications as read', handler: (req) => service.markAllRead(req.user.id) });
  notifications.get('/preferences', { summary: 'Notification preferences', handler: (req) => service.getPreferences(req.user.id) });
  notifications.put('/preferences', {
    summary: 'Update notification preferences',
    body: preferencesSchema,
    handler: (req) => service.updatePreferences(req.user.id, req.valid.body),
  });
  notifications.patch('/:id/read', { summary: 'Mark a notification as read', params: idParams, handler: (req) => service.markRead(req.user.id, req.valid.params.id) });
  notifications.delete('/:id', { summary: 'Delete a notification', params: idParams, handler: (req) => service.remove(req.user.id, req.valid.params.id) });

  return createApp({
    name: 'notification-service',
    description: 'In-app and email notifications driven by domain events.',
    routers: [notifications],
    readiness,
    enableDocs,
  });
}
