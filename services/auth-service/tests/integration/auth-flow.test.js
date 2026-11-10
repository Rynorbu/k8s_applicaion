/** Integration test against a real PostgreSQL database (TEST_DATABASE_URL). */
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createPool, runMigrations } from '@spendwise/common';
import { createTokenSigner, loadSigningKeys } from '../../src/crypto.js';
import { createAuthService } from '../../src/service.js';

const DB = process.env.TEST_DATABASE_URL;

describe.skipIf(!DB)('auth service with PostgreSQL', () => {
  let pool;
  let service;
  const email = `it-${Date.now()}@example.com`;
  const meta = { ip: '127.0.0.1', userAgent: 'vitest' };

  beforeAll(async () => {
    const admin = createPool(DB);
    await admin.query('DROP SCHEMA IF EXISTS auth_it CASCADE; CREATE SCHEMA auth_it');
    await admin.end();
    const url = new URL(DB);
    url.searchParams.set('options', '-c search_path=auth_it,public');
    pool = createPool(url.toString());
    await runMigrations(pool, { dir: new URL('../../migrations', import.meta.url) });
    const keys = await loadSigningKeys({ keyId: 'it', production: false });
    const signer = createTokenSigner({ ...keys, issuer: 'spendwise-auth', audience: 'spendwise', accessTokenTtl: '15m' });
    const store = new Map();
    const redis = { set: async (k, v) => store.set(k, v), exists: async (k) => (store.has(k) ? 1 : 0) };
    service = createAuthService({
      pool,
      redis,
      signer,
      config: { REFRESH_TOKEN_TTL_DAYS: 7, ADMIN_EMAILS: [], MAX_FAILED_LOGINS: 3, LOCKOUT_MINUTES: 15, PASSWORD_RESET_TTL_MINUTES: 30, APP_URL: 'http://x' },
    });
  });

  afterAll(async () => {
    await pool?.query('DROP SCHEMA IF EXISTS auth_it CASCADE');
    await pool?.end();
  });

  it('registers, emits UserRegistered via the outbox and logs in', async () => {
    const session = await service.register({ email, password: 'Str0ngPassw0rd', name: 'IT User' }, meta);
    expect(session.user.email).toBe(email);
    const { rows } = await pool.query(`SELECT event_type FROM outbox WHERE payload->'data'->>'userId' = $1`, [session.user.id]);
    expect(rows.map((r) => r.event_type)).toContain('UserRegistered');
    await expect(service.register({ email, password: 'Str0ngPassw0rd', name: 'Dup' }, meta)).rejects.toMatchObject({ status: 409 });
    const login = await service.login({ email, password: 'Str0ngPassw0rd' }, meta);
    expect(login.accessToken).toBeTruthy();
  });

  it('rotates refresh tokens and detects reuse', async () => {
    const login = await service.login({ email, password: 'Str0ngPassw0rd' }, meta);
    const rotated = await service.refresh(login.refreshToken, meta);
    expect(rotated.refreshToken).not.toBe(login.refreshToken);
    // Replaying the old token revokes the family, so the new token stops working too.
    await expect(service.refresh(login.refreshToken, meta)).rejects.toMatchObject({ status: 401 });
    await expect(service.refresh(rotated.refreshToken, meta)).rejects.toMatchObject({ status: 401 });
  });

  it('locks the account after repeated failures', async () => {
    for (let i = 0; i < 3; i += 1) {
      await expect(service.login({ email, password: 'WrongPassw0rd' }, meta)).rejects.toMatchObject({ status: 401 });
    }
    await expect(service.login({ email, password: 'Str0ngPassw0rd' }, meta)).rejects.toMatchObject({ code: 'ACCOUNT_LOCKED' });
  });

  it('resets the password with a single-use token', async () => {
    await service.requestPasswordReset(email);
    const { rows } = await pool.query(
      `SELECT payload->'data'->>'resetUrl' AS url FROM outbox WHERE event_type = 'PasswordResetRequested' ORDER BY created_at DESC LIMIT 1`,
    );
    const token = new URL(rows[0].url).searchParams.get('token');
    await service.resetPassword({ token, password: 'An0therStrongOne' });
    await expect(service.resetPassword({ token, password: 'An0therStrongOne' })).rejects.toMatchObject({ status: 400 });
    const login = await service.login({ email, password: 'An0therStrongOne' }, meta);
    expect(login.user.email).toBe(email);
  });
});
