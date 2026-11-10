CREATE TABLE audit_logs (
  seq             BIGSERIAL PRIMARY KEY,
  event_id        UUID        NOT NULL UNIQUE,
  event_type      TEXT        NOT NULL,
  source          TEXT        NOT NULL,
  actor_id        UUID,
  correlation_id  TEXT,
  occurred_at     TIMESTAMPTZ NOT NULL,
  recorded_at     TIMESTAMPTZ NOT NULL DEFAULT now(),
  payload         JSONB       NOT NULL,
  prev_hash       CHAR(64)    NOT NULL,
  hash            CHAR(64)    NOT NULL
);
CREATE INDEX audit_logs_actor_idx ON audit_logs (actor_id, occurred_at DESC);
CREATE INDEX audit_logs_type_idx ON audit_logs (event_type, occurred_at DESC);
CREATE INDEX audit_logs_correlation_idx ON audit_logs (correlation_id);

-- Append-only: the database itself rejects UPDATE, DELETE and TRUNCATE.
CREATE FUNCTION audit_logs_immutable() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  RAISE EXCEPTION 'audit_logs is append-only (% rejected)', TG_OP;
END $$;
CREATE TRIGGER audit_logs_no_update_delete BEFORE UPDATE OR DELETE ON audit_logs FOR EACH ROW EXECUTE FUNCTION audit_logs_immutable();
CREATE TRIGGER audit_logs_no_truncate BEFORE TRUNCATE ON audit_logs FOR EACH STATEMENT EXECUTE FUNCTION audit_logs_immutable();
