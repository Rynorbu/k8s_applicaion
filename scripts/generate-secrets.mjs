#!/usr/bin/env node
/**
 * Generates a .env file with strong random secrets and a fresh RSA-2048 JWT signing key.
 * Never commit the generated file (.gitignore'd). Existing .env is not overwritten
 * unless --force is passed.
 */
import { generateKeyPairSync, randomBytes } from 'node:crypto';
import { existsSync, readFileSync, writeFileSync } from 'node:fs';

const target = '.env';
if (existsSync(target) && !process.argv.includes('--force')) {
  console.error('.env already exists - pass --force to regenerate');
  process.exit(1);
}
const secret = (bytes = 32) => randomBytes(bytes).toString('base64url');
const { privateKey } = generateKeyPairSync('rsa', { modulusLength: 2048 });
const pem = privateKey.export({ type: 'pkcs8', format: 'pem' });

const template = readFileSync('.env.example', 'utf8');
const values = {
  NODE_ENV: 'production',
  INTERNAL_API_TOKEN: secret(32),
  POSTGRES_PASSWORD: secret(24),
  SERVICE_DB_PASSWORD: secret(24),
  RABBITMQ_PASSWORD: secret(24),
  REDIS_PASSWORD: secret(24),
  GRAFANA_PASSWORD: secret(16),
  JWT_PRIVATE_KEY: Buffer.from(pem).toString('base64'),
};
const env = template.replace(/^([A-Z_]+)=.*$/gm, (line, key) => (key in values ? `${key}=${values[key]}` : line));
writeFileSync(target, env, { mode: 0o600 });
console.log('Wrote .env with generated secrets (keep it private).');
