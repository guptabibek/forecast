-- ============================================================================
-- AI Reporting (NLQ) — returns datasets (Part 2b).
--
-- Adds item-level views for the RETURN families so NLQ can answer
-- "show me sales returns in April", "top returned products", "which customer
-- returned the most", etc. — the questions that became unanswerable when the
-- invoice views went pure-invoice-only in Part 1.
--
-- Symmetry with the pure-invoice views (20260522100000):
--   * Same column shape as vw_ai_sales_items / vw_ai_purchase_items, so the
--     catalog can reuse the same dimensions and column patterns.
--   * Amounts are ABS (positive) — a returns report counts UP. (Net-of-returns
--     is served by the dashboard's scope=net; a signed NLQ net view is a
--     future addition.)
--   * Family filter is the decisive gate: sales returns = SALES_RETURN +
--     SALES_BRK_EXP_RECEIVE; purchase returns = PURCHASE_RETURN +
--     PURCHASE_BRK_EXP_RETURN. These mirror SALES_RETURN_FAMILIES /
--     PURCHASE_RETURN_FAMILIES in sales-purchase-analysis.service.ts, so NLQ
--     returns numbers equal the dashboard's scope=return totals.
--   * Cancelled vouchers excluded at source; is_cancelled exposed real.
--   * Line-type join + family use UPPER(mv.type) for lowercase-variant safety.
--
-- document_type is the constant family label for the dataset ('SALES_RETURN' /
-- 'PURCHASE_RETURN'); status is always 'RETURN' here.
-- ============================================================================

CREATE OR REPLACE VIEW vw_ai_sales_returns AS
SELECT
  mv.tenant_id,
  mv.company_id,
  mb.location_id AS branch_id,
  mb.code AS branch_code,
  COALESCE(mb.name, mb.branch, 'Company ' || mv.company_id::text) AS branch_name,
  fper.fiscal_year AS financial_year,
  fper.fiscal_period_name,
  fper.fiscal_month,
  (mv.company_id::text || ':' || mv.voucher) AS invoice_id,
  mv.voucher AS source_voucher_no,
  COALESCE(mv.vcn, mv.voucher) AS invoice_no,
  mv.date AS invoice_date,
  mv.type AS voucher_type,
  'SALES_RETURN'::varchar AS document_type,
  mp.customer_id,
  mv.cid AS customer_code,
  COALESCE(mp.par_name, c.name, mv.cid, 'Unmapped Party') AS customer_name,
  mp.gst_no AS customer_gst_no,
  mp.par_addr AS customer_address,
  mp.route AS route_code,
  mp.area AS area_code,
  NULLIF(TRIM(COALESCE(mv.salesman, mv.mr, mp.mr)), '') AS salesman_code,
  COALESCE(
    sm.name,
    NULLIF(TRIM(REGEXP_REPLACE(smp.par_name, '[[:cntrl:]]', '', 'g')), ''),
    CASE
      WHEN NULLIF(TRIM(COALESCE(mv.salesman, mv.mr, mp.mr)), '') IS NULL THEN NULL
      ELSE 'Unknown salesman (' || NULLIF(TRIM(COALESCE(mv.salesman, mv.mr, mp.mr)), '') || ')'
    END
  ) AS salesman_name,
  p.id AS product_id,
  mt.pid AS marg_product_pid,
  COALESCE(p.code, mprod.code, mt.pid) AS product_code,
  COALESCE(p.name, mprod.name, 'Unmapped Item') AS product_name,
  NULLIF(TRIM(COALESCE(p.product_group, mprod.g_code5)), '') AS product_group,
  NULLIF(TRIM(p.category), '') AS product_category,
  NULLIF(TRIM(COALESCE(p.product_company, mprod.g_code)), '') AS product_company,
  pc.name AS product_company_name,
  NULLIF(TRIM(COALESCE(p.salt, mprod.g_code3)), '') AS salt,
  ps.name AS salt_name,
  p.hsn_code,
  mt.batch AS batch_no,
  ms.expiry AS expiry_date,
  mb.location_id AS warehouse_id,
  COALESCE(mb.name, mb.branch, 'Company ' || mv.company_id::text) AS warehouse,
  NULLIF(TRIM(COALESCE(p.unit_of_measure, mprod.unit)), '') AS uom_code,
  uom.name AS uom_name,
  ABS(COALESCE(mt.qty, 0))::float8 AS quantity,
  COALESCE(mt.free, 0)::float8 AS free_quantity,
  COALESCE(mt.rate, 0)::float8 AS rate,
  COALESCE(mt.mrp, 0)::float8 AS mrp,
  (ABS(COALESCE(mt.qty, 0)) * COALESCE(mt.rate, 0))::float8 AS gross_amount,
  GREATEST(ABS(COALESCE(mt.qty, 0)) * COALESCE(mt.rate, 0) - ABS(COALESCE(mt.amount, 0)), 0)::float8 AS discount_amount,
  ABS(COALESCE(mt.amount, 0))::float8 AS line_amount,
  CASE WHEN COALESCE(mt.gst, 0) > 0 THEN ABS(COALESCE(mt.amount, 0)) ELSE 0 END::float8 AS taxable_amount,
  CASE WHEN COALESCE(mt.gst, 0) = 0 THEN ABS(COALESCE(mt.amount, 0)) ELSE 0 END::float8 AS non_taxable_amount,
  COALESCE(mt.gst, 0)::float8 AS tax_rate,
  ABS(COALESCE(mt.gst_amount, 0))::float8 AS tax_amount,
  (ABS(COALESCE(mt.amount, 0)) + ABS(COALESCE(mt.gst_amount, 0)))::float8 AS net_amount,
  COALESCE(ms.p_rate, ms.lp_rate, p.standard_cost, 0)::float8 AS cost_rate,
  (ABS(COALESCE(mt.qty, 0)) * COALESCE(ms.p_rate, ms.lp_rate, p.standard_cost, 0))::float8 AS cost_amount,
  mv.final_amt::float8 AS voucher_final_amount,
  'RETURN'::text AS status,
  mv.is_cancelled AS is_cancelled,
  mt.id AS source_transaction_id,
  mt.source_key AS source_transaction_key,
  mv.id AS source_voucher_id,
  mt.add_field AS source_transaction_add_field,
  mv.add_field AS source_voucher_add_field
FROM marg_vouchers mv
JOIN marg_transactions mt
  ON mt.tenant_id = mv.tenant_id
 AND mt.company_id = mv.company_id
 AND mt.voucher = mv.voucher
 -- Sales-return headers (R = Credit Note, W = BRK/EXP receive) pair with
 -- R / W line types (per the V2 production audit). UPPER for case-safety.
 AND (UPPER(mv.type) IN ('R', 'W') AND mt.type IN ('R', 'W'))
LEFT JOIN marg_products mprod ON mprod.tenant_id = mt.tenant_id AND mprod.company_id = mt.company_id AND mprod.pid = mt.pid
LEFT JOIN products p ON p.id = mprod.product_id AND p.tenant_id = mt.tenant_id
LEFT JOIN product_companies pc ON pc.tenant_id = mt.tenant_id AND pc.code = NULLIF(TRIM(COALESCE(p.product_company, mprod.g_code)), '')
LEFT JOIN product_salts ps ON ps.tenant_id = mt.tenant_id AND ps.code = NULLIF(TRIM(COALESCE(p.salt, mprod.g_code3)), '')
LEFT JOIN unit_of_measures uom ON uom.tenant_id = mt.tenant_id AND uom.code = NULLIF(TRIM(COALESCE(p.unit_of_measure, mprod.unit)), '')
LEFT JOIN marg_parties mp ON mp.tenant_id = mv.tenant_id AND mp.company_id = mv.company_id AND mp.cid = mv.cid
LEFT JOIN customers c ON c.id = mp.customer_id AND c.tenant_id = mv.tenant_id
LEFT JOIN marg_branches mb ON mb.tenant_id = mv.tenant_id AND mb.company_id = mv.company_id
LEFT JOIN salesmen sm ON sm.tenant_id = mv.tenant_id AND sm.code = NULLIF(TRIM(COALESCE(mv.salesman, mv.mr, mp.mr)), '')
LEFT JOIN marg_parties smp ON smp.tenant_id = mv.tenant_id AND smp.company_id = mv.company_id AND smp.cid = NULLIF(TRIM(COALESCE(mv.salesman, mv.mr, mp.mr)), '') AND smp.is_deleted = false
LEFT JOIN LATERAL (
  SELECT fp.fiscal_year::text AS fiscal_year, fp.period_name AS fiscal_period_name, fp.fiscal_month
  FROM fiscal_calendars fc
  JOIN fiscal_periods fp ON fp.calendar_id = fc.id
  WHERE fc.tenant_id = mv.tenant_id AND fc.is_default = true AND mv.date BETWEEN fp.start_date AND fp.end_date
  ORDER BY fc.updated_at DESC, fp.start_date DESC
  LIMIT 1
) fper ON TRUE
LEFT JOIN LATERAL (
  SELECT expiry, p_rate, lp_rate
  FROM marg_stocks ms
  WHERE ms.tenant_id = mt.tenant_id AND ms.company_id = mt.company_id AND ms.pid = mt.pid
    AND (mt.batch IS NULL OR ms.batch = mt.batch)
  ORDER BY CASE WHEN mt.batch IS NOT NULL AND ms.batch = mt.batch THEN 0 ELSE 1 END, ms.updated_at DESC
  LIMIT 1
) ms ON TRUE
WHERE mv.family IN ('SALES_RETURN', 'SALES_BRK_EXP_RECEIVE')
  AND mv.is_cancelled = FALSE;

CREATE OR REPLACE VIEW vw_ai_purchase_returns AS
SELECT
  mv.tenant_id,
  mv.company_id,
  mb.location_id AS branch_id,
  mb.code AS branch_code,
  COALESCE(mb.name, mb.branch, 'Company ' || mv.company_id::text) AS branch_name,
  fper.fiscal_year AS financial_year,
  fper.fiscal_period_name,
  fper.fiscal_month,
  (mv.company_id::text || ':' || mv.voucher) AS invoice_id,
  mv.voucher AS source_voucher_no,
  COALESCE(mv.vcn, mv.voucher) AS invoice_no,
  mv.date AS invoice_date,
  mv.type AS voucher_type,
  'PURCHASE_RETURN'::varchar AS document_type,
  s.id AS supplier_id,
  mv.cid AS supplier_code,
  COALESCE(mp.par_name, s.name, mv.cid, 'Unmapped Party') AS supplier_name,
  mp.gst_no AS supplier_gst_no,
  mp.par_addr AS supplier_address,
  p.id AS product_id,
  mt.pid AS marg_product_pid,
  COALESCE(p.code, mprod.code, mt.pid) AS product_code,
  COALESCE(p.name, mprod.name, 'Unmapped Item') AS product_name,
  NULLIF(TRIM(COALESCE(p.product_group, mprod.g_code5)), '') AS product_group,
  NULLIF(TRIM(p.category), '') AS product_category,
  NULLIF(TRIM(COALESCE(p.product_company, mprod.g_code)), '') AS product_company,
  pc.name AS product_company_name,
  NULLIF(TRIM(COALESCE(p.salt, mprod.g_code3)), '') AS salt,
  ps.name AS salt_name,
  p.hsn_code,
  mt.batch AS batch_no,
  ms.expiry AS expiry_date,
  mb.location_id AS warehouse_id,
  COALESCE(mb.name, mb.branch, 'Company ' || mv.company_id::text) AS warehouse,
  NULLIF(TRIM(COALESCE(p.unit_of_measure, mprod.unit)), '') AS uom_code,
  uom.name AS uom_name,
  ABS(COALESCE(mt.qty, 0))::float8 AS quantity,
  COALESCE(mt.free, 0)::float8 AS free_quantity,
  COALESCE(mt.rate, 0)::float8 AS rate,
  COALESCE(mt.mrp, 0)::float8 AS mrp,
  (ABS(COALESCE(mt.qty, 0)) * COALESCE(mt.rate, 0))::float8 AS gross_amount,
  GREATEST(ABS(COALESCE(mt.qty, 0)) * COALESCE(mt.rate, 0) - ABS(COALESCE(mt.amount, 0)), 0)::float8 AS discount_amount,
  ABS(COALESCE(mt.amount, 0))::float8 AS line_amount,
  CASE WHEN COALESCE(mt.gst, 0) > 0 THEN ABS(COALESCE(mt.amount, 0)) ELSE 0 END::float8 AS taxable_amount,
  CASE WHEN COALESCE(mt.gst, 0) = 0 THEN ABS(COALESCE(mt.amount, 0)) ELSE 0 END::float8 AS non_taxable_amount,
  COALESCE(mt.gst, 0)::float8 AS tax_rate,
  ABS(COALESCE(mt.gst_amount, 0))::float8 AS tax_amount,
  (ABS(COALESCE(mt.amount, 0)) + ABS(COALESCE(mt.gst_amount, 0)))::float8 AS net_amount,
  COALESCE(ms.p_rate, ms.lp_rate, p.standard_cost, 0)::float8 AS landed_cost_rate,
  mv.final_amt::float8 AS voucher_final_amount,
  'RETURN'::text AS status,
  mv.is_cancelled AS is_cancelled,
  mt.id AS source_transaction_id,
  mt.source_key AS source_transaction_key,
  mv.id AS source_voucher_id,
  mt.add_field AS source_transaction_add_field,
  mv.add_field AS source_voucher_add_field
FROM marg_vouchers mv
JOIN marg_transactions mt
  ON mt.tenant_id = mv.tenant_id
 AND mt.company_id = mv.company_id
 AND mt.voucher = mv.voucher
 -- Purchase-return headers (B = Debit Note, Q = BRK/EXP return) pair with
 -- B / Q line types. UPPER for case-safety.
 AND (UPPER(mv.type) IN ('B', 'Q') AND mt.type IN ('B', 'Q'))
LEFT JOIN marg_products mprod ON mprod.tenant_id = mt.tenant_id AND mprod.company_id = mt.company_id AND mprod.pid = mt.pid
LEFT JOIN products p ON p.id = mprod.product_id AND p.tenant_id = mt.tenant_id
LEFT JOIN product_companies pc ON pc.tenant_id = mt.tenant_id AND pc.code = NULLIF(TRIM(COALESCE(p.product_company, mprod.g_code)), '')
LEFT JOIN product_salts ps ON ps.tenant_id = mt.tenant_id AND ps.code = NULLIF(TRIM(COALESCE(p.salt, mprod.g_code3)), '')
LEFT JOIN unit_of_measures uom ON uom.tenant_id = mt.tenant_id AND uom.code = NULLIF(TRIM(COALESCE(p.unit_of_measure, mprod.unit)), '')
LEFT JOIN marg_parties mp ON mp.tenant_id = mv.tenant_id AND mp.company_id = mv.company_id AND mp.cid = mv.cid
LEFT JOIN LATERAL (
  SELECT s.id, s.name
  FROM suppliers s
  WHERE s.tenant_id = mv.tenant_id
    AND (s.code = mv.cid OR s.external_id = ('marg:' || mv.company_id::text || ':' || mv.cid))
  ORDER BY CASE WHEN s.code = mv.cid THEN 0 ELSE 1 END, s.updated_at DESC
  LIMIT 1
) s ON TRUE
LEFT JOIN marg_branches mb ON mb.tenant_id = mv.tenant_id AND mb.company_id = mv.company_id
LEFT JOIN LATERAL (
  SELECT fp.fiscal_year::text AS fiscal_year, fp.period_name AS fiscal_period_name, fp.fiscal_month
  FROM fiscal_calendars fc
  JOIN fiscal_periods fp ON fp.calendar_id = fc.id
  WHERE fc.tenant_id = mv.tenant_id AND fc.is_default = true AND mv.date BETWEEN fp.start_date AND fp.end_date
  ORDER BY fc.updated_at DESC, fp.start_date DESC
  LIMIT 1
) fper ON TRUE
LEFT JOIN LATERAL (
  SELECT expiry, p_rate, lp_rate
  FROM marg_stocks ms
  WHERE ms.tenant_id = mt.tenant_id AND ms.company_id = mt.company_id AND ms.pid = mt.pid
    AND (mt.batch IS NULL OR ms.batch = mt.batch)
  ORDER BY CASE WHEN mt.batch IS NOT NULL AND ms.batch = mt.batch THEN 0 ELSE 1 END, ms.updated_at DESC
  LIMIT 1
) ms ON TRUE
WHERE mv.family IN ('PURCHASE_RETURN', 'PURCHASE_BRK_EXP_RETURN')
  AND mv.is_cancelled = FALSE;
