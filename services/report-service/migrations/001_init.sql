CREATE TABLE reports (
  id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id       UUID        NOT NULL,
  title         TEXT        NOT NULL CHECK (char_length(title) BETWEEN 1 AND 120),
  type          TEXT        NOT NULL CHECK (type IN ('full', 'transactions', 'summary')),
  format        TEXT        NOT NULL CHECK (format IN ('pdf', 'csv', 'xlsx')),
  date_from     DATE        NOT NULL,
  date_to       DATE        NOT NULL,
  status        TEXT        NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'processing', 'completed', 'failed')),
  file_name     TEXT,
  storage_key   TEXT,
  file_size     INT,
  error         TEXT,
  created_at    TIMESTAMPTZ NOT NULL DEFAULT now(),
  started_at    TIMESTAMPTZ,
  completed_at  TIMESTAMPTZ,
  expires_at    TIMESTAMPTZ NOT NULL DEFAULT now() + interval '7 days',
  CHECK (date_to >= date_from)
);
CREATE INDEX reports_user_created_idx ON reports (user_id, created_at DESC);
CREATE INDEX reports_status_idx ON reports (status) WHERE status IN ('pending', 'processing');
