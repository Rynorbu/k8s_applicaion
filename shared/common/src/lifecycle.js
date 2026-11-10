import { getLogger } from './logger.js';

/** Starts the HTTP server and wires graceful shutdown (SIGTERM from Kubernetes). */
export function startServer({ app, port, onShutdown = [], shutdownTimeoutMs = 20_000 }) {
  const log = getLogger();
  const server = app.listen(port, () => log.info({ port }, 'service listening'));
  // Keep-alive longer than typical load-balancer idle timeouts.
  server.keepAliveTimeout = 65_000;
  server.headersTimeout = 66_000;

  let shuttingDown = false;
  const shutdown = async (signal) => {
    if (shuttingDown) return;
    shuttingDown = true;
    log.info({ signal }, 'graceful shutdown started');
    const force = setTimeout(() => {
      log.error('graceful shutdown timed out, forcing exit');
      process.exit(1);
    }, shutdownTimeoutMs);
    force.unref();
    await new Promise((resolve) => server.close(resolve));
    for (const fn of onShutdown) {
      try {
        await fn();
      } catch (err) {
        log.error({ err }, 'shutdown hook failed');
      }
    }
    await globalThis.__spendwiseOtelSdk?.shutdown().catch(() => {});
    log.info('shutdown complete');
    process.exit(0);
  };
  process.on('SIGTERM', () => shutdown('SIGTERM'));
  process.on('SIGINT', () => shutdown('SIGINT'));
  process.on('unhandledRejection', (reason) => log.error({ err: reason }, 'unhandled promise rejection'));
  process.on('uncaughtException', (err) => {
    log.fatal({ err }, 'uncaught exception');
    shutdown('uncaughtException');
  });
  return server;
}

/** Runs `fn` every `intervalMs` without overlapping executions. */
export function every(intervalMs, fn, { runImmediately = false } = {}) {
  const log = getLogger();
  let running = false;
  const tick = async () => {
    if (running) return;
    running = true;
    try {
      await fn();
    } catch (err) {
      log.error({ err }, 'scheduled job failed');
    } finally {
      running = false;
    }
  };
  if (runImmediately) setTimeout(tick, 1000).unref();
  const timer = setInterval(tick, intervalMs);
  timer.unref();
  return () => clearInterval(timer);
}
