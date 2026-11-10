import { mkdir } from 'node:fs/promises';
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
import { createReportService } from './service.js';

const config = loadConfig(
  {
    DATABASE_URL: z.string().min(1),
    RABBITMQ_URL: z.string().min(1),
    AUTH_JWKS_URL: z.string().url(),
    ANALYTICS_SERVICE_URL: z.string().url(),
    EXPENSE_SERVICE_URL: z.string().url(),
    INCOME_SERVICE_URL: z.string().url(),
    REPORTS_DIR: z.string().default('./data/reports'),
  },
  { SERVICE_NAME: 'report-service', PORT: 4011 },
);
initLogger(config.SERVICE_NAME, config.LOG_LEVEL);
await mkdir(config.REPORTS_DIR, { recursive: true });

const pool = createPool(config.DATABASE_URL, { max: config.DATABASE_POOL_MAX });
await runMigrations(pool, { dir: new URL('../migrations', import.meta.url) });
configureAuth({ jwksUrl: config.AUTH_JWKS_URL, internalToken: config.INTERNAL_API_TOKEN });

const client = (name, baseUrl) => createServiceClient({ name, baseUrl, internalToken: config.INTERNAL_API_TOKEN, timeoutMs: 15_000 });
const service = createReportService({
  pool,
  config,
  clients: {
    analytics: client('analytics-service', config.ANALYTICS_SERVICE_URL),
    expenses: client('expense-service', config.EXPENSE_SERVICE_URL),
    incomes: client('income-service', config.INCOME_SERVICE_URL),
  },
});

const bus = new MessageBus({ url: config.RABBITMQ_URL, serviceName: config.SERVICE_NAME, pool, prefetch: 2 });
await bus.start({
  relayOutbox: true,
  handlers: { [Events.ReportRequested]: (e, { client: db }) => service.process(db, e.data) },
});
every(15 * 60 * 1000, async () => {
  await service.housekeeping();
  await bus.cleanup();
});

const app = buildApp({
  service,
  enableDocs: config.ENABLE_DOCS,
  readiness: { database: () => pool.query('SELECT 1'), broker: () => bus.isReady() },
});
startServer({ app, port: config.PORT, onShutdown: [() => bus.close(), () => pool.end()] });
