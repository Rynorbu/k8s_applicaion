import {
  Events,
  MessageBus,
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
import { createAnalyticsService } from './service.js';

const config = loadConfig(
  { DATABASE_URL: z.string().min(1), RABBITMQ_URL: z.string().min(1), REDIS_URL: z.string().min(1), AUTH_JWKS_URL: z.string().url() },
  { SERVICE_NAME: 'analytics-service', PORT: 4009 },
);
initLogger(config.SERVICE_NAME, config.LOG_LEVEL);

const pool = createPool(config.DATABASE_URL, { max: config.DATABASE_POOL_MAX });
await runMigrations(pool, { dir: new URL('../migrations', import.meta.url) });
configureAuth({ jwksUrl: config.AUTH_JWKS_URL, internalToken: config.INTERNAL_API_TOKEN });

const redis = createRedis(config.REDIS_URL);
const service = createAnalyticsService({ pool, redis });

const bus = new MessageBus({ url: config.RABBITMQ_URL, serviceName: config.SERVICE_NAME, pool });
await bus.start({
  handlers: {
    [Events.ExpenseCreated]: (e, { client }) => service.upsertTransaction(client, 'expense', e.data),
    [Events.ExpenseUpdated]: (e, { client }) => service.upsertTransaction(client, 'expense', e.data),
    [Events.ExpenseDeleted]: (e, { client }) => service.deleteTransaction(client, 'expense', e.data),
    [Events.IncomeCreated]: (e, { client }) => service.upsertTransaction(client, 'income', e.data),
    [Events.IncomeUpdated]: (e, { client }) => service.upsertTransaction(client, 'income', e.data),
    [Events.IncomeDeleted]: (e, { client }) => service.deleteTransaction(client, 'income', e.data),
    [Events.CategoryUpdated]: (e, { client }) => service.onCategoryUpdated(client, e.data),
    [Events.CategoryDeleted]: (e, { client }) => service.onCategoryDeleted(client, e.data),
  },
});
every(6 * 60 * 60 * 1000, () => bus.cleanup());

const app = buildApp({
  service,
  enableDocs: config.ENABLE_DOCS,
  readiness: { database: () => pool.query('SELECT 1'), broker: () => bus.isReady() },
});
startServer({ app, port: config.PORT, onShutdown: [() => bus.close(), () => redis.quit(), () => pool.end()] });
