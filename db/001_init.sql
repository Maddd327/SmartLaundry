-- Jalankan dengan CATALOG_DB_PASSWORD dan ORDER_DB_PASSWORD di environment psql.
-- Aman untuk data transaksi: CREATE IF NOT EXISTS dan seed ON CONFLICT DO NOTHING.
\getenv catalog_password CATALOG_DB_PASSWORD
\getenv order_password ORDER_DB_PASSWORD
SELECT format('CREATE ROLE catalog_app LOGIN PASSWORD %L', :'catalog_password')
WHERE NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'catalog_app') \gexec
SELECT format('CREATE ROLE order_app LOGIN PASSWORD %L', :'order_password')
WHERE NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'order_app') \gexec
ALTER ROLE catalog_app PASSWORD :'catalog_password';
ALTER ROLE order_app PASSWORD :'order_password';
CREATE SCHEMA IF NOT EXISTS catalog;
CREATE SCHEMA IF NOT EXISTS ordering;

CREATE TABLE IF NOT EXISTS catalog.services (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL CHECK (length(trim(name)) > 0),
  description TEXT NOT NULL DEFAULT '',
  category TEXT NOT NULL CHECK (length(trim(category)) > 0),
  price_kg BIGINT NOT NULL CHECK (price_kg > 0),
  price_item BIGINT NOT NULL CHECK (price_item > 0),
  supported_units TEXT[] NOT NULL CHECK (
    supported_units = ARRAY['kg']::TEXT[] OR
    supported_units = ARRAY['item']::TEXT[] OR
    supported_units = ARRAY['kg','item']::TEXT[] OR
    supported_units = ARRAY['item','kg']::TEXT[]
  ),
  duration_minutes INTEGER NOT NULL CHECK (duration_minutes > 0),
  active BOOLEAN NOT NULL DEFAULT TRUE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS ordering.customers (
  id UUID PRIMARY KEY,
  name TEXT NOT NULL CHECK (length(trim(name)) > 0),
  whatsapp TEXT NOT NULL UNIQUE CHECK (whatsapp ~ '^628[0-9]{8,12}$'),
  additional_contact TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE TABLE IF NOT EXISTS ordering.orders (
  id UUID PRIMARY KEY,
  client_order_id TEXT NOT NULL UNIQUE,
  request_hash CHAR(64) NOT NULL,
  customer_id UUID NOT NULL REFERENCES ordering.customers(id),
  ordered_at TIMESTAMPTZ NOT NULL,
  status TEXT NOT NULL DEFAULT 'baru' CHECK (status IN ('menunggu_konfirmasi','baru','diproses','selesai','diambil','dibatalkan')),
  source TEXT NOT NULL DEFAULT 'pos' CHECK (source IN ('pos','website')),
  requested_date DATE,
  request_name TEXT,
  subtotal BIGINT NOT NULL CHECK (subtotal >= 0),
  discount BIGINT NOT NULL DEFAULT 0 CHECK (discount >= 0 AND discount <= subtotal),
  total BIGINT NOT NULL CHECK (total = subtotal - discount),
  expected_completed_at TIMESTAMPTZ NOT NULL,
  note TEXT NOT NULL DEFAULT '',
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
ALTER TABLE ordering.orders ADD COLUMN IF NOT EXISTS note TEXT NOT NULL DEFAULT '';
-- Migrasi berulang untuk volume PostgreSQL yang sudah berisi transaksi.
ALTER TABLE ordering.orders ADD COLUMN IF NOT EXISTS source TEXT NOT NULL DEFAULT 'pos';
ALTER TABLE ordering.orders ADD COLUMN IF NOT EXISTS requested_date DATE;
ALTER TABLE ordering.orders ADD COLUMN IF NOT EXISTS request_name TEXT;
ALTER TABLE ordering.orders DROP CONSTRAINT IF EXISTS orders_status_check;
ALTER TABLE ordering.orders ADD CONSTRAINT orders_status_check
  CHECK (status IN ('menunggu_konfirmasi','baru','diproses','selesai','diambil','dibatalkan'));
CREATE TABLE IF NOT EXISTS ordering.order_items (
  id UUID PRIMARY KEY,
  order_id UUID NOT NULL REFERENCES ordering.orders(id) ON DELETE CASCADE,
  service_id TEXT NOT NULL,
  service_name TEXT NOT NULL CHECK (length(trim(service_name)) > 0),
  unit_price BIGINT NOT NULL CHECK (unit_price > 0),
  unit TEXT NOT NULL CHECK (unit IN ('kg','item')),
  quantity NUMERIC(12,3) NOT NULL CHECK (quantity > 0 AND (unit <> 'item' OR quantity = trunc(quantity))),
  line_total BIGINT NOT NULL CHECK (line_total > 0)
);
CREATE TABLE IF NOT EXISTS ordering.payments (
  id UUID PRIMARY KEY,
  order_id UUID NOT NULL REFERENCES ordering.orders(id) ON DELETE CASCADE,
  amount BIGINT NOT NULL CHECK (amount > 0),
  method TEXT NOT NULL CHECK (method IN ('tunai','transfer','qris')),
  paid_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE TABLE IF NOT EXISTS ordering.expenses (
  id UUID PRIMARY KEY,
  category TEXT NOT NULL CHECK (length(trim(category)) > 0),
  description TEXT NOT NULL CHECK (length(trim(description)) > 0),
  amount BIGINT NOT NULL CHECK (amount > 0),
  expense_date DATE NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS orders_ordered_at_idx ON ordering.orders(ordered_at);
CREATE INDEX IF NOT EXISTS payments_paid_at_idx ON ordering.payments(paid_at);
CREATE INDEX IF NOT EXISTS expenses_date_idx ON ordering.expenses(expense_date);
CREATE INDEX IF NOT EXISTS order_items_order_id_idx ON ordering.order_items(order_id);
CREATE INDEX IF NOT EXISTS payments_order_id_idx ON ordering.payments(order_id);

-- Stable IDs; rerunning never changes edited service prices or transaction data.
INSERT INTO catalog.services (id,name,description,category,price_kg,price_item,supported_units,duration_minutes,active)
VALUES
  ('regular','Cuci Setrika Regular','Cuci dan setrika untuk pakaian sehari-hari.','cuci-setrika',6000,18000,ARRAY['kg','item'],2880,TRUE),
  ('express','Express Wash','Pilihan lebih cepat untuk kebutuhan mendesak.','express',8000,25000,ARRAY['kg','item'],1440,TRUE),
  ('iron','Setrika Saja','Pakaian rapi tanpa layanan cuci.','setrika',3000,5000,ARRAY['kg','item'],240,TRUE)
ON CONFLICT (id) DO NOTHING;

GRANT USAGE ON SCHEMA catalog TO catalog_app;
GRANT SELECT,INSERT,UPDATE ON catalog.services TO catalog_app;
GRANT USAGE ON SCHEMA ordering TO order_app;
GRANT SELECT,INSERT,UPDATE ON ALL TABLES IN SCHEMA ordering TO order_app;
