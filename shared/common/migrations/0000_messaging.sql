-- Transactional outbox: events are written in the same DB transaction as the
-- business change and relayed to RabbitMQ asynchronously (at-least-once).
CREATE TABLE IF NOT EXISTS outbox (
  id            UUID PRIMARY KEY,
  event_type    TEXT        NOT NULL,
  routing_key   TEXT        NOT NULL,
  payload       JSONB       NOT NULL,
  headers       JSONB       NOT NULL DEFAULT '{}'::jsonb,
  created_at    TIMESTAMPTZ NOT NULL DEFAULT now(),
  published_at  TIMESTAMPTZ,
  attempts      INT         NOT NULL DEFAULT 0,
  last_error    TEXT
);
CREATE INDEX IF NOT EXISTS outbox_unpublished_idx ON outbox (created_at) WHERE published_at IS NULL;
CREATE INDEX IF NOT EXISTS outbox_published_idx ON outbox (published_at) WHERE published_at IS NOT NULL;

-- Inbox / idempotent consumer: one row per (event, consumer) inserted in the
-- same transaction as the handler's side effects.
CREATE TABLE IF NOT EXISTS processed_events (
  event_id      UUID        NOT NULL,
  consumer      TEXT        NOT NULL,
  event_type    TEXT        NOT NULL,
  processed_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
  PRIMARY KEY (event_id, consumer)
);
CREATE INDEX IF NOT EXISTS processed_events_processed_at_idx ON processed_events (processed_at);
