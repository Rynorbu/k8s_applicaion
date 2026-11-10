import { paginated } from '@spendwise/common';
import { GENESIS_HASH, computeHash, redact, verifyChain } from './chain.js';

const CHAIN_LOCK = 727_303;

const toEntry = (row) => ({
  seq: row.seq,
  eventId: row.event_id,
  eventType: row.event_type,
  source: row.source,
  actorId: row.actor_id,
  correlationId: row.correlation_id,
  occurredAt: row.occurred_at instanceof Date ? row.occurred_at.toISOString() : row.occurred_at,
  recordedAt: row.recorded_at,
  payload: row.payload,
  prevHash: row.prev_hash,
  hash: row.hash,
});

export function createAuditService({ pool }) {
  return {
    /** Appends an event to the hash chain (serialised with an advisory lock). */
    async record(client, event) {
      await client.query('SELECT pg_advisory_xact_lock($1)', [CHAIN_LOCK]);
      const { rows } = await client.query('SELECT hash FROM audit_logs ORDER BY seq DESC LIMIT 1');
      const prevHash = rows[0]?.hash ?? GENESIS_HASH;
      const entry = {
        eventId: event.id,
        eventType: event.type,
        source: event.source ?? 'unknown',
        actorId: event.userId ?? event.data?.userId ?? null,
        occurredAt: new Date(event.occurredAt ?? Date.now()).toISOString(),
        payload: redact(event.data ?? {}),
      };
      const hash = computeHash(prevHash, entry);
      await client.query(
        `INSERT INTO audit_logs (event_id, event_type, source, actor_id, correlation_id, occurred_at, payload, prev_hash, hash)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9) ON CONFLICT (event_id) DO NOTHING`,
        [entry.eventId, entry.eventType, entry.source, entry.actorId, event.correlationId ?? null, entry.occurredAt, entry.payload, prevHash, hash],
      );
    },

    async list({ actorId, eventType, from, to, correlationId, page, pageSize }) {
      const params = [];
      const where = [];
      const add = (sql, v) => {
        params.push(v);
        where.push(sql.replace('?', `$${params.length}`));
      };
      if (actorId) add('actor_id = ?', actorId);
      if (eventType) add('event_type = ?', eventType);
      if (correlationId) add('correlation_id = ?', correlationId);
      if (from) add('occurred_at >= ?::date', from);
      if (to) add(`occurred_at < (?::date + interval '1 day')`, to);
      const clause = where.length ? `WHERE ${where.join(' AND ')}` : '';
      const [{ rows }, { rows: count }] = await Promise.all([
        pool.query(`SELECT * FROM audit_logs ${clause} ORDER BY seq DESC LIMIT ${pageSize} OFFSET ${(page - 1) * pageSize}`, params),
        pool.query(`SELECT count(*)::int AS n FROM audit_logs ${clause}`, params),
      ]);
      return paginated(rows.map(toEntry), { page, pageSize }, count[0].n);
    },

    async eventTypes(actorId) {
      const { rows } = await pool.query(
        'SELECT event_type, count(*)::int AS count FROM audit_logs WHERE ($1::uuid IS NULL OR actor_id = $1) GROUP BY 1 ORDER BY 2 DESC',
        [actorId ?? null],
      );
      return { data: rows.map((r) => ({ eventType: r.event_type, count: r.count })) };
    },

    /** Walks the entire chain in batches and reports tampering. */
    async verify(batchSize = 1000) {
      let prev = GENESIS_HASH;
      let lastSeq = 0;
      let checked = 0;
      for (;;) {
        const { rows } = await pool.query('SELECT * FROM audit_logs WHERE seq > $1 ORDER BY seq LIMIT $2', [lastSeq, batchSize]);
        if (rows.length === 0) break;
        const result = verifyChain(rows.map(toEntry), prev);
        if (!result.valid) return { valid: false, checked: checked + rows.findIndex((r) => r.seq === result.brokenAt), brokenAt: result.brokenAt, reason: result.reason };
        prev = result.lastHash;
        lastSeq = rows.at(-1).seq;
        checked += rows.length;
      }
      return { valid: true, checked, headHash: prev };
    },
  };
}
