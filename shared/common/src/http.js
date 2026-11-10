import { randomUUID } from 'node:crypto';
import express from 'express';
import helmet from 'helmet';
import { pinoHttp } from 'pino-http';
import swaggerUi from 'swagger-ui-express';
import { runWithContext } from './context.js';
import { errorHandler, notFoundHandler } from './errors.js';
import { getLogger } from './logger.js';
import { initMetrics, metricsHandler, metricsMiddleware } from './metrics.js';
import { buildOpenApi } from './openapi.js';

const ID_PATTERN = /^[A-Za-z0-9._-]{8,128}$/;

/** Assigns request & correlation ids (reusing trusted upstream values) and opens the async context. */
export function requestContext() {
  return (req, res, next) => {
    const incomingRequestId = req.get('x-request-id');
    const incomingCorrelationId = req.get('x-correlation-id');
    const requestId = incomingRequestId && ID_PATTERN.test(incomingRequestId) ? incomingRequestId : randomUUID();
    const correlationId =
      incomingCorrelationId && ID_PATTERN.test(incomingCorrelationId) ? incomingCorrelationId : requestId;
    req.id = requestId;
    req.correlationId = correlationId;
    res.setHeader('x-request-id', requestId);
    res.setHeader('x-correlation-id', correlationId);
    runWithContext({ requestId, correlationId }, () => next());
  };
}

function withTimeout(promise, ms) {
  let timer;
  return Promise.race([
    promise,
    new Promise((_, reject) => {
      timer = setTimeout(() => reject(new Error('timeout')), ms);
    }),
  ]).finally(() => clearTimeout(timer));
}

export function healthRoutes(name, readiness = {}) {
  const router = express.Router();
  router.get('/health/live', (req, res) => res.json({ status: 'ok', service: name, uptime: process.uptime() }));
  router.get('/health/ready', async (req, res) => {
    const checks = {};
    let ready = true;
    await Promise.all(
      Object.entries(readiness).map(async ([key, check]) => {
        try {
          await withTimeout(Promise.resolve(check()), 2000);
          checks[key] = 'up';
        } catch {
          ready = false;
          checks[key] = 'down';
        }
      }),
    );
    res.status(ready ? 200 : 503).json({ status: ready ? 'ready' : 'not_ready', service: name, checks });
  });
  return router;
}

/**
 * Creates a hardened Express application with the platform's standard middleware:
 * security headers, request context, structured access logs, metrics, health probes,
 * Swagger docs, JSON body limits, 404 + error handling.
 */
export function createApp({
  name,
  version = '1.0.0',
  description,
  routers = [],
  readiness = {},
  bodyLimit = '100kb',
  enableDocs = true,
  configure,
}) {
  initMetrics(name);
  const app = express();
  app.disable('x-powered-by');
  app.set('trust proxy', 1);
  app.use(helmet({ crossOriginResourcePolicy: { policy: 'same-site' } }));
  app.use(requestContext());
  app.use(
    pinoHttp({
      logger: getLogger(),
      genReqId: (req) => req.id,
      autoLogging: { ignore: (req) => req.url.startsWith('/health') || req.url === '/metrics' },
      customLogLevel: (req, res, err) => (err || res.statusCode >= 500 ? 'error' : res.statusCode >= 400 ? 'warn' : 'info'),
      serializers: {
        req: (req) => ({ method: req.method, url: req.url?.split('?')[0], remoteAddress: req.remoteAddress }),
        res: (res) => ({ statusCode: res.statusCode }),
      },
    }),
  );
  app.use(metricsMiddleware);
  app.use(healthRoutes(name, readiness));
  app.get('/metrics', metricsHandler);

  if (enableDocs) {
    const spec = buildOpenApi({ title: `SpendWise ${name}`, version, description, routers });
    app.get('/docs/openapi.json', (req, res) => res.json(spec));
    app.use('/docs', swaggerUi.serve, swaggerUi.setup(spec, { customSiteTitle: `SpendWise ${name}` }));
  }

  configure?.(app);
  app.use(express.json({ limit: bodyLimit }));
  for (const router of routers) app.use(router.prefix, router.router);
  app.use(notFoundHandler);
  app.use(errorHandler);
  return app;
}
