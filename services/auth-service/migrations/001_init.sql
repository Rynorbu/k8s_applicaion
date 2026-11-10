CREATE EXTENSION IF NOT EXISTS citext WITH SCHEMA public;

CREATE TABLE users (
  id                     UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  email                  CITEXT      NOT NULL UNIQUE CHECK (char_length(email) <= 254),
  name                   TEXT        NOT NULL CHECK (char_length(name) BETWEEN 1 AND 100),
  password_hash          TEXT        NOT NULL,
  roles                  TEXT[]      NOT NULL DEFAULT ARRAY['user'],
  failed_login_attempts  INT         NOT NULL DEFAULT 0,
  locked_until           TIMESTAMPTZ,
  password_changed_at    TIMESTAMPTZ NOT NULL DEFAULT now(),
  last_login_at          TIMESTAMPTZ,
  created_at             TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at             TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- Rotating refresh tokens. Only SHA-256 hashes are stored. Tokens of one login
-- form a "family"; presenting an already-rotated token revokes the whole family.
CREATE TABLE refresh_tokens (
  id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id       UUID        NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  family_id     UUID        NOT NULL,
  token_hash    CHAR(64)    NOT NULL UNIQUE,
  user_agent    TEXT,
  ip_address    TEXT,
  expires_at    TIMESTAMPTZ NOT NULL,
  revoked_at    TIMESTAMPTZ,
  replaced_by   UUID,
  created_at    TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX refresh_tokens_user_active_idx ON refresh_tokens (user_id) WHERE revoked_at IS NULL;
CREATE INDEX refresh_tokens_family_idx ON refresh_tokens (family_id);

CREATE TABLE password_reset_tokens (
  id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id     UUID        NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  token_hash  CHAR(64)    NOT NULL UNIQUE,
  expires_at  TIMESTAMPTZ NOT NULL,
  used_at     TIMESTAMPTZ,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX password_reset_tokens_user_idx ON password_reset_tokens (user_id);
