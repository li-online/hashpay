ALTER TABLE orders ADD COLUMN driver TEXT;
ALTER TABLE orders ADD COLUMN txid TEXT;

CREATE UNIQUE INDEX orders_driver_txid_unique
ON orders(driver, txid)
WHERE driver IS NOT NULL AND txid IS NOT NULL;
