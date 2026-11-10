import {
  MessageBus,
  booleanString,
  configureAuth,
  createPool,
  createRedis,
  every,
  initLogger,
  loadConfig,
  runMigrations,
  startServer,
  z,
} from '@spendwise/common';
import { buildApp } from './app.js';
import { createCurrencyService } from './service.js';

const config = loadConfig(
  {
    DATABASE_URL: z.string().min(1),
    RABBITMQ_URL: z.string().min(1),
    REDIS_URL: z.string().min(1),
    AUTH_JWKS_URL: z.string().url(),
    RATES_PROVIDER_URL: z.string().url().default('https://api.frankfurter.dev/v1/latest?base=USD'),
    RATES_REFRESH_ENABLED: booleanString.default('true'),
    RATES_REFRESH_INTERVAL_MINUTES: z.coerce.number().int().min(5).default(360),
  },
  { SERVICE_NAME: 'currency-service', PORT: 4013 },
);
const log = initLogger(config.SERVICE_NAME, config.LOG_LEVEL);

const pool = createPool(config.DATABASE_URL, { max: config.DATABASE_POOL_MAX });
await runMigrations(pool, { dir: new URL('../migrations', import.meta.url) });
configureAuth({ jwksUrl: config.AUTH_JWKS_URL, internalToken: config.INTERNAL_API_TOKEN });

const redis = createRedis(config.REDIS_URL);
const service = createCurrencyService({ pool, redis, config });
const bus = new MessageBus({ url: config.RABBITMQ_URL, serviceName: config.SERVICE_NAME, pool });
await bus.start({ relayOutbox: true });

if (config.RATES_REFRESH_ENABLED) {
  every(
    config.RATES_REFRESH_INTERVAL_MINUTES * 60_000,
    () => service.refresh().catch((err) => log.warn({ err: err.message }, 'rate refresh failed; using stored rates')),
    { runImmediately: true },
  );
}

const app = buildApp({
  service,
  enableDocs: config.ENABLE_DOCS,
  readiness: { database: () => pool.query('SELECT 1'), broker: () => bus.isReady() },
});
startServer({ app, port: config.PORT, onShutdown: [() => bus.close(), () => redis.quit(), () => pool.end()] });
