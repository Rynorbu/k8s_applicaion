import { Events, NotFound, getLogger, paginated } from '@spendwise/common';
import { render } from './templates.js';

const toNotification = (row) => ({
  id: row.id,
  type: row.type,
  title: row.title,
  message: row.message,
  severity: row.severity,
  link: row.link,
  data: row.data,
  read: Boolean(row.read_at),
  readAt: row.read_at,
  createdAt: row.created_at,
});

const toPreferences = (row) => ({
  emailEnabled: row?.email_enabled ?? true,
  inAppEnabled: row?.in_app_enabled ?? true,
  mutedTypes: row?.muted_types ?? [],
});

export function createNotificationService({ pool, mailer, config }) {
  const log = getLogger();

  async function sendEmail(client, { userId, to, subject, html, template, eventId }) {
    try {
      await mailer.sendMail({ from: config.EMAIL_FROM, to, subject, html });
      await client.query(
        `INSERT INTO email_log (user_id, to_email, subject, template, status, event_id) VALUES ($1,$2,$3,$4,'sent',$5)`,
        [userId, to, subject, template, eventId],
      );
    } catch (err) {
      log.error({ err: err.message, template }, 'email delivery failed');
      // Re-throw so the whole event is retried with backoff (and DLQ'd if SMTP stays down).
      throw err;
    }
  }

  return {
    /** Generic event handler: render -> respect preferences -> in-app row and/or email. */
    async handleEvent(client, event) {
      if (event.type === Events.UserRegistered || event.type === Events.UserProfileUpdated) {
        const { userId, email, name } = event.data;
        if (email) {
          await client.query(
            `INSERT INTO recipients (user_id, email, name) VALUES ($1, $2, $3)
             ON CONFLICT (user_id) DO UPDATE SET email = EXCLUDED.email, name = EXCLUDED.name, updated_at = now()`,
            [userId, email, name ?? 'there'],
          );
        }
        if (event.type === Events.UserProfileUpdated) return;
      }
      const userId = event.data?.userId ?? event.userId;
      if (!userId) return;
      const rendered = render(event, { appUrl: config.APP_URL });
      if (!rendered) return;

      const [{ rows: prefRows }, { rows: recipientRows }] = await Promise.all([
        client.query('SELECT * FROM notification_preferences WHERE user_id = $1', [userId]),
        client.query('SELECT * FROM recipients WHERE user_id = $1', [userId]),
      ]);
      const prefs = toPreferences(prefRows[0]);
      const muted = !rendered.security && prefs.mutedTypes.includes(rendered.type);
      if (muted) return;

      if (rendered.inApp !== false && (prefs.inAppEnabled || rendered.security)) {
        await client.query(
          `INSERT INTO notifications (user_id, type, title, message, severity, link, data, source_event_id)
           VALUES ($1,$2,$3,$4,$5,$6,$7,$8)`,
          [userId, rendered.type, rendered.title, rendered.message, rendered.severity, rendered.link ?? null, { eventType: event.type }, event.id],
        );
      }
      const to = recipientRows[0]?.email ?? event.data?.email;
      if (rendered.email && to && (prefs.emailEnabled || rendered.security)) {
        await sendEmail(client, { userId, to, subject: rendered.email.subject, html: rendered.email.html, template: rendered.type, eventId: event.id });
      }
    },

    async list(userId, { unreadOnly, page, pageSize }) {
      const where = `user_id = $1 ${unreadOnly ? 'AND read_at IS NULL' : ''}`;
      const [{ rows }, { rows: count }] = await Promise.all([
        pool.query(`SELECT * FROM notifications WHERE ${where} ORDER BY created_at DESC LIMIT $2 OFFSET $3`, [userId, pageSize, (page - 1) * pageSize]),
        pool.query(`SELECT count(*)::int AS n FROM notifications WHERE ${where}`, [userId]),
      ]);
      return paginated(rows.map(toNotification), { page, pageSize }, count[0].n);
    },

    async unreadCount(userId) {
      const { rows } = await pool.query('SELECT count(*)::int AS n FROM notifications WHERE user_id = $1 AND read_at IS NULL', [userId]);
      return { unread: rows[0].n };
    },

    async markRead(userId, id) {
      const { rows } = await pool.query(
        'UPDATE notifications SET read_at = COALESCE(read_at, now()) WHERE id = $1 AND user_id = $2 RETURNING *',
        [id, userId],
      );
      if (!rows[0]) throw NotFound('Notification not found');
      return toNotification(rows[0]);
    },

    async markAllRead(userId) {
      const { rowCount } = await pool.query('UPDATE notifications SET read_at = now() WHERE user_id = $1 AND read_at IS NULL', [userId]);
      return { updated: rowCount };
    },

    async remove(userId, id) {
      const { rowCount } = await pool.query('DELETE FROM notifications WHERE id = $1 AND user_id = $2', [id, userId]);
      if (rowCount === 0) throw NotFound('Notification not found');
    },

    async getPreferences(userId) {
      const { rows } = await pool.query('SELECT * FROM notification_preferences WHERE user_id = $1', [userId]);
      return toPreferences(rows[0]);
    },

    async updatePreferences(userId, prefs) {
      const { rows } = await pool.query(
        `INSERT INTO notification_preferences (user_id, email_enabled, in_app_enabled, muted_types) VALUES ($1,$2,$3,$4)
         ON CONFLICT (user_id) DO UPDATE SET email_enabled = EXCLUDED.email_enabled, in_app_enabled = EXCLUDED.in_app_enabled,
           muted_types = EXCLUDED.muted_types, updated_at = now()
         RETURNING *`,
        [userId, prefs.emailEnabled, prefs.inAppEnabled, prefs.mutedTypes],
      );
      return toPreferences(rows[0]);
    },
  };
}
