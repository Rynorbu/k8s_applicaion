-- Projection of transactions used for modelling (built from Expense*/Income* events).
CREATE TABLE ai_transactions (
  id             UUID PRIMARY KEY,
  user_id        UUID          NOT NULL,
  kind           TEXT          NOT NULL CHECK (kind IN ('expense', 'income')),
  amount_base    NUMERIC(14,2) NOT NULL,
  base_currency  CHAR(3)       NOT NULL,
  category_id    UUID,
  category_name  TEXT,
  description    TEXT,
  counterparty   TEXT,
  occurred_on    DATE          NOT NULL,
  origin         TEXT,
  version        INT           NOT NULL DEFAULT 1,
  deleted        BOOLEAN       NOT NULL DEFAULT false,
  updated_at     TIMESTAMPTZ   NOT NULL DEFAULT now()
);
CREATE INDEX ai_transactions_user_date_idx ON ai_transactions (user_id, occurred_on) WHERE NOT deleted;
CREATE INDEX ai_transactions_user_category_idx ON ai_transactions (user_id, category_id, occurred_on) WHERE NOT deleted;

-- Persisted insights (anomalies are detected on events; others are refreshed on demand).
CREATE TABLE insights (
  id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id       UUID        NOT NULL,
  type          TEXT        NOT NULL CHECK (type IN ('anomaly', 'trend', 'recommendation', 'forecast')),
  severity      TEXT        NOT NULL DEFAULT 'info' CHECK (severity IN ('info', 'success', 'warning', 'danger')),
  title         TEXT        NOT NULL,
  message       TEXT        NOT NULL,
  data          JSONB       NOT NULL DEFAULT '{}'::jsonb,
  fingerprint   TEXT        NOT NULL,
  dismissed_at  TIMESTAMPTZ,
  created_at    TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (user_id, fingerprint)
);
CREATE INDEX insights_user_created_idx ON insights (user_id, created_at DESC) WHERE dismissed_at IS NULL;
