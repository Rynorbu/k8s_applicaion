import {
  Events,
  MessageBus,
  configureAuth,
  createPool,
  createRedis,
  every,
  initLogger,
  runMigrations,
  startServer,
} from '@spendwise/common';
import { buildApp } from './app.js';
import { getConfig } from './config.js';
import { createTokenSigner, loadSigningKeys } from './crypto.js';
import { createAuthService } from './service.js';

const config = getConfig();
const logger = initLogger(config.SERVICE_NAME, config.LOG_LEVEL);

const keys = await loadSigningKeys({
  privateKeyBase64: config.JWT_PRIVATE_KEY,
  keyId: config.JWT_KEY_ID,
  production: config.NODE_ENV === 'production',
});
const pool = createPool(config.DATABASE_URL, { max: config.DATABASE_POOL_MAX });
await runMigrations(pool, { dir: new URL('../migrations', import.meta.url) });

const redis = createRedis(config.REDIS_URL);
const signer = createTokenSigner({
  privateKey: keys.privateKey,
  keyId: keys.keyId,
  issuer: config.JWT_ISSUER,
  audience: config.JWT_AUDIENCE,
  accessTokenTtl: config.ACCESS_TOKEN_TTL,
});
const service = createAuthService({ pool, redis, signer, config });
configureAuth({
  key: keys.publicKey,
  issuer: config.JWT_ISSUER,
  audience: config.JWT_AUDIENCE,
  internalToken: config.INTERNAL_API_TOKEN,
  isRevoked: (jti) => service.isRevoked(jti),
});

const bus = new MessageBus({ url: config.RABBITMQ_URL, serviceName: config.SERVICE_NAME, pool });
await bus.start({
  relayOutbox: true,
  handlers: {
    [Events.UserProfileUpdated]: (event, { client }) => service.syncProfile(client, event.data),
  },
});

// Housekeeping: purge expired refresh/reset tokens and old outbox rows.
every(60 * 60 * 1000, async () => {
  await pool.query(`DELETE FROM refresh_tokens WHERE expires_at < now() - interval '1 day'`);
  await pool.query(`DELETE FROM password_reset_tokens WHERE expires_at < now() - interval '1 day'`);
  await bus.cleanup();
});

const app = buildApp({
  service,
  config,
  jwks: keys.jwks,
  readiness: {
    database: () => pool.query('SELECT 1'),
    broker: () => bus.isReady(),
    redis: () => redis.ping(),
  },
});

startServer({
  app,
  port: config.PORT,
  onShutdown: [() => bus.close(), () => redis.quit(), () => pool.end()],
});
logger.info('auth-service started');
