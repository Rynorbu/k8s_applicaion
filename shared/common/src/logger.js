import pino from 'pino';
import { trace } from '@opentelemetry/api';
import { getContext } from './context.js';

const REDACT_PATHS = [
  'password',
  '*.password',
  'newPassword',
  '*.newPassword',
  'currentPassword',
  '*.currentPassword',
  'token',
  '*.token',
  'accessToken',
  '*.accessToken',
  'refreshToken',
  '*.refreshToken',
  'req.headers.authorization',
  'req.headers.cookie',
  'req.headers["x-internal-token"]',
  'res.headers["set-cookie"]',
  'headers.authorization',
  'headers["x-internal-token"]',
];

export function createLogger(service, level = process.env.LOG_LEVEL || 'info') {
  return pino({
    level,
    base: { service, env: process.env.NODE_ENV || 'development' },
    timestamp: pino.stdTimeFunctions.isoTime,
    formatters: { level: (label) => ({ level: label }) },
    redact: { paths: REDACT_PATHS, censor: '[REDACTED]' },
    // Every log line carries request/correlation/trace ids so logs can be joined with traces.
    mixin() {
      const ctx = getContext();
      const spanContext = trace.getActiveSpan()?.spanContext();
      return {
        requestId: ctx.requestId,
        correlationId: ctx.correlationId,
        userId: ctx.userId,
        traceId: spanContext?.traceId,
        spanId: spanContext?.spanId,
      };
    },
  });
}

let instance;

export function initLogger(service, level) {
  instance = createLogger(service, level);
  return instance;
}

export function getLogger() {
  if (!instance) instance = createLogger(process.env.SERVICE_NAME || 'spendwise');
  return instance;
}
