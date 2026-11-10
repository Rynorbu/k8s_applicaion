-- Local replica of the user's base currency (event-carried state from user-service).
CREATE TABLE user_settings (
  user_id        UUID PRIMARY KEY,
  base_currency  CHAR(3)     NOT NULL DEFAULT 'USD',
  updated_at     TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE expenses (
  id               UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id          UUID           NOT NULL,
  amount           NUMERIC(14,2)  NOT NULL CHECK (amount > 0),
  currency         CHAR(3)        NOT NULL CHECK (currency ~ '^[A-Z]{3}$'),
  amount_base      NUMERIC(14,2)  NOT NULL CHECK (amount_base >= 0),
  base_currency    CHAR(3)        NOT NULL,
  exchange_rate    NUMERIC(20,10) NOT NULL DEFAULT 1 CHECK (exchange_rate > 0),
  category_id      UUID           NOT NULL,
  category_name    TEXT           NOT NULL,
  category_color   TEXT,
  category_icon    TEXT,
  description      TEXT           NOT NULL CHECK (char_length(description) BETWEEN 1 AND 255),
  merchant         TEXT           CHECK (char_length(merchant) <= 120),
  payment_method   TEXT           NOT NULL DEFAULT 'card'
                   CHECK (payment_method IN ('cash', 'card', 'bank_transfer', 'mobile_wallet', 'other')),
  expense_date     DATE           NOT NULL,
  notes            TEXT           CHECK (char_length(notes) <= 1000),
  tags             TEXT[]         NOT NULL DEFAULT '{}',
  receipt_file_id  UUID,
  origin           TEXT           NOT NULL DEFAULT 'manual' CHECK (origin IN ('manual', 'recurring', 'import')),
  recurring_id     UUID,
  occurrence_date  DATE,
  import_id        UUID,
  import_row       INT,
  version          INT            NOT NULL DEFAULT 1,
  created_at       TIMESTAMPTZ    NOT NULL DEFAULT now(),
  updated_at       TIMESTAMPTZ    NOT NULL DEFAULT now(),
  deleted_at       TIMESTAMPTZ
);

CREATE INDEX expenses_user_date_idx     ON expenses (user_id, expense_date DESC, created_at DESC) WHERE deleted_at IS NULL;
CREATE INDEX expenses_user_category_idx ON expenses (user_id, category_id) WHERE deleted_at IS NULL;
CREATE INDEX expenses_category_idx      ON expenses (category_id);
-- Idempotency for generated transactions: one expense per recurring occurrence / import row.
CREATE UNIQUE INDEX expenses_recurring_occurrence_uq ON expenses (recurring_id, occurrence_date) WHERE recurring_id IS NOT NULL;
CREATE UNIQUE INDEX expenses_import_row_uq           ON expenses (import_id, import_row)        WHERE import_id IS NOT NULL;
