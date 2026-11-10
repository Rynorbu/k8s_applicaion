import { configureAuth, createRedis, initLogger, loadConfig, startServer, z } from '@spendwise/common';
import { createAggregator, createDocsFetcher } from './aggregator.js';
import { buildGateway } from './app.js';
import { SERVICES } from './routes.js';

const serviceUrls = Object.fromEntries(SERVICES.map((s) => [s.env, z.string().url()]));
const config = loadConfig(
  {
    ...serviceUrls,
    REDIS_URL: z.string().min(1),
    AUTH_JWKS_URL: z.string().url(),
    CORS_ORIGINS: z
      .string()
      .default('http://localhost:3000,http://localhost:5173')
      .transform((v) => v.split(',').map((o) => o.trim()).filter(Boolean)),
    RATE_LIMIT_PER_MINUTE: z.coerce.number().int().min(10).default(600),
    USER_RATE_LIMIT_PER_MINUTE: z.coerce.number().int().min(10).default(300),
    AUTH_RATE_LIMIT_PER_15MIN: z.coerce.number().int().min(3).default(30),
  },
  { SERVICE_NAME: 'api-gateway', PORT: 8080 },
);
initLogger(config.SERVICE_NAME, config.LOG_LEVEL);

const redis = createRedis(config.REDIS_URL);
configureAuth({
  jwksUrl: config.AUTH_JWKS_URL,
  internalToken: config.INTERNAL_API_TOKEN,
  // Access tokens revoked at logout are deny-listed in Redis by the auth service.
  isRevoked: async (jti) => {
    try {
      return (await redis.exists(`auth:revoked:${jti}`)) === 1;
    } catch {
      return false;
    }
  },
});

const targets = Object.fromEntries(SERVICES.map((s) => [s.name, config[s.env]]));
const app = buildGateway({
  config,
  redis,
  targets,
  aggregator: createAggregator({ targets }),
  docsFetcher: createDocsFetcher({ targets }),
  readiness: { redis: () => redis.ping() },
});

startServer({ app, port: config.PORT, onShutdown: [() => redis.quit()] });
