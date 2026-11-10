import { mkdir } from 'node:fs/promises';
import { MessageBus, configureAuth, createPool, every, initLogger, loadConfig, runMigrations, startServer, z } from '@spendwise/common';
import { buildApp } from './app.js';
import { createFileService } from './service.js';

const config = loadConfig(
  {
    DATABASE_URL: z.string().min(1),
    RABBITMQ_URL: z.string().min(1),
    AUTH_JWKS_URL: z.string().url(),
    FILES_DIR: z.string().default('./data/files'),
    MAX_UPLOAD_BYTES: z.coerce.number().int().min(1024).max(25 * 1024 * 1024).default(5 * 1024 * 1024),
  },
  { SERVICE_NAME: 'file-service', PORT: 4016 },
);
initLogger(config.SERVICE_NAME, config.LOG_LEVEL);
await mkdir(config.FILES_DIR, { recursive: true });

const pool = createPool(config.DATABASE_URL, { max: config.DATABASE_POOL_MAX });
await runMigrations(pool, { dir: new URL('../migrations', import.meta.url) });
configureAuth({ jwksUrl: config.AUTH_JWKS_URL, internalToken: config.INTERNAL_API_TOKEN });

const service = createFileService({ pool, config });
const bus = new MessageBus({ url: config.RABBITMQ_URL, serviceName: config.SERVICE_NAME, pool });
await bus.start({ relayOutbox: true });
every(6 * 60 * 60 * 1000, () => bus.cleanup());

const app = buildApp({
  service,
  config,
  enableDocs: config.ENABLE_DOCS,
  readiness: { database: () => pool.query('SELECT 1'), broker: () => bus.isReady() },
});
startServer({ app, port: config.PORT, onShutdown: [() => bus.close(), () => pool.end()] });
