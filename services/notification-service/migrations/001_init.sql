-- Replica of contact details (from UserRegistered / UserProfileUpdated).
CREATE TABLE recipients (
  user_id     UUID PRIMARY KEY,
  email       TEXT        NOT NULL,
  name        TEXT        NOT NULL,
  updated_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE notification_preferences (
  user_id         UUID PRIMARY KEY,
  email_enabled   BOOLEAN     NOT NULL DEFAULT true,
  in_app_enabled  BOOLEAN     NOT NULL DEFAULT true,
  muted_types     TEXT[]      NOT NULL DEFAULT '{}',
  updated_at      TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE notifications (
  id               UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id          UUID        NOT NULL,
  type             TEXT        NOT NULL,
  title            TEXT        NOT NULL CHECK (char_length(title) <= 200),
  message          TEXT        NOT NULL CHECK (char_length(message) <= 1000),
  severity         TEXT        NOT NULL DEFAULT 'info' CHECK (severity IN ('info', 'success', 'warning', 'danger')),
  link             TEXT,
  data             JSONB       NOT NULL DEFAULT '{}'::jsonb,
  source_event_id  UUID,
  read_at          TIMESTAMPTZ,
  created_at       TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX notifications_user_created_idx ON notifications (user_id, created_at DESC);
CREATE INDEX notifications_user_unread_idx ON notifications (user_id) WHERE read_at IS NULL;

CREATE TABLE email_log (
  id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id     UUID,
  to_email    TEXT        NOT NULL,
  subject     TEXT        NOT NULL,
  template    TEXT        NOT NULL,
  status      TEXT        NOT NULL CHECK (status IN ('sent', 'failed', 'skipped')),
  error       TEXT,
  event_id    UUID,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX email_log_user_idx ON email_log (user_id, created_at DESC);
