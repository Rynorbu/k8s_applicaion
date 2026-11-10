CREATE TABLE profiles (
  user_id        UUID PRIMARY KEY,
  email          TEXT        NOT NULL,
  name           TEXT        NOT NULL CHECK (char_length(name) BETWEEN 1 AND 100),
  base_currency  CHAR(3)     NOT NULL DEFAULT 'USD' CHECK (base_currency ~ '^[A-Z]{3}$'),
  timezone       TEXT        NOT NULL DEFAULT 'UTC',
  locale         TEXT        NOT NULL DEFAULT 'en-US',
  date_format    TEXT        NOT NULL DEFAULT 'YYYY-MM-DD',
  theme          TEXT        NOT NULL DEFAULT 'system' CHECK (theme IN ('light', 'dark', 'system')),
  monthly_income_target NUMERIC(14,2) CHECK (monthly_income_target IS NULL OR monthly_income_target >= 0),
  bio            TEXT CHECK (char_length(bio) <= 500),
  occupation     TEXT CHECK (char_length(occupation) <= 100),
  created_at     TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at     TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX profiles_email_idx ON profiles (lower(email));
