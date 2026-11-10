CREATE TABLE user_settings (
  user_id        UUID PRIMARY KEY,
  base_currency  CHAR(3)     NOT NULL DEFAULT 'USD',
  updated_at     TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE budgets (
  id               UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id          UUID          NOT NULL,
  name             TEXT          NOT NULL CHECK (char_length(name) BETWEEN 1 AND 80),
  category_id      UUID,                       -- NULL = overall spending budget
  category_name    TEXT,
  category_color   TEXT,
  amount           NUMERIC(14,2) NOT NULL CHECK (amount > 0),
  currency         CHAR(3)       NOT NULL,
  period           TEXT          NOT NULL CHECK (period IN ('weekly', 'monthly', 'yearly')),
  alert_threshold  SMALLINT      NOT NULL DEFAULT 80 CHECK (alert_threshold BETWEEN 1 AND 100),
  active           BOOLEAN       NOT NULL DEFAULT true,
  created_at       TIMESTAMPTZ   NOT NULL DEFAULT now(),
  updated_at       TIMESTAMPTZ   NOT NULL DEFAULT now()
);
-- One active budget per (user, category|overall, period).
CREATE UNIQUE INDEX budgets_scope_uq ON budgets (user_id, COALESCE(category_id, '00000000-0000-0000-0000-000000000000'::uuid), period) WHERE active;
CREATE INDEX budgets_user_idx ON budgets (user_id) WHERE active;

-- Local projection of expenses (from Expense* events) used to compute usage without calling expense-service.
CREATE TABLE budget_transactions (
  expense_id    UUID PRIMARY KEY,
  user_id       UUID          NOT NULL,
  category_id   UUID          NOT NULL,
  amount_base   NUMERIC(14,2) NOT NULL,
  expense_date  DATE          NOT NULL,
  version       INT           NOT NULL DEFAULT 1,
  updated_at    TIMESTAMPTZ   NOT NULL DEFAULT now()
);
CREATE INDEX budget_transactions_user_date_idx ON budget_transactions (user_id, expense_date);
CREATE INDEX budget_transactions_user_category_idx ON budget_transactions (user_id, category_id, expense_date);

-- Alerts already sent for a budget period (guarantees one warning/exceeded alert per period).
CREATE TABLE budget_alerts (
  id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  budget_id     UUID          NOT NULL REFERENCES budgets(id) ON DELETE CASCADE,
  period_start  DATE          NOT NULL,
  level         TEXT          NOT NULL CHECK (level IN ('warning', 'exceeded')),
  spent         NUMERIC(14,2) NOT NULL,
  percentage    NUMERIC(7,2)  NOT NULL,
  created_at    TIMESTAMPTZ   NOT NULL DEFAULT now(),
  UNIQUE (budget_id, period_start, level)
);
