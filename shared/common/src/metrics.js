import client from 'prom-client';

export const registry = new client.Registry();
let defaultsCollected = false;

export function initMetrics(service) {
  if (defaultsCollected) return;
  registry.setDefaultLabels({ service });
  client.collectDefaultMetrics({ register: registry });
  defaultsCollected = true;
}

export const httpRequestDuration = new client.Histogram({
  name: 'http_request_duration_seconds',
  help: 'HTTP request latency in seconds',
  labelNames: ['method', 'route', 'status_code'],
  buckets: [0.005, 0.01, 0.025, 0.05, 0.1, 0.25, 0.5, 1, 2.5, 5, 10],
  registers: [registry],
});

export const eventsPublished = new client.Counter({
  name: 'events_published_total',
  help: 'Domain events relayed from the outbox to the broker',
  labelNames: ['type'],
  registers: [registry],
});

export const eventsConsumed = new client.Counter({
  name: 'events_consumed_total',
  help: 'Domain events consumed, by outcome (success, duplicate, retry, dead_letter, ignored)',
  labelNames: ['type', 'outcome'],
  registers: [registry],
});

export const eventProcessingDuration = new client.Histogram({
  name: 'event_processing_duration_seconds',
  help: 'Time spent handling a consumed event',
  labelNames: ['type'],
  buckets: [0.005, 0.01, 0.05, 0.1, 0.5, 1, 5],
  registers: [registry],
});

export const outboxPending = new client.Gauge({
  name: 'outbox_pending_events',
  help: 'Events waiting in the outbox to be published',
  registers: [registry],
});

export const businessEvents = new client.Counter({
  name: 'spendwise_business_events_total',
  help: 'Business-level counters (expenses created, budgets exceeded, ...)',
  labelNames: ['name'],
  registers: [registry],
});

function routeLabel(req, res) {
  if (req.route?.path) return `${req.baseUrl}${req.route.path}`;
  if (res.statusCode === 404) return 'unmatched';
  // Proxied routes (gateway): keep cardinality bounded to the resource prefix.
  return req.originalUrl.split('?')[0].split('/').slice(0, 4).join('/') || '/';
}

export function metricsMiddleware(req, res, next) {
  if (req.path === '/metrics' || req.path.startsWith('/health')) return next();
  const end = httpRequestDuration.startTimer();
  res.on('finish', () => end({ method: req.method, route: routeLabel(req, res), status_code: res.statusCode }));
  next();
}

export async function metricsHandler(req, res) {
  res.set('Content-Type', registry.contentType);
  res.end(await registry.metrics());
}
