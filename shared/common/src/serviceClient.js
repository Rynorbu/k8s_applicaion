import { getContext } from './context.js';
import { AppError, ServiceUnavailable } from './errors.js';
import { getLogger } from './logger.js';

const IDEMPOTENT = new Set(['GET', 'HEAD', 'PUT', 'DELETE']);

/**
 * Minimal resilient REST client for synchronous service-to-service calls:
 * timeouts, bounded retries with backoff for idempotent requests, a simple circuit
 * breaker, and propagation of request/correlation ids + internal credentials.
 * (W3C trace context is injected automatically by the OpenTelemetry undici instrumentation.)
 */
export function createServiceClient({
  name,
  baseUrl,
  internalToken,
  timeoutMs = 3000,
  retries = 2,
  failureThreshold = 5,
  resetAfterMs = 15_000,
}) {
  const breaker = { failures: 0, openUntil: 0 };
  const log = getLogger().child({ component: 'service-client', target: name });

  async function request(method, path, { query, body, headers = {}, bearer } = {}) {
    if (Date.now() < breaker.openUntil) throw ServiceUnavailable(`${name} is temporarily unavailable`);
    const url = new URL(path, baseUrl);
    for (const [k, v] of Object.entries(query ?? {})) {
      if (v !== undefined && v !== null && v !== '') url.searchParams.set(k, String(v));
    }
    const ctx = getContext();
    const finalHeaders = {
      accept: 'application/json',
      ...(body !== undefined ? { 'content-type': 'application/json' } : {}),
      ...(ctx.requestId ? { 'x-request-id': ctx.requestId } : {}),
      ...(ctx.correlationId ? { 'x-correlation-id': ctx.correlationId } : {}),
      ...(internalToken ? { 'x-internal-token': internalToken } : {}),
      ...(bearer ? { authorization: `Bearer ${bearer}` } : {}),
      ...headers,
    };
    const maxAttempts = IDEMPOTENT.has(method) ? retries + 1 : 1;
    let lastError;
    for (let attempt = 1; attempt <= maxAttempts; attempt += 1) {
      try {
        const res = await fetch(url, {
          method,
          headers: finalHeaders,
          body: body !== undefined ? JSON.stringify(body) : undefined,
          signal: AbortSignal.timeout(timeoutMs),
        });
        if (res.status >= 500) throw Object.assign(new Error(`${name} responded ${res.status}`), { retryable: true });
        breaker.failures = 0;
        const text = await res.text();
        const payload = text ? JSON.parse(text) : undefined;
        if (!res.ok) {
          // Propagate client errors (404, 409, 422 ...) with the downstream message.
          throw new AppError(res.status, payload?.error?.code ?? 'UPSTREAM_ERROR', payload?.error?.message ?? `${name} request failed`);
        }
        return payload;
      } catch (err) {
        if (err instanceof AppError) throw err;
        lastError = err;
        log.warn({ attempt, method, path: url.pathname, err: err.message }, 'downstream call failed');
        if (attempt < maxAttempts) await new Promise((r) => setTimeout(r, 100 * 2 ** attempt));
      }
    }
    breaker.failures += 1;
    if (breaker.failures >= failureThreshold) {
      breaker.openUntil = Date.now() + resetAfterMs;
      log.error({ failures: breaker.failures }, 'circuit opened');
    }
    throw ServiceUnavailable(`${name} is unavailable: ${lastError?.message ?? 'unknown error'}`);
  }

  return {
    get: (path, opts) => request('GET', path, opts),
    post: (path, body, opts) => request('POST', path, { ...opts, body }),
    put: (path, body, opts) => request('PUT', path, { ...opts, body }),
    patch: (path, body, opts) => request('PATCH', path, { ...opts, body }),
    delete: (path, opts) => request('DELETE', path, opts),
    ping: () => request('GET', '/health/live'),
  };
}
