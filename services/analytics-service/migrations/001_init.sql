-- Read model built from Expense*/Income*/Category* events (CQRS query side).
CREATE TABLE transactions (
  id              UUID PRIMARY KEY,                 -- expense id or income id
  user_id         UUID          NOT NULL,
  kind            TEXT          NOT NULL CHECK (kind IN ('expense', 'income')),
  amount_base     NUMERIC(14,2) NOT NULL,
  base_currency   CHAR(3)       NOT NULL,
  category_id     UUID,
  category_name   TEXT,
  category_color  TEXT,
  description     TEXT,
  counterparty    TEXT,                             -- merchant (expense) or payer (income)
  occurred_on     DATE          NOT NULL,
  origin          TEXT,
  version         INT           NOT NULL DEFAULT 1,
  deleted         BOOLEAN       NOT NULL DEFAULT false,  -- tombstone keeps out-of-order events harmless
  updated_at      TIMESTAMPTZ   NOT NULL DEFAULT now()
);
CREATE INDEX transactions_user_date_idx ON transactions (user_id, occurred_on) WHERE NOT deleted;
CREATE INDEX transactions_user_kind_date_idx ON transactions (user_id, kind, occurred_on) WHERE NOT deleted;
CREATE INDEX transactions_category_idx ON transactions (category_id);
