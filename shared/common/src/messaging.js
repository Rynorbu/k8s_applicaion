import { randomUUID } from 'node:crypto';
import amqp from 'amqplib';
import { ROOT_CONTEXT, SpanKind, SpanStatusCode, context, propagation, trace } from '@opentelemetry/api';
import { getContext, runWithContext } from './context.js';
import { withTransaction } from './db.js';
import { routingKeyFor } from './events.js';
import { getLogger } from './logger.js';
import { eventProcessingDuration, eventsConsumed, eventsPublished, outboxPending } from './metrics.js';

export const EXCHANGE = 'spendwise.events';
export const DEFAULT_RETRY_DELAYS_MS = [5_000, 30_000, 120_000];

const tracer = trace.getTracer('spendwise-messaging');

/** Thrown by handlers for poison messages that must never be retried. */
export class NonRetryableError extends Error {}

/**
 * Writes a domain event to the outbox inside the caller's transaction. The event is
 * only published if the business transaction commits (no dual-write problem).
 * The current trace context is captured so the consumer's span joins the same trace.
 */
export async function enqueueEvent(client, type, data, { userId, correlationId, causationId } = {}) {
  const ctx = getContext();
  const event = {
    id: randomUUID(),
    type,
    version: 1,
    source: process.env.SERVICE_NAME ?? 'unknown',
    occurredAt: new Date().toISOString(),
    correlationId: correlationId ?? ctx.correlationId ?? randomUUID(),
    causationId: causationId ?? ctx.causationId ?? ctx.requestId ?? null,
    userId: userId ?? ctx.userId ?? null,
    data,
  };
  const headers = { 'x-correlation-id': event.correlationId };
  propagation.inject(context.active(), headers);
  await client.query(
    `INSERT INTO outbox (id, event_type, routing_key, payload, headers) VALUES ($1, $2, $3, $4, $5)`,
    [event.id, type, routingKeyFor(type), event, headers],
  );
  return event;
}

/**
 * RabbitMQ integration:
 *  - topic exchange `spendwise.events`, one durable queue per service
 *  - delayed retries via TTL'd retry queues that dead-letter back to the main queue
 *  - dead-letter queue after the final retry
 *  - idempotent handling through the `processed_events` inbox table
 *  - outbox relay with publisher confirms
 *  - automatic reconnection with backoff
 */
export class MessageBus {
  constructor({ url, serviceName, pool, prefetch = 10, retryDelays = DEFAULT_RETRY_DELAYS_MS }) {
    this.url = url;
    this.serviceName = serviceName;
    this.pool = pool;
    this.prefetch = prefetch;
    this.retryDelays = retryDelays;
    this.log = getLogger().child({ component: 'message-bus' });
    this.handlers = {};
    this.connected = false;
    this.closing = false;
    this.relayEnabled = false;
    this.relayTimer = null;
    this.queue = `${serviceName}.events`;
    this.dlq = `${serviceName}.events.dlq`;
  }

  get retryQueues() {
    return this.retryDelays.map((delay, i) => ({ name: `${this.queue}.retry.${i + 1}`, delay }));
  }

  /**
   * @param {object} options
   * @param {Record<string, Function>} [options.handlers] event type -> async (event, { client }) => void
   * @param {string[]} [options.bindings] extra routing-key patterns (e.g. '#')
   * @param {boolean} [options.relayOutbox] publish this service's outbox
   */
  async start({ handlers = {}, bindings = [], relayOutbox = false } = {}) {
    this.handlers = handlers;
    const typed = Object.keys(handlers).filter((type) => type !== '*');
    this.bindings = [...new Set([...typed.map(routingKeyFor), ...bindings])];
    this.relayEnabled = relayOutbox;
    // Connect in the background so the HTTP server can come up and report readiness.
    this.#connectWithRetry();
    if (relayOutbox) this.#scheduleRelay(1000);
  }

  isReady() {
    if (!this.connected) throw new Error('broker disconnected');
    return true;
  }

  async #connectWithRetry(attempt = 1) {
    if (this.closing) return;
    try {
      await this.#connect();
      this.log.info({ queue: this.queue, bindings: this.bindings }, 'connected to RabbitMQ');
    } catch (err) {
      const delay = Math.min(30_000, 1000 * 2 ** Math.min(attempt, 5));
      this.log.warn({ err: err.message, attempt, delay }, 'RabbitMQ connection failed, retrying');
      setTimeout(() => this.#connectWithRetry(attempt + 1), delay).unref();
    }
  }

  async #connect() {
    const connection = await amqp.connect(this.url, { clientProperties: { connection_name: this.serviceName } });
    connection.on('error', (err) => this.log.error({ err: err.message }, 'RabbitMQ connection error'));
    connection.on('close', () => {
      this.connected = false;
      if (this.closing) return;
      this.log.warn('RabbitMQ connection closed, reconnecting');
      this.#connectWithRetry();
    });
    this.connection = connection;
    this.publishChannel = await connection.createConfirmChannel();
    await this.publishChannel.assertExchange(EXCHANGE, 'topic', { durable: true });

    if (this.bindings.length > 0) {
      const ch = await connection.createChannel();
      await ch.assertExchange(EXCHANGE, 'topic', { durable: true });
      await ch.assertQueue(this.queue, { durable: true });
      await ch.assertQueue(this.dlq, { durable: true });
      for (const { name, delay } of this.retryQueues) {
        await ch.assertQueue(name, {
          durable: true,
          arguments: {
            'x-message-ttl': delay,
            'x-dead-letter-exchange': '',
            'x-dead-letter-routing-key': this.queue,
          },
        });
      }
      for (const key of this.bindings) await ch.bindQueue(this.queue, EXCHANGE, key);
      await ch.prefetch(this.prefetch);
      await ch.consume(this.queue, (msg) => msg && this.#onMessage(ch, msg), { noAck: false });
      this.consumeChannel = ch;
    }
    this.connected = true;
  }

  async #onMessage(channel, msg) {
    let event;
    try {
      event = JSON.parse(msg.content.toString('utf8'));
    } catch {
      this.log.error({ messageId: msg.properties.messageId }, 'unparseable message sent to DLQ');
      channel.sendToQueue(this.dlq, msg.content, { persistent: true, headers: { 'x-error': 'invalid JSON' } });
      channel.ack(msg);
      return;
    }
    const handler = this.handlers[event.type];
    if (!handler) {
      // Wildcard consumers (audit) use the '*' handler.
      if (!this.handlers['*']) {
        eventsConsumed.inc({ type: event.type, outcome: 'ignored' });
        channel.ack(msg);
        return;
      }
    }
    const headers = msg.properties.headers ?? {};
    const parentContext = propagation.extract(ROOT_CONTEXT, headers);
    const stopTimer = eventProcessingDuration.startTimer({ type: event.type });

    await context.with(parentContext, () =>
      tracer.startActiveSpan(
        `${event.type} process`,
        {
          kind: SpanKind.CONSUMER,
          attributes: {
            'messaging.system': 'rabbitmq',
            'messaging.destination.name': EXCHANGE,
            'messaging.operation': 'process',
            'messaging.message.id': event.id,
            'messaging.consumer.group': this.serviceName,
            'spendwise.correlation_id': event.correlationId,
          },
        },
        async (span) => {
          try {
            await runWithContext(
              { correlationId: event.correlationId, requestId: event.id, causationId: event.id, userId: event.userId },
              () => this.#process(event, handler ?? this.handlers['*']),
            );
            channel.ack(msg);
          } catch (err) {
            span.recordException(err);
            span.setStatus({ code: SpanStatusCode.ERROR, message: err.message });
            this.#retryOrDeadLetter(channel, msg, event, err);
          } finally {
            stopTimer();
            span.end();
          }
        },
      ),
    );
  }

  async #process(event, handler) {
    const outcome = await withTransaction(this.pool, async (client) => {
      const inserted = await client.query(
        `INSERT INTO processed_events (event_id, consumer, event_type) VALUES ($1, $2, $3) ON CONFLICT DO NOTHING`,
        [event.id, this.serviceName, event.type],
      );
      if (inserted.rowCount === 0) return 'duplicate';
      await handler(event, { client });
      return 'success';
    });
    eventsConsumed.inc({ type: event.type, outcome });
    if (outcome === 'duplicate') this.log.debug({ eventId: event.id, type: event.type }, 'duplicate event skipped');
    else this.log.debug({ eventId: event.id, type: event.type }, 'event processed');
  }

  #retryOrDeadLetter(channel, msg, event, err) {
    const headers = { ...(msg.properties.headers ?? {}) };
    const attempt = Number(headers['x-retry-count'] ?? 0);
    const options = {
      persistent: true,
      contentType: 'application/json',
      messageId: msg.properties.messageId,
      type: msg.properties.type,
      headers: { ...headers, 'x-retry-count': attempt + 1, 'x-last-error': String(err.message).slice(0, 500) },
    };
    const retryable = !(err instanceof NonRetryableError);
    if (retryable && attempt < this.retryQueues.length) {
      const target = this.retryQueues[attempt];
      channel.sendToQueue(target.name, msg.content, options);
      eventsConsumed.inc({ type: event.type, outcome: 'retry' });
      this.log.warn({ eventId: event.id, type: event.type, attempt: attempt + 1, delayMs: target.delay, err: err.message }, 'event handling failed, scheduled retry');
    } else {
      channel.sendToQueue(this.dlq, msg.content, options);
      eventsConsumed.inc({ type: event.type, outcome: 'dead_letter' });
      this.log.error({ eventId: event.id, type: event.type, err }, 'event moved to dead-letter queue');
    }
    channel.ack(msg);
  }

  #scheduleRelay(delay = 500) {
    if (this.closing || !this.relayEnabled) return;
    this.relayTimer = setTimeout(async () => {
      let published = 0;
      try {
        published = await this.relayOutboxOnce();
      } catch (err) {
        this.log.error({ err: err.message }, 'outbox relay failed');
      }
      this.#scheduleRelay(published >= 100 ? 0 : 500);
    }, delay);
    this.relayTimer.unref?.();
  }

  /** Publishes a batch of pending outbox events. Safe with many replicas (SKIP LOCKED). */
  async relayOutboxOnce(batchSize = 100) {
    if (!this.connected || !this.publishChannel) return 0;
    const client = await this.pool.connect();
    try {
      await client.query('BEGIN');
      const { rows } = await client.query(
        `SELECT id, event_type, routing_key, payload, headers FROM outbox
          WHERE published_at IS NULL ORDER BY created_at LIMIT $1 FOR UPDATE SKIP LOCKED`,
        [batchSize],
      );
      if (rows.length === 0) {
        await client.query('COMMIT');
        outboxPending.set(0);
        return 0;
      }
      for (const row of rows) {
        // Producer span linked to the trace captured when the event was written.
        const parent = propagation.extract(ROOT_CONTEXT, row.headers ?? {});
        const span = tracer.startSpan(`${row.event_type} publish`, { kind: SpanKind.PRODUCER, attributes: { 'messaging.system': 'rabbitmq', 'messaging.destination.name': EXCHANGE, 'messaging.message.id': row.id } }, parent);
        const headers = { ...row.headers };
        propagation.inject(trace.setSpan(parent, span), headers);
        this.publishChannel.publish(EXCHANGE, row.routing_key, Buffer.from(JSON.stringify(row.payload)), {
          persistent: true,
          contentType: 'application/json',
          messageId: row.id,
          type: row.event_type,
          timestamp: Math.floor(Date.now() / 1000),
          headers,
        });
        span.end();
      }
      await this.publishChannel.waitForConfirms();
      await client.query('UPDATE outbox SET published_at = now(), attempts = attempts + 1 WHERE id = ANY($1::uuid[])', [
        rows.map((r) => r.id),
      ]);
      await client.query('COMMIT');
      for (const row of rows) eventsPublished.inc({ type: row.event_type });
      const { rows: pending } = await this.pool.query('SELECT count(*)::int AS n FROM outbox WHERE published_at IS NULL');
      outboxPending.set(pending[0].n);
      return rows.length;
    } catch (err) {
      await client.query('ROLLBACK').catch(() => {});
      throw err;
    } finally {
      client.release();
    }
  }

  /** Removes published outbox rows and old inbox rows (housekeeping). */
  async cleanup({ retentionDays = 7 } = {}) {
    await this.pool.query(`DELETE FROM outbox WHERE published_at < now() - make_interval(days => $1)`, [retentionDays]);
    await this.pool.query(`DELETE FROM processed_events WHERE processed_at < now() - make_interval(days => $1)`, [
      retentionDays * 4,
    ]);
  }

  async close() {
    this.closing = true;
    clearTimeout(this.relayTimer);
    try {
      await this.consumeChannel?.close();
      await this.publishChannel?.close();
      await this.connection?.close();
    } catch {
      // already closed
    }
    this.connected = false;
  }
}
