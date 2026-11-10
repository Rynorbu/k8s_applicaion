CREATE TABLE categories (
  id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id     UUID,                         -- NULL = system category shared by all users
  type        TEXT        NOT NULL CHECK (type IN ('expense', 'income')),
  name        TEXT        NOT NULL CHECK (char_length(name) BETWEEN 1 AND 50),
  color       CHAR(7)     NOT NULL DEFAULT '#64748b' CHECK (color ~ '^#[0-9a-fA-F]{6}$'),
  icon        TEXT        NOT NULL DEFAULT 'tag' CHECK (char_length(icon) <= 40),
  keywords    TEXT[]      NOT NULL DEFAULT '{}',
  is_system   BOOLEAN     GENERATED ALWAYS AS (user_id IS NULL) STORED,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE UNIQUE INDEX categories_unique_name_idx
  ON categories (COALESCE(user_id, '00000000-0000-0000-0000-000000000000'::uuid), type, lower(name));
CREATE INDEX categories_user_type_idx ON categories (user_id, type);

INSERT INTO categories (id, user_id, type, name, color, icon, keywords) VALUES
  ('c0000000-0000-4000-8000-000000000001', NULL, 'expense', 'Food & Dining',     '#f97316', 'utensils',        ARRAY['restaurant','cafe','coffee','starbucks','mcdonald','pizza','burger','lunch','dinner','breakfast','takeaway','uber eats','doordash','zomato','swiggy','kfc','subway']),
  ('c0000000-0000-4000-8000-000000000002', NULL, 'expense', 'Groceries',         '#22c55e', 'shopping-basket', ARRAY['grocery','groceries','supermarket','walmart','costco','aldi','lidl','tesco','whole foods','kroger','vegetables','bhatbhateni','bigmart']),
  ('c0000000-0000-4000-8000-000000000003', NULL, 'expense', 'Transportation',    '#3b82f6', 'car',             ARRAY['uber','lyft','taxi','bus','train','metro','fuel','petrol','gas station','parking','toll','pathao','indrive']),
  ('c0000000-0000-4000-8000-000000000004', NULL, 'expense', 'Housing',           '#8b5cf6', 'home',            ARRAY['rent','mortgage','landlord','apartment','property','maintenance','repair']),
  ('c0000000-0000-4000-8000-000000000005', NULL, 'expense', 'Utilities',         '#eab308', 'zap',             ARRAY['electricity','water bill','internet','wifi','phone bill','mobile recharge','gas bill','utility']),
  ('c0000000-0000-4000-8000-000000000006', NULL, 'expense', 'Entertainment',     '#ec4899', 'film',            ARRAY['movie','cinema','concert','game','steam','playstation','xbox','theatre','tickets','bowling']),
  ('c0000000-0000-4000-8000-000000000007', NULL, 'expense', 'Shopping',          '#14b8a6', 'shopping-bag',    ARRAY['amazon','ebay','clothing','shoes','mall','daraz','flipkart','ikea','electronics','apparel','zara']),
  ('c0000000-0000-4000-8000-000000000008', NULL, 'expense', 'Health & Fitness',  '#ef4444', 'heart-pulse',     ARRAY['pharmacy','doctor','hospital','clinic','dentist','medicine','gym','fitness','yoga','health']),
  ('c0000000-0000-4000-8000-000000000009', NULL, 'expense', 'Education',         '#6366f1', 'graduation-cap',  ARRAY['tuition','school','college','university','course','udemy','coursera','books','textbook','training']),
  ('c0000000-0000-4000-8000-000000000010', NULL, 'expense', 'Travel',            '#0ea5e9', 'plane',           ARRAY['flight','airline','hotel','airbnb','booking.com','expedia','vacation','trip','resort','visa']),
  ('c0000000-0000-4000-8000-000000000011', NULL, 'expense', 'Subscriptions',     '#a855f7', 'repeat',          ARRAY['netflix','spotify','youtube premium','disney','hulu','prime video','subscription','icloud','dropbox','adobe']),
  ('c0000000-0000-4000-8000-000000000012', NULL, 'expense', 'Personal Care',     '#f43f5e', 'sparkles',        ARRAY['salon','haircut','barber','spa','cosmetics','beauty','skincare']),
  ('c0000000-0000-4000-8000-000000000013', NULL, 'expense', 'Insurance',         '#64748b', 'shield',          ARRAY['insurance','premium','policy']),
  ('c0000000-0000-4000-8000-000000000014', NULL, 'expense', 'Gifts & Donations', '#d946ef', 'gift',            ARRAY['gift','donation','charity','present','wedding','birthday']),
  ('c0000000-0000-4000-8000-000000000015', NULL, 'expense', 'Other',             '#94a3b8', 'circle-ellipsis', ARRAY[]::TEXT[]),
  ('c0000000-0000-4000-8000-000000000101', NULL, 'income',  'Salary',            '#16a34a', 'briefcase',       ARRAY['salary','payroll','wage','paycheck','employer']),
  ('c0000000-0000-4000-8000-000000000102', NULL, 'income',  'Freelance',         '#0891b2', 'laptop',          ARRAY['freelance','upwork','fiverr','contract','client','consulting','invoice']),
  ('c0000000-0000-4000-8000-000000000103', NULL, 'income',  'Business',          '#7c3aed', 'building',        ARRAY['business','sales','revenue']),
  ('c0000000-0000-4000-8000-000000000104', NULL, 'income',  'Investments',       '#ca8a04', 'trending-up',     ARRAY['dividend','interest','stock','crypto','capital gain','mutual fund','bond']),
  ('c0000000-0000-4000-8000-000000000105', NULL, 'income',  'Rental',            '#9333ea', 'key',             ARRAY['rental income','tenant','lease']),
  ('c0000000-0000-4000-8000-000000000106', NULL, 'income',  'Gifts Received',    '#db2777', 'gift',            ARRAY['gift received']),
  ('c0000000-0000-4000-8000-000000000107', NULL, 'income',  'Refunds',           '#2563eb', 'rotate-ccw',      ARRAY['refund','cashback','reimbursement']),
  ('c0000000-0000-4000-8000-000000000108', NULL, 'income',  'Other Income',      '#94a3b8', 'circle-ellipsis', ARRAY[]::TEXT[]);
