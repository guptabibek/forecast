-- ============================================================================
-- AI Reporting View Validation
--
-- Run in staging or a controlled production session after applying:
--   apps/api/prisma/migrations/20260512120000_add_ai_reporting_views/migration.sql
--
-- psql example:
--   \set tenant_id '00000000-0000-0000-0000-000000000000'
--   \set company_id 1
--   \set branch_id '00000000-0000-0000-0000-000000000000'
--   \set start_date '2026-04-01'
--   \set end_date '2026-04-30'
--   \i docs/ai-reporting/view-validation.sql
--
-- Do not run EXPLAIN ANALYZE on production peak traffic without DBA approval.
-- ============================================================================

-- Required psql variables:
--   tenant_id, company_id, branch_id, start_date, end_date

-- ---------------------------------------------------------------------------
-- 1. Basic row counts
-- ---------------------------------------------------------------------------

SELECT 'vw_ai_sales_items' AS view_name, COUNT(*)::bigint AS row_count
FROM vw_ai_sales_items
WHERE tenant_id = :'tenant_id'::uuid;

SELECT 'vw_ai_sales_invoices' AS view_name, COUNT(*)::bigint AS row_count
FROM vw_ai_sales_invoices
WHERE tenant_id = :'tenant_id'::uuid;

SELECT 'vw_ai_purchase_items' AS view_name, COUNT(*)::bigint AS row_count
FROM vw_ai_purchase_items
WHERE tenant_id = :'tenant_id'::uuid;

SELECT 'vw_ai_purchase_invoices' AS view_name, COUNT(*)::bigint AS row_count
FROM vw_ai_purchase_invoices
WHERE tenant_id = :'tenant_id'::uuid;

SELECT 'vw_ai_stock_summary' AS view_name, COUNT(*)::bigint AS row_count
FROM vw_ai_stock_summary
WHERE tenant_id = :'tenant_id'::uuid;

SELECT 'vw_ai_stock_batches' AS view_name, COUNT(*)::bigint AS row_count
FROM vw_ai_stock_batches
WHERE tenant_id = :'tenant_id'::uuid;

SELECT 'vw_ai_stock_ledger' AS view_name, COUNT(*)::bigint AS row_count
FROM vw_ai_stock_ledger
WHERE tenant_id = :'tenant_id'::uuid;

SELECT 'vw_ai_party_outstanding' AS view_name, COUNT(*)::bigint AS row_count
FROM vw_ai_party_outstanding
WHERE tenant_id = :'tenant_id'::uuid;

SELECT 'vw_ai_tax_register' AS view_name, COUNT(*)::bigint AS row_count
FROM vw_ai_tax_register
WHERE tenant_id = :'tenant_id'::uuid;

SELECT 'vw_ai_ledger_entries' AS view_name, COUNT(*)::bigint AS row_count
FROM vw_ai_ledger_entries
WHERE tenant_id = :'tenant_id'::uuid;

-- ---------------------------------------------------------------------------
-- 2. Sample output checks
-- ---------------------------------------------------------------------------

SELECT *
FROM vw_ai_sales_items
WHERE tenant_id = :'tenant_id'::uuid
  AND company_id = :company_id
  AND invoice_date BETWEEN :'start_date'::date AND :'end_date'::date
ORDER BY invoice_date DESC, invoice_no
LIMIT 25;

SELECT *
FROM vw_ai_purchase_items
WHERE tenant_id = :'tenant_id'::uuid
  AND company_id = :company_id
  AND invoice_date BETWEEN :'start_date'::date AND :'end_date'::date
ORDER BY invoice_date DESC, invoice_no
LIMIT 25;

SELECT *
FROM vw_ai_stock_summary
WHERE tenant_id = :'tenant_id'::uuid
  AND warehouse_id = :'branch_id'::uuid
ORDER BY ABS(current_stock) DESC, product_code
LIMIT 25;

SELECT *
FROM vw_ai_stock_batches
WHERE tenant_id = :'tenant_id'::uuid
  AND warehouse_id = :'branch_id'::uuid
  AND is_reportable_stock = true
ORDER BY expiry_date ASC NULLS LAST, product_code
LIMIT 25;

SELECT *
FROM vw_ai_party_outstanding
WHERE tenant_id = :'tenant_id'::uuid
  AND company_id = :company_id
  AND is_open = true
ORDER BY outstanding_amount DESC, party_code
LIMIT 25;

-- ---------------------------------------------------------------------------
-- 3. Compare with existing raw report logic
-- ---------------------------------------------------------------------------

-- Sales invoice totals: should match production billRollup semantics.
WITH raw_sales AS (
  SELECT
    mv.company_id || ':' || mv.voucher AS invoice_id,
    COALESCE(MAX(mv.final_amt), SUM(ABS(COALESCE(mt.amount, 0)) + ABS(COALESCE(mt.gst_amount, 0))))::float8 AS raw_net_amount,
    COALESCE(SUM(ABS(COALESCE(mt.gst_amount, 0))), 0)::float8 AS raw_tax_amount,
    COALESCE(SUM(ABS(COALESCE(mt.qty, 0))), 0)::float8 AS raw_quantity
  FROM marg_vouchers mv
  LEFT JOIN marg_transactions mt
    ON mt.tenant_id = mv.tenant_id
   AND mt.company_id = mv.company_id
   AND mt.voucher = mv.voucher
   AND (
     (mv.type = 'S' AND mt.type IN ('G', 'S', 'O'))
     OR (mv.type = 'R' AND mt.type = 'R')
     OR (mv.type = 'T' AND mt.type IN ('X', 'T'))
   )
  WHERE mv.tenant_id = :'tenant_id'::uuid
    AND mv.company_id = :company_id
    AND mv.type IN ('S', 'R', 'T')
    AND mv.date BETWEEN :'start_date'::date AND :'end_date'::date
  GROUP BY mv.company_id, mv.voucher
),
view_sales AS (
  SELECT invoice_id, net_amount, tax_amount, quantity
  FROM vw_ai_sales_invoices
  WHERE tenant_id = :'tenant_id'::uuid
    AND company_id = :company_id
    AND invoice_date BETWEEN :'start_date'::date AND :'end_date'::date
)
SELECT
  COUNT(*) FILTER (WHERE ABS(raw_net_amount - net_amount) > 0.01) AS net_mismatches,
  COUNT(*) FILTER (WHERE ABS(raw_tax_amount - tax_amount) > 0.01) AS tax_mismatches,
  COUNT(*) FILTER (WHERE ABS(raw_quantity - quantity) > 0.0001) AS quantity_mismatches
FROM raw_sales
JOIN view_sales USING (invoice_id);

-- Purchase invoice totals: should match production billRollup semantics.
WITH raw_purchase AS (
  SELECT
    mv.company_id || ':' || mv.voucher AS invoice_id,
    COALESCE(MAX(mv.final_amt), SUM(ABS(COALESCE(mt.amount, 0)) + ABS(COALESCE(mt.gst_amount, 0))))::float8 AS raw_net_amount,
    COALESCE(SUM(ABS(COALESCE(mt.gst_amount, 0))), 0)::float8 AS raw_tax_amount,
    COALESCE(SUM(ABS(COALESCE(mt.qty, 0))), 0)::float8 AS raw_quantity
  FROM marg_vouchers mv
  LEFT JOIN marg_transactions mt
    ON mt.tenant_id = mv.tenant_id
   AND mt.company_id = mv.company_id
   AND mt.voucher = mv.voucher
   AND (
     (mv.type = 'P' AND mt.type = 'P')
     OR (mv.type = 'B' AND mt.type = 'B')
   )
  WHERE mv.tenant_id = :'tenant_id'::uuid
    AND mv.company_id = :company_id
    AND mv.type IN ('P', 'B')
    AND mv.date BETWEEN :'start_date'::date AND :'end_date'::date
  GROUP BY mv.company_id, mv.voucher
),
view_purchase AS (
  SELECT invoice_id, net_amount, tax_amount, quantity
  FROM vw_ai_purchase_invoices
  WHERE tenant_id = :'tenant_id'::uuid
    AND company_id = :company_id
    AND invoice_date BETWEEN :'start_date'::date AND :'end_date'::date
)
SELECT
  COUNT(*) FILTER (WHERE ABS(raw_net_amount - net_amount) > 0.01) AS net_mismatches,
  COUNT(*) FILTER (WHERE ABS(raw_tax_amount - tax_amount) > 0.01) AS tax_mismatches,
  COUNT(*) FILTER (WHERE ABS(raw_quantity - quantity) > 0.0001) AS quantity_mismatches
FROM raw_purchase
JOIN view_purchase USING (invoice_id);

-- Current stock totals: should match inventory_levels for the same branch.
SELECT
  (SELECT COALESCE(SUM(on_hand_qty), 0)::float8
   FROM inventory_levels
   WHERE tenant_id = :'tenant_id'::uuid
     AND location_id = :'branch_id'::uuid) AS raw_on_hand_qty,
  (SELECT COALESCE(SUM(current_stock), 0)::float8
   FROM vw_ai_stock_summary
   WHERE tenant_id = :'tenant_id'::uuid
     AND warehouse_id = :'branch_id'::uuid) AS view_on_hand_qty;

-- Batch reportable rows: should match existing batch inventory base filter.
SELECT
  (SELECT COUNT(*)::bigint
   FROM batches
   WHERE tenant_id = :'tenant_id'::uuid
     AND location_id = :'branch_id'::uuid
     AND status NOT IN ('CONSUMED', 'RECALLED')
     AND quantity <> 0) AS raw_batch_count,
  (SELECT COUNT(*)::bigint
   FROM vw_ai_stock_batches
   WHERE tenant_id = :'tenant_id'::uuid
     AND warehouse_id = :'branch_id'::uuid
     AND is_reportable_stock = true) AS view_batch_count;

-- Outstanding exposure: should match Marg outstanding sign convention.
SELECT
  party_type,
  COUNT(*)::bigint AS rows,
  SUM(outstanding_amount)::float8 AS outstanding_amount,
  SUM(credit_balance)::float8 AS credit_balance
FROM vw_ai_party_outstanding
WHERE tenant_id = :'tenant_id'::uuid
  AND company_id = :company_id
  AND is_open = true
GROUP BY party_type
ORDER BY party_type;

-- Core GL totals: trial balance should balance for posted core GL lines.
SELECT
  SUM(debit_amount)::float8 AS total_debits,
  SUM(credit_amount)::float8 AS total_credits,
  (SUM(debit_amount) - SUM(credit_amount))::float8 AS net_difference
FROM vw_ai_ledger_entries
WHERE tenant_id = :'tenant_id'::uuid
  AND ledger_source = 'CORE_GL'
  AND status = 'POSTED'
  AND entry_date BETWEEN :'start_date'::date AND :'end_date'::date;

-- ---------------------------------------------------------------------------
-- 4. Null checks for important dimensions
-- ---------------------------------------------------------------------------

SELECT 'vw_ai_sales_items' AS view_name,
  COUNT(*) FILTER (WHERE invoice_id IS NULL) AS missing_invoice_id,
  COUNT(*) FILTER (WHERE invoice_date IS NULL) AS missing_invoice_date,
  COUNT(*) FILTER (WHERE product_code IS NULL) AS missing_product_code,
  COUNT(*) FILTER (WHERE customer_code IS NULL) AS missing_customer_code
FROM vw_ai_sales_items
WHERE tenant_id = :'tenant_id'::uuid
  AND company_id = :company_id
  AND invoice_date BETWEEN :'start_date'::date AND :'end_date'::date;

SELECT 'vw_ai_purchase_items' AS view_name,
  COUNT(*) FILTER (WHERE invoice_id IS NULL) AS missing_invoice_id,
  COUNT(*) FILTER (WHERE invoice_date IS NULL) AS missing_invoice_date,
  COUNT(*) FILTER (WHERE product_code IS NULL) AS missing_product_code,
  COUNT(*) FILTER (WHERE supplier_code IS NULL) AS missing_supplier_code
FROM vw_ai_purchase_items
WHERE tenant_id = :'tenant_id'::uuid
  AND company_id = :company_id
  AND invoice_date BETWEEN :'start_date'::date AND :'end_date'::date;

SELECT 'vw_ai_stock_summary' AS view_name,
  COUNT(*) FILTER (WHERE product_id IS NULL) AS missing_product_id,
  COUNT(*) FILTER (WHERE warehouse_id IS NULL) AS missing_warehouse_id,
  COUNT(*) FILTER (WHERE product_code IS NULL) AS missing_product_code
FROM vw_ai_stock_summary
WHERE tenant_id = :'tenant_id'::uuid;

SELECT 'vw_ai_stock_batches' AS view_name,
  COUNT(*) FILTER (WHERE product_id IS NULL) AS missing_product_id,
  COUNT(*) FILTER (WHERE warehouse_id IS NULL) AS missing_warehouse_id,
  COUNT(*) FILTER (WHERE batch_no IS NULL) AS missing_batch_no
FROM vw_ai_stock_batches
WHERE tenant_id = :'tenant_id'::uuid;

-- ---------------------------------------------------------------------------
-- 5. Company, branch, and status filter checks
-- ---------------------------------------------------------------------------

SELECT 'sales_company_filter' AS check_name, COUNT(*)::bigint AS rows
FROM vw_ai_sales_invoices
WHERE tenant_id = :'tenant_id'::uuid
  AND company_id = :company_id
  AND invoice_date BETWEEN :'start_date'::date AND :'end_date'::date;

SELECT 'sales_branch_filter' AS check_name, COUNT(*)::bigint AS rows
FROM vw_ai_sales_invoices
WHERE tenant_id = :'tenant_id'::uuid
  AND branch_id = :'branch_id'::uuid
  AND invoice_date BETWEEN :'start_date'::date AND :'end_date'::date;

SELECT status, COUNT(*)::bigint AS rows, SUM(net_amount)::float8 AS net_amount
FROM vw_ai_sales_invoices
WHERE tenant_id = :'tenant_id'::uuid
  AND company_id = :company_id
  AND invoice_date BETWEEN :'start_date'::date AND :'end_date'::date
GROUP BY status
ORDER BY status;

SELECT status, COUNT(*)::bigint AS rows, SUM(net_amount)::float8 AS net_amount
FROM vw_ai_purchase_invoices
WHERE tenant_id = :'tenant_id'::uuid
  AND company_id = :company_id
  AND invoice_date BETWEEN :'start_date'::date AND :'end_date'::date
GROUP BY status
ORDER BY status;

-- ---------------------------------------------------------------------------
-- 6. Performance checks for realistic filters
-- ---------------------------------------------------------------------------

EXPLAIN (ANALYZE, BUFFERS)
SELECT customer_code, customer_name, SUM(net_amount)::float8 AS sales_amount
FROM vw_ai_sales_invoices
WHERE tenant_id = :'tenant_id'::uuid
  AND company_id = :company_id
  AND invoice_date BETWEEN :'start_date'::date AND :'end_date'::date
GROUP BY customer_code, customer_name
ORDER BY sales_amount DESC
LIMIT 50;

EXPLAIN (ANALYZE, BUFFERS)
SELECT product_code, product_name, SUM(quantity)::float8 AS purchase_quantity, SUM(net_amount)::float8 AS purchase_amount
FROM vw_ai_purchase_items
WHERE tenant_id = :'tenant_id'::uuid
  AND company_id = :company_id
  AND invoice_date BETWEEN :'start_date'::date AND :'end_date'::date
GROUP BY product_code, product_name
ORDER BY purchase_amount DESC
LIMIT 50;

EXPLAIN (ANALYZE, BUFFERS)
SELECT product_code, product_name, warehouse_name, current_stock, reorder_level, stock_status
FROM vw_ai_stock_summary
WHERE tenant_id = :'tenant_id'::uuid
  AND warehouse_id = :'branch_id'::uuid
  AND stock_status IN ('BELOW_MINIMUM', 'BELOW_REORDER', 'NEGATIVE')
ORDER BY stock_status, product_code
LIMIT 100;

EXPLAIN (ANALYZE, BUFFERS)
SELECT product_code, product_name, batch_no, expiry_date, days_to_expiry, current_stock, stock_value
FROM vw_ai_stock_batches
WHERE tenant_id = :'tenant_id'::uuid
  AND warehouse_id = :'branch_id'::uuid
  AND is_reportable_stock = true
  AND expiry_date <= CURRENT_DATE + INTERVAL '90 days'
ORDER BY expiry_date ASC NULLS LAST
LIMIT 100;

EXPLAIN (ANALYZE, BUFFERS)
SELECT party_code, party_name, SUM(outstanding_amount)::float8 AS outstanding_amount
FROM vw_ai_party_outstanding
WHERE tenant_id = :'tenant_id'::uuid
  AND company_id = :company_id
  AND party_type = 'CUSTOMER'
  AND is_open = true
GROUP BY party_code, party_name
ORDER BY outstanding_amount DESC
LIMIT 50;
