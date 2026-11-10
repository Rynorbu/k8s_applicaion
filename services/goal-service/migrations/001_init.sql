CREATE TABLE user_settings (
  user_id        UUID PRIMARY KEY,
  base_currency  CHAR(3)     NOT NULL DEFAULT 'USD',
  updated_at     TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE goals (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id         UUID          NOT NULL,
  name            TEXT          NOT NULL CHECK (char_length(name) BETWEEN 1 AND 80),
  description     TEXT          CHECK (char_length(description) <= 500),
  target_amount   NUMERIC(14,2) NOT NULL CHECK (target_amount > 0),
  current_amount  NUMERIC(14,2) NOT NULL DEFAULT 0 CHECK (current_amount >= 0),
  currency        CHAR(3)       NOT NULL,
  target_date     DATE,
  icon            TEXT          NOT NULL DEFAULT 'piggy-bank',
  color           TEXT          NOT NULL DEFAULT '#22c55e' CHECK (color ~ '^#[0-9a-fA-F]{6}$'),
  priority        TEXT          NOT NULL DEFAULT 'medium' CHECK (priority IN ('low', 'medium', 'high')),
  status          TEXT          NOT NULL DEFAULT 'active' CHECK (status IN ('active', 'completed', 'cancelled')),
  completed_at    TIMESTAMPTZ,
  created_at      TIMESTAMPTZ   NOT NULL DEFAULT now(),
  updated_at      TIMESTAMPTZ   NOT NULL DEFAULT now()
);
CREATE INDEX goals_user_status_idx ON goals (user_id, status);

CREATE TABLE goal_contributions (
  id                 UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  goal_id            UUID          NOT NULL REFERENCES goals(id) ON DELETE CASCADE,
  user_id            UUID          NOT NULL,
  amount             NUMERIC(14,2) NOT NULL CHECK (amount <> 0),   -- negative = withdrawal
  note               TEXT          CHECK (char_length(note) <= 255),
  contribution_date  DATE          NOT NULL,
  created_at         TIMESTAMPTZ   NOT NULL DEFAULT now()
);
CREATE INDEX goal_contributions_goal_idx ON goal_contributions (goal_id, contribution_date DESC);

-- Milestones reached (25/50/75/100%); PK guarantees each is announced once.
CREATE TABLE goal_milestones (
  goal_id     UUID        NOT NULL REFERENCES goals(id) ON DELETE CASCADE,
  milestone   SMALLINT    NOT NULL CHECK (milestone IN (25, 50, 75, 100)),
  reached_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
  PRIMARY KEY (goal_id, milestone)
);
