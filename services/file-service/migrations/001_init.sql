CREATE TABLE files (
  id             UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id        UUID        NOT NULL,
  kind           TEXT        NOT NULL CHECK (kind IN ('receipt', 'import')),
  original_name  TEXT        NOT NULL CHECK (char_length(original_name) <= 255),
  mime_type      TEXT        NOT NULL,
  size_bytes     INT         NOT NULL CHECK (size_bytes > 0),
  sha256         CHAR(64)    NOT NULL,
  storage_key    TEXT        NOT NULL,
  created_at     TIMESTAMPTZ NOT NULL DEFAULT now(),
  deleted_at     TIMESTAMPTZ
);
CREATE INDEX files_user_kind_idx ON files (user_id, kind, created_at DESC) WHERE deleted_at IS NULL;

CREATE TABLE imports (
  id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id       UUID        NOT NULL,
  file_id       UUID        NOT NULL REFERENCES files(id),
  file_name     TEXT        NOT NULL,
  status        TEXT        NOT NULL CHECK (status IN ('completed', 'failed')),
  total_rows    INT         NOT NULL DEFAULT 0,
  valid_rows    INT         NOT NULL DEFAULT 0,
  failed_rows   INT         NOT NULL DEFAULT 0,
  expense_rows  INT         NOT NULL DEFAULT 0,
  income_rows   INT         NOT NULL DEFAULT 0,
  errors        JSONB       NOT NULL DEFAULT '[]'::jsonb,
  created_at    TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX imports_user_idx ON imports (user_id, created_at DESC);
