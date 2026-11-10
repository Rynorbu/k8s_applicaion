CREATE TABLE recurring_rules (
  id                     UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id                UUID          NOT NULL,
  type                   TEXT          NOT NULL CHECK (type IN ('expense', 'income')),
  description            TEXT          NOT NULL CHECK (char_length(description) BETWEEN 1 AND 255),
  amount                 NUMERIC(14,2) NOT NULL CHECK (amount > 0),
  currency               CHAR(3),                 -- NULL = user's base currency at generation time
  category_id            UUID,
  category_name          TEXT,
  merchant               TEXT CHECK (char_length(merchant) <= 120),
  payment_method         TEXT,
  notes                  TEXT CHECK (char_length(notes) <= 1000),
  frequency              TEXT          NOT NULL CHECK (frequency IN ('daily', 'weekly', 'biweekly', 'monthly', 'quarterly', 'yearly')),
  interval_count         SMALLINT      NOT NULL DEFAULT 1 CHECK (interval_count BETWEEN 1 AND 12),
  anchor_day             SMALLINT      NOT NULL CHECK (anchor_day BETWEEN 1 AND 31),
  start_date             DATE          NOT NULL,
  end_date               DATE,
  max_occurrences        INT CHECK (max_occurrences IS NULL OR max_occurrences > 0),
  next_run_date          DATE,
  last_run_date          DATE,
  occurrences_generated  INT           NOT NULL DEFAULT 0,
  status                 TEXT          NOT NULL DEFAULT 'active' CHECK (status IN ('active', 'paused', 'completed')),
  created_at             TIMESTAMPTZ   NOT NULL DEFAULT now(),
  updated_at             TIMESTAMPTZ   NOT NULL DEFAULT now(),
  CHECK (end_date IS NULL OR end_date >= start_date)
);
CREATE INDEX recurring_rules_due_idx ON recurring_rules (next_run_date) WHERE status = 'active';
CREATE INDEX recurring_rules_user_idx ON recurring_rules (user_id, status);

-- Log of generated occurrences; the PK makes generation idempotent.
CREATE TABLE recurring_occurrences (
  rule_id          UUID        NOT NULL REFERENCES recurring_rules(id) ON DELETE CASCADE,
  occurrence_date  DATE        NOT NULL,
  event_id         UUID        NOT NULL,
  created_at       TIMESTAMPTZ NOT NULL DEFAULT now(),
  PRIMARY KEY (rule_id, occurrence_date)
);
