import request from 'supertest';
import { decodeJwt } from 'jose';
import { beforeAll, describe, expect, it, vi } from 'vitest';
import { setupTestAuth } from '@spendwise/common/testing';
import { buildApp } from '../../src/app.js';
import { checkPasswordPolicy, createTokenSigner, hashPassword, loadSigningKeys, verifyPassword } from '../../src/crypto.js';

describe('password policy', () => {
  it('requires length, upper, lower and digit', () => {
    expect(checkPasswordPolicy('short', 'a@b.c')).toEqual(
      expect.arrayContaining(['at least 10 characters', 'an uppercase letter', 'a digit']),
    );
    expect(checkPasswordPolicy('Str0ngPassw0rd', 'someone@example.com')).toEqual([]);
  });

  it('rejects passwords containing the email local part', () => {
    expect(checkPasswordPolicy('Johnsmith123', 'johnsmith@example.com')).toContain('not contain your email');
  });
});

describe('password hashing', () => {
  it('uses argon2id and verifies correctly', async () => {
    const hash = await hashPassword('Str0ngPassw0rd');
    expect(hash.startsWith('$argon2id$')).toBe(true);
    expect(await verifyPassword(hash, 'Str0ngPassw0rd')).toBe(true);
    expect(await verifyPassword(hash, 'wrong')).toBe(false);
  });
});

describe('token signer', () => {
  it('issues RS256 access tokens with the expected claims', async () => {
    const keys = await loadSigningKeys({ keyId: 'k1', production: false });
    const signer = createTokenSigner({ ...keys, issuer: 'spendwise-auth', audience: 'spendwise', accessTokenTtl: '15m' });
    const { token, jti } = await signer.signAccessToken({ id: 'u1', email: 'a@b.c', name: 'A', roles: ['user'] });
    const claims = decodeJwt(token);
    expect(claims).toMatchObject({ sub: 'u1', iss: 'spendwise-auth', aud: 'spendwise', typ: 'access', jti });
    expect(claims.exp - claims.iat).toBe(900);
    expect(keys.jwks.keys[0]).toMatchObject({ alg: "RS256", use: "sig" });
    expect(keys.jwks.keys[0].kid).toMatch(/^k1-dev-[0-9a-f]{8}$/); // unique per ephemeral key
    expect(keys.jwks.keys[0].d).toBeUndefined(); // never expose the private exponent
  });

  it('refuses to generate ephemeral keys in production', async () => {
    await expect(loadSigningKeys({ keyId: 'k', production: true })).rejects.toThrow(/required in production/);
  });
});

describe('auth API', () => {
  let app;
  let service;
  let tokenFor;
  const config = { COOKIE_SECURE: false, ENABLE_DOCS: true };
  const session = {
    user: { id: '11111111-1111-4111-8111-111111111111', email: 'a@b.co', name: 'A', roles: ['user'] },
    accessToken: 'access.jwt',
    refreshToken: 'refresh-opaque',
    refreshExpiresAt: new Date(Date.now() + 86_400_000),
  };

  beforeAll(async () => {
    ({ tokenFor } = await setupTestAuth());
    service = {
      register: vi.fn().mockResolvedValue(session),
      login: vi.fn().mockResolvedValue(session),
      refresh: vi.fn().mockResolvedValue(session),
      logout: vi.fn().mockResolvedValue(),
      requestPasswordReset: vi.fn().mockResolvedValue(),
      me: vi.fn().mockResolvedValue(session.user),
    };
    app = buildApp({ service, config, jwks: { keys: [] } });
  });

  it('sets the refresh token only as an httpOnly SameSite=Strict cookie', async () => {
    const res = await request(app).post('/api/v1/auth/login').send({ email: 'A@B.co', password: 'x' });
    expect(res.status).toBe(200);
    expect(res.body.accessToken).toBe('access.jwt');
    expect(res.body.refreshToken).toBeUndefined();
    const cookie = res.headers['set-cookie'][0];
    expect(cookie).toMatch(/sw_refresh=refresh-opaque/);
    expect(cookie).toMatch(/HttpOnly/);
    expect(cookie).toMatch(/SameSite=Strict/);
    expect(cookie).toMatch(/Path=\/api\/v1\/auth/);
    expect(service.login).toHaveBeenCalledWith({ email: 'a@b.co', password: 'x' }, expect.any(Object));
  });

  it('validates registration input', async () => {
    const res = await request(app).post('/api/v1/auth/register').send({ email: 'not-an-email', password: '', name: '' });
    expect(res.status).toBe(400);
    expect(res.body.error.code).toBe('VALIDATION_ERROR');
  });

  it('requires the X-Requested-With header on refresh (CSRF defence)', async () => {
    const res = await request(app).post('/api/v1/auth/refresh').set('Cookie', 'sw_refresh=abc');
    expect(res.status).toBe(400);
    const ok = await request(app)
      .post('/api/v1/auth/refresh')
      .set('Cookie', 'sw_refresh=abc')
      .set('X-Requested-With', 'XMLHttpRequest');
    expect(ok.status).toBe(200);
    expect(service.refresh).toHaveBeenCalledWith('abc', expect.any(Object));
  });

  it('always answers 202 on forgot-password', async () => {
    const res = await request(app).post('/api/v1/auth/forgot-password').send({ email: 'nobody@example.com' });
    expect(res.status).toBe(202);
  });

  it('protects /me', async () => {
    expect((await request(app).get('/api/v1/auth/me')).status).toBe(401);
    const token = await tokenFor(session.user.id);
    const res = await request(app).get('/api/v1/auth/me').set('Authorization', `Bearer ${token}`);
    expect(res.status).toBe(200);
  });
});
