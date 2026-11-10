import { randomUUID } from 'node:crypto';
import {
  AppError,
  BadRequest,
  Conflict,
  Events,
  NotFound,
  Unauthorized,
  businessEvents,
  enqueueEvent,
  getLogger,
  withTransaction,
} from '@spendwise/common';
import { checkPasswordPolicy, dummyVerify, generateOpaqueToken, hashPassword, sha256, verifyPassword } from './crypto.js';

const toPublicUser = (row) => ({
  id: row.id,
  email: row.email,
  name: row.name,
  roles: row.roles,
  createdAt: row.created_at,
  lastLoginAt: row.last_login_at,
});

export function createAuthService({ pool, redis, signer, config }) {
  const log = getLogger();
  const refreshTtlMs = config.REFRESH_TOKEN_TTL_DAYS * 24 * 60 * 60 * 1000;

  async function issueRefreshToken(client, userId, { familyId = randomUUID(), userAgent, ip }) {
    const token = generateOpaqueToken();
    const { rows } = await client.query(
      `INSERT INTO refresh_tokens (user_id, family_id, token_hash, user_agent, ip_address, expires_at)
       VALUES ($1, $2, $3, $4, $5, $6) RETURNING id`,
      [userId, familyId, sha256(token), userAgent?.slice(0, 255), ip, new Date(Date.now() + refreshTtlMs)],
    );
    return { token, id: rows[0].id, familyId, expiresAt: new Date(Date.now() + refreshTtlMs) };
  }

  async function issueSession(client, user, meta) {
    const access = await signer.signAccessToken(user);
    const refresh = await issueRefreshToken(client, user.id, meta);
    return { user: toPublicUser(user), accessToken: access.token, refreshToken: refresh.token, refreshExpiresAt: refresh.expiresAt };
  }

  function assertPolicy(password, email) {
    const problems = checkPasswordPolicy(password, email);
    if (problems.length) throw BadRequest(`Password must have ${problems.join(', ')}`, problems.map((p) => ({ path: 'password', message: p })));
  }

  return {
    async register({ email, password, name }, meta) {
      assertPolicy(password, email);
      const passwordHash = await hashPassword(password);
      const roles = config.ADMIN_EMAILS.includes(email.toLowerCase()) ? ['user', 'admin'] : ['user'];
      try {
        return await withTransaction(pool, async (client) => {
          const { rows } = await client.query(
            `INSERT INTO users (email, name, password_hash, roles, last_login_at) VALUES ($1, $2, $3, $4, now()) RETURNING *`,
            [email, name, passwordHash, roles],
          );
          const user = rows[0];
          await enqueueEvent(client, Events.UserRegistered, { userId: user.id, email: user.email, name: user.name, roles }, { userId: user.id });
          businessEvents.inc({ name: 'user_registered' });
          return issueSession(client, user, meta);
        });
      } catch (err) {
        if (err.code === '23505') throw Conflict('An account with this email already exists');
        throw err;
      }
    },

    async login({ email, password }, meta) {
      return withTransaction(pool, async (client) => {
        const { rows } = await client.query('SELECT * FROM users WHERE email = $1 FOR UPDATE', [email]);
        const user = rows[0];
        const invalid = Unauthorized('Invalid email or password');
        if (!user) {
          await dummyVerify(password);
          await enqueueEvent(client, Events.LoginFailed, { email, reason: 'unknown_email', ip: meta.ip });
          throw invalid;
        }
        if (user.locked_until && new Date(user.locked_until) > new Date()) {
          await enqueueEvent(client, Events.LoginFailed, { email, reason: 'locked', ip: meta.ip }, { userId: user.id });
          throw new AppError(401, 'ACCOUNT_LOCKED', 'Too many failed attempts. Try again later or reset your password.');
        }
        if (!(await verifyPassword(user.password_hash, password))) {
          const attempts = user.failed_login_attempts + 1;
          const lock = attempts >= config.MAX_FAILED_LOGINS;
          await client.query(
            `UPDATE users SET failed_login_attempts = $2, locked_until = $3, updated_at = now() WHERE id = $1`,
            [user.id, lock ? 0 : attempts, lock ? new Date(Date.now() + config.LOCKOUT_MINUTES * 60_000) : null],
          );
          await enqueueEvent(client, Events.LoginFailed, { email, reason: lock ? 'locked_out' : 'bad_password', attempts, ip: meta.ip }, { userId: user.id });
          // Commit the counter update, then reject.
          return { error: invalid };
        }
        const { rows: updated } = await client.query(
          `UPDATE users SET failed_login_attempts = 0, locked_until = NULL, last_login_at = now(), updated_at = now() WHERE id = $1 RETURNING *`,
          [user.id],
        );
        await enqueueEvent(client, Events.UserLoggedIn, { userId: user.id, ip: meta.ip, userAgent: meta.userAgent?.slice(0, 255) }, { userId: user.id });
        return issueSession(client, updated[0], meta);
      }).then((result) => {
        if (result.error) throw result.error;
        return result;
      });
    },

    /** Rotates a refresh token. Re-use of a rotated token revokes the whole family (theft detection). */
    async refresh(refreshToken, meta) {
      if (!refreshToken) throw Unauthorized('Missing refresh token');
      const outcome = await withTransaction(pool, async (client) => {
        const { rows } = await client.query(
          `SELECT rt.*, u.email, u.name, u.roles, u.created_at AS user_created_at, u.last_login_at
             FROM refresh_tokens rt JOIN users u ON u.id = rt.user_id
            WHERE rt.token_hash = $1 FOR UPDATE OF rt`,
          [sha256(refreshToken)],
        );
        const row = rows[0];
        if (!row) return { error: 'invalid' };
        if (row.revoked_at) {
          if (row.replaced_by) {
            await client.query(`UPDATE refresh_tokens SET revoked_at = now() WHERE family_id = $1 AND revoked_at IS NULL`, [row.family_id]);
            await enqueueEvent(client, Events.UserLoggedOut, { userId: row.user_id, reason: 'refresh_token_reuse_detected' }, { userId: row.user_id });
            log.warn({ userId: row.user_id, familyId: row.family_id }, 'refresh token reuse detected; session family revoked');
          }
          return { error: 'invalid' };
        }
        if (new Date(row.expires_at) < new Date()) return { error: 'expired' };
        const next = await issueRefreshToken(client, row.user_id, { familyId: row.family_id, ...meta });
        await client.query(`UPDATE refresh_tokens SET revoked_at = now(), replaced_by = $2 WHERE id = $1`, [row.id, next.id]);
        const user = { id: row.user_id, email: row.email, name: row.name, roles: row.roles, created_at: row.user_created_at, last_login_at: row.last_login_at };
        const access = await signer.signAccessToken(user);
        return { user: toPublicUser(user), accessToken: access.token, refreshToken: next.token, refreshExpiresAt: next.expiresAt };
      });
      if (outcome.error) throw Unauthorized('Session expired. Please sign in again.');
      return outcome;
    },

    async logout({ refreshToken, accessJti, accessExp, userId }) {
      await withTransaction(pool, async (client) => {
        if (refreshToken) {
          const { rows } = await client.query(
            `UPDATE refresh_tokens SET revoked_at = now()
              WHERE family_id = (SELECT family_id FROM refresh_tokens WHERE token_hash = $1) AND revoked_at IS NULL
              RETURNING user_id`,
            [sha256(refreshToken)],
          );
          userId ??= rows[0]?.user_id;
        }
        if (userId) await enqueueEvent(client, Events.UserLoggedOut, { userId, reason: 'user_logout' }, { userId });
      });
      await this.revokeAccessToken(accessJti, accessExp);
    },

    async logoutAll(userId, { accessJti, accessExp }) {
      await withTransaction(pool, async (client) => {
        await client.query(`UPDATE refresh_tokens SET revoked_at = now() WHERE user_id = $1 AND revoked_at IS NULL`, [userId]);
        await enqueueEvent(client, Events.UserLoggedOut, { userId, reason: 'logout_all_sessions' }, { userId });
      });
      await this.revokeAccessToken(accessJti, accessExp);
    },

    /** Deny-lists an access token's jti in Redis until it would have expired anyway. */
    async revokeAccessToken(jti, exp) {
      if (!jti || !exp) return;
      const ttl = Math.max(1, exp - Math.floor(Date.now() / 1000));
      await redis.set(`auth:revoked:${jti}`, '1', 'EX', ttl).catch((err) => log.warn({ err: err.message }, 'could not deny-list token'));
    },

    async isRevoked(jti) {
      try {
        return (await redis.exists(`auth:revoked:${jti}`)) === 1;
      } catch {
        return false;
      }
    },

    async me(userId) {
      const { rows } = await pool.query('SELECT * FROM users WHERE id = $1', [userId]);
      if (!rows[0]) throw NotFound('User not found');
      return toPublicUser(rows[0]);
    },

    async listSessions(userId) {
      const { rows } = await pool.query(
        `SELECT DISTINCT ON (family_id) family_id, user_agent, ip_address, created_at, expires_at
           FROM refresh_tokens WHERE user_id = $1 AND revoked_at IS NULL AND expires_at > now()
          ORDER BY family_id, created_at DESC`,
        [userId],
      );
      return rows
        .map((r) => ({ id: r.family_id, userAgent: r.user_agent, ipAddress: r.ip_address, lastActiveAt: r.created_at, expiresAt: r.expires_at }))
        .sort((a, b) => new Date(b.lastActiveAt) - new Date(a.lastActiveAt));
    },

    async revokeSession(userId, familyId) {
      const { rowCount } = await pool.query(
        `UPDATE refresh_tokens SET revoked_at = now() WHERE user_id = $1 AND family_id = $2 AND revoked_at IS NULL`,
        [userId, familyId],
      );
      if (rowCount === 0) throw NotFound('Session not found');
    },

    async requestPasswordReset(email) {
      await withTransaction(pool, async (client) => {
        const { rows } = await client.query('SELECT id, email, name FROM users WHERE email = $1', [email]);
        const user = rows[0];
        if (!user) return; // Do not reveal whether the account exists.
        const token = generateOpaqueToken();
        const expiresAt = new Date(Date.now() + config.PASSWORD_RESET_TTL_MINUTES * 60_000);
        await client.query(`UPDATE password_reset_tokens SET used_at = now() WHERE user_id = $1 AND used_at IS NULL`, [user.id]);
        await client.query(`INSERT INTO password_reset_tokens (user_id, token_hash, expires_at) VALUES ($1, $2, $3)`, [user.id, sha256(token), expiresAt]);
        const resetUrl = `${config.APP_URL}/reset-password?token=${encodeURIComponent(token)}`;
        await enqueueEvent(client, Events.PasswordResetRequested, { userId: user.id, email: user.email, name: user.name, resetUrl, expiresAt }, { userId: user.id });
      });
    },

    async resetPassword({ token, password }) {
      await withTransaction(pool, async (client) => {
        const { rows } = await client.query(
          `SELECT prt.id, prt.user_id, u.email FROM password_reset_tokens prt JOIN users u ON u.id = prt.user_id
            WHERE prt.token_hash = $1 AND prt.used_at IS NULL AND prt.expires_at > now() FOR UPDATE OF prt`,
          [sha256(token)],
        );
        const row = rows[0];
        if (!row) throw BadRequest('This reset link is invalid or has expired');
        assertPolicy(password, row.email);
        await client.query(
          `UPDATE users SET password_hash = $2, password_changed_at = now(), failed_login_attempts = 0, locked_until = NULL, updated_at = now() WHERE id = $1`,
          [row.user_id, await hashPassword(password)],
        );
        await client.query('UPDATE password_reset_tokens SET used_at = now() WHERE id = $1', [row.id]);
        await client.query('UPDATE refresh_tokens SET revoked_at = now() WHERE user_id = $1 AND revoked_at IS NULL', [row.user_id]);
        await enqueueEvent(client, Events.PasswordChanged, { userId: row.user_id, email: row.email, method: 'reset' }, { userId: row.user_id });
      });
    },

    async changePassword(userId, { currentPassword, newPassword }) {
      await withTransaction(pool, async (client) => {
        const { rows } = await client.query('SELECT * FROM users WHERE id = $1 FOR UPDATE', [userId]);
        const user = rows[0];
        if (!user) throw NotFound('User not found');
        if (!(await verifyPassword(user.password_hash, currentPassword))) throw BadRequest('Current password is incorrect');
        if (currentPassword === newPassword) throw BadRequest('New password must differ from the current password');
        assertPolicy(newPassword, user.email);
        await client.query(`UPDATE users SET password_hash = $2, password_changed_at = now(), updated_at = now() WHERE id = $1`, [
          userId,
          await hashPassword(newPassword),
        ]);
        await enqueueEvent(client, Events.PasswordChanged, { userId, email: user.email, method: 'change' }, { userId });
      });
    },

    /** Keeps the display name in sync when the profile service changes it. */
    async syncProfile(client, { userId, name }) {
      if (name) await client.query('UPDATE users SET name = $2, updated_at = now() WHERE id = $1', [userId, name]);
    },
  };
}
