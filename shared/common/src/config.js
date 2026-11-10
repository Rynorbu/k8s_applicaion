import { z } from 'zod';

const booleanString = z
  .union([z.boolean(), z.string()])
  .transform((v) => v === true || v === 'true' || v === '1');

export const baseConfigSchema = z.object({
  NODE_ENV: z.enum(['development', 'test', 'production']).default('development'),
  SERVICE_NAME: z.string().min(1),
  SERVICE_VERSION: z.string().default('1.0.0'),
  PORT: z.coerce.number().int().min(1).max(65535),
  LOG_LEVEL: z.enum(['fatal', 'error', 'warn', 'info', 'debug', 'trace', 'silent']).default('info'),
  ENABLE_DOCS: booleanString.default('true'),
  DATABASE_URL: z.string().optional(),
  DATABASE_POOL_MAX: z.coerce.number().int().min(1).max(100).default(10),
  RABBITMQ_URL: z.string().optional(),
  REDIS_URL: z.string().optional(),
  AUTH_JWKS_URL: z.string().url().optional(),
  JWT_ISSUER: z.string().default('spendwise-auth'),
  JWT_AUDIENCE: z.string().default('spendwise'),
  INTERNAL_API_TOKEN: z.string().min(24, 'INTERNAL_API_TOKEN must be at least 24 characters'),
});

/**
 * Loads and validates configuration from environment variables. The service refuses
 * to start with invalid configuration (fail fast) instead of running half-configured.
 */
export function loadConfig(extension = {}, defaults = {}) {
  const schema = baseConfigSchema.extend(extension);
  const result = schema.safeParse({ ...defaults, ...process.env });
  if (!result.success) {
    const fields = Object.entries(result.error.flatten().fieldErrors)
      .map(([key, msgs]) => `  - ${key}: ${msgs.join(', ')}`)
      .join('\n');
    throw new Error(`Invalid configuration:\n${fields}`);
  }
  const config = result.data;
  if (config.NODE_ENV === 'production' && /change-me|dev-only/i.test(config.INTERNAL_API_TOKEN)) {
    throw new Error('Refusing to start in production with a development INTERNAL_API_TOKEN');
  }
  return config;
}

export { booleanString };
