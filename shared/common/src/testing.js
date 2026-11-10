import { randomUUID } from 'node:crypto';
import { SignJWT, generateKeyPair } from 'jose';
import { configureAuth } from './auth.js';

import { createPool, runMigrations } from './db.js';

/**
 * Creates an isolated schema in TEST_DATABASE_URL, applies the service's migrations
 * into it and returns a pool bound to that schema.
 */
export async function createTestDatabase(schema, migrationsDir) {
  const base = process.env.TEST_DATABASE_URL;
  const admin = createPool(base);
  await admin.query(`DROP SCHEMA IF EXISTS ${schema} CASCADE; CREATE SCHEMA ${schema}`);
  await admin.end();
  const url = new URL(base);
  url.searchParams.set('options', `-c search_path=${schema},public`);
  const pool = createPool(url.toString());
  await runMigrations(pool, { dir: migrationsDir });
  return {
    pool,
    async drop() {
      await pool.end();
      const cleanup = createPool(base);
      await cleanup.query(`DROP SCHEMA IF EXISTS ${schema} CASCADE`);
      await cleanup.end();
    },
  };
}

export const TEST_INTERNAL_TOKEN = 'test-internal-token-0123456789abcdef';

/** Configures auth with an ephemeral RSA key and returns a token factory for API tests. */
export async function setupTestAuth() {
  const { publicKey, privateKey } = await generateKeyPair('RS256');
  configureAuth({ key: publicKey, internalToken: TEST_INTERNAL_TOKEN, issuer: 'spendwise-auth', audience: 'spendwise' });
  const tokenFor = (userId = randomUUID(), { roles = ['user'], email = 'user@example.com' } = {}) =>
    new SignJWT({ email, name: 'Test User', roles, typ: 'access' })
      .setProtectedHeader({ alg: 'RS256' })
      .setSubject(userId)
      .setIssuer('spendwise-auth')
      .setAudience('spendwise')
      .setIssuedAt()
      .setJti(randomUUID())
      .setExpirationTime('5m')
      .sign(privateKey);
  return { tokenFor, internalToken: TEST_INTERNAL_TOKEN };
}
