#!/usr/bin/env node
/**
 * Moves messages from a service's dead-letter queue back onto its main queue after the
 * underlying bug has been fixed. Safe because consumers are idempotent (inbox table).
 *
 *   RABBITMQ_URL=amqp://user:pass@localhost:5672 node scripts/replay-dlq.mjs expense-service [--limit 100]
 */
import amqp from 'amqplib';

const [service] = process.argv.slice(2);
const limitIdx = process.argv.indexOf('--limit');
const limit = limitIdx > 0 ? Number(process.argv[limitIdx + 1]) : Infinity;
if (!service) {
  console.error('usage: replay-dlq.mjs <service-name> [--limit N]');
  process.exit(1);
}

const conn = await amqp.connect(process.env.RABBITMQ_URL ?? 'amqp://spendwise:spendwise-dev@localhost:5672');
const ch = await conn.createConfirmChannel();
const dlq = `${service}.events.dlq`;
const target = `${service}.events`;
let moved = 0;
while (moved < limit) {
  const msg = await ch.get(dlq, { noAck: false });
  if (!msg) break;
  const headers = { ...(msg.properties.headers ?? {}), 'x-retry-count': 0, 'x-replayed-at': new Date().toISOString() };
  ch.sendToQueue(target, msg.content, { ...msg.properties, headers, persistent: true });
  await ch.waitForConfirms();
  ch.ack(msg);
  moved += 1;
  console.log(`replayed ${msg.properties.type ?? 'message'} ${msg.properties.messageId ?? ''} (last error: ${msg.properties.headers?.['x-last-error'] ?? 'n/a'})`);
}
console.log(`moved ${moved} message(s) from ${dlq} to ${target}`);
await ch.close();
await conn.close();
