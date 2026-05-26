-- ============================================================================
-- SUPPLEMENTARY REPORTING INDEXES
--
-- Fixes slow COUNT queries used across procurement and reporting endpoints.
--
--   1. marg_vouchers (tenant_id, type)
--      Several reporting queries filter by:
--        WHERE tenant_id = ? AND type = 'P'   -- purchase invoices
--        WHERE tenant_id = ? AND type = 'X'   -- purchase orders
--        WHERE tenant_id = ? AND type = 'S'   -- sales invoices
--      The existing indexes are (tenant_id, date) and (tenant_id, family, date).
--      Neither has `type` as the second column, forcing a full tenant row scan
--      followed by type filtering. For tenants with 100k+ vouchers this is slow.
--
--   2. inventory_transactions (tenant_id, reference_type)
--      Queried as:
--        WHERE tenant_id = ? AND reference_type = 'MARG_EDE'
--      Only (tenant_id) index exists — scans all tenant rows then checks
--      reference_type. Partial index on MARG_EDE rows is far smaller.
--
--   3. inventory_ledger (tenant_id, reference_type)
--      Same pattern as inventory_transactions.
--      The existing partial index (tenant_id, product_id, location_id, sequence_number)
--      WHERE reference_type = 'MARG_EDE' already handles the stock-out window
--      function queries; this smaller index handles simple COUNT queries where
--      the planner prefers a covering index scan over the larger composite one.
--
-- NOTE: Cannot use CONCURRENTLY inside Prisma migration transactions.
-- ============================================================================

-- ─── marg_vouchers: type filter ──────────────────────────────────────────────
CREATE INDEX IF NOT EXISTS idx_marg_vouchers_tenant_type
  ON marg_vouchers (tenant_id, type);

-- ─── inventory_transactions: reference_type filter ───────────────────────────
CREATE INDEX IF NOT EXISTS idx_inv_transactions_tenant_ref_type
  ON inventory_transactions (tenant_id, reference_type)
  WHERE reference_type = 'MARG_EDE';

-- ─── inventory_ledger: reference_type filter (for COUNT queries) ──────────────
-- Separate from the large (product, location, sequence_number) index so the
-- planner can pick the smallest index for simple COUNT(*) aggregations.
CREATE INDEX IF NOT EXISTS idx_inv_ledger_tenant_ref_type
  ON inventory_ledger (tenant_id, reference_type)
  WHERE reference_type = 'MARG_EDE';
