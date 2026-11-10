import { MessageBus, configureAuth, createPool, every, initLogger, loadConfig, runMigrations, startServer, z } from '@spendwise/common';
import { buildApp } from './app.js';
import { createAuditService } from './service.js';

const config = loadConfig(
  { DATABASE_URL: z.string().min(1), RABBITMQ_URL: z.string().min(1), AUTH_JWKS_URL: z.string().url() },
  { SERVICE_NAME: 'audit-service', PORT: 4014 },
);
initLogger(config.SERVICE_NAME, config.LOG_LEVEL);

const pool = createPool(config.DATABASE_URL, { max: config.DATABASE_POOL_MAX });
await runMigrations(pool, { dir: new URL('../migrations', import.meta.url) });
configureAuth({ jwksUrl: config.AUTH_JWKS_URL, internalToken: config.INTERNAL_API_TOKEN });

const service = createAuditService({ pool });
const bus = new MessageBus({ url: config.RABBITMQ_URL, serviceName: config.SERVICE_NAME, pool, prefetch: 1 });
// Wildcard subscription: every event on the exchange is recorded.
await bus.start({ bindings: ['#'], handlers: { '*': (event, { client }) => service.record(client, event) } });
every(24 * 60 * 60 * 1000, () => bus.cleanup());

const app = buildApp({
  service,
  enableDocs: config.ENABLE_DOCS,
  readiness: { database: () => pool.query('SELECT 1'), broker: () => bus.isReady() },
});
startServer({ app, port: config.PORT, onShutdown: [() => bus.close(), () => pool.end()] });
