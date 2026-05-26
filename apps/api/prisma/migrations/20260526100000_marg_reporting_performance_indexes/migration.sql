-- ============================================================================
-- MARG REPORTING PERFORMANCE INDEXES
--
-- Addresses 30-second timeouts on pharma-reports/analysis/*/overview for
-- tenants with large datasets. Root causes identified:
--
--   1. topItems / taxSummary / paymentSummary join marg_vouchers to
--      marg_transactions on (tenant_id, company_id, voucher) but
--      marg_transactions had no index on voucher — full seq scan per voucher.
--
--   2. marg_vouchers WHERE clause filters family = ? AND date BETWEEN ? AND ?
--      but the only index was (tenant_id, date) — family not covered,
--      causing the planner to scan all rows in the date range then check family.
--
--   3. marg_bill_rollup WHERE clause filters family = ? AND date BETWEEN ?
--      but the existing index (tenant_id, date, family) puts family last —
--      planner scans all date-range rows then checks family. A separate
--      (tenant_id, family, date) index lets the planner use family equality
--      as the leading filter (far more selective).
--
-- NOTE: Cannot use CONCURRENTLY inside Prisma migration transactions.
-- ============================================================================

-- ─── marg_transactions: JOIN key from voucher headers ────────────────────────
-- Critical for topItems / taxSummary / paymentSummary which join:
--   marg_vouchers mv JOIN marg_transactions mt
--     ON mt.tenant_id = mv.tenant_id
--     AND mt.company_id = mv.company_id
--     AND mt.voucher = mv.voucher
-- Without this index every voucher header requires a seq scan of transactions.
CREATE INDEX IF NOT EXISTS idx_marg_transactions_tenant_company_voucher
  ON marg_transactions (tenant_id, company_id, voucher);

-- ─── marg_vouchers: family + date covering index ─────────────────────────────
-- The WHERE clause in all live-path queries is:
--   mv.tenant_id = ? AND mv.family = 'PURCHASE_INVOICE' AND mv.date BETWEEN ? AND ?
--   AND mv.is_cancelled = false
-- A (tenant_id, family, date) partial index on non-cancelled rows lets the
-- planner narrow to one family value then do a date range scan — much faster
-- than the existing (tenant_id, date) index which scans all dates first.
CREATE INDEX IF NOT EXISTS idx_marg_vouchers_tenant_family_date
  ON marg_vouchers (tenant_id, family, date)
  WHERE is_cancelled = false;

-- ─── marg_bill_rollup: family-first index for rollup queries ─────────────────
-- The rollup WHERE is:
--   b.tenant_id = ? AND b.family = 'PURCHASE_INVOICE' AND b.date BETWEEN ? AND ?
-- The existing (tenant_id, date, family) index scans all dates then checks
-- family. A (tenant_id, family, date) index uses family equality as the
-- second column — far more selective for invoice-only queries.
CREATE INDEX IF NOT EXISTS idx_marg_bill_rollup_tenant_family_date
  ON marg_bill_rollup (tenant_id, family, date);
