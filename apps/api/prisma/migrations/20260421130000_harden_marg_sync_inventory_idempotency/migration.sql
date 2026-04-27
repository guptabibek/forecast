-- Harden Marg inventory sync idempotency and snapshot correctness.

ALTER TABLE "marg_stocks"
  ADD COLUMN IF NOT EXISTS "source_deleted" BOOLEAN NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS "last_seen_sync_log_id" UUID;

ALTER TABLE "inventory_transactions"
  ADD COLUMN IF NOT EXISTS "idempotency_key" VARCHAR(100);

ALTER TABLE "inventory_ledger"
  ADD COLUMN IF NOT EXISTS "idempotency_key" VARCHAR(100);

DROP INDEX IF EXISTS "marg_transactions_tenant_id_company_id_source_key_key";

CREATE TEMP TABLE marg_tx_key_map AS
SELECT
  id,
  tenant_id,
  company_id,
  marg_id,
  source_key AS old_source_key,
  CONCAT('marg:', company_id::text, ':', marg_id::text) AS new_source_key
FROM marg_transactions;

UPDATE actuals AS a
SET source_reference = key_map.new_source_key
FROM marg_transactions AS mt
JOIN marg_tx_key_map AS key_map ON key_map.id = mt.id
WHERE mt.actual_id = a.id
  AND a.source_system = 'MARG_EDE'
  AND a.source_reference IS DISTINCT FROM key_map.new_source_key;

UPDATE inventory_transactions AS it
SET
  reference_number = LEFT(CONCAT('MARG-', key_map.new_source_key), 50),
  idempotency_key = LEFT(CONCAT('MARG_TX:', key_map.new_source_key), 100)
FROM marg_tx_key_map AS key_map
WHERE it.reference_type = 'MARG_EDE'
  AND it.tenant_id = key_map.tenant_id
  AND it.reference_number = LEFT(CONCAT('MARG-', key_map.old_source_key), 50);

UPDATE inventory_ledger AS il
SET
  reference_number = LEFT(CONCAT('MARG-', key_map.new_source_key), 50),
  idempotency_key = LEFT(CONCAT('MARG_LEDGER:', key_map.new_source_key), 100)
FROM marg_tx_key_map AS key_map
WHERE il.reference_type = 'MARG_EDE'
  AND il.tenant_id = key_map.tenant_id
  AND il.reference_number = LEFT(CONCAT('MARG-', key_map.old_source_key), 50);

UPDATE marg_transactions AS mt
SET source_key = key_map.new_source_key
FROM marg_tx_key_map AS key_map
WHERE mt.id = key_map.id
  AND mt.source_key IS DISTINCT FROM key_map.new_source_key;

WITH ranked AS (
  SELECT
    id,
    actual_id,
    FIRST_VALUE(id) OVER sync_window AS keep_id,
    ROW_NUMBER() OVER sync_window AS row_num
  FROM marg_transactions
  WINDOW sync_window AS (
    PARTITION BY tenant_id, company_id, source_key
    ORDER BY updated_at DESC, created_at DESC, id DESC
  )
), keep_actuals AS (
  SELECT
    keep_id,
    (ARRAY_AGG(actual_id) FILTER (WHERE actual_id IS NOT NULL))[1] AS actual_id
  FROM ranked
  GROUP BY keep_id
)
UPDATE marg_transactions AS mt
SET actual_id = keep_actuals.actual_id
FROM keep_actuals
WHERE mt.id = keep_actuals.keep_id
  AND keep_actuals.actual_id IS NOT NULL
  AND mt.actual_id IS DISTINCT FROM keep_actuals.actual_id;

WITH ranked AS (
  SELECT
    id,
    ROW_NUMBER() OVER sync_window AS row_num
  FROM marg_transactions
  WINDOW sync_window AS (
    PARTITION BY tenant_id, company_id, source_key
    ORDER BY updated_at DESC, created_at DESC, id DESC
  )
)
DELETE FROM marg_transactions AS mt
USING ranked
WHERE mt.id = ranked.id
  AND ranked.row_num > 1;

WITH ranked AS (
  SELECT
    id,
    FIRST_VALUE(id) OVER actual_window AS keep_id,
    ROW_NUMBER() OVER actual_window AS row_num
  FROM actuals
  WHERE source_system = 'MARG_EDE'
    AND source_reference IS NOT NULL
  WINDOW actual_window AS (
    PARTITION BY tenant_id, source_system, source_reference
    ORDER BY updated_at DESC, created_at DESC, id DESC
  )
)
UPDATE marg_transactions AS mt
SET actual_id = ranked.keep_id
FROM ranked
WHERE mt.actual_id = ranked.id
  AND ranked.row_num > 1;

WITH ranked AS (
  SELECT
    id,
    ROW_NUMBER() OVER actual_window AS row_num
  FROM actuals
  WHERE source_system = 'MARG_EDE'
    AND source_reference IS NOT NULL
  WINDOW actual_window AS (
    PARTITION BY tenant_id, source_system, source_reference
    ORDER BY updated_at DESC, created_at DESC, id DESC
  )
)
DELETE FROM actuals AS a
USING ranked
WHERE a.id = ranked.id
  AND ranked.row_num > 1;

WITH ranked AS (
  SELECT
    id,
    ROW_NUMBER() OVER tx_window AS row_num
  FROM inventory_transactions
  WHERE reference_type = 'MARG_EDE'
    AND reference_number IS NOT NULL
  WINDOW tx_window AS (
    PARTITION BY tenant_id, reference_type, reference_number
    ORDER BY created_at DESC, id DESC
  )
)
DELETE FROM inventory_transactions AS it
USING ranked
WHERE it.id = ranked.id
  AND ranked.row_num > 1;

WITH ranked AS (
  SELECT
    id,
    ROW_NUMBER() OVER ledger_window AS row_num
  FROM inventory_ledger
  WHERE reference_type = 'MARG_EDE'
    AND reference_number IS NOT NULL
  WINDOW ledger_window AS (
    PARTITION BY tenant_id, reference_type, reference_number, product_id, location_id, COALESCE(batch_id::text, '')
    ORDER BY created_at DESC, id DESC
  )
)
DELETE FROM inventory_ledger AS il
USING ranked
WHERE il.id = ranked.id
  AND ranked.row_num > 1;

UPDATE inventory_transactions
SET idempotency_key = LEFT(CONCAT('MARG_TX:', COALESCE(reference_number, id::text)), 100)
WHERE reference_type = 'MARG_EDE'
  AND idempotency_key IS NULL;

UPDATE inventory_ledger
SET idempotency_key = LEFT(CONCAT('MARG_LEDGER:', COALESCE(reference_number, id::text)), 100)
WHERE reference_type = 'MARG_EDE'
  AND idempotency_key IS NULL;

DROP TABLE marg_tx_key_map;

CREATE UNIQUE INDEX IF NOT EXISTS "marg_transactions_tenant_id_company_id_source_key_key"
  ON "marg_transactions"("tenant_id", "company_id", "source_key");

CREATE INDEX IF NOT EXISTS "marg_stocks_tenant_id_source_deleted_idx"
  ON "marg_stocks"("tenant_id", "source_deleted");

CREATE INDEX IF NOT EXISTS "marg_stocks_last_seen_sync_log_id_idx"
  ON "marg_stocks"("last_seen_sync_log_id");

CREATE UNIQUE INDEX IF NOT EXISTS "actuals_tenant_id_source_system_source_reference_key"
  ON "actuals"("tenant_id", "source_system", "source_reference");

CREATE UNIQUE INDEX IF NOT EXISTS "inventory_transactions_tenant_id_idempotency_key_key"
  ON "inventory_transactions"("tenant_id", "idempotency_key");

CREATE UNIQUE INDEX IF NOT EXISTS "inventory_ledger_tenant_id_idempotency_key_key"
  ON "inventory_ledger"("tenant_id", "idempotency_key");

DROP INDEX IF EXISTS "batches_tenant_id_batch_number_key";

CREATE UNIQUE INDEX IF NOT EXISTS "batches_tenant_id_product_id_location_id_batch_number_key"
  ON "batches"("tenant_id", "product_id", "location_id", "batch_number");