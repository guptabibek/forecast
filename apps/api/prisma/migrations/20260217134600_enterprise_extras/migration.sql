-- ===========================================================================
-- Enterprise Extras Migration
-- Sequences, custom composite indexes, partition tables, utility functions
-- ===========================================================================

-- ─────────────────────────────────────────────────────────────────────────────
-- 1. DOCUMENT NUMBER SEQUENCES (concurrency-safe numbering)
-- ─────────────────────────────────────────────────────────────────────────────

CREATE SEQUENCE IF NOT EXISTS seq_purchase_order_number START WITH 1 INCREMENT BY 1;
CREATE SEQUENCE IF NOT EXISTS seq_goods_receipt_number START WITH 1 INCREMENT BY 1;
CREATE SEQUENCE IF NOT EXISTS seq_work_order_number START WITH 1 INCREMENT BY 1;
CREATE SEQUENCE IF NOT EXISTS seq_material_issue_number START WITH 1 INCREMENT BY 1;
CREATE SEQUENCE IF NOT EXISTS seq_production_completion_number START WITH 1 INCREMENT BY 1;
CREATE SEQUENCE IF NOT EXISTS seq_batch_number START WITH 1 INCREMENT BY 1;
CREATE SEQUENCE IF NOT EXISTS seq_inventory_transaction_number START WITH 1 INCREMENT BY 1;
CREATE SEQUENCE IF NOT EXISTS seq_reservation_number START WITH 1 INCREMENT BY 1;
CREATE SEQUENCE IF NOT EXISTS seq_hold_number START WITH 1 INCREMENT BY 1;
CREATE SEQUENCE IF NOT EXISTS seq_journal_entry_number START WITH 1 INCREMENT BY 1;
CREATE SEQUENCE IF NOT EXISTS seq_inspection_number START WITH 1 INCREMENT BY 1;
CREATE SEQUENCE IF NOT EXISTS seq_ncr_number START WITH 1 INCREMENT BY 1;
CREATE SEQUENCE IF NOT EXISTS seq_capa_number START WITH 1 INCREMENT BY 1;


-- ─────────────────────────────────────────────────────────────────────────────
-- 2. ADDITIONAL COMPOSITE INDEXES (beyond Prisma @@index)
-- ─────────────────────────────────────────────────────────────────────────────

-- JournalEntry: tenant-scoped date range + period + status queries
CREATE INDEX IF NOT EXISTS "idx_journal_tenant_date"
  ON "journal_entries" ("tenant_id", "entry_date" DESC);

CREATE INDEX IF NOT EXISTS "idx_journal_tenant_period"
  ON "journal_entries" ("tenant_id", "fiscal_period_id");

CREATE INDEX IF NOT EXISTS "idx_journal_tenant_status_date"
  ON "journal_entries" ("tenant_id", "status", "entry_date" DESC);

-- JournalEntryLine: aggregate trial-balance by account
CREATE INDEX IF NOT EXISTS "idx_jel_account_journal"
  ON "journal_entry_lines" ("gl_account_id", "journal_entry_id");

-- InventoryLedger: primary query (tenant, product, location, date)
CREATE INDEX IF NOT EXISTS "idx_ledger_tenant_prod_loc_date"
  ON "inventory_ledger" ("tenant_id", "product_id", "location_id", "transaction_date" DESC);

CREATE INDEX IF NOT EXISTS "idx_ledger_tenant_type_date"
  ON "inventory_ledger" ("tenant_id", "entry_type", "transaction_date" DESC);

-- MaterialIssue: work order cost aggregation
CREATE INDEX IF NOT EXISTS "idx_mi_tenant_wo"
  ON "material_issues" ("tenant_id", "work_order_id");

-- ProductionCompletion: work order aggregation
CREATE INDEX IF NOT EXISTS "idx_pc_tenant_wo"
  ON "production_completions" ("tenant_id", "work_order_id");

-- LaborEntry: operation-based lookups for cost aggregation
CREATE INDEX IF NOT EXISTS "idx_labor_tenant_op"
  ON "labor_entries" ("tenant_id", "operation_id");

-- InventoryReservation: active lookups
CREATE INDEX IF NOT EXISTS "idx_resv_tenant_active"
  ON "inventory_reservations" ("tenant_id", "status") WHERE "status" = 'ACTIVE';

-- InventoryHold: active lookups
CREATE INDEX IF NOT EXISTS "idx_hold_tenant_active"
  ON "inventory_holds" ("tenant_id", "status") WHERE "status" = 'ACTIVE';


-- ─────────────────────────────────────────────────────────────────────────────
-- 3. OPTIMISTIC LOCK CHECK FUNCTION
-- ─────────────────────────────────────────────────────────────────────────────

CREATE OR REPLACE FUNCTION check_optimistic_lock(affected_rows INTEGER, entity_name TEXT)
RETURNS VOID AS $$
BEGIN
  IF affected_rows = 0 THEN
    RAISE EXCEPTION 'Optimistic lock conflict on %: row was modified by another transaction', entity_name
      USING ERRCODE = '40001';
  END IF;
END;
$$ LANGUAGE plpgsql;


-- ─────────────────────────────────────────────────────────────────────────────
-- 4. PARTITION PREPARATION (advisory, for data archival)
-- ─────────────────────────────────────────────────────────────────────────────

-- Inventory ledger archive (for entries older than current fiscal year)
CREATE TABLE IF NOT EXISTS inventory_ledger_archive (
  id              UUID NOT NULL,
  tenant_id       UUID NOT NULL,
  sequence_number BIGINT NOT NULL,
  transaction_date TIMESTAMPTZ NOT NULL,
  product_id      UUID NOT NULL,
  location_id     UUID NOT NULL,
  batch_id        UUID,
  entry_type      TEXT NOT NULL,
  quantity        DECIMAL(18,4) NOT NULL,
  uom             VARCHAR(20) NOT NULL,
  unit_cost       DECIMAL(18,4) DEFAULT 0,
  total_cost      DECIMAL(18,4) DEFAULT 0,
  reference_type  VARCHAR(50),
  reference_id    UUID,
  reference_number VARCHAR(50),
  lot_number      VARCHAR(100),
  inventory_status TEXT DEFAULT 'INV_AVAILABLE',
  running_balance DECIMAL(18,4),
  journal_entry_id UUID,
  created_by_id   UUID,
  notes           TEXT,
  created_at      TIMESTAMPTZ DEFAULT NOW(),
  PRIMARY KEY (id, transaction_date)
) PARTITION BY RANGE (transaction_date);

DO $$
BEGIN
  FOR yr IN 2024..2030 LOOP
    EXECUTE format(
      'CREATE TABLE IF NOT EXISTS inventory_ledger_archive_%s PARTITION OF inventory_ledger_archive
       FOR VALUES FROM (%L) TO (%L)',
      yr,
      yr || '-01-01',
      (yr + 1) || '-01-01'
    );
  END LOOP;
END $$;

-- Journal entry line archive (for closed fiscal years)
CREATE TABLE IF NOT EXISTS journal_entry_lines_archive (
  id              UUID NOT NULL,
  journal_entry_id UUID NOT NULL,
  line_number     INT NOT NULL,
  gl_account_id   UUID NOT NULL,
  debit_amount    DECIMAL(18,4) DEFAULT 0,
  credit_amount   DECIMAL(18,4) DEFAULT 0,
  product_id      UUID,
  location_id     UUID,
  cost_center_id  UUID,
  description     TEXT,
  entry_date      DATE NOT NULL,
  PRIMARY KEY (id, entry_date)
) PARTITION BY RANGE (entry_date);

DO $$
BEGIN
  FOR yr IN 2024..2030 LOOP
    EXECUTE format(
      'CREATE TABLE IF NOT EXISTS journal_entry_lines_archive_%s PARTITION OF journal_entry_lines_archive
       FOR VALUES FROM (%L) TO (%L)',
      yr,
      yr || '-01-01',
      (yr + 1) || '-01-01'
    );
  END LOOP;
END $$;


-- ─────────────────────────────────────────────────────────────────────────────
-- 5. SEED SEQUENCES FROM EXISTING DATA
-- ─────────────────────────────────────────────────────────────────────────────

CREATE OR REPLACE FUNCTION seed_sequences_from_existing_data() RETURNS void AS $$
DECLARE
  max_val BIGINT;
  tbl_exists BOOLEAN;
BEGIN
  SELECT EXISTS (SELECT 1 FROM information_schema.tables WHERE table_name = 'purchase_orders') INTO tbl_exists;
  IF tbl_exists THEN
    SELECT COALESCE(MAX(CAST(NULLIF(regexp_replace(order_number, '[^0-9]', '', 'g'), '') AS BIGINT)), 0) INTO max_val FROM purchase_orders;
    PERFORM setval('seq_purchase_order_number', GREATEST(max_val, 1), max_val > 0);
  END IF;

  SELECT EXISTS (SELECT 1 FROM information_schema.tables WHERE table_name = 'goods_receipts') INTO tbl_exists;
  IF tbl_exists THEN
    SELECT COALESCE(MAX(CAST(NULLIF(regexp_replace(receipt_number, '[^0-9]', '', 'g'), '') AS BIGINT)), 0) INTO max_val FROM goods_receipts;
    PERFORM setval('seq_goods_receipt_number', GREATEST(max_val, 1), max_val > 0);
  END IF;

  SELECT EXISTS (SELECT 1 FROM information_schema.tables WHERE table_name = 'work_orders') INTO tbl_exists;
  IF tbl_exists THEN
    SELECT COALESCE(MAX(CAST(NULLIF(regexp_replace(order_number, '[^0-9]', '', 'g'), '') AS BIGINT)), 0) INTO max_val FROM work_orders;
    PERFORM setval('seq_work_order_number', GREATEST(max_val, 1), max_val > 0);
  END IF;

  SELECT EXISTS (SELECT 1 FROM information_schema.tables WHERE table_name = 'material_issues') INTO tbl_exists;
  IF tbl_exists THEN
    SELECT COALESCE(MAX(CAST(NULLIF(regexp_replace(issue_number, '[^0-9]', '', 'g'), '') AS BIGINT)), 0) INTO max_val FROM material_issues;
    PERFORM setval('seq_material_issue_number', GREATEST(max_val, 1), max_val > 0);
  END IF;

  SELECT EXISTS (SELECT 1 FROM information_schema.tables WHERE table_name = 'production_completions') INTO tbl_exists;
  IF tbl_exists THEN
    SELECT COALESCE(MAX(CAST(NULLIF(regexp_replace(completion_number, '[^0-9]', '', 'g'), '') AS BIGINT)), 0) INTO max_val FROM production_completions;
    PERFORM setval('seq_production_completion_number', GREATEST(max_val, 1), max_val > 0);
  END IF;

  SELECT EXISTS (SELECT 1 FROM information_schema.tables WHERE table_name = 'batches') INTO tbl_exists;
  IF tbl_exists THEN
    SELECT COALESCE(MAX(CAST(NULLIF(regexp_replace(batch_number, '[^0-9]', '', 'g'), '') AS BIGINT)), 0) INTO max_val FROM batches;
    PERFORM setval('seq_batch_number', GREATEST(max_val, 1), max_val > 0);
  END IF;

  SELECT EXISTS (SELECT 1 FROM information_schema.tables WHERE table_name = 'inventory_reservations') INTO tbl_exists;
  IF tbl_exists THEN
    SELECT COALESCE(MAX(CAST(NULLIF(regexp_replace(reservation_number, '[^0-9]', '', 'g'), '') AS BIGINT)), 0) INTO max_val FROM inventory_reservations;
    PERFORM setval('seq_reservation_number', GREATEST(max_val, 1), max_val > 0);
  END IF;

  SELECT EXISTS (SELECT 1 FROM information_schema.tables WHERE table_name = 'inventory_holds') INTO tbl_exists;
  IF tbl_exists THEN
    SELECT COALESCE(MAX(CAST(NULLIF(regexp_replace(hold_number, '[^0-9]', '', 'g'), '') AS BIGINT)), 0) INTO max_val FROM inventory_holds;
    PERFORM setval('seq_hold_number', GREATEST(max_val, 1), max_val > 0);
  END IF;

  SELECT EXISTS (SELECT 1 FROM information_schema.tables WHERE table_name = 'journal_entries') INTO tbl_exists;
  IF tbl_exists THEN
    SELECT COALESCE(MAX(CAST(NULLIF(regexp_replace(entry_number, '[^0-9]', '', 'g'), '') AS BIGINT)), 0) INTO max_val FROM journal_entries;
    PERFORM setval('seq_journal_entry_number', GREATEST(max_val, 1), max_val > 0);
  END IF;

  SELECT EXISTS (SELECT 1 FROM information_schema.tables WHERE table_name = 'quality_inspections') INTO tbl_exists;
  IF tbl_exists THEN
    SELECT COALESCE(MAX(CAST(NULLIF(regexp_replace(inspection_number, '[^0-9]', '', 'g'), '') AS BIGINT)), 0) INTO max_val FROM quality_inspections;
    PERFORM setval('seq_inspection_number', GREATEST(max_val, 1), max_val > 0);
  END IF;

  SELECT EXISTS (SELECT 1 FROM information_schema.tables WHERE table_name = 'non_conformance_reports') INTO tbl_exists;
  IF tbl_exists THEN
    SELECT COALESCE(MAX(CAST(NULLIF(regexp_replace(ncr_number, '[^0-9]', '', 'g'), '') AS BIGINT)), 0) INTO max_val FROM non_conformance_reports;
    PERFORM setval('seq_ncr_number', GREATEST(max_val, 1), max_val > 0);
  END IF;

  SELECT EXISTS (SELECT 1 FROM information_schema.tables WHERE table_name = 'corrective_actions') INTO tbl_exists;
  IF tbl_exists THEN
    SELECT COALESCE(MAX(CAST(NULLIF(regexp_replace(capa_number, '[^0-9]', '', 'g'), '') AS BIGINT)), 0) INTO max_val FROM corrective_actions;
    PERFORM setval('seq_capa_number', GREATEST(max_val, 1), max_val > 0);
  END IF;
END;
$$ LANGUAGE plpgsql;

-- Execute the seeding function
SELECT seed_sequences_from_existing_data();
