/**
 * Integration test for the outbox -> RabbitMQ -> idempotent consumer pipeline.
 * Requires real infrastructure: TEST_DATABASE_URL and TEST_RABBITMQ_URL
 * (provided as service containers in CI, or by `npm run infra:up` locally).
 */
import { randomUUID } from 'node:crypto';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { MessageBus, createPool, enqueueEvent, runMigrations, withTransaction } from '../../src/index.js';

const DB = process.env.TEST_DATABASE_URL;
const MQ = process.env.TEST_RABBITMQ_URL;

const waitFor = async (fn, timeoutMs = 15_000) => {
  const start = Date.now();
  while (Date.now() - start < timeoutMs) {
    if (await fn()) return true;
    await new Promise((r) => setTimeout(r, 200));
  }
  return false;
};

describe.skipIf(!DB || !MQ)('messaging pipeline', () => {
  const serviceName = `it-${randomUUID().slice(0, 8)}`;
  let pool;
  let producer;
  let consumer;
  const received = [];
  let failuresLeft = 1;

  beforeAll(async () => {
    process.env.SERVICE_NAME = serviceName;
    pool = createPool(DB);
    await runMigrations(pool, {});
    await pool.query('CREATE TABLE IF NOT EXISTS it_effects (event_id UUID PRIMARY KEY)');
    producer = new MessageBus({ url: MQ, serviceName: `${serviceName}-producer`, pool });
    consumer = new MessageBus({ url: MQ, serviceName, pool, retryDelays: [200, 200] });
    await consumer.start({
      handlers: {
        ItestHappened: async (event, { client }) => {
          if (event.data.flaky && failuresLeft-- > 0) throw new Error('transient failure');
          await client.query('INSERT INTO it_effects (event_id) VALUES ($1)', [event.id]);
          received.push(event);
        },
      },
    });
    await producer.start({ relayOutbox: true });
    await waitFor(() => producer.connected && consumer.connected);
  });

  afterAll(async () => {
    await producer?.close();
    await consumer?.close();
    await pool?.end();
  });

  it('delivers events written to the outbox exactly once to the handler', async () => {
    const event = await withTransaction(pool, (client) =>
      enqueueEvent(client, 'ItestHappened', { n: 1 }, { userId: randomUUID(), correlationId: 'corr-it-000001' }),
    );
    expect(await waitFor(() => received.some((e) => e.id === event.id))).toBe(true);
    expect(received.find((e) => e.id === event.id).correlationId).toBe('corr-it-000001');
  });

  it('does not publish events from rolled-back transactions', async () => {
    let id;
    await withTransaction(pool, async (client) => {
      id = (await enqueueEvent(client, 'ItestHappened', { n: 2 })).id;
      throw new Error('rollback');
    }).catch(() => {});
    const { rows } = await pool.query('SELECT 1 FROM outbox WHERE id = $1', [id]);
    expect(rows).toHaveLength(0);
  });

  it('retries failed handlers and eventually succeeds', async () => {
    const event = await withTransaction(pool, (client) => enqueueEvent(client, 'ItestHappened', { flaky: true }));
    expect(await waitFor(() => received.some((e) => e.id === event.id))).toBe(true);
  });

  it('skips duplicate deliveries (idempotent consumer)', async () => {
    const event = await withTransaction(pool, (client) => enqueueEvent(client, 'ItestHappened', { n: 3 }));
    expect(await waitFor(() => received.some((e) => e.id === event.id))).toBe(true);
    // Re-publish the same event id: the inbox table must swallow it.
    await pool.query('UPDATE outbox SET published_at = NULL WHERE id = $1', [event.id]);
    await new Promise((r) => setTimeout(r, 2000));
    expect(received.filter((e) => e.id === event.id)).toHaveLength(1);
  });
});
