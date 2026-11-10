import { MessageBus, configureAuth, createPool, initLogger, loadConfig, runMigrations, startServer, z } from '@spendwise/common';
import { buildApp } from './app.js';
import { createCategoryService } from './service.js';

const config = loadConfig(
  { DATABASE_URL: z.string().min(1), RABBITMQ_URL: z.string().min(1), AUTH_JWKS_URL: z.string().url() },
  { SERVICE_NAME: 'category-service', PORT: 4005 },
);
initLogger(config.SERVICE_NAME, config.LOG_LEVEL);

const pool = createPool(config.DATABASE_URL, { max: config.DATABASE_POOL_MAX });
await runMigrations(pool, { dir: new URL('../migrations', import.meta.url) });
configureAuth({ jwksUrl: config.AUTH_JWKS_URL, internalToken: config.INTERNAL_API_TOKEN });

const service = createCategoryService({ pool });
const bus = new MessageBus({ url: config.RABBITMQ_URL, serviceName: config.SERVICE_NAME, pool });
await bus.start({ relayOutbox: true });

const app = buildApp({
  service,
  enableDocs: config.ENABLE_DOCS,
  readiness: { database: () => pool.query('SELECT 1'), broker: () => bus.isReady() },
});
startServer({ app, port: config.PORT, onShutdown: [() => bus.close(), () => pool.end()] });
