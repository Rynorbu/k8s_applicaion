/**
 * OpenTelemetry bootstrap. Loaded before the application via `node --import
 * @spendwise/common/tracing src/index.js` so instrumentation hooks are installed
 * before http/express/pg/ioredis/undici are imported.
 *
 * Exports spans over OTLP/HTTP (OTEL_EXPORTER_OTLP_ENDPOINT) to the OpenTelemetry
 * Collector, which forwards to Jaeger. Disable with OTEL_SDK_DISABLED=true.
 */
import { register } from 'node:module';

if (process.env.OTEL_SDK_DISABLED !== 'true') {
  register('@opentelemetry/instrumentation/hook.mjs', import.meta.url);

  const { NodeSDK } = await import('@opentelemetry/sdk-node');
  const { getNodeAutoInstrumentations } = await import('@opentelemetry/auto-instrumentations-node');
  const { OTLPTraceExporter } = await import('@opentelemetry/exporter-trace-otlp-http');

  const sdk = new NodeSDK({
    serviceName: process.env.OTEL_SERVICE_NAME || process.env.SERVICE_NAME || 'spendwise-service',
    traceExporter: new OTLPTraceExporter(),
    instrumentations: [
      getNodeAutoInstrumentations({
        '@opentelemetry/instrumentation-fs': { enabled: false },
        '@opentelemetry/instrumentation-dns': { enabled: false },
        '@opentelemetry/instrumentation-net': { enabled: false },
        // Messaging spans are created manually so trace context survives the outbox hop.
        '@opentelemetry/instrumentation-amqplib': { enabled: false },
        '@opentelemetry/instrumentation-http': {
          ignoreIncomingRequestHook: (req) => req.url?.startsWith('/health') || req.url === '/metrics',
        },
      }),
    ],
  });
  sdk.start();
  globalThis.__spendwiseOtelSdk = sdk;
}
