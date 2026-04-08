-- Ensure uuid_generate_v4() is available for UUID defaults.
CREATE EXTENSION IF NOT EXISTS "uuid-ossp";

-- CreateEnum: CostingMethod
DO $$ BEGIN
  CREATE TYPE "CostingMethod" AS ENUM ('STANDARD', 'MOVING_AVERAGE', 'FIFO', 'LIFO', 'ACTUAL_JOB_COSTING');
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

-- CreateEnum: CostLayerStatus
DO $$ BEGIN
  CREATE TYPE "CostLayerStatus" AS ENUM ('OPEN', 'DEPLETED', 'FROZEN');
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

-- CreateEnum: RevaluationStatus
DO $$ BEGIN
  CREATE TYPE "RevaluationStatus" AS ENUM ('DRAFT', 'POSTED', 'REVERSED');
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

-- CreateEnum: PeriodCloseStatus
DO $$ BEGIN
  CREATE TYPE "PeriodCloseStatus" AS ENUM ('OPEN', 'CLOSING', 'CLOSED', 'REOPENED');
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

-- ═══════════════════════════════════════════════════════════════════════════
-- ItemCostProfile — per-item costing method configuration
-- ═══════════════════════════════════════════════════════════════════════════
CREATE TABLE IF NOT EXISTS "item_cost_profiles" (
  "id"                    UUID NOT NULL DEFAULT uuid_generate_v4(),
  "tenant_id"             UUID NOT NULL,
  "product_id"            UUID NOT NULL,
  "location_id"           UUID,
  "costing_method"        "CostingMethod" NOT NULL DEFAULT 'STANDARD',
  "standard_cost_version" VARCHAR(50),
  "enable_landed_cost"    BOOLEAN NOT NULL DEFAULT false,
  "overhead_rate"         DECIMAL(18,4),
  "labor_rate"            DECIMAL(18,4),
  "created_at"            TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at"            TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

  CONSTRAINT "item_cost_profiles_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX IF NOT EXISTS "item_cost_profiles_tenant_product_location"
  ON "item_cost_profiles" ("tenant_id", "product_id", "location_id");
CREATE INDEX IF NOT EXISTS "item_cost_profiles_tenant_id_idx"
  ON "item_cost_profiles" ("tenant_id");

-- ═══════════════════════════════════════════════════════════════════════════
-- CostLayer — immutable receipt-level cost layer for FIFO/LIFO
-- ═══════════════════════════════════════════════════════════════════════════
CREATE TABLE IF NOT EXISTS "cost_layers" (
  "id"                UUID NOT NULL DEFAULT uuid_generate_v4(),
  "tenant_id"         UUID NOT NULL,
  "product_id"        UUID NOT NULL,
  "location_id"       UUID NOT NULL,
  "batch_id"          UUID,
  "costing_method"    "CostingMethod" NOT NULL,
  "layer_date"        TIMESTAMP(3) NOT NULL,
  "reference_type"    VARCHAR(50) NOT NULL,
  "reference_id"      UUID NOT NULL,
  "reference_number"  VARCHAR(100),
  "original_qty"      DECIMAL(18,4) NOT NULL,
  "remaining_qty"     DECIMAL(18,4) NOT NULL,
  "unit_cost"         DECIMAL(18,4) NOT NULL,
  "landed_cost"       DECIMAL(18,4) NOT NULL DEFAULT 0,
  "total_cost"        DECIMAL(18,4) NOT NULL,
  "currency"          VARCHAR(3) NOT NULL DEFAULT 'USD',
  "exchange_rate"     DECIMAL(18,6) DEFAULT 1,
  "base_curr_cost"    DECIMAL(18,4),
  "fiscal_period_id"  UUID,
  "status"            "CostLayerStatus" NOT NULL DEFAULT 'OPEN',
  "version"           INTEGER NOT NULL DEFAULT 1,
  "created_at"        TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at"        TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

  CONSTRAINT "cost_layers_pkey" PRIMARY KEY ("id")
);

CREATE INDEX IF NOT EXISTS "cost_layers_tenant_product_location_status"
  ON "cost_layers" ("tenant_id", "product_id", "location_id", "status");
CREATE INDEX IF NOT EXISTS "cost_layers_tenant_id_idx"
  ON "cost_layers" ("tenant_id");
CREATE INDEX IF NOT EXISTS "cost_layers_layer_date_idx"
  ON "cost_layers" ("layer_date");
CREATE INDEX IF NOT EXISTS "cost_layers_reference_idx"
  ON "cost_layers" ("reference_type", "reference_id");
CREATE INDEX IF NOT EXISTS "cost_layers_fiscal_period_idx"
  ON "cost_layers" ("fiscal_period_id");

-- ═══════════════════════════════════════════════════════════════════════════
-- CostLayerDepletion — audit trail for each consumption from a cost layer
-- ═══════════════════════════════════════════════════════════════════════════
CREATE TABLE IF NOT EXISTS "cost_layer_depletions" (
  "id"                UUID NOT NULL DEFAULT uuid_generate_v4(),
  "tenant_id"         UUID NOT NULL,
  "cost_layer_id"     UUID NOT NULL,
  "depleted_qty"      DECIMAL(18,4) NOT NULL,
  "unit_cost"         DECIMAL(18,4) NOT NULL,
  "total_cost"        DECIMAL(18,4) NOT NULL,
  "reference_type"    VARCHAR(50) NOT NULL,
  "reference_id"      UUID NOT NULL,
  "reference_number"  VARCHAR(100),
  "depleted_at"       TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

  CONSTRAINT "cost_layer_depletions_pkey" PRIMARY KEY ("id")
);

CREATE INDEX IF NOT EXISTS "cost_layer_depletions_layer_idx"
  ON "cost_layer_depletions" ("cost_layer_id");
CREATE INDEX IF NOT EXISTS "cost_layer_depletions_tenant_idx"
  ON "cost_layer_depletions" ("tenant_id");
CREATE INDEX IF NOT EXISTS "cost_layer_depletions_reference_idx"
  ON "cost_layer_depletions" ("reference_type", "reference_id");

ALTER TABLE "cost_layer_depletions"
  ADD CONSTRAINT "cost_layer_depletions_cost_layer_fk"
  FOREIGN KEY ("cost_layer_id") REFERENCES "cost_layers"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- ═══════════════════════════════════════════════════════════════════════════
-- ItemCost — moving average / standard cost tracker per (product, location)
-- ═══════════════════════════════════════════════════════════════════════════
CREATE TABLE IF NOT EXISTS "item_costs" (
  "id"                UUID NOT NULL DEFAULT uuid_generate_v4(),
  "tenant_id"         UUID NOT NULL,
  "product_id"        UUID NOT NULL,
  "location_id"       VARCHAR(255) NOT NULL DEFAULT '',
  "current_unit_cost" DECIMAL(18,4) NOT NULL DEFAULT 0,
  "current_total_qty" DECIMAL(18,4) NOT NULL DEFAULT 0,
  "current_total_value" DECIMAL(18,4) NOT NULL DEFAULT 0,
  "standard_cost"     DECIMAL(18,4) NOT NULL DEFAULT 0,
  "last_receipt_cost" DECIMAL(18,4),
  "last_receipt_date" TIMESTAMP(3),
  "last_issue_cost"   DECIMAL(18,4),
  "last_issue_date"   TIMESTAMP(3),
  "currency"          VARCHAR(3) DEFAULT 'USD',
  "version"           INTEGER NOT NULL DEFAULT 1,
  "created_at"        TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at"        TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

  CONSTRAINT "item_costs_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX IF NOT EXISTS "item_costs_tenant_product_location"
  ON "item_costs" ("tenant_id", "product_id", "location_id");
CREATE INDEX IF NOT EXISTS "item_costs_tenant_id_idx"
  ON "item_costs" ("tenant_id");

-- ═══════════════════════════════════════════════════════════════════════════
-- WIPCostAccumulation — WIP breakdown by cost element per work order
-- ═══════════════════════════════════════════════════════════════════════════
CREATE TABLE IF NOT EXISTS "wip_cost_accumulations" (
  "id"                    UUID NOT NULL DEFAULT uuid_generate_v4(),
  "tenant_id"             UUID NOT NULL,
  "work_order_id"         UUID NOT NULL,
  "cost_element"          VARCHAR(50) NOT NULL,
  "accumulated_amount"    DECIMAL(18,4) NOT NULL DEFAULT 0,
  "absorbed_amount"       DECIMAL(18,4),
  "variance_amount"       DECIMAL(18,4),
  "last_transaction_date" TIMESTAMP(3),
  "created_at"            TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at"            TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

  CONSTRAINT "wip_cost_accumulations_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX IF NOT EXISTS "wip_cost_accumulations_tenant_wo_element"
  ON "wip_cost_accumulations" ("tenant_id", "work_order_id", "cost_element");
CREATE INDEX IF NOT EXISTS "wip_cost_accumulations_wo_idx"
  ON "wip_cost_accumulations" ("work_order_id");
CREATE INDEX IF NOT EXISTS "wip_cost_accumulations_tenant_idx"
  ON "wip_cost_accumulations" ("tenant_id");

-- ═══════════════════════════════════════════════════════════════════════════
-- CostVariance — persisted variance records
-- ═══════════════════════════════════════════════════════════════════════════
CREATE TABLE IF NOT EXISTS "cost_variances" (
  "id"                UUID NOT NULL DEFAULT uuid_generate_v4(),
  "tenant_id"         UUID NOT NULL,
  "variance_type"     VARCHAR(50) NOT NULL,
  "reference_type"    VARCHAR(50) NOT NULL,
  "reference_id"      UUID NOT NULL,
  "product_id"        UUID,
  "fiscal_period_id"  UUID,
  "standard_amount"   DECIMAL(18,4) NOT NULL,
  "actual_amount"     DECIMAL(18,4) NOT NULL,
  "variance_amount"   DECIMAL(18,4) NOT NULL,
  "variance_pct"      DECIMAL(8,2),
  "favorability"      VARCHAR(20),
  "notes"             TEXT,
  "created_at"        TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

  CONSTRAINT "cost_variances_pkey" PRIMARY KEY ("id")
);

CREATE INDEX IF NOT EXISTS "cost_variances_tenant_idx"
  ON "cost_variances" ("tenant_id");
CREATE INDEX IF NOT EXISTS "cost_variances_reference_idx"
  ON "cost_variances" ("reference_type", "reference_id");
CREATE INDEX IF NOT EXISTS "cost_variances_type_idx"
  ON "cost_variances" ("tenant_id", "variance_type");
CREATE INDEX IF NOT EXISTS "cost_variances_product_idx"
  ON "cost_variances" ("tenant_id", "product_id");
CREATE INDEX IF NOT EXISTS "cost_variances_period_idx"
  ON "cost_variances" ("tenant_id", "fiscal_period_id");

-- ═══════════════════════════════════════════════════════════════════════════
-- RevaluationHistory — revaluation event records
-- ═══════════════════════════════════════════════════════════════════════════
CREATE TABLE IF NOT EXISTS "revaluation_history" (
  "id"                    UUID NOT NULL DEFAULT uuid_generate_v4(),
  "tenant_id"             UUID NOT NULL,
  "revaluation_number"    VARCHAR(50) NOT NULL,
  "revaluation_type"      VARCHAR(50) NOT NULL,
  "product_id"            UUID NOT NULL,
  "location_id"           UUID,
  "batch_id"              UUID,
  "fiscal_period_id"      UUID,
  "old_unit_cost"         DECIMAL(18,4) NOT NULL,
  "new_unit_cost"         DECIMAL(18,4) NOT NULL,
  "affected_qty"          DECIMAL(18,4) NOT NULL,
  "revaluation_amount"    DECIMAL(18,4) NOT NULL,
  "journal_entry_id"      UUID,
  "status"                "RevaluationStatus" NOT NULL DEFAULT 'DRAFT',
  "reason"                TEXT,
  "approved_by_id"        UUID,
  "approved_at"           TIMESTAMP(3),
  "performed_by_id"       UUID,
  "performed_at"          TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "created_at"            TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

  CONSTRAINT "revaluation_history_pkey" PRIMARY KEY ("id")
);

CREATE INDEX IF NOT EXISTS "revaluation_history_tenant_idx"
  ON "revaluation_history" ("tenant_id");
CREATE INDEX IF NOT EXISTS "revaluation_history_product_idx"
  ON "revaluation_history" ("tenant_id", "product_id");
CREATE INDEX IF NOT EXISTS "revaluation_history_period_idx"
  ON "revaluation_history" ("tenant_id", "fiscal_period_id");

-- ═══════════════════════════════════════════════════════════════════════════
-- CurrencyRateSnapshot — locked exchange rates per transaction
-- ═══════════════════════════════════════════════════════════════════════════
CREATE TABLE IF NOT EXISTS "currency_rate_snapshots" (
  "id"              UUID NOT NULL DEFAULT uuid_generate_v4(),
  "tenant_id"       UUID NOT NULL,
  "from_currency"   VARCHAR(3) NOT NULL,
  "to_currency"     VARCHAR(3) NOT NULL,
  "rate"            DECIMAL(18,6) NOT NULL,
  "inverse_rate"    DECIMAL(18,6) NOT NULL,
  "rate_date"       TIMESTAMP(3) NOT NULL,
  "source"          VARCHAR(50),
  "reference_type"  VARCHAR(50),
  "reference_id"    UUID,
  "created_at"      TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

  CONSTRAINT "currency_rate_snapshots_pkey" PRIMARY KEY ("id")
);

CREATE INDEX IF NOT EXISTS "currency_rate_snapshots_tenant_idx"
  ON "currency_rate_snapshots" ("tenant_id");
CREATE INDEX IF NOT EXISTS "currency_rate_snapshots_reference_idx"
  ON "currency_rate_snapshots" ("reference_type", "reference_id");

-- ═══════════════════════════════════════════════════════════════════════════
-- PeriodValuationSnapshot — inventory valuation at period close
-- ═══════════════════════════════════════════════════════════════════════════
CREATE TABLE IF NOT EXISTS "period_valuation_snapshots" (
  "id"                UUID NOT NULL DEFAULT uuid_generate_v4(),
  "tenant_id"         UUID NOT NULL,
  "fiscal_period_id"  UUID NOT NULL,
  "product_id"        UUID NOT NULL,
  "location_id"       UUID NOT NULL,
  "on_hand_qty"       DECIMAL(18,4) NOT NULL,
  "unit_cost"         DECIMAL(18,4) NOT NULL,
  "total_value"       DECIMAL(18,4) NOT NULL,
  "costing_method"    VARCHAR(30),
  "open_layer_count"  INTEGER DEFAULT 0,
  "snapshot_at"       TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

  CONSTRAINT "period_valuation_snapshots_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX IF NOT EXISTS "period_valuation_snapshots_unique"
  ON "period_valuation_snapshots" ("tenant_id", "fiscal_period_id", "product_id", "location_id");
CREATE INDEX IF NOT EXISTS "period_valuation_snapshots_tenant_idx"
  ON "period_valuation_snapshots" ("tenant_id");
CREATE INDEX IF NOT EXISTS "period_valuation_snapshots_period_idx"
  ON "period_valuation_snapshots" ("fiscal_period_id");

-- ═══════════════════════════════════════════════════════════════════════════
-- LandedCostAllocation — distributes extra purchase costs across receipt lines
-- ═══════════════════════════════════════════════════════════════════════════
CREATE TABLE IF NOT EXISTS "landed_cost_allocations" (
  "id"                    UUID NOT NULL DEFAULT uuid_generate_v4(),
  "tenant_id"             UUID NOT NULL,
  "goods_receipt_id"      UUID NOT NULL,
  "goods_receipt_line_id" UUID NOT NULL,
  "cost_layer_id"         UUID,
  "cost_category"         VARCHAR(50) NOT NULL,
  "allocation_method"     VARCHAR(30) NOT NULL,
  "allocated_amount"      DECIMAL(18,4) NOT NULL,
  "vendor_invoice_ref"    VARCHAR(100),
  "created_at"            TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

  CONSTRAINT "landed_cost_allocations_pkey" PRIMARY KEY ("id")
);

CREATE INDEX IF NOT EXISTS "landed_cost_allocations_tenant_idx"
  ON "landed_cost_allocations" ("tenant_id");
CREATE INDEX IF NOT EXISTS "landed_cost_allocations_gr_idx"
  ON "landed_cost_allocations" ("goods_receipt_id");
CREATE INDEX IF NOT EXISTS "landed_cost_allocations_layer_idx"
  ON "landed_cost_allocations" ("cost_layer_id");

ALTER TABLE "landed_cost_allocations"
  ADD CONSTRAINT "landed_cost_allocations_cost_layer_fk"
  FOREIGN KEY ("cost_layer_id") REFERENCES "cost_layers"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- ═══════════════════════════════════════════════════════════════════════════
-- PeriodCloseCheckpoint — tracks period close status with GL reconciliation
-- ═══════════════════════════════════════════════════════════════════════════
CREATE TABLE IF NOT EXISTS "period_close_checkpoints" (
  "id"                        UUID NOT NULL DEFAULT uuid_generate_v4(),
  "tenant_id"                 UUID NOT NULL,
  "fiscal_period_id"          UUID NOT NULL,
  "status"                    "PeriodCloseStatus" NOT NULL DEFAULT 'OPEN',
  "inventory_valuation_total" DECIMAL(18,4),
  "gl_inventory_total"        DECIMAL(18,4),
  "discrepancy"               DECIMAL(18,4),
  "variance_summary"          JSONB,
  "closed_by_id"              UUID,
  "closed_at"                 TIMESTAMP(3),
  "reopened_by_id"            UUID,
  "reopened_at"               TIMESTAMP(3),
  "reopen_reason"             TEXT,
  "created_at"                TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at"                TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

  CONSTRAINT "period_close_checkpoints_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX IF NOT EXISTS "period_close_checkpoints_tenant_period"
  ON "period_close_checkpoints" ("tenant_id", "fiscal_period_id");
CREATE INDEX IF NOT EXISTS "period_close_checkpoints_tenant_idx"
  ON "period_close_checkpoints" ("tenant_id");

-- ═══════════════════════════════════════════════════════════════════════════
-- Sequence for Revaluation Numbers
-- ═══════════════════════════════════════════════════════════════════════════
DO $$ BEGIN
  CREATE SEQUENCE IF NOT EXISTS seq_rv START WITH 1 INCREMENT BY 1;
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;
