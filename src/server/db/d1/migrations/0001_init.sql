CREATE TABLE IF NOT EXISTS configs (
  key TEXT PRIMARY KEY,
  value TEXT,
  blob BLOB,
  updated_at INTEGER NOT NULL
);

CREATE TABLE IF NOT EXISTS merchants (
  id TEXT PRIMARY KEY,
  type TEXT NOT NULL DEFAULT 'website',
  name TEXT NOT NULL,
  public_key TEXT NOT NULL DEFAULT '',
  callback TEXT,
  status TEXT NOT NULL DEFAULT 'enabled',
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL
);

CREATE TABLE IF NOT EXISTS payments (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  driver TEXT NOT NULL,
  name TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'enabled',
  address TEXT NOT NULL,
  assets TEXT NOT NULL,
  credentials TEXT NOT NULL DEFAULT '{}',
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL
);

CREATE TABLE IF NOT EXISTS orders (
  id TEXT PRIMARY KEY,
  merchant TEXT NOT NULL,
  merchant_no TEXT NOT NULL,
  description TEXT,
  status TEXT NOT NULL,
  amount REAL NOT NULL,
  currency TEXT NOT NULL,
  payway INTEGER,
  payment TEXT NOT NULL DEFAULT '{}',
  callback TEXT,
  redirect_url TEXT,
  expire_at INTEGER NOT NULL,
  paid_at INTEGER,
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL,
  UNIQUE(merchant, merchant_no)
);

CREATE TABLE IF NOT EXISTS notify (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  order_id TEXT NOT NULL,
  status TEXT NOT NULL,
  attempts INTEGER NOT NULL DEFAULT 0,
  next_run_at INTEGER NOT NULL,
  last_error TEXT,
  payload_json TEXT NOT NULL,
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL
);

CREATE TABLE IF NOT EXISTS review (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  order_id TEXT NOT NULL UNIQUE,
  answer TEXT NOT NULL,
  image BLOB,
  image_url TEXT
);

CREATE INDEX IF NOT EXISTS orders_status_idx ON orders(status);
CREATE INDEX IF NOT EXISTS orders_expire_at_idx ON orders(expire_at);
CREATE INDEX IF NOT EXISTS orders_payway_idx ON orders(payway);
CREATE INDEX IF NOT EXISTS notify_status_next_idx ON notify(status, next_run_at);
CREATE INDEX IF NOT EXISTS review_order_idx ON review(order_id);
