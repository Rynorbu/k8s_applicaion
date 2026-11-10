import {
  Events,
  MessageBus,
  configureAuth,
  createPool,
  createServiceClient,
  every,
  initLogger,
  loadConfig,
  runMigrations,
  startServer,
  z,
} from '@spendwise/common';
import { buildApp } from './app.js';
import { createRecurringService } from './service.js';

const config = loadConfig(
  {
    DATABASE_URL: z.string().min(1),
    RABBITMQ_URL: z.string().min(1),
    AUTH_JWKS_URL: z.string().url(),
    CATEGORY_SERVICE_URL: z.string().url(),
    SCHEDULER_INTERVAL_SECONDS: z.coerce.number().int().min(5).default(30),
  },
  { SERVICE_NAME: 'recurring-service', PORT: 4007 },
);
initLogger(config.SERVICE_NAME, config.LOG_LEVEL);

const pool = createPool(config.DATABASE_URL, { max: config.DATABASE_POOL_MAX });
await runMigrations(pool, { dir: new URL('../migrations', import.meta.url) });
configureAuth({ jwksUrl: config.AUTH_JWKS_URL, internalToken: config.INTERNAL_API_TOKEN });

const service = createRecurringService({
  pool,
  clients: {
    categories: createServiceClient({ name: 'category-service', baseUrl: config.CATEGORY_SERVICE_URL, internalToken: config.INTERNAL_API_TOKEN }),
  },
});

const bus = new MessageBus({ url: config.RABBITMQ_URL, serviceName: config.SERVICE_NAME, pool });
await bus.start({
  relayOutbox: true,
  handlers: {
    [Events.CategoryUpdated]: (e, { client }) => service.onCategoryUpdated(client, e.data),
    [Events.CategoryDeleted]: (e, { client }) => service.onCategoryDeleted(client, e.data),
  },
});

every(config.SCHEDULER_INTERVAL_SECONDS * 1000, () => service.runDue(), { runImmediately: true });
every(6 * 60 * 60 * 1000, () => bus.cleanup());

const app = buildApp({
  service,
  enableDocs: config.ENABLE_DOCS,
  readiness: { database: () => pool.query('SELECT 1'), broker: () => bus.isReady() },
});
startServer({ app, port: config.PORT, onShutdown: [() => bus.close(), () => pool.end()] });
