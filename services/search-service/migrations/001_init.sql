CREATE EXTENSION IF NOT EXISTS pg_trgm WITH SCHEMA public;

CREATE OR REPLACE FUNCTION sw_tags_text(tags TEXT[]) RETURNS TEXT
  LANGUAGE sql IMMUTABLE PARALLEL SAFE AS $$ SELECT coalesce(array_to_string(tags, ' '), '') $$;

-- Search index projection of expenses and income (built from events).
CREATE TABLE search_documents (
  id              UUID PRIMARY KEY,
  user_id         UUID          NOT NULL,
  kind            TEXT          NOT NULL CHECK (kind IN ('expense', 'income')),
  amount          NUMERIC(14,2) NOT NULL,
  currency        CHAR(3)       NOT NULL,
  amount_base     NUMERIC(14,2) NOT NULL,
  base_currency   CHAR(3)       NOT NULL,
  description     TEXT          NOT NULL,
  counterparty    TEXT,
  notes           TEXT,
  tags            TEXT[]        NOT NULL DEFAULT '{}',
  category_id     UUID,
  category_name   TEXT,
  category_color  TEXT,
  occurred_on     DATE          NOT NULL,
  origin          TEXT,
  version         INT           NOT NULL DEFAULT 1,
  deleted         BOOLEAN       NOT NULL DEFAULT false,
  indexed_at      TIMESTAMPTZ   NOT NULL DEFAULT now(),
  search_vector   TSVECTOR GENERATED ALWAYS AS (
      setweight(to_tsvector('simple'::regconfig, coalesce(description, '')), 'A')
   || setweight(to_tsvector('simple'::regconfig, coalesce(counterparty, '')), 'A')
   || setweight(to_tsvector('simple'::regconfig, coalesce(category_name, '')), 'B')
   || setweight(to_tsvector('simple'::regconfig, sw_tags_text(tags)), 'B')
   || setweight(to_tsvector('simple'::regconfig, coalesce(notes, '')), 'C')
  ) STORED
);
CREATE INDEX search_documents_vector_idx ON search_documents USING GIN (search_vector);
CREATE INDEX search_documents_description_trgm_idx ON search_documents USING GIN (description gin_trgm_ops);
CREATE INDEX search_documents_counterparty_trgm_idx ON search_documents USING GIN (counterparty gin_trgm_ops);
CREATE INDEX search_documents_user_date_idx ON search_documents (user_id, occurred_on DESC) WHERE NOT deleted;
