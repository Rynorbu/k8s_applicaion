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
import { createExpenseService } from './service.js';

const config = loadConfig(
  {
    DATABASE_URL: z.string().min(1),
    RABBITMQ_URL: z.string().min(1),
    AUTH_JWKS_URL: z.string().url(),
    CATEGORY_SERVICE_URL: z.string().url(),
    CURRENCY_SERVICE_URL: z.string().url(),
    FILE_SERVICE_URL: z.string().url(),
  },
  { SERVICE_NAME: 'expense-service', PORT: 4003 },
);
initLogger(config.SERVICE_NAME, config.LOG_LEVEL);

const pool = createPool(config.DATABASE_URL, { max: config.DATABASE_POOL_MAX });
await runMigrations(pool, { dir: new URL('../migrations', import.meta.url) });
configureAuth({ jwksUrl: config.AUTH_JWKS_URL, internalToken: config.INTERNAL_API_TOKEN });

const client = (name, baseUrl) => createServiceClient({ name, baseUrl, internalToken: config.INTERNAL_API_TOKEN });
const service = createExpenseService({
  pool,
  clients: {
    categories: client('category-service', config.CATEGORY_SERVICE_URL),
    currency: client('currency-service', config.CURRENCY_SERVICE_URL),
    files: client('file-service', config.FILE_SERVICE_URL),
  },
});

const bus = new MessageBus({ url: config.RABBITMQ_URL, serviceName: config.SERVICE_NAME, pool });
await bus.start({
  relayOutbox: true,
  handlers: {
    [Events.UserRegistered]: (e, { client: db }) => service.upsertSettings(db, { userId: e.data.userId }),
    [Events.UserProfileUpdated]: (e, { client: db }) => service.upsertSettings(db, e.data),
    [Events.CategoryUpdated]: (e, { client: db }) => service.onCategoryUpdated(db, e.data),
    [Events.CategoryDeleted]: (e, { client: db }) => service.onCategoryDeleted(db, e.data),
    [Events.RecurringTransactionDue]: (e, { client: db }) => service.onRecurringDue(db, e.data),
    [Events.ImportBatchReady]: (e, { client: db }) => service.onImportBatch(db, e.data),
  },
});
every(6 * 60 * 60 * 1000, () => bus.cleanup());

const app = buildApp({
  service,
  enableDocs: config.ENABLE_DOCS,
  readiness: { database: () => pool.query('SELECT 1'), broker: () => bus.isReady() },
});
startServer({ app, port: config.PORT, onShutdown: [() => bus.close(), () => pool.end()] });
