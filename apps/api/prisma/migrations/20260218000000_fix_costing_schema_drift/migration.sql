-- ═══════════════════════════════════════════════════════════════════════════
-- Corrective Migration: Fix costing schema drift identified by financial audit
-- ═══════════════════════════════════════════════════════════════════════════
-- Fixes:
--   1. gl_accounts: add is_inventory_asset flag
--   2. item_costs: location_id VARCHAR(255) → UUID
--   3. wip_cost_accumulations: add standard_amount, currency, version
--   4. period_valuation_snapshots: rename snapshot_at → snapshot_date, add currency
--   5. cost_layers: add 5-column FIFO covering index
--   6. Performance: covering indexes, partition advisory
-- ═══════════════════════════════════════════════════════════════════════════

-- -----------------------------------------------------------------------
-- 1. gl_accounts — add is_inventory_asset flag for reconciliation
-- -----------------------------------------------------------------------
ALTER TABLE "gl_accounts"
  ADD COLUMN IF NOT EXISTS "is_inventory_asset" BOOLEAN NOT NULL DEFAULT false;

COMMENT ON COLUMN "gl_accounts"."is_inventory_asset"
  IS 'True for GL accounts that hold inventory asset balances (raw material, FG, WIP). Used by period-close reconciliation.';

-- -----------------------------------------------------------------------
-- 2. item_costs — fix location_id from VARCHAR(255) to UUID
-- -----------------------------------------------------------------------
-- Step 2a: Replace empty-string defaults with a proper NULL-safe approach
-- First, allow NULL temporarily
ALTER TABLE "item_costs" ALTER COLUMN "location_id" DROP DEFAULT;
ALTER TABLE "item_costs" ALTER COLUMN "location_id" DROP NOT NULL;

-- Step 2b: Set empty strings to NULL (they violate UUID format)
UPDATE "item_costs" SET "location_id" = NULL WHERE "location_id" = '';

-- Step 2c: Cast to UUID
ALTER TABLE "item_costs"
  ALTER COLUMN "location_id" TYPE UUID USING "location_id"::uuid;

-- Step 2d: Restore NOT NULL with a sentinel for any remaining NULLs
UPDATE "item_costs"
  SET "location_id" = '00000000-0000-0000-0000-000000000000'
  WHERE "location_id" IS NULL;

ALTER TABLE "item_costs" ALTER COLUMN "location_id" SET NOT NULL;

-- Step 2e: Add missing columns
ALTER TABLE "item_costs"
  ADD COLUMN IF NOT EXISTS "last_issue_cost" DECIMAL(18,4),
  ADD COLUMN IF NOT EXISTS "last_issue_date" TIMESTAMP(3),
  ADD COLUMN IF NOT EXISTS "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP;

-- -----------------------------------------------------------------------
-- 3. wip_cost_accumulations — add missing columns
-- -----------------------------------------------------------------------
ALTER TABLE "wip_cost_accumulations"
  ADD COLUMN IF NOT EXISTS "standard_amount" DECIMAL(18,4) NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS "currency" VARCHAR(3) NOT NULL DEFAULT 'USD',
  ADD COLUMN IF NOT EXISTS "version" INTEGER NOT NULL DEFAULT 1;

-- -----------------------------------------------------------------------
-- 4. period_valuation_snapshots — rename snapshot_at → snapshot_date, add currency
-- -----------------------------------------------------------------------
DO $$
BEGIN
  -- Only rename if old column exists and new column doesn't
  IF EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_name = 'period_valuation_snapshots' AND column_name = 'snapshot_at'
  ) AND NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_name = 'period_valuation_snapshots' AND column_name = 'snapshot_date'
  ) THEN
    ALTER TABLE "period_valuation_snapshots" RENAME COLUMN "snapshot_at" TO "snapshot_date";
  END IF;
END $$;

ALTER TABLE "period_valuation_snapshots"
  ADD COLUMN IF NOT EXISTS "currency" VARCHAR(3) NOT NULL DEFAULT 'USD';

-- -----------------------------------------------------------------------
-- 5. cost_layers — add 5-column FIFO covering index
-- -----------------------------------------------------------------------
CREATE INDEX IF NOT EXISTS "cost_layers_fifo_covering_idx"
  ON "cost_layers" ("tenant_id", "product_id", "location_id", "status", "layer_date");

-- -----------------------------------------------------------------------
-- 6. Performance indexes
-- -----------------------------------------------------------------------

-- cost_layer_depletions: covering index for layer aggregation
CREATE INDEX IF NOT EXISTS "cost_layer_depletions_layer_agg_idx"
  ON "cost_layer_depletions" ("tenant_id", "cost_layer_id", "depleted_at");

-- cost_variances: period reporting index
CREATE INDEX IF NOT EXISTS "cost_variances_period_type_idx"
  ON "cost_variances" ("tenant_id", "fiscal_period_id", "variance_type");

-- journal_entry_lines: GL reconciliation index (inventory accounts)
CREATE INDEX IF NOT EXISTS "journal_entry_lines_account_idx"
  ON "journal_entry_lines" ("gl_account_id");

-- revaluation_history: status filtering
CREATE INDEX IF NOT EXISTS "revaluation_history_status_idx"
  ON "revaluation_history" ("tenant_id", "status");

-- -----------------------------------------------------------------------
-- 7. Seed is_inventory_asset for common inventory account patterns
-- -----------------------------------------------------------------------
UPDATE "gl_accounts"
  SET "is_inventory_asset" = true
  WHERE "account_type" = 'ASSET'
    AND "is_inventory_asset" = false
    AND (
      LOWER("name") LIKE '%inventory%'
      OR LOWER("name") LIKE '%raw material%'
      OR LOWER("name") LIKE '%finished good%'
      OR LOWER("name") LIKE '%work in progress%'
      OR LOWER("name") LIKE '%wip%'
    );

