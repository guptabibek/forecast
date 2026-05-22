-- ============================================================================
-- AI Reporting (NLQ) views — realign with the marg_vouchers.family classifier
-- and the pure-invoice-only product decision.
--
-- WHY
-- ---
-- The original AI views (20260512120000) were written before the family
-- classifier and used raw `mv.type` heuristics:
--   * vw_ai_sales_items:    WHERE mv.type IN ('S','R','T')  (challans NOT excluded;
--                           type T counted as SALES_RETURN; type W invisible;
--                           lowercase 'v' invoices excluded by case-sensitive match)
--   * vw_ai_purchase_items: WHERE mv.type IN ('P','B')      (type Q invisible)
--   * is_cancelled hardcoded NULL on every row, so the catalog default filter
--     `is_cancelled IS DISTINCT FROM true` passed 100% of rows — cancelled
--     vouchers leaked into every NLQ answer.
--
-- Net effect: NLQ `net_sales = SUM(net_amount)` summed sales + returns +
-- challans + SC adjustments as positives, disagreeing with the Sales/Purchase
-- Analysis dashboard. Two surfaces, two answers.
--
-- WHAT CHANGES
-- ------------
-- Re-create the two item-level views to match the dashboard EXACTLY:
--   * Filter on classifier output: family = 'SALES_INVOICE' /
--     'PURCHASE_INVOICE' — pure commercial invoices only. Returns, challans,
--     challan-returns, BRK/EXP (W/Q), and accounting adjustments (T/U) are
--     excluded, identical to SalesPurchaseAnalysisService's pure-invoice mode.
--   * Exclude cancelled vouchers at the source (mv.is_cancelled = FALSE) and
--     expose the real is_cancelled value instead of NULL.
--   * UPPER(mv.type) in the line-type join and in the document_type / status
--     CASE expressions, so lowercase header variants behave like uppercase
--     (mirrors the classifier's UPPER rule).
--
-- The three dependent views are NOT re-created here and need no change:
--   * vw_ai_sales_invoices    (SELECT … FROM vw_ai_sales_items)
--   * vw_ai_purchase_invoices (SELECT … FROM vw_ai_purchase_items)
--   * vw_ai_tax_register      (SELECT … FROM vw_ai_sales_items / _purchase_items)
-- They query the item views live (not materialized) and inherit the corrected
-- filtering automatically.
--
-- COLUMN-TYPE CONTRACT (why CREATE OR REPLACE is safe with dependents)
-- -------------------------------------------------------------------
-- Postgres forbids CREATE OR REPLACE VIEW from changing a column's name, type,
-- or order, and the three dependent views above reference document_type
-- (varchar), status (text), and is_cancelled (boolean). To stay byte-compatible:
--   * document_type / status keep their ORIGINAL CASE expressions verbatim
--     (only UPPER() added inside the WHEN predicates). The THEN/ELSE branches
--     are unchanged, so the inferred column types are identical to the
--     originals (document_type = varchar via the `ELSE mv.type` branch;
--     status = text via all-literal branches). The WHERE clause guarantees
--     these only ever evaluate to the invoice value, so the runtime result is
--     constant even though the expression is unchanged.
--   * is_cancelled changes value (NULL::boolean → mv.is_cancelled) but stays
--     boolean.
-- No column is added, removed, renamed, retyped, or reordered.
--
-- CONSISTENCY GUARANTEE
-- ---------------------
-- Both surfaces now filter on the identical family value
-- (PURE_SALES_FAMILY / PURE_PURCHASE_FAMILY in
-- sales-purchase-analysis.service.ts === 'SALES_INVOICE' / 'PURCHASE_INVOICE'
-- here). NLQ `net_sales` for a (tenant, company, branch, date range) therefore
-- equals the dashboard headline total for the same scope.
-- ============================================================================

CREATE OR REPLACE VIEW vw_ai_sales_items AS
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
  -- Original CASE kept verbatim (UPPER added) so the column type stays varchar.
  -- The WHERE family='SALES_INVOICE' filter guarantees this is always 'SALE'.
  CASE
    WHEN UPPER(mv.type) = 'S' THEN 'SALE'
    WHEN UPPER(mv.type) IN ('R', 'T') THEN 'SALES_RETURN'
    ELSE mv.type
  END AS document_type,
  mp.customer_id,
  mv.cid AS customer_code,
  COALESCE(mp.par_name, c.name, mv.cid, 'Unmapped Party') AS customer_name,
  mp.gst_no AS customer_gst_no,
  mp.gst_no AS customer_vat_no,
  mp.gst_no AS customer_pan_no,
  mp.par_addr AS customer_address,
  mp.par_add1 AS customer_address_line1,
  mp.par_add2 AS customer_address_line2,
  mp.phone1 AS customer_phone,
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
  CASE
    WHEN (ABS(COALESCE(mt.qty, 0)) * COALESCE(mt.rate, 0)) > 0
      THEN LEAST(GREATEST((GREATEST(ABS(COALESCE(mt.qty, 0)) * COALESCE(mt.rate, 0) - ABS(COALESCE(mt.amount, 0)), 0) / (ABS(COALESCE(mt.qty, 0)) * COALESCE(mt.rate, 0)) * 100), 0), 100)::float8
    ELSE NULL::float8
  END AS discount_pct,
  ABS(COALESCE(mt.amount, 0))::float8 AS line_amount,
  CASE WHEN COALESCE(mt.gst, 0) > 0 THEN ABS(COALESCE(mt.amount, 0)) ELSE 0 END::float8 AS taxable_amount,
  CASE WHEN COALESCE(mt.gst, 0) = 0 THEN ABS(COALESCE(mt.amount, 0)) ELSE 0 END::float8 AS non_taxable_amount,
  COALESCE(mt.gst, 0)::float8 AS tax_rate,
  ABS(COALESCE(mt.gst_amount, 0))::float8 AS tax_amount,
  (ABS(COALESCE(mt.amount, 0)) + ABS(COALESCE(mt.gst_amount, 0)))::float8 AS net_amount,
  COALESCE(ms.p_rate, ms.lp_rate, p.standard_cost, 0)::float8 AS cost_rate,
  (ABS(COALESCE(mt.qty, 0)) * COALESCE(ms.p_rate, ms.lp_rate, p.standard_cost, 0))::float8 AS cost_amount,
  ((ABS(COALESCE(mt.amount, 0)) + ABS(COALESCE(mt.gst_amount, 0))) - ABS(COALESCE(mt.qty, 0)) * COALESCE(ms.p_rate, ms.lp_rate, p.standard_cost, 0))::float8 AS profit_amount,
  CASE
    WHEN (ABS(COALESCE(mt.amount, 0)) + ABS(COALESCE(mt.gst_amount, 0))) > 0
      THEN (((ABS(COALESCE(mt.amount, 0)) + ABS(COALESCE(mt.gst_amount, 0))) - ABS(COALESCE(mt.qty, 0)) * COALESCE(ms.p_rate, ms.lp_rate, p.standard_cost, 0)) / (ABS(COALESCE(mt.amount, 0)) + ABS(COALESCE(mt.gst_amount, 0))) * 100)::float8
    ELSE NULL::float8
  END AS margin_pct,
  mv.final_amt::float8 AS voucher_final_amount,
  COALESCE(mv.cash, 0)::float8 AS cash_amount,
  COALESCE(mv.others, 0)::float8 AS other_payment_amount,
  CASE
    WHEN COALESCE(mv.cash, 0) > 0 AND COALESCE(mv.others, 0) > 0 THEN 'MIXED'
    WHEN COALESCE(mv.cash, 0) > 0 THEN 'CASH'
    ELSE 'CREDIT'
  END AS payment_mode,
  -- Original all-literal CASE kept (UPPER added) so the column type stays text.
  -- WHERE guarantees this is always 'POSTED' under pure-invoice-only.
  CASE WHEN UPPER(mv.type) IN ('R', 'T') THEN 'RETURN' ELSE 'POSTED' END AS status,
  mv.is_cancelled AS is_cancelled,
  mt.id AS source_transaction_id,
  mt.source_key AS source_transaction_key,
  mv.id AS source_voucher_id,
  mv.orn AS source_order_no,
  mv.o_date AS source_order_date,
  mt.add_field AS source_transaction_add_field,
  mv.add_field AS source_voucher_add_field
FROM marg_vouchers mv
JOIN marg_transactions mt
  ON mt.tenant_id = mv.tenant_id
 AND mt.company_id = mv.company_id
 AND mt.voucher = mv.voucher
 -- Pure sales invoice line types only (G/S/O). UPPER so lowercase header
 -- variants behave like their uppercase form, matching the classifier.
 AND (UPPER(mv.type) = 'S' AND mt.type IN ('G', 'S', 'O'))
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
  WHERE fc.tenant_id = mv.tenant_id
    AND fc.is_default = true
    AND mv.date BETWEEN fp.start_date AND fp.end_date
  ORDER BY fc.updated_at DESC, fp.start_date DESC
  LIMIT 1
) fper ON TRUE
LEFT JOIN LATERAL (
  SELECT expiry, p_rate, lp_rate
  FROM marg_stocks ms
  WHERE ms.tenant_id = mt.tenant_id
    AND ms.company_id = mt.company_id
    AND ms.pid = mt.pid
    AND (mt.batch IS NULL OR ms.batch = mt.batch)
  ORDER BY CASE WHEN mt.batch IS NOT NULL AND ms.batch = mt.batch THEN 0 ELSE 1 END, ms.updated_at DESC
  LIMIT 1
) ms ON TRUE
-- Two-gate pure-invoice filter, identical to the dashboard's buildHeaderWhere:
-- family narrows to pure SALES_INVOICE; is_cancelled excludes voided vouchers.
WHERE mv.family = 'SALES_INVOICE'
  AND mv.is_cancelled = FALSE;

CREATE OR REPLACE VIEW vw_ai_purchase_items AS
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
  -- Original CASE kept verbatim (UPPER added) so the column type stays varchar.
  -- WHERE family='PURCHASE_INVOICE' guarantees this is always 'PURCHASE'.
  CASE WHEN UPPER(mv.type) = 'P' THEN 'PURCHASE' WHEN UPPER(mv.type) = 'B' THEN 'PURCHASE_RETURN' ELSE mv.type END AS document_type,
  s.id AS supplier_id,
  mv.cid AS supplier_code,
  COALESCE(mp.par_name, s.name, mv.cid, 'Unmapped Party') AS supplier_name,
  mp.gst_no AS supplier_gst_no,
  mp.gst_no AS supplier_vat_no,
  mp.gst_no AS supplier_pan_no,
  mp.par_addr AS supplier_address,
  mp.par_add1 AS supplier_address_line1,
  mp.par_add2 AS supplier_address_line2,
  mp.phone1 AS supplier_phone,
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
  CASE
    WHEN (ABS(COALESCE(mt.qty, 0)) * COALESCE(mt.rate, 0)) > 0
      THEN LEAST(GREATEST((GREATEST(ABS(COALESCE(mt.qty, 0)) * COALESCE(mt.rate, 0) - ABS(COALESCE(mt.amount, 0)), 0) / (ABS(COALESCE(mt.qty, 0)) * COALESCE(mt.rate, 0)) * 100), 0), 100)::float8
    ELSE NULL::float8
  END AS discount_pct,
  ABS(COALESCE(mt.amount, 0))::float8 AS line_amount,
  CASE WHEN COALESCE(mt.gst, 0) > 0 THEN ABS(COALESCE(mt.amount, 0)) ELSE 0 END::float8 AS taxable_amount,
  CASE WHEN COALESCE(mt.gst, 0) = 0 THEN ABS(COALESCE(mt.amount, 0)) ELSE 0 END::float8 AS non_taxable_amount,
  COALESCE(mt.gst, 0)::float8 AS tax_rate,
  ABS(COALESCE(mt.gst_amount, 0))::float8 AS tax_amount,
  (ABS(COALESCE(mt.amount, 0)) + ABS(COALESCE(mt.gst_amount, 0)))::float8 AS net_amount,
  COALESCE(ms.p_rate, ms.lp_rate, p.standard_cost, 0)::float8 AS landed_cost_rate,
  mv.final_amt::float8 AS voucher_final_amount,
  COALESCE(mv.cash, 0)::float8 AS cash_amount,
  COALESCE(mv.others, 0)::float8 AS other_payment_amount,
  CASE
    WHEN COALESCE(mv.cash, 0) > 0 AND COALESCE(mv.others, 0) > 0 THEN 'MIXED'
    WHEN COALESCE(mv.cash, 0) > 0 THEN 'CASH'
    ELSE 'CREDIT'
  END AS payment_mode,
  CASE WHEN UPPER(mv.type) = 'B' THEN 'RETURN' ELSE 'POSTED' END AS status,
  mv.is_cancelled AS is_cancelled,
  mt.id AS source_transaction_id,
  mt.source_key AS source_transaction_key,
  mv.id AS source_voucher_id,
  mv.orn AS source_order_no,
  mv.o_date AS source_order_date,
  mt.add_field AS source_transaction_add_field,
  mv.add_field AS source_voucher_add_field
FROM marg_vouchers mv
JOIN marg_transactions mt
  ON mt.tenant_id = mv.tenant_id
 AND mt.company_id = mv.company_id
 AND mt.voucher = mv.voucher
 -- Pure purchase invoice line type only (P). UPPER for case-insensitivity.
 AND (UPPER(mv.type) = 'P' AND mt.type = 'P')
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
  WHERE fc.tenant_id = mv.tenant_id
    AND fc.is_default = true
    AND mv.date BETWEEN fp.start_date AND fp.end_date
  ORDER BY fc.updated_at DESC, fp.start_date DESC
  LIMIT 1
) fper ON TRUE
LEFT JOIN LATERAL (
  SELECT expiry, p_rate, lp_rate
  FROM marg_stocks ms
  WHERE ms.tenant_id = mt.tenant_id
    AND ms.company_id = mt.company_id
    AND ms.pid = mt.pid
    AND (mt.batch IS NULL OR ms.batch = mt.batch)
  ORDER BY CASE WHEN mt.batch IS NOT NULL AND ms.batch = mt.batch THEN 0 ELSE 1 END, ms.updated_at DESC
  LIMIT 1
) ms ON TRUE
WHERE mv.family = 'PURCHASE_INVOICE'
  AND mv.is_cancelled = FALSE;
