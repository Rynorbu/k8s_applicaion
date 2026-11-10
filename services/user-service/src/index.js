import {
  Events,
  MessageBus,
  configureAuth,
  createPool,
  createServiceClient,
  initLogger,
  loadConfig,
  runMigrations,
  startServer,
  z,
} from '@spendwise/common';
import { buildApp } from './app.js';
import { createUserService } from './service.js';

const config = loadConfig(
  {
    DATABASE_URL: z.string().min(1),
    RABBITMQ_URL: z.string().min(1),
    AUTH_JWKS_URL: z.string().url(),
    CURRENCY_SERVICE_URL: z.string().url(),
  },
  { SERVICE_NAME: 'user-service', PORT: 4002 },
);
initLogger(config.SERVICE_NAME, config.LOG_LEVEL);

const pool = createPool(config.DATABASE_URL, { max: config.DATABASE_POOL_MAX });
await runMigrations(pool, { dir: new URL('../migrations', import.meta.url) });
configureAuth({ jwksUrl: config.AUTH_JWKS_URL, internalToken: config.INTERNAL_API_TOKEN });

const currencyClient = createServiceClient({
  name: 'currency-service',
  baseUrl: config.CURRENCY_SERVICE_URL,
  internalToken: config.INTERNAL_API_TOKEN,
});
const service = createUserService({ pool, currencyClient });

const bus = new MessageBus({ url: config.RABBITMQ_URL, serviceName: config.SERVICE_NAME, pool });
await bus.start({
  relayOutbox: true,
  handlers: {
    [Events.UserRegistered]: (event, { client }) => service.createFromRegistration(client, event.data),
  },
});

const app = buildApp({
  service,
  enableDocs: config.ENABLE_DOCS,
  readiness: { database: () => pool.query('SELECT 1'), broker: () => bus.isReady() },
});
startServer({ app, port: config.PORT, onShutdown: [() => bus.close(), () => pool.end()] });
