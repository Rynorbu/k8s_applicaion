import { booleanString, loadConfig, z } from '@spendwise/common';

export function getConfig() {
  return loadConfig(
    {
      DATABASE_URL: z.string().min(1),
      RABBITMQ_URL: z.string().min(1),
      REDIS_URL: z.string().min(1),
      // Base64-encoded PKCS#8 PEM. When absent outside production an ephemeral key is generated.
      JWT_PRIVATE_KEY: z.string().optional(),
      JWT_KEY_ID: z.string().default('spendwise-key-1'),
      ACCESS_TOKEN_TTL: z.string().default('15m'),
      REFRESH_TOKEN_TTL_DAYS: z.coerce.number().int().min(1).max(90).default(7),
      PASSWORD_RESET_TTL_MINUTES: z.coerce.number().int().min(5).max(120).default(30),
      MAX_FAILED_LOGINS: z.coerce.number().int().min(3).max(20).default(5),
      LOCKOUT_MINUTES: z.coerce.number().int().min(1).max(1440).default(15),
      COOKIE_SECURE: booleanString.default('false'),
      APP_URL: z.string().url().default('http://localhost:3000'),
      ADMIN_EMAILS: z
        .string()
        .default('')
        .transform((v) => v.split(',').map((e) => e.trim().toLowerCase()).filter(Boolean)),
    },
    { SERVICE_NAME: 'auth-service', PORT: 4001 },
  );
}
