import { readdir, readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import pg from 'pg';
import { getLogger } from './logger.js';

// Return BIGINT/COUNT as numbers, NUMERIC as floats (amounts are NUMERIC(14,2)),
// and DATE columns as plain 'YYYY-MM-DD' strings (avoids timezone shifts).
pg.types.setTypeParser(20, (v) => Number.parseInt(v, 10));
pg.types.setTypeParser(1700, (v) => Number.parseFloat(v));
pg.types.setTypeParser(1082, (v) => v);

const COMMON_MIGRATIONS = fileURLToPath(new URL('../migrations', import.meta.url));
const MIGRATION_LOCK_ID = 727_101;

export function createPool(connectionString, { max = 10 } = {}) {
  const pool = new pg.Pool({
    connectionString,
    max,
    idleTimeoutMillis: 30_000,
    connectionTimeoutMillis: 5_000,
    statement_timeout: 15_000,
    application_name: process.env.SERVICE_NAME,
  });
  pool.on('error', (err) => getLogger().error({ err }, 'idle postgres client error'));
  return pool;
}

export async function withTransaction(pool, fn) {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const result = await fn(client);
    await client.query('COMMIT');
    return result;
  } catch (err) {
    await client.query('ROLLBACK').catch(() => {});
    throw err;
  } finally {
    client.release();
  }
}

export async function waitForDatabase(pool, { attempts = 30, delayMs = 2000 } = {}) {
  for (let i = 1; i <= attempts; i += 1) {
    try {
      await pool.query('SELECT 1');
      return;
    } catch (err) {
      if (i === attempts) throw err;
      getLogger().warn({ attempt: i, err: err.message }, 'database not ready, retrying');
      await new Promise((r) => setTimeout(r, delayMs));
    }
  }
}

async function listSql(dir, prefix) {
  const entries = await readdir(dir).catch(() => []);
  return entries
    .filter((f) => f.endsWith('.sql'))
    .sort()
    .map((f) => ({ name: `${prefix}${f}`, file: path.join(dir, f) }));
}

/**
 * Forward-only SQL migrations. Runs under a Postgres advisory lock so multiple
 * replicas starting at once never apply the same migration concurrently.
 */
export async function runMigrations(pool, { dir, includeMessaging = true } = {}) {
  const log = getLogger();
  await waitForDatabase(pool);
  const client = await pool.connect();
  try {
    await client.query('SELECT pg_advisory_lock($1)', [MIGRATION_LOCK_ID]);
    await client.query(
      'CREATE TABLE IF NOT EXISTS schema_migrations (name TEXT PRIMARY KEY, applied_at TIMESTAMPTZ NOT NULL DEFAULT now())',
    );
    const serviceDir = dir instanceof URL ? fileURLToPath(dir) : dir;
    const files = [
      ...(includeMessaging ? await listSql(COMMON_MIGRATIONS, 'common/') : []),
      ...(serviceDir ? await listSql(serviceDir, '') : []),
    ];
    const { rows } = await client.query('SELECT name FROM schema_migrations');
    const applied = new Set(rows.map((r) => r.name));
    for (const migration of files) {
      if (applied.has(migration.name)) continue;
      const sql = await readFile(migration.file, 'utf8');
      await client.query('BEGIN');
      try {
        await client.query(sql);
        await client.query('INSERT INTO schema_migrations (name) VALUES ($1)', [migration.name]);
        await client.query('COMMIT');
        log.info({ migration: migration.name }, 'migration applied');
      } catch (err) {
        await client.query('ROLLBACK');
        throw new Error(`Migration ${migration.name} failed: ${err.message}`, { cause: err });
      }
    }
  } finally {
    await client.query('SELECT pg_advisory_unlock($1)', [MIGRATION_LOCK_ID]).catch(() => {});
    client.release();
  }
}
