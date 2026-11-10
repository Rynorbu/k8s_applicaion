import cors from 'cors';
import { rateLimit } from 'express-rate-limit';
import { createProxyMiddleware } from 'http-proxy-middleware';
import { RedisStore } from 'rate-limit-redis';
import swaggerUi from 'swagger-ui-express';
import {
  AppError,
  NotFound,
  Unauthorized,
  createApp,
  extractBearer,
  getContext,
  getLogger,
  setContextValue,
  verifyAccessToken,
} from '@spendwise/common';
import { SERVICES, isPublic, isSensitive } from './routes.js';

const STRIPPED_HEADERS = ['x-internal-token', 'x-user-id', 'x-user-roles', 'x-forwarded-user'];

function errorJson(res, status, code, message) {
  if (res.headersSent) return;
  res.status(status).json({ error: { code, message, requestId: getContext().requestId } });
}

/** Builds the gateway Express app. `deps` are injectable for tests. */
export function buildGateway({ config, redis, targets, aggregator, docsFetcher, readiness = {} }) {
  const log = getLogger();
  const makeStore = (prefix) =>
    redis ? new RedisStore({ prefix, sendCommand: (...args) => redis.call(...args) }) : undefined;

  const limiterBase = {
    standardHeaders: 'draft-7',
    legacyHeaders: false,
    passOnStoreError: true, // a Redis outage must not take the API down
    handler: (req, res) => errorJson(res, 429, 'TOO_MANY_REQUESTS', 'Too many requests. Please slow down.'),
  };
  const globalLimiter = rateLimit({ ...limiterBase, windowMs: 60_000, limit: config.RATE_LIMIT_PER_MINUTE, store: makeStore('rl:global:') });
  const sensitiveLimiter = rateLimit({
    ...limiterBase,
    windowMs: 15 * 60_000,
    limit: config.AUTH_RATE_LIMIT_PER_15MIN,
    store: makeStore('rl:auth:'),
    skip: (req) => !isSensitive(`${req.baseUrl}${req.path}`),
  });
  const userLimiter = rateLimit({
    ...limiterBase,
    windowMs: 60_000,
    limit: config.USER_RATE_LIMIT_PER_MINUTE,
    store: makeStore('rl:user:'),
    keyGenerator: (req) => req.user?.id ?? req.ip,
    skip: (req) => !req.user,
  });

  async function authenticate(req, res, next) {
    for (const h of STRIPPED_HEADERS) delete req.headers[h];
    if (!req.path.startsWith('/api/') || isPublic(req.path)) return next();
    const token = extractBearer(req);
    if (!token) return errorJson(res, 401, 'UNAUTHORIZED', 'Missing bearer token');
    try {
      const payload = await verifyAccessToken(token);
      req.user = { id: payload.sub, roles: payload.roles ?? [] };
      setContextValue('userId', payload.sub);
      next();
    } catch (err) {
      const message = err instanceof AppError ? err.message : 'Invalid or expired token';
      errorJson(res, 401, 'UNAUTHORIZED', message);
    }
  }

  const proxies = SERVICES.map((service) =>
    createProxyMiddleware({
      target: targets[service.name],
      changeOrigin: true,
      xfwd: true,
      proxyTimeout: 30_000,
      timeout: 30_000,
      pathFilter: (path) => service.prefixes.some((p) => path === p || path.startsWith(`${p}/`)),
      on: {
        proxyReq: (proxyReq, req) => {
          const ctx = getContext();
          proxyReq.setHeader('x-request-id', req.id ?? ctx.requestId);
          proxyReq.setHeader('x-correlation-id', req.correlationId ?? ctx.correlationId);
        },
        error: (err, req, res) => {
          log.error({ err: err.message, service: service.name, path: req.url }, 'upstream error');
          if (typeof res.status === 'function') errorJson(res, 502, 'BAD_GATEWAY', `The ${service.name} service is unavailable`);
          else res.end?.();
        },
      },
    }),
  );

  const docsUrls = SERVICES.map((s) => ({ url: `/docs/specs/${s.name}`, name: `${s.name}-service` }));

  return createApp({
    name: 'api-gateway',
    description: 'SpendWise API gateway',
    enableDocs: false,
    readiness,
    configure: (app) => {
      app.use(
        cors({
          origin: (origin, cb) => cb(null, !origin || config.CORS_ORIGINS.includes(origin)),
          credentials: true,
          exposedHeaders: ['x-request-id', 'x-correlation-id', 'content-disposition', 'ratelimit', 'ratelimit-policy'],
          maxAge: 600,
        }),
      );

      // Aggregated API documentation for all services.
      if (config.ENABLE_DOCS) {
        app.get('/docs/specs/:service', async (req, res, next) => {
          try {
            const service = SERVICES.find((s) => s.name === req.params.service);
            if (!service) throw NotFound('Unknown service');
            res.json(await docsFetcher(service));
          } catch (err) {
            next(err);
          }
        });
        app.use('/docs', swaggerUi.serveFiles(null, { swaggerOptions: { urls: docsUrls } }), swaggerUi.setup(null, {
          explorer: true,
          customSiteTitle: 'SpendWise API',
          swaggerOptions: { urls: docsUrls },
        }));
      }

      app.use('/api', globalLimiter, sensitiveLimiter);
      app.use(authenticate);
      app.use('/api', userLimiter);

      // Backend-for-frontend: one round trip for the whole dashboard.
      app.get('/api/v1/dashboard', async (req, res, next) => {
        try {
          res.json(await aggregator.dashboard(extractBearer(req)));
        } catch (err) {
          next(err);
        }
      });
      app.get('/api/v1/system/status', async (req, res, next) => {
        try {
          if (!req.user?.roles.includes('admin')) throw new AppError(403, 'FORBIDDEN', 'Admin only');
          res.json(await aggregator.status());
        } catch (err) {
          next(err);
        }
      });

      for (const proxy of proxies) app.use(proxy);
      app.use('/internal', (req, res, next) => next(Unauthorized('Not available')));
    },
  });
}
