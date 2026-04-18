-- ============================================================================
-- PHARMA REPORTING MODULE: Supplementary Indexes
-- These indexes optimize the heavy analytical queries used by the
-- pharma-reports module without altering existing table structures.
-- NOTE: Cannot use CONCURRENTLY inside Prisma migration transactions.
-- ============================================================================

-- ─── BATCHES ────────────────────────────────────────────────────────────────

-- Near-expiry / expired lookups: filter by tenant + expiry + status + qty
CREATE INDEX IF NOT EXISTS idx_batches_expiry_reporting
  ON batches (tenant_id, expiry_date)
  WHERE status NOT IN ('CONSUMED', 'RECALLED') AND quantity > 0;

-- Stock ageing: manufacturing_date based bucketing
CREATE INDEX IF NOT EXISTS idx_batches_mfg_date_reporting
  ON batches (tenant_id, manufacturing_date)
  WHERE status NOT IN ('CONSUMED', 'RECALLED') AND quantity > 0;

-- Batch-wise inventory by product
CREATE INDEX IF NOT EXISTS idx_batches_product_location
  ON batches (tenant_id, product_id, location_id)
  WHERE quantity > 0;

-- FEFO picking: product+location sorted by expiry
CREATE INDEX IF NOT EXISTS idx_batches_fefo
  ON batches (tenant_id, product_id, location_id, expiry_date ASC NULLS LAST)
  WHERE status = 'AVAILABLE' AND available_qty > 0;


-- ─── INVENTORY TRANSACTIONS ────────────────────────────────────────────────

-- Issue-based analytics (ABC, XYZ, COGS, dead stock, avg daily sales)
CREATE INDEX IF NOT EXISTS idx_inv_txn_issue_reporting
  ON inventory_transactions (tenant_id, product_id, location_id, transaction_date)
  WHERE transaction_type IN ('ISSUE', 'PRODUCTION_ISSUE');

-- Receipt tracking for value trend
CREATE INDEX IF NOT EXISTS idx_inv_txn_receipt_reporting
  ON inventory_transactions (tenant_id, transaction_date)
  WHERE transaction_type IN ('RECEIPT', 'ADJUSTMENT_IN', 'RETURN', 'PRODUCTION_RECEIPT');


-- ─── INVENTORY LEDGER ──────────────────────────────────────────────────────

-- Stock-out detection: running balance transitions
CREATE INDEX IF NOT EXISTS idx_inv_ledger_balance
  ON inventory_ledger (tenant_id, product_id, location_id, sequence_number);


-- ─── PURCHASE ORDERS ───────────────────────────────────────────────────────

-- Supplier performance: date-based lookups
CREATE INDEX IF NOT EXISTS idx_po_supplier_date
  ON purchase_orders (tenant_id, supplier_id, order_date)
  WHERE status != 'CANCELLED';


-- ─── GOODS RECEIPTS ────────────────────────────────────────────────────────

-- Lead time calculation: receipt date by PO
CREATE INDEX IF NOT EXISTS idx_gr_po_receipt
  ON goods_receipts (purchase_order_id, receipt_date)
  WHERE status = 'POSTED';
