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
import { createNarrator } from './narrative.js';
import { createInsightService } from './service.js';

const config = loadConfig(
  {
    DATABASE_URL: z.string().min(1),
    RABBITMQ_URL: z.string().min(1),
    REDIS_URL: z.string().min(1),
    AUTH_JWKS_URL: z.string().url(),
    // Optional: enables Claude-written narratives. Without it a deterministic template is used.
    ANTHROPIC_API_KEY: z.string().optional(),
    ANTHROPIC_MODEL: z.string().default('claude-opus-5-5'),
  },
  { SERVICE_NAME: 'ai-service', PORT: 4015 },
);
const log = initLogger(config.SERVICE_NAME, config.LOG_LEVEL);

const pool = createPool(config.DATABASE_URL, { max: config.DATABASE_POOL_MAX });
await runMigrations(pool, { dir: new URL('../migrations', import.meta.url) });
configureAuth({ jwksUrl: config.AUTH_JWKS_URL, internalToken: config.INTERNAL_API_TOKEN });

const redis = createRedis(config.REDIS_URL);
const narrator = createNarrator({ apiKey: config.ANTHROPIC_API_KEY, model: config.ANTHROPIC_MODEL, redis });
log.info({ llmNarrative: narrator.enabled, model: narrator.enabled ? config.ANTHROPIC_MODEL : undefined }, 'insight engine configured');
const service = createInsightService({ pool, narrator });

const bus = new MessageBus({ url: config.RABBITMQ_URL, serviceName: config.SERVICE_NAME, pool });
await bus.start({
  relayOutbox: true,
  handlers: {
    [Events.ExpenseCreated]: (e, { client }) => service.onExpenseCreated(client, e.data),
    [Events.ExpenseUpdated]: (e, { client }) => service.upsert(client, 'expense', e.data),
    [Events.ExpenseDeleted]: (e, { client }) => service.remove(client, 'expense', e.data),
    [Events.IncomeCreated]: (e, { client }) => service.upsert(client, 'income', e.data),
    [Events.IncomeUpdated]: (e, { client }) => service.upsert(client, 'income', e.data),
    [Events.IncomeDeleted]: (e, { client }) => service.remove(client, 'income', e.data),
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
