CREATE TABLE currencies (
  code      CHAR(3)  PRIMARY KEY CHECK (code ~ '^[A-Z]{3}$'),
  name      TEXT     NOT NULL,
  symbol    TEXT     NOT NULL,
  decimals  SMALLINT NOT NULL DEFAULT 2 CHECK (decimals BETWEEN 0 AND 4),
  active    BOOLEAN  NOT NULL DEFAULT true
);

-- Rates are stored against USD: 1 USD = rate units of `quote`. Cross rates are derived.
CREATE TABLE exchange_rates (
  quote       CHAR(3)        NOT NULL REFERENCES currencies(code),
  as_of       DATE           NOT NULL,
  rate        NUMERIC(20,10) NOT NULL CHECK (rate > 0),
  source      TEXT           NOT NULL,
  updated_at  TIMESTAMPTZ    NOT NULL DEFAULT now(),
  PRIMARY KEY (quote, as_of)
);
CREATE INDEX exchange_rates_as_of_idx ON exchange_rates (as_of DESC);

INSERT INTO currencies (code, name, symbol, decimals) VALUES
  ('USD','US Dollar','$',2), ('EUR','Euro','€',2), ('GBP','British Pound','£',2), ('JPY','Japanese Yen','¥',0),
  ('INR','Indian Rupee','₹',2), ('NPR','Nepalese Rupee','रु',2), ('CAD','Canadian Dollar','C$',2),
  ('AUD','Australian Dollar','A$',2), ('CHF','Swiss Franc','CHF',2), ('CNY','Chinese Yuan','¥',2),
  ('SGD','Singapore Dollar','S$',2), ('NZD','New Zealand Dollar','NZ$',2), ('SEK','Swedish Krona','kr',2),
  ('NOK','Norwegian Krone','kr',2), ('DKK','Danish Krone','kr',2), ('HKD','Hong Kong Dollar','HK$',2),
  ('KRW','South Korean Won','₩',0), ('MXN','Mexican Peso','MX$',2), ('BRL','Brazilian Real','R$',2),
  ('ZAR','South African Rand','R',2), ('AED','UAE Dirham','د.إ',2), ('SAR','Saudi Riyal','﷼',2),
  ('THB','Thai Baht','฿',2), ('MYR','Malaysian Ringgit','RM',2), ('PHP','Philippine Peso','₱',2),
  ('IDR','Indonesian Rupiah','Rp',0), ('PKR','Pakistani Rupee','₨',2), ('BDT','Bangladeshi Taka','৳',2),
  ('LKR','Sri Lankan Rupee','Rs',2), ('TRY','Turkish Lira','₺',2), ('PLN','Polish Zloty','zł',2);

-- Offline fallback rates (approximate). Refreshed from the ECB (Frankfurter API) at runtime;
-- currencies the ECB does not publish (NPR, AED, SAR, PKR, BDT, LKR) keep their pegged/seed values.
INSERT INTO exchange_rates (quote, as_of, rate, source) VALUES
  ('USD','2025-01-01',1,'seed'), ('EUR','2025-01-01',0.92,'seed'), ('GBP','2025-01-01',0.79,'seed'),
  ('JPY','2025-01-01',150,'seed'), ('INR','2025-01-01',83.5,'seed'), ('NPR','2025-01-01',133.6,'seed'),
  ('CAD','2025-01-01',1.36,'seed'), ('AUD','2025-01-01',1.52,'seed'), ('CHF','2025-01-01',0.88,'seed'),
  ('CNY','2025-01-01',7.2,'seed'), ('SGD','2025-01-01',1.34,'seed'), ('NZD','2025-01-01',1.66,'seed'),
  ('SEK','2025-01-01',10.5,'seed'), ('NOK','2025-01-01',10.6,'seed'), ('DKK','2025-01-01',6.9,'seed'),
  ('HKD','2025-01-01',7.8,'seed'), ('KRW','2025-01-01',1330,'seed'), ('MXN','2025-01-01',17.2,'seed'),
  ('BRL','2025-01-01',5.0,'seed'), ('ZAR','2025-01-01',18.6,'seed'), ('AED','2025-01-01',3.6725,'seed'),
  ('SAR','2025-01-01',3.75,'seed'), ('THB','2025-01-01',35.5,'seed'), ('MYR','2025-01-01',4.7,'seed'),
  ('PHP','2025-01-01',56,'seed'), ('IDR','2025-01-01',15700,'seed'), ('PKR','2025-01-01',278,'seed'),
  ('BDT','2025-01-01',110,'seed'), ('LKR','2025-01-01',300,'seed'), ('TRY','2025-01-01',32,'seed'),
  ('PLN','2025-01-01',4.0,'seed');
