-- ============================================================================
-- AI Reporting Approved Views
--
-- These views expose stable, read-only reporting datasets for NLQ/semantic
-- reporting. They intentionally mirror existing production report SQL:
--   * Marg sales: voucher types S/R/T with compatible line types G,S,O/R/X,T.
--   * Marg purchase: voucher types P/B with compatible line types P/B.
--   * Amounts use ABS() as existing reports do for sales/purchase analytics.
--   * Invoice totals prefer marg_vouchers.final_amt when present.
--   * Inventory datasets use existing inventory_levels, batches, and ledger.
--
-- No raw transactional table access should be granted to the AI layer.
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
  CASE
    WHEN mv.type = 'S' THEN 'SALE'
    WHEN mv.type IN ('R', 'T') THEN 'SALES_RETURN'
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
  CASE WHEN mv.type IN ('R', 'T') THEN 'RETURN' ELSE 'POSTED' END AS status,
  NULL::boolean AS is_cancelled,
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
 AND (
   (mv.type = 'S' AND mt.type IN ('G', 'S', 'O'))
   OR (mv.type = 'R' AND mt.type = 'R')
   OR (mv.type = 'T' AND mt.type IN ('X', 'T'))
 )
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
WHERE mv.type IN ('S', 'R', 'T');

CREATE OR REPLACE VIEW vw_ai_sales_invoices AS
SELECT
  tenant_id,
  company_id,
  branch_id,
  branch_code,
  branch_name,
  financial_year,
  fiscal_period_name,
  fiscal_month,
  invoice_id,
  source_voucher_no,
  invoice_no,
  invoice_date,
  voucher_type,
  document_type,
  customer_id,
  customer_code,
  customer_name,
  customer_gst_no,
  customer_vat_no,
  customer_pan_no,
  customer_address,
  route_code,
  area_code,
  salesman_code,
  salesman_name,
  payment_mode,
  cash_amount,
  other_payment_amount,
  SUM(quantity)::float8 AS quantity,
  SUM(gross_amount)::float8 AS gross_amount,
  SUM(discount_amount)::float8 AS discount_amount,
  CASE WHEN SUM(gross_amount) > 0 THEN (SUM(discount_amount) / SUM(gross_amount) * 100)::float8 ELSE NULL::float8 END AS discount_pct,
  SUM(line_amount)::float8 AS line_amount,
  SUM(taxable_amount)::float8 AS taxable_amount,
  SUM(non_taxable_amount)::float8 AS non_taxable_amount,
  SUM(tax_amount)::float8 AS tax_amount,
  (COALESCE(MAX(voucher_final_amount), SUM(net_amount)) - SUM(net_amount))::float8 AS round_off_amount,
  COALESCE(MAX(voucher_final_amount), SUM(net_amount))::float8 AS net_amount,
  SUM(cost_amount)::float8 AS cost_amount,
  (COALESCE(MAX(voucher_final_amount), SUM(net_amount)) - SUM(cost_amount))::float8 AS profit_amount,
  CASE
    WHEN COALESCE(MAX(voucher_final_amount), SUM(net_amount)) > 0
      THEN ((COALESCE(MAX(voucher_final_amount), SUM(net_amount)) - SUM(cost_amount)) / COALESCE(MAX(voucher_final_amount), SUM(net_amount)) * 100)::float8
    ELSE NULL::float8
  END AS margin_pct,
  COUNT(*)::int AS line_count,
  COUNT(DISTINCT COALESCE(product_id::text, marg_product_pid))::int AS item_count,
  status,
  is_cancelled,
  source_voucher_id,
  source_order_no,
  source_order_date
FROM vw_ai_sales_items
GROUP BY
  tenant_id, company_id, branch_id, branch_code, branch_name, financial_year,
  fiscal_period_name, fiscal_month, invoice_id, source_voucher_no, invoice_no,
  invoice_date, voucher_type, document_type, customer_id, customer_code,
  customer_name, customer_gst_no, customer_vat_no, customer_pan_no,
  customer_address, route_code, area_code, salesman_code, salesman_name,
  payment_mode, cash_amount, other_payment_amount, status, is_cancelled,
  source_voucher_id, source_order_no, source_order_date;

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
  CASE WHEN mv.type = 'P' THEN 'PURCHASE' WHEN mv.type = 'B' THEN 'PURCHASE_RETURN' ELSE mv.type END AS document_type,
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
  CASE WHEN mv.type = 'B' THEN 'RETURN' ELSE 'POSTED' END AS status,
  NULL::boolean AS is_cancelled,
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
 AND (
   (mv.type = 'P' AND mt.type = 'P')
   OR (mv.type = 'B' AND mt.type = 'B')
 )
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
WHERE mv.type IN ('P', 'B');

CREATE OR REPLACE VIEW vw_ai_purchase_invoices AS
SELECT
  tenant_id,
  company_id,
  branch_id,
  branch_code,
  branch_name,
  financial_year,
  fiscal_period_name,
  fiscal_month,
  invoice_id,
  source_voucher_no,
  invoice_no,
  invoice_date,
  voucher_type,
  document_type,
  supplier_id,
  supplier_code,
  supplier_name,
  supplier_gst_no,
  supplier_vat_no,
  supplier_pan_no,
  supplier_address,
  payment_mode,
  cash_amount,
  other_payment_amount,
  SUM(quantity)::float8 AS quantity,
  SUM(gross_amount)::float8 AS gross_amount,
  SUM(discount_amount)::float8 AS discount_amount,
  CASE WHEN SUM(gross_amount) > 0 THEN (SUM(discount_amount) / SUM(gross_amount) * 100)::float8 ELSE NULL::float8 END AS discount_pct,
  SUM(line_amount)::float8 AS line_amount,
  SUM(taxable_amount)::float8 AS taxable_amount,
  SUM(non_taxable_amount)::float8 AS non_taxable_amount,
  SUM(tax_amount)::float8 AS tax_amount,
  (COALESCE(MAX(voucher_final_amount), SUM(net_amount)) - SUM(net_amount))::float8 AS round_off_amount,
  COALESCE(MAX(voucher_final_amount), SUM(net_amount))::float8 AS net_amount,
  COUNT(*)::int AS line_count,
  COUNT(DISTINCT COALESCE(product_id::text, marg_product_pid))::int AS item_count,
  status,
  is_cancelled,
  source_voucher_id,
  source_order_no,
  source_order_date
FROM vw_ai_purchase_items
GROUP BY
  tenant_id, company_id, branch_id, branch_code, branch_name, financial_year,
  fiscal_period_name, fiscal_month, invoice_id, source_voucher_no, invoice_no,
  invoice_date, voucher_type, document_type, supplier_id, supplier_code,
  supplier_name, supplier_gst_no, supplier_vat_no, supplier_pan_no,
  supplier_address, payment_mode, cash_amount, other_payment_amount, status,
  is_cancelled, source_voucher_id, source_order_no, source_order_date;

CREATE OR REPLACE VIEW vw_ai_stock_summary AS
SELECT
  il.tenant_id,
  NULL::integer AS company_id,
  il.location_id AS branch_id,
  l.code AS branch_code,
  l.name AS branch_name,
  il.location_id AS warehouse_id,
  l.code AS warehouse_code,
  l.name AS warehouse_name,
  p.id AS product_id,
  p.code AS product_code,
  p.name AS product_name,
  NULLIF(TRIM(p.product_group), '') AS product_group,
  NULLIF(TRIM(p.category), '') AS product_category,
  NULLIF(TRIM(p.product_company), '') AS product_company,
  pc.name AS product_company_name,
  NULLIF(TRIM(p.salt), '') AS salt,
  ps.name AS salt_name,
  p.hsn_code,
  NULL::uuid AS batch_id,
  NULL::text AS batch_no,
  NULL::date AS expiry_date,
  NULLIF(TRIM(p.unit_of_measure), '') AS uom_code,
  uom.name AS uom_name,
  COALESCE(il.on_hand_qty, 0)::float8 AS current_stock,
  COALESCE(il.available_qty, 0)::float8 AS available_stock,
  COALESCE(il.allocated_qty, 0)::float8 AS allocated_stock,
  COALESCE(il.reserved_qty, 0)::float8 AS reserved_stock,
  COALESCE(il.quarantine_qty, 0)::float8 AS quarantine_stock,
  COALESCE(il.in_transit_qty, 0)::float8 AS in_transit_stock,
  COALESCE(il.on_order_qty, 0)::float8 AS on_order_stock,
  COALESCE(il.average_cost, il.standard_cost, 0)::float8 AS unit_cost,
  COALESCE(il.inventory_value, 0)::float8 AS stock_value,
  ip.safety_stock_qty::float8 AS minimum_stock,
  ip.max_order_qty::float8 AS maximum_stock,
  ip.reorder_point::float8 AS reorder_level,
  ip.reorder_qty::float8 AS reorder_quantity,
  il.last_receipt_date,
  il.last_issue_date,
  il.last_count_date,
  il.updated_at AS last_updated_at,
  CASE
    WHEN COALESCE(il.on_hand_qty, 0) < 0 THEN 'NEGATIVE'
    WHEN ip.reorder_point IS NOT NULL AND COALESCE(il.available_qty, 0) <= ip.reorder_point THEN 'BELOW_REORDER'
    WHEN ip.safety_stock_qty IS NOT NULL AND COALESCE(il.available_qty, 0) <= ip.safety_stock_qty THEN 'BELOW_MINIMUM'
    ELSE 'NORMAL'
  END AS stock_status
FROM inventory_levels il
JOIN products p ON p.id = il.product_id AND p.tenant_id = il.tenant_id
JOIN locations l ON l.id = il.location_id AND l.tenant_id = il.tenant_id
LEFT JOIN inventory_policies ip ON ip.tenant_id = il.tenant_id AND ip.product_id = il.product_id AND ip.location_id = il.location_id
LEFT JOIN product_companies pc ON pc.tenant_id = p.tenant_id AND pc.code = NULLIF(TRIM(p.product_company), '')
LEFT JOIN product_salts ps ON ps.tenant_id = p.tenant_id AND ps.code = NULLIF(TRIM(p.salt), '')
LEFT JOIN unit_of_measures uom ON uom.tenant_id = p.tenant_id AND uom.code = NULLIF(TRIM(p.unit_of_measure), '');

CREATE OR REPLACE VIEW vw_ai_stock_batches AS
SELECT
  b.tenant_id,
  NULL::integer AS company_id,
  b.location_id AS branch_id,
  l.code AS branch_code,
  l.name AS branch_name,
  b.location_id AS warehouse_id,
  l.code AS warehouse_code,
  l.name AS warehouse_name,
  p.id AS product_id,
  p.code AS product_code,
  p.name AS product_name,
  NULLIF(TRIM(p.product_group), '') AS product_group,
  NULLIF(TRIM(p.category), '') AS product_category,
  NULLIF(TRIM(p.product_company), '') AS product_company,
  NULLIF(TRIM(p.salt), '') AS salt,
  p.hsn_code,
  b.id AS batch_id,
  b.batch_number AS batch_no,
  b.manufacturing_date,
  b.expiry_date,
  CASE WHEN b.expiry_date IS NOT NULL THEN (b.expiry_date::date - CURRENT_DATE) ELSE NULL END AS days_to_expiry,
  b.uom AS uom_code,
  uom.name AS uom_name,
  COALESCE(b.quantity, 0)::float8 AS current_stock,
  COALESCE(b.available_qty, 0)::float8 AS available_stock,
  COALESCE(b.cost_per_unit, 0)::float8 AS unit_cost,
  (COALESCE(b.quantity, 0) * COALESCE(b.cost_per_unit, 0))::float8 AS stock_value,
  b.status::text AS batch_status,
  (b.status NOT IN ('CONSUMED', 'RECALLED') AND COALESCE(b.quantity, 0) <> 0) AS is_reportable_stock,
  b.supplier_id,
  s.code AS supplier_code,
  s.name AS supplier_name,
  b.purchase_order_id,
  b.work_order_id,
  b.created_at,
  b.updated_at
FROM batches b
JOIN products p ON p.id = b.product_id AND p.tenant_id = b.tenant_id
JOIN locations l ON l.id = b.location_id AND l.tenant_id = b.tenant_id
LEFT JOIN suppliers s ON s.id = b.supplier_id AND s.tenant_id = b.tenant_id
LEFT JOIN unit_of_measures uom ON uom.tenant_id = b.tenant_id AND uom.code = NULLIF(TRIM(b.uom), '');

CREATE OR REPLACE VIEW vw_ai_stock_ledger AS
SELECT
  il.tenant_id,
  NULL::integer AS company_id,
  il.location_id AS branch_id,
  l.code AS branch_code,
  l.name AS branch_name,
  il.id AS ledger_entry_id,
  il.sequence_number,
  il.transaction_date,
  il.transaction_date::date AS transaction_day,
  p.id AS product_id,
  p.code AS product_code,
  p.name AS product_name,
  il.location_id AS warehouse_id,
  l.code AS warehouse_code,
  l.name AS warehouse_name,
  bat.id AS batch_id,
  bat.batch_number AS batch_no,
  bat.expiry_date,
  il.entry_type::text AS entry_type,
  il.inventory_status::text AS inventory_status,
  il.quantity::float8 AS quantity,
  il.uom AS uom_code,
  uom.name AS uom_name,
  COALESCE(il.unit_cost, 0)::float8 AS unit_cost,
  COALESCE(il.total_cost, 0)::float8 AS total_cost,
  COALESCE(il.running_balance, 0)::float8 AS running_balance,
  il.reference_type,
  il.reference_id,
  il.reference_number,
  il.lot_number,
  il.journal_entry_id,
  il.created_by_id,
  il.notes,
  il.created_at
FROM inventory_ledger il
JOIN products p ON p.id = il.product_id AND p.tenant_id = il.tenant_id
JOIN locations l ON l.id = il.location_id AND l.tenant_id = il.tenant_id
LEFT JOIN batches bat ON bat.id = il.batch_id AND bat.tenant_id = il.tenant_id
LEFT JOIN unit_of_measures uom ON uom.tenant_id = il.tenant_id AND uom.code = NULLIF(TRIM(il.uom), '');

CREATE OR REPLACE VIEW vw_ai_party_outstanding AS
SELECT
  mo.tenant_id,
  mo.company_id,
  mb.location_id AS branch_id,
  mb.code AS branch_code,
  COALESCE(mb.name, mb.branch, 'Company ' || mo.company_id::text) AS branch_name,
  CASE
    WHEN UPPER(COALESCE(mo.group_code, '')) LIKE 'C%' THEN 'CUSTOMER'
    WHEN UPPER(COALESCE(mo.group_code, '')) LIKE 'D%' THEN 'SUPPLIER'
    ELSE 'OTHER'
  END AS party_type,
  mo.ord AS party_code,
  mp.par_name AS party_name,
  mp.gst_no AS party_gst_no,
  mp.gst_no AS party_vat_no,
  mp.gst_no AS party_pan_no,
  mo.group_code,
  mag.name AS group_name,
  mo.date AS invoice_date,
  mo.vcn AS invoice_no,
  mo.voucher AS voucher_no,
  mo.s_voucher AS source_voucher_no,
  mo.days AS source_age_days,
  GREATEST(CURRENT_DATE - mo.date::date, 0) AS current_age_days,
  COALESCE(mo.final_amt, 0)::float8 AS invoice_amount,
  COALESCE(mo.balance, 0)::float8 AS signed_balance,
  CASE
    WHEN UPPER(COALESCE(mo.group_code, '')) LIKE 'D%' THEN GREATEST(-COALESCE(mo.balance, 0), 0)
    WHEN UPPER(COALESCE(mo.group_code, '')) LIKE 'C%' THEN GREATEST(COALESCE(mo.balance, 0), 0)
    ELSE ABS(COALESCE(mo.balance, 0))
  END::float8 AS outstanding_amount,
  CASE
    WHEN UPPER(COALESCE(mo.group_code, '')) LIKE 'D%' THEN GREATEST(COALESCE(mo.balance, 0), 0)
    WHEN UPPER(COALESCE(mo.group_code, '')) LIKE 'C%' THEN GREATEST(-COALESCE(mo.balance, 0), 0)
    ELSE 0
  END::float8 AS credit_balance,
  COALESCE(mo.pd_less, 0)::float8 AS pd_less_amount,
  CASE WHEN COALESCE(mo.balance, 0) = 0 THEN false ELSE true END AS is_open,
  mo.id AS source_outstanding_id,
  mo.add_field AS source_add_field,
  mo.created_at,
  mo.updated_at
FROM marg_outstandings mo
LEFT JOIN marg_parties mp ON mp.tenant_id = mo.tenant_id AND mp.company_id = mo.company_id AND mp.cid = mo.ord
LEFT JOIN marg_account_groups mag ON mag.tenant_id = mo.tenant_id AND mag.company_id = mo.company_id AND mag.aid = mo.group_code
LEFT JOIN marg_branches mb ON mb.tenant_id = mo.tenant_id AND mb.company_id = mo.company_id;

CREATE OR REPLACE VIEW vw_ai_tax_register AS
SELECT
  tenant_id,
  company_id,
  branch_id,
  branch_code,
  branch_name,
  financial_year,
  fiscal_period_name,
  fiscal_month,
  'SALES'::text AS tax_domain,
  document_type,
  invoice_id,
  invoice_no,
  invoice_date,
  customer_code AS party_code,
  customer_name AS party_name,
  customer_gst_no AS party_gst_no,
  customer_vat_no AS party_vat_no,
  customer_pan_no AS party_pan_no,
  product_id,
  product_code,
  product_name,
  hsn_code,
  line_amount,
  taxable_amount,
  non_taxable_amount,
  tax_rate,
  tax_amount,
  net_amount,
  status,
  source_transaction_id,
  source_voucher_id
FROM vw_ai_sales_items
UNION ALL
SELECT
  tenant_id,
  company_id,
  branch_id,
  branch_code,
  branch_name,
  financial_year,
  fiscal_period_name,
  fiscal_month,
  'PURCHASE'::text AS tax_domain,
  document_type,
  invoice_id,
  invoice_no,
  invoice_date,
  supplier_code AS party_code,
  supplier_name AS party_name,
  supplier_gst_no AS party_gst_no,
  supplier_vat_no AS party_vat_no,
  supplier_pan_no AS party_pan_no,
  product_id,
  product_code,
  product_name,
  hsn_code,
  line_amount,
  taxable_amount,
  non_taxable_amount,
  tax_rate,
  tax_amount,
  net_amount,
  status,
  source_transaction_id,
  source_voucher_id
FROM vw_ai_purchase_items;

CREATE OR REPLACE VIEW vw_ai_ledger_entries AS
SELECT
  je.tenant_id,
  NULL::integer AS company_id,
  jl.location_id AS branch_id,
  l.code AS branch_code,
  l.name AS branch_name,
  fp.fiscal_year::text AS financial_year,
  fp.period_name AS fiscal_period_name,
  'CORE_GL'::text AS ledger_source,
  je.id AS source_entry_id,
  jl.id AS source_line_id,
  je.entry_date,
  je.posting_date,
  je.entry_number AS voucher_no,
  je.reference_type,
  je.reference_id::text AS reference_id,
  je.status::text AS status,
  ga.id AS account_id,
  ga.account_number AS account_code,
  ga.name AS account_name,
  ga.account_type::text AS account_type,
  ga.normal_balance::text AS normal_balance,
  NULL::text AS party_code,
  NULL::text AS party_name,
  NULL::text AS counterparty_code,
  NULL::text AS counterparty_name,
  COALESCE(jl.debit_amount, 0)::float8 AS debit_amount,
  COALESCE(jl.credit_amount, 0)::float8 AS credit_amount,
  (COALESCE(jl.debit_amount, 0) - COALESCE(jl.credit_amount, 0))::float8 AS signed_amount,
  jl.product_id,
  p.code AS product_code,
  p.name AS product_name,
  jl.location_id AS location_id,
  l.name AS location_name,
  jl.cost_center_id,
  COALESCE(jl.description, je.description) AS description,
  je.currency,
  je.created_at
FROM journal_entry_lines jl
JOIN journal_entries je ON je.id = jl.journal_entry_id
JOIN gl_accounts ga ON ga.id = jl.gl_account_id AND ga.tenant_id = je.tenant_id
LEFT JOIN fiscal_periods fp ON fp.id = je.fiscal_period_id
LEFT JOIN products p ON p.id = jl.product_id AND p.tenant_id = je.tenant_id
LEFT JOIN locations l ON l.id = jl.location_id AND l.tenant_id = je.tenant_id
UNION ALL
SELECT
  map.tenant_id,
  map.company_id,
  mb.location_id AS branch_id,
  mb.code AS branch_code,
  COALESCE(mb.name, mb.branch, 'Company ' || map.company_id::text) AS branch_name,
  NULL::text AS financial_year,
  NULL::text AS fiscal_period_name,
  'MARG_PARTY_LEDGER'::text AS ledger_source,
  map.id AS source_entry_id,
  NULL::uuid AS source_line_id,
  map.date AS entry_date,
  map.created_at AS posting_date,
  COALESCE(mvref.vcn, map.voucher) AS voucher_no,
  map.book AS reference_type,
  map.voucher AS reference_id,
  'POSTED'::text AS status,
  NULL::uuid AS account_id,
  map.book AS account_code,
  NULL::text AS account_name,
  NULL::text AS account_type,
  NULL::text AS normal_balance,
  map.code AS party_code,
  mp.par_name AS party_name,
  map.code1 AS counterparty_code,
  COALESCE(cp.par_name, mag.name) AS counterparty_name,
  CASE WHEN map.amount > 0 THEN map.amount ELSE 0 END::float8 AS debit_amount,
  CASE WHEN map.amount < 0 THEN -map.amount ELSE 0 END::float8 AS credit_amount,
  map.amount::float8 AS signed_amount,
  NULL::uuid AS product_id,
  NULL::text AS product_code,
  NULL::text AS product_name,
  mb.location_id AS location_id,
  COALESCE(mb.name, mb.branch, 'Company ' || map.company_id::text) AS location_name,
  NULL::uuid AS cost_center_id,
  map.remark AS description,
  NULL::text AS currency,
  map.created_at
FROM marg_account_postings map
LEFT JOIN LATERAL (
  SELECT mv.vcn
  FROM marg_vouchers mv
  WHERE mv.tenant_id = map.tenant_id
    AND mv.company_id = map.company_id
    AND mv.voucher = map.voucher
  ORDER BY mv.updated_at DESC
  LIMIT 1
) mvref ON TRUE
LEFT JOIN marg_parties mp ON mp.tenant_id = map.tenant_id AND mp.company_id = map.company_id AND mp.cid = map.code
LEFT JOIN marg_parties cp ON cp.tenant_id = map.tenant_id AND cp.company_id = map.company_id AND cp.cid = map.code1
LEFT JOIN marg_account_groups mag ON mag.tenant_id = map.tenant_id AND mag.company_id = map.company_id AND mag.aid = map.code1
LEFT JOIN marg_branches mb ON mb.tenant_id = map.tenant_id AND mb.company_id = map.company_id;
