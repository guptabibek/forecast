-- ============================================================================
-- AI Reporting (NLQ) — regional dimensions on the net sales/purchase views.
--
-- WHY
-- ---
-- NLQ questions like "Top 5 routes with most sales" or "cities with highest
-- purchase" could not be answered: the semantic catalog had NO regional
-- dimension at all, so the LLM degraded such questions to ungrouped detail
-- lists ("top 5 sales records").
--
-- The item views DO expose route_code/area_code — but from the PARTY MASTER
-- (mp.route / mp.area). That source is deliberately not used for regional
-- analytics anywhere else in the platform: party-master routing is mutable,
-- so re-routing a customer silently rewrites historical regional totals
-- (see topStates()/topCities() in sales-purchase-analysis.service.ts).
-- The canonical regional source is the TRANSACTION-TIME code carried on
-- marg_transactions.add_field — segment 20 (route/state, named via
-- marg_sale_types sg_code='ROUT') and segment 21 (area/city, named via
-- sg_code='AREA') — which both item and returns views already pass through
-- as source_transaction_add_field.
--
-- WHAT CHANGES
-- ------------
-- Re-create vw_ai_sales_net / vw_ai_purchase_net only (thin UNION wrappers),
-- APPENDING four columns to the end of both UNION arms:
--   region_route_code / region_route_name  (add_field seg 20 → ROUT lookup)
--   region_area_code  / region_area_name   (add_field seg 21 → AREA lookup)
-- Codes/names are attributes of the line, NOT amounts — they are never
-- negated in the returns arm. Existing columns keep their exact names,
-- types, and order, so CREATE OR REPLACE VIEW is legal and all dependents
-- are unaffected. The marg_sale_types lookup join cannot fan out rows:
-- the table is UNIQUE on (tenant_id, company_id, sg_code, s_code).
--
-- CONSISTENCY GUARANTEE
-- ---------------------
-- Identical source + lookup as the dashboard regional breakdowns, so an NLQ
-- "sales by route" reconciles with the Sales Analysis regional report for
-- the same scope.
-- ============================================================================

CREATE OR REPLACE VIEW vw_ai_sales_net AS
SELECT
  v.tenant_id, v.company_id, v.branch_id, v.branch_code, v.branch_name,
  v.financial_year, v.fiscal_period_name, v.fiscal_month,
  v.invoice_id, v.source_voucher_no, v.invoice_no, v.invoice_date, v.voucher_type, v.document_type,
  v.customer_id, v.customer_code, v.customer_name, v.customer_gst_no, v.customer_address, v.route_code, v.area_code,
  v.salesman_code, v.salesman_name,
  v.product_id, v.marg_product_pid, v.product_code, v.product_name, v.product_group, v.product_category,
  v.product_company, v.product_company_name, v.salt, v.salt_name, v.hsn_code, v.batch_no, v.expiry_date,
  v.warehouse_id, v.warehouse, v.uom_code, v.uom_name,
  v.quantity, v.free_quantity, v.rate, v.mrp,
  v.gross_amount, v.discount_amount, v.line_amount, v.taxable_amount, v.non_taxable_amount, v.tax_rate, v.tax_amount,
  v.net_amount, v.cost_rate, v.cost_amount, v.voucher_final_amount,
  v.status, v.is_cancelled, v.source_transaction_id, v.source_voucher_id,
  NULLIF(TRIM(SPLIT_PART(COALESCE(v.source_transaction_add_field, ''), ';', 20)), '') AS region_route_code,
  COALESCE(rt.name, NULLIF(TRIM(SPLIT_PART(COALESCE(v.source_transaction_add_field, ''), ';', 20)), ''), 'Unknown') AS region_route_name,
  NULLIF(TRIM(SPLIT_PART(COALESCE(v.source_transaction_add_field, ''), ';', 21)), '') AS region_area_code,
  COALESCE(ar.name, NULLIF(TRIM(SPLIT_PART(COALESCE(v.source_transaction_add_field, ''), ';', 21)), ''), 'Unknown') AS region_area_name
FROM vw_ai_sales_items v
LEFT JOIN marg_sale_types rt
  ON rt.tenant_id = v.tenant_id AND rt.company_id = v.company_id AND rt.sg_code = 'ROUT'
 AND rt.s_code = NULLIF(TRIM(SPLIT_PART(COALESCE(v.source_transaction_add_field, ''), ';', 20)), '')
LEFT JOIN marg_sale_types ar
  ON ar.tenant_id = v.tenant_id AND ar.company_id = v.company_id AND ar.sg_code = 'AREA'
 AND ar.s_code = NULLIF(TRIM(SPLIT_PART(COALESCE(v.source_transaction_add_field, ''), ';', 21)), '')
UNION ALL
SELECT
  v.tenant_id, v.company_id, v.branch_id, v.branch_code, v.branch_name,
  v.financial_year, v.fiscal_period_name, v.fiscal_month,
  v.invoice_id, v.source_voucher_no, v.invoice_no, v.invoice_date, v.voucher_type, v.document_type,
  v.customer_id, v.customer_code, v.customer_name, v.customer_gst_no, v.customer_address, v.route_code, v.area_code,
  v.salesman_code, v.salesman_name,
  v.product_id, v.marg_product_pid, v.product_code, v.product_name, v.product_group, v.product_category,
  v.product_company, v.product_company_name, v.salt, v.salt_name, v.hsn_code, v.batch_no, v.expiry_date,
  v.warehouse_id, v.warehouse, v.uom_code, v.uom_name,
  -v.quantity, -v.free_quantity, v.rate, v.mrp,
  -v.gross_amount, -v.discount_amount, -v.line_amount, -v.taxable_amount, -v.non_taxable_amount, v.tax_rate, -v.tax_amount,
  -v.net_amount, v.cost_rate, -v.cost_amount, -v.voucher_final_amount,
  v.status, v.is_cancelled, v.source_transaction_id, v.source_voucher_id,
  NULLIF(TRIM(SPLIT_PART(COALESCE(v.source_transaction_add_field, ''), ';', 20)), '') AS region_route_code,
  COALESCE(rt.name, NULLIF(TRIM(SPLIT_PART(COALESCE(v.source_transaction_add_field, ''), ';', 20)), ''), 'Unknown') AS region_route_name,
  NULLIF(TRIM(SPLIT_PART(COALESCE(v.source_transaction_add_field, ''), ';', 21)), '') AS region_area_code,
  COALESCE(ar.name, NULLIF(TRIM(SPLIT_PART(COALESCE(v.source_transaction_add_field, ''), ';', 21)), ''), 'Unknown') AS region_area_name
FROM vw_ai_sales_returns v
LEFT JOIN marg_sale_types rt
  ON rt.tenant_id = v.tenant_id AND rt.company_id = v.company_id AND rt.sg_code = 'ROUT'
 AND rt.s_code = NULLIF(TRIM(SPLIT_PART(COALESCE(v.source_transaction_add_field, ''), ';', 20)), '')
LEFT JOIN marg_sale_types ar
  ON ar.tenant_id = v.tenant_id AND ar.company_id = v.company_id AND ar.sg_code = 'AREA'
 AND ar.s_code = NULLIF(TRIM(SPLIT_PART(COALESCE(v.source_transaction_add_field, ''), ';', 21)), '');

CREATE OR REPLACE VIEW vw_ai_purchase_net AS
SELECT
  v.tenant_id, v.company_id, v.branch_id, v.branch_code, v.branch_name,
  v.financial_year, v.fiscal_period_name, v.fiscal_month,
  v.invoice_id, v.source_voucher_no, v.invoice_no, v.invoice_date, v.voucher_type, v.document_type,
  v.supplier_id, v.supplier_code, v.supplier_name, v.supplier_gst_no, v.supplier_address,
  v.product_id, v.marg_product_pid, v.product_code, v.product_name, v.product_group, v.product_category,
  v.product_company, v.product_company_name, v.salt, v.salt_name, v.hsn_code, v.batch_no, v.expiry_date,
  v.warehouse_id, v.warehouse, v.uom_code, v.uom_name,
  v.quantity, v.free_quantity, v.rate, v.mrp,
  v.gross_amount, v.discount_amount, v.line_amount, v.taxable_amount, v.non_taxable_amount, v.tax_rate, v.tax_amount,
  v.net_amount, v.landed_cost_rate, v.voucher_final_amount,
  v.status, v.is_cancelled, v.source_transaction_id, v.source_voucher_id,
  NULLIF(TRIM(SPLIT_PART(COALESCE(v.source_transaction_add_field, ''), ';', 20)), '') AS region_route_code,
  COALESCE(rt.name, NULLIF(TRIM(SPLIT_PART(COALESCE(v.source_transaction_add_field, ''), ';', 20)), ''), 'Unknown') AS region_route_name,
  NULLIF(TRIM(SPLIT_PART(COALESCE(v.source_transaction_add_field, ''), ';', 21)), '') AS region_area_code,
  COALESCE(ar.name, NULLIF(TRIM(SPLIT_PART(COALESCE(v.source_transaction_add_field, ''), ';', 21)), ''), 'Unknown') AS region_area_name
FROM vw_ai_purchase_items v
LEFT JOIN marg_sale_types rt
  ON rt.tenant_id = v.tenant_id AND rt.company_id = v.company_id AND rt.sg_code = 'ROUT'
 AND rt.s_code = NULLIF(TRIM(SPLIT_PART(COALESCE(v.source_transaction_add_field, ''), ';', 20)), '')
LEFT JOIN marg_sale_types ar
  ON ar.tenant_id = v.tenant_id AND ar.company_id = v.company_id AND ar.sg_code = 'AREA'
 AND ar.s_code = NULLIF(TRIM(SPLIT_PART(COALESCE(v.source_transaction_add_field, ''), ';', 21)), '')
UNION ALL
SELECT
  v.tenant_id, v.company_id, v.branch_id, v.branch_code, v.branch_name,
  v.financial_year, v.fiscal_period_name, v.fiscal_month,
  v.invoice_id, v.source_voucher_no, v.invoice_no, v.invoice_date, v.voucher_type, v.document_type,
  v.supplier_id, v.supplier_code, v.supplier_name, v.supplier_gst_no, v.supplier_address,
  v.product_id, v.marg_product_pid, v.product_code, v.product_name, v.product_group, v.product_category,
  v.product_company, v.product_company_name, v.salt, v.salt_name, v.hsn_code, v.batch_no, v.expiry_date,
  v.warehouse_id, v.warehouse, v.uom_code, v.uom_name,
  -v.quantity, -v.free_quantity, v.rate, v.mrp,
  -v.gross_amount, -v.discount_amount, -v.line_amount, -v.taxable_amount, -v.non_taxable_amount, v.tax_rate, -v.tax_amount,
  -v.net_amount, v.landed_cost_rate, -v.voucher_final_amount,
  v.status, v.is_cancelled, v.source_transaction_id, v.source_voucher_id,
  NULLIF(TRIM(SPLIT_PART(COALESCE(v.source_transaction_add_field, ''), ';', 20)), '') AS region_route_code,
  COALESCE(rt.name, NULLIF(TRIM(SPLIT_PART(COALESCE(v.source_transaction_add_field, ''), ';', 20)), ''), 'Unknown') AS region_route_name,
  NULLIF(TRIM(SPLIT_PART(COALESCE(v.source_transaction_add_field, ''), ';', 21)), '') AS region_area_code,
  COALESCE(ar.name, NULLIF(TRIM(SPLIT_PART(COALESCE(v.source_transaction_add_field, ''), ';', 21)), ''), 'Unknown') AS region_area_name
FROM vw_ai_purchase_returns v
LEFT JOIN marg_sale_types rt
  ON rt.tenant_id = v.tenant_id AND rt.company_id = v.company_id AND rt.sg_code = 'ROUT'
 AND rt.s_code = NULLIF(TRIM(SPLIT_PART(COALESCE(v.source_transaction_add_field, ''), ';', 20)), '')
LEFT JOIN marg_sale_types ar
  ON ar.tenant_id = v.tenant_id AND ar.company_id = v.company_id AND ar.sg_code = 'AREA'
 AND ar.s_code = NULLIF(TRIM(SPLIT_PART(COALESCE(v.source_transaction_add_field, ''), ';', 21)), '');
