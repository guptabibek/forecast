-- ============================================================================
-- AI Reporting (NLQ) — net-of-returns views + returns invoice-level rollups.
--
-- Completes the Part 2 NLQ surface:
--   * vw_ai_sales_net / vw_ai_purchase_net  — invoices (positive) UNION ALL
--     returns (negated). SUM(net_amount) = invoices − returns = net-of-returns,
--     matching the dashboard scope=net. document_type distinguishes the two
--     arms so callers can still break the net down.
--   * vw_ai_sales_returns_invoices / vw_ai_purchase_returns_invoices —
--     invoice-grain rollups of the returns item views (one row per credit /
--     debit note), mirroring vw_ai_sales_invoices / vw_ai_purchase_invoices.
--
-- All four are built ON TOP of the existing item/returns views (defined in
-- 20260522100000 and 20260522110000), so the family filters, cancellation
-- handling, and amount semantics are inherited — there is exactly one source
-- of truth per concept.
--
-- Net views select an explicit, identical column list in both UNION arms
-- (names + order) so the UNION is type-stable. Amount/quantity columns are
-- negated in the returns arm; tax_rate (a percentage) and dimensions are not.
-- ============================================================================

CREATE OR REPLACE VIEW vw_ai_sales_net AS
SELECT
  tenant_id, company_id, branch_id, branch_code, branch_name,
  financial_year, fiscal_period_name, fiscal_month,
  invoice_id, source_voucher_no, invoice_no, invoice_date, voucher_type, document_type,
  customer_id, customer_code, customer_name, customer_gst_no, customer_address, route_code, area_code,
  salesman_code, salesman_name,
  product_id, marg_product_pid, product_code, product_name, product_group, product_category,
  product_company, product_company_name, salt, salt_name, hsn_code, batch_no, expiry_date,
  warehouse_id, warehouse, uom_code, uom_name,
  quantity, free_quantity, rate, mrp,
  gross_amount, discount_amount, line_amount, taxable_amount, non_taxable_amount, tax_rate, tax_amount,
  net_amount, cost_rate, cost_amount, voucher_final_amount,
  status, is_cancelled, source_transaction_id, source_voucher_id
FROM vw_ai_sales_items
UNION ALL
SELECT
  tenant_id, company_id, branch_id, branch_code, branch_name,
  financial_year, fiscal_period_name, fiscal_month,
  invoice_id, source_voucher_no, invoice_no, invoice_date, voucher_type, document_type,
  customer_id, customer_code, customer_name, customer_gst_no, customer_address, route_code, area_code,
  salesman_code, salesman_name,
  product_id, marg_product_pid, product_code, product_name, product_group, product_category,
  product_company, product_company_name, salt, salt_name, hsn_code, batch_no, expiry_date,
  warehouse_id, warehouse, uom_code, uom_name,
  -quantity, -free_quantity, rate, mrp,
  -gross_amount, -discount_amount, -line_amount, -taxable_amount, -non_taxable_amount, tax_rate, -tax_amount,
  -net_amount, cost_rate, -cost_amount, -voucher_final_amount,
  status, is_cancelled, source_transaction_id, source_voucher_id
FROM vw_ai_sales_returns;

CREATE OR REPLACE VIEW vw_ai_purchase_net AS
SELECT
  tenant_id, company_id, branch_id, branch_code, branch_name,
  financial_year, fiscal_period_name, fiscal_month,
  invoice_id, source_voucher_no, invoice_no, invoice_date, voucher_type, document_type,
  supplier_id, supplier_code, supplier_name, supplier_gst_no, supplier_address,
  product_id, marg_product_pid, product_code, product_name, product_group, product_category,
  product_company, product_company_name, salt, salt_name, hsn_code, batch_no, expiry_date,
  warehouse_id, warehouse, uom_code, uom_name,
  quantity, free_quantity, rate, mrp,
  gross_amount, discount_amount, line_amount, taxable_amount, non_taxable_amount, tax_rate, tax_amount,
  net_amount, landed_cost_rate, voucher_final_amount,
  status, is_cancelled, source_transaction_id, source_voucher_id
FROM vw_ai_purchase_items
UNION ALL
SELECT
  tenant_id, company_id, branch_id, branch_code, branch_name,
  financial_year, fiscal_period_name, fiscal_month,
  invoice_id, source_voucher_no, invoice_no, invoice_date, voucher_type, document_type,
  supplier_id, supplier_code, supplier_name, supplier_gst_no, supplier_address,
  product_id, marg_product_pid, product_code, product_name, product_group, product_category,
  product_company, product_company_name, salt, salt_name, hsn_code, batch_no, expiry_date,
  warehouse_id, warehouse, uom_code, uom_name,
  -quantity, -free_quantity, rate, mrp,
  -gross_amount, -discount_amount, -line_amount, -taxable_amount, -non_taxable_amount, tax_rate, -tax_amount,
  -net_amount, landed_cost_rate, -voucher_final_amount,
  status, is_cancelled, source_transaction_id, source_voucher_id
FROM vw_ai_purchase_returns;

-- ── Returns invoice-level rollups ──────────────────────────────────────────
-- One row per return document, mirroring vw_ai_sales_invoices /
-- vw_ai_purchase_invoices but sourced from the returns item views.

CREATE OR REPLACE VIEW vw_ai_sales_returns_invoices AS
SELECT
  tenant_id, company_id, branch_id, branch_code, branch_name,
  financial_year, fiscal_period_name, fiscal_month,
  invoice_id, source_voucher_no, invoice_no, invoice_date, voucher_type, document_type,
  customer_id, customer_code, customer_name, customer_gst_no, customer_address, route_code, area_code,
  salesman_code, salesman_name,
  SUM(quantity)::float8 AS quantity,
  SUM(gross_amount)::float8 AS gross_amount,
  SUM(discount_amount)::float8 AS discount_amount,
  CASE WHEN SUM(gross_amount) > 0 THEN (SUM(discount_amount) / SUM(gross_amount) * 100)::float8 ELSE NULL::float8 END AS discount_pct,
  SUM(line_amount)::float8 AS line_amount,
  SUM(taxable_amount)::float8 AS taxable_amount,
  SUM(non_taxable_amount)::float8 AS non_taxable_amount,
  SUM(tax_amount)::float8 AS tax_amount,
  COALESCE(MAX(voucher_final_amount), SUM(net_amount))::float8 AS net_amount,
  SUM(cost_amount)::float8 AS cost_amount,
  COUNT(*)::int AS line_count,
  COUNT(DISTINCT COALESCE(product_id::text, marg_product_pid))::int AS item_count,
  status, is_cancelled, source_voucher_id
FROM vw_ai_sales_returns
GROUP BY
  tenant_id, company_id, branch_id, branch_code, branch_name, financial_year,
  fiscal_period_name, fiscal_month, invoice_id, source_voucher_no, invoice_no,
  invoice_date, voucher_type, document_type, customer_id, customer_code,
  customer_name, customer_gst_no, customer_address, route_code, area_code,
  salesman_code, salesman_name, status, is_cancelled, source_voucher_id;

CREATE OR REPLACE VIEW vw_ai_purchase_returns_invoices AS
SELECT
  tenant_id, company_id, branch_id, branch_code, branch_name,
  financial_year, fiscal_period_name, fiscal_month,
  invoice_id, source_voucher_no, invoice_no, invoice_date, voucher_type, document_type,
  supplier_id, supplier_code, supplier_name, supplier_gst_no, supplier_address,
  SUM(quantity)::float8 AS quantity,
  SUM(gross_amount)::float8 AS gross_amount,
  SUM(discount_amount)::float8 AS discount_amount,
  CASE WHEN SUM(gross_amount) > 0 THEN (SUM(discount_amount) / SUM(gross_amount) * 100)::float8 ELSE NULL::float8 END AS discount_pct,
  SUM(line_amount)::float8 AS line_amount,
  SUM(taxable_amount)::float8 AS taxable_amount,
  SUM(non_taxable_amount)::float8 AS non_taxable_amount,
  SUM(tax_amount)::float8 AS tax_amount,
  COALESCE(MAX(voucher_final_amount), SUM(net_amount))::float8 AS net_amount,
  COUNT(*)::int AS line_count,
  COUNT(DISTINCT COALESCE(product_id::text, marg_product_pid))::int AS item_count,
  status, is_cancelled, source_voucher_id
FROM vw_ai_purchase_returns
GROUP BY
  tenant_id, company_id, branch_id, branch_code, branch_name, financial_year,
  fiscal_period_name, fiscal_month, invoice_id, source_voucher_no, invoice_no,
  invoice_date, voucher_type, document_type, supplier_id, supplier_code,
  supplier_name, supplier_gst_no, supplier_address, status, is_cancelled, source_voucher_id;
