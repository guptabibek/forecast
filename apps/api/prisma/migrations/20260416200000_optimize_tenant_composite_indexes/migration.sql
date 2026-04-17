-- Optimize bare single-column indexes to tenant-prefixed composite indexes
-- for multi-tenant query performance. In a shared-schema multi-tenant DB,
-- every query filters by tenant_id; bare indexes on status/productId/etc.
-- force full index scans across all tenants.

-- ============================================================
-- WorkOrder: replace bare productId, status with tenant-composite
-- ============================================================
DROP INDEX IF EXISTS "work_orders_product_id_idx";
DROP INDEX IF EXISTS "work_orders_status_idx";
CREATE INDEX IF NOT EXISTS "work_orders_tenant_id_status_idx" ON "work_orders"("tenant_id", "status");
CREATE INDEX IF NOT EXISTS "work_orders_tenant_id_product_id_idx" ON "work_orders"("tenant_id", "product_id");
CREATE INDEX IF NOT EXISTS "work_orders_tenant_id_location_id_idx" ON "work_orders"("tenant_id", "location_id");

-- ============================================================
-- PurchaseOrder: replace bare supplierId, status with tenant-composite
-- ============================================================
DROP INDEX IF EXISTS "purchase_orders_supplier_id_idx";
DROP INDEX IF EXISTS "purchase_orders_status_idx";
CREATE INDEX IF NOT EXISTS "purchase_orders_tenant_id_status_idx" ON "purchase_orders"("tenant_id", "status");
CREATE INDEX IF NOT EXISTS "purchase_orders_tenant_id_supplier_id_idx" ON "purchase_orders"("tenant_id", "supplier_id");

-- ============================================================
-- InventoryTransaction: replace bare productId, transactionType, transactionDate
-- ============================================================
DROP INDEX IF EXISTS "inventory_transactions_product_id_idx";
DROP INDEX IF EXISTS "inventory_transactions_transaction_type_idx";
DROP INDEX IF EXISTS "inventory_transactions_transaction_date_idx";
CREATE INDEX IF NOT EXISTS "inventory_transactions_tenant_id_transaction_date_idx" ON "inventory_transactions"("tenant_id", "transaction_date");
CREATE INDEX IF NOT EXISTS "inventory_transactions_tenant_id_transaction_type_idx" ON "inventory_transactions"("tenant_id", "transaction_type");
CREATE INDEX IF NOT EXISTS "inventory_transactions_tenant_id_product_id_transaction_date_idx" ON "inventory_transactions"("tenant_id", "product_id", "transaction_date");

-- ============================================================
-- ForecastRun: add createdAt sort index
-- ============================================================
CREATE INDEX IF NOT EXISTS "forecast_runs_tenant_id_created_at_idx" ON "forecast_runs"("tenant_id", "created_at");

-- ============================================================
-- ForecastOverride: add composite for reconciliation hot path
-- ============================================================
CREATE INDEX IF NOT EXISTS "forecast_overrides_tenant_id_forecast_run_id_status_idx" ON "forecast_overrides"("tenant_id", "forecast_run_id", "status");

-- ============================================================
-- User: add createdAt sort index for paginated listings
-- ============================================================
CREATE INDEX IF NOT EXISTS "users_tenant_id_created_at_idx" ON "users"("tenant_id", "created_at");

-- ============================================================
-- PlannedOrder: replace bare productId, status with tenant-composite
-- ============================================================
DROP INDEX IF EXISTS "planned_orders_product_id_idx";
DROP INDEX IF EXISTS "planned_orders_status_idx";
CREATE INDEX IF NOT EXISTS "planned_orders_tenant_id_product_id_idx" ON "planned_orders"("tenant_id", "product_id");
CREATE INDEX IF NOT EXISTS "planned_orders_tenant_id_status_idx" ON "planned_orders"("tenant_id", "status");

-- ============================================================
-- Batch: replace bare productId, status, expiryDate with tenant-composite
-- ============================================================
DROP INDEX IF EXISTS "batches_product_id_idx";
DROP INDEX IF EXISTS "batches_status_idx";
DROP INDEX IF EXISTS "batches_expiry_date_idx";
CREATE INDEX IF NOT EXISTS "batches_tenant_id_product_id_idx" ON "batches"("tenant_id", "product_id");
CREATE INDEX IF NOT EXISTS "batches_tenant_id_status_idx" ON "batches"("tenant_id", "status");
CREATE INDEX IF NOT EXISTS "batches_tenant_id_expiry_date_idx" ON "batches"("tenant_id", "expiry_date");

-- ============================================================
-- InventoryReservation: replace bare status, productId+locationId
-- ============================================================
DROP INDEX IF EXISTS "inventory_reservations_product_id_location_id_idx";
DROP INDEX IF EXISTS "inventory_reservations_status_idx";
CREATE INDEX IF NOT EXISTS "inventory_reservations_tenant_id_product_id_location_id_idx" ON "inventory_reservations"("tenant_id", "product_id", "location_id");
CREATE INDEX IF NOT EXISTS "inventory_reservations_tenant_id_status_idx" ON "inventory_reservations"("tenant_id", "status");

-- ============================================================
-- InventoryHold: replace bare status, productId+locationId
-- ============================================================
DROP INDEX IF EXISTS "inventory_holds_product_id_location_id_idx";
DROP INDEX IF EXISTS "inventory_holds_status_idx";
CREATE INDEX IF NOT EXISTS "inventory_holds_tenant_id_product_id_location_id_idx" ON "inventory_holds"("tenant_id", "product_id", "location_id");
CREATE INDEX IF NOT EXISTS "inventory_holds_tenant_id_status_idx" ON "inventory_holds"("tenant_id", "status");

-- ============================================================
-- InventoryLevel: replace bare productId with tenant+locationId
-- ============================================================
DROP INDEX IF EXISTS "inventory_levels_product_id_idx";
CREATE INDEX IF NOT EXISTS "inventory_levels_tenant_id_location_id_idx" ON "inventory_levels"("tenant_id", "location_id");

-- ============================================================
-- InventoryLedger: replace bare productId+locationId with tenant-composite
-- ============================================================
DROP INDEX IF EXISTS "inventory_ledger_product_id_location_id_idx";
CREATE INDEX IF NOT EXISTS "inventory_ledger_tenant_id_product_id_location_id_idx" ON "inventory_ledger"("tenant_id", "product_id", "location_id");

-- ============================================================
-- QualityInspection: add createdAt sort index
-- ============================================================
CREATE INDEX IF NOT EXISTS "quality_inspections_tenant_id_created_at_idx" ON "quality_inspections"("tenant_id", "created_at");

-- ============================================================
-- NonConformanceReport: replace bare productId, add createdAt
-- ============================================================
DROP INDEX IF EXISTS "non_conformance_reports_product_id_idx";
CREATE INDEX IF NOT EXISTS "non_conformance_reports_tenant_id_product_id_idx" ON "non_conformance_reports"("tenant_id", "product_id");
CREATE INDEX IF NOT EXISTS "non_conformance_reports_tenant_id_created_at_idx" ON "non_conformance_reports"("tenant_id", "created_at");

-- ============================================================
-- CorrectiveAction: add createdAt sort index
-- ============================================================
CREATE INDEX IF NOT EXISTS "corrective_actions_tenant_id_created_at_idx" ON "corrective_actions"("tenant_id", "created_at");

-- ============================================================
-- DataImport: add createdAt sort index
-- ============================================================
CREATE INDEX IF NOT EXISTS "data_imports_tenant_id_created_at_idx" ON "data_imports"("tenant_id", "created_at");

-- ============================================================
-- JournalEntry: add createdAt sort index
-- ============================================================
CREATE INDEX IF NOT EXISTS "journal_entries_tenant_id_created_at_idx" ON "journal_entries"("tenant_id", "created_at");
