-- AI Reporting correctness and performance smoke checks.
-- Run against a production-like database after applying AI reporting view migrations.
-- Replace psql variables with a company, tenant, and branch scope the tester is authorized to inspect.
--
-- Required psql variables:
--   tenant_id: UUID
--   company_id: integer
--   branch_id: UUID
--   start_date: YYYY-MM-DD
--   end_date: YYYY-MM-DD

\set ON_ERROR_STOP on

BEGIN;
SET LOCAL statement_timeout = '30000ms';
SET LOCAL TRANSACTION READ ONLY;

-- 1. Top selling products. Compare this output with the existing production
-- top-item/product sales report for the same scope and date range.
SELECT product_id, product_code, product_name,
       SUM(quantity) AS sold_quantity,
       SUM(net_amount) AS net_sales
FROM vw_ai_sales_items
WHERE tenant_id = :'tenant_id'::uuid
  AND company_id = :company_id::int
  AND branch_id = :'branch_id'::uuid
  AND invoice_date BETWEEN :'start_date'::date AND :'end_date'::date
  AND is_cancelled = false
GROUP BY product_id, product_code, product_name
ORDER BY sold_quantity DESC, net_sales DESC
LIMIT 25;

-- 2. Sales item totals must reconcile to invoice totals for non-cancelled sales
-- invoices within the same tenant/company/branch/date scope.
WITH item_totals AS (
  SELECT SUM(net_amount) AS item_net_sales
  FROM vw_ai_sales_items
  WHERE tenant_id = :'tenant_id'::uuid
    AND company_id = :company_id::int
    AND branch_id = :'branch_id'::uuid
    AND invoice_date BETWEEN :'start_date'::date AND :'end_date'::date
    AND is_cancelled = false
),
invoice_totals AS (
  SELECT SUM(net_amount) AS invoice_net_sales
  FROM vw_ai_sales_invoices
  WHERE tenant_id = :'tenant_id'::uuid
    AND company_id = :company_id::int
    AND branch_id = :'branch_id'::uuid
    AND invoice_date BETWEEN :'start_date'::date AND :'end_date'::date
    AND is_cancelled = false
)
SELECT item_net_sales, invoice_net_sales, item_net_sales - invoice_net_sales AS variance
FROM item_totals CROSS JOIN invoice_totals;

-- 3. Salesman-wise sales. Compare with the existing salesman-wise production report.
SELECT salesman_code, salesman_name,
       COUNT(DISTINCT invoice_id) AS invoice_count,
       SUM(net_amount) AS net_sales
FROM vw_ai_sales_invoices
WHERE tenant_id = :'tenant_id'::uuid
  AND company_id = :company_id::int
  AND branch_id = :'branch_id'::uuid
  AND invoice_date BETWEEN :'start_date'::date AND :'end_date'::date
  AND is_cancelled = false
GROUP BY salesman_code, salesman_name
ORDER BY net_sales DESC
LIMIT 50;

-- 4. Customer-wise and invoice-wise sales. Compare with existing customer and
-- bill-wise sales reports for the same filters.
SELECT customer_code, customer_name,
       COUNT(DISTINCT invoice_id) AS invoice_count,
       SUM(net_amount) AS net_sales
FROM vw_ai_sales_invoices
WHERE tenant_id = :'tenant_id'::uuid
  AND company_id = :company_id::int
  AND branch_id = :'branch_id'::uuid
  AND invoice_date BETWEEN :'start_date'::date AND :'end_date'::date
  AND is_cancelled = false
GROUP BY customer_code, customer_name
ORDER BY net_sales DESC
LIMIT 50;

SELECT invoice_id, invoice_no, invoice_date, customer_code, customer_name,
       net_amount, gross_amount, tax_amount
FROM vw_ai_sales_invoices
WHERE tenant_id = :'tenant_id'::uuid
  AND company_id = :company_id::int
  AND branch_id = :'branch_id'::uuid
  AND invoice_date BETWEEN :'start_date'::date AND :'end_date'::date
  AND is_cancelled = false
ORDER BY invoice_date DESC, invoice_no DESC
LIMIT 50;

-- 5. Purchase item and supplier-wise reports. Compare with existing purchase
-- item-wise and supplier-wise purchase reports.
SELECT product_id, product_code, product_name,
       SUM(quantity) AS purchase_quantity,
       SUM(net_amount) AS net_purchase
FROM vw_ai_purchase_items
WHERE tenant_id = :'tenant_id'::uuid
  AND company_id = :company_id::int
  AND branch_id = :'branch_id'::uuid
  AND invoice_date BETWEEN :'start_date'::date AND :'end_date'::date
  AND is_cancelled = false
GROUP BY product_id, product_code, product_name
ORDER BY purchase_quantity DESC, net_purchase DESC
LIMIT 25;

SELECT supplier_code, supplier_name,
       COUNT(DISTINCT invoice_id) AS invoice_count,
       SUM(net_amount) AS net_purchase
FROM vw_ai_purchase_invoices
WHERE tenant_id = :'tenant_id'::uuid
  AND company_id = :company_id::int
  AND branch_id = :'branch_id'::uuid
  AND invoice_date BETWEEN :'start_date'::date AND :'end_date'::date
  AND is_cancelled = false
GROUP BY supplier_code, supplier_name
ORDER BY net_purchase DESC
LIMIT 50;

-- 6. Stock summary and low stock checks. Compare with the existing stock
-- summary/low-stock reports using the same authorized warehouse or branch scope.
SELECT product_id, product_code, product_name, warehouse_id, warehouse_code,
       current_stock, available_stock, minimum_stock, stock_value, stock_status
FROM vw_ai_stock_summary
WHERE tenant_id = :'tenant_id'::uuid
  AND warehouse_id = :'branch_id'::uuid
ORDER BY stock_value DESC NULLS LAST
LIMIT 50;

SELECT product_id, product_code, product_name, warehouse_id, warehouse_code,
       current_stock, minimum_stock, stock_status
FROM vw_ai_stock_summary
WHERE tenant_id = :'tenant_id'::uuid
  AND warehouse_id = :'branch_id'::uuid
  AND stock_status = 'LOW_STOCK'
ORDER BY product_name
LIMIT 50;

-- 7. Basic performance probes used by production smoke testing.
EXPLAIN (ANALYZE, BUFFERS)
SELECT product_id, product_name, SUM(quantity) AS sold_quantity
FROM vw_ai_sales_items
WHERE tenant_id = :'tenant_id'::uuid
  AND company_id = :company_id::int
  AND branch_id = :'branch_id'::uuid
  AND invoice_date BETWEEN :'start_date'::date AND :'end_date'::date
  AND is_cancelled = false
GROUP BY product_id, product_name
ORDER BY sold_quantity DESC
LIMIT 25;

ROLLBACK;
