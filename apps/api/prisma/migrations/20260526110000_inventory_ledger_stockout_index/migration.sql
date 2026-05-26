-- ============================================================================
-- INVENTORY LEDGER: STOCK-OUT REPORT PERFORMANCE INDEX
--
-- Fixes 30-second timeouts on /api/reports/stock-out for large tenants.
--
-- Root cause: getStockOutReport scans inventory_ledger with:
--   WHERE tenant_id = ? AND reference_type = 'MARG_EDE'
-- then computes two window functions over the result:
--   1. LAG(running_balance) OVER (PARTITION BY product_id, location_id ORDER BY sequence_number)
--   2. MIN(CASE WHEN ... > 0 THEN transaction_date END) OVER (PARTITION BY product_id, location_id
--        ORDER BY sequence_number ROWS BETWEEN 1 FOLLOWING AND UNBOUNDED FOLLOWING)
-- and a DISTINCT ON scan for current-stock snapshot:
--   ORDER BY product_id, location_id, sequence_number DESC
--
-- The existing indexes are (tenant_id) and (tenant_id, product_id, location_id) —
-- neither covers sequence_number nor the reference_type filter, forcing:
--   a) a full seq scan + filter for all MARG_EDE rows, then
--   b) an explicit sort on (product_id, location_id, sequence_number) for the window
--
-- This partial index covers all three access patterns with a single index scan
-- in the exact order needed, with no sort step:
--
--   • marg_ledger CTE: WHERE tenant_id=? AND reference_type='MARG_EDE'
--     → partial index condition eliminates non-MARG rows at index level
--   • LAG/MIN window: PARTITION BY (product_id, location_id) ORDER BY sequence_number
--     → index column order matches, no sort needed (index scan in order)
--   • DISTINCT ON current-stock: ORDER BY product_id, location_id, sequence_number DESC
--     → same index scanned backward (PostgreSQL supports backward index scans)
--
-- NOTE: Cannot use CONCURRENTLY inside Prisma migration transactions.
-- ============================================================================

CREATE INDEX IF NOT EXISTS idx_inv_ledger_marg_ede_product_seq
  ON inventory_ledger (tenant_id, product_id, location_id, sequence_number)
  WHERE reference_type = 'MARG_EDE';
