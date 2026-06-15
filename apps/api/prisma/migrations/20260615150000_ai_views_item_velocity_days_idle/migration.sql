-- item_velocity: add a non-null `days_idle` column for "not sold in <period>"
-- filtering.
--
-- days_since_last_sold is NULL for never-sold items, so `days_since >= N`
-- silently EXCLUDES them — but "items not sold in the last N days" must include
-- items that never sold. The LLM also tried to express this as
-- `never_sold = true AND days_since >= N`, which is an unsatisfiable AND
-- (NULL >= N is false) and returned zero rows.
--
-- days_idle = elapsed days since last sale, or a large sentinel when never
-- sold, so a single `days_idle >= N` predicate covers both idle-and-never-sold,
-- and combining it with never_sold is no longer contradictory. days_idle is
-- appended last so CREATE OR REPLACE VIEW keeps the existing column order.
-- days_since_last_sold stays NULL-for-never-sold for honest display.

CREATE OR REPLACE VIEW vw_ai_item_velocity AS
SELECT
  mprod.tenant_id,
  mprod.company_id,
  mprod.pid AS marg_product_pid,
  p.id AS product_id,
  COALESCE(p.code, mprod.code, mprod.pid) AS product_code,
  COALESCE(p.name, mprod.name, 'Unmapped Item') AS product_name,
  NULLIF(TRIM(COALESCE(p.product_group, mprod.g_code5)), '') AS product_group,
  NULLIF(TRIM(p.category), '') AS product_category,
  NULLIF(TRIM(COALESCE(p.product_company, mprod.g_code)), '') AS product_company,
  pc.name AS product_company_name,
  NULLIF(TRIM(COALESCE(p.salt, mprod.g_code3)), '') AS salt,
  ps.name AS salt_name,
  p.hsn_code,
  NULLIF(TRIM(COALESCE(p.unit_of_measure, mprod.unit)), '') AS uom_code,
  uom.name AS uom_name,
  sold.first_sold_date,
  sold.last_sold_date,
  CASE WHEN sold.last_sold_date IS NOT NULL THEN (CURRENT_DATE - sold.last_sold_date) ELSE NULL END AS days_since_last_sold,
  (sold.last_sold_date IS NULL) AS never_sold,
  COALESCE(sold.total_sold_quantity, 0)::float8 AS total_sold_quantity,
  COALESCE(sold.total_net_sales, 0)::float8 AS total_net_sales,
  COALESCE(sold.sale_count, 0)::int AS sale_count,
  COALESCE(stk.current_stock, 0)::float8 AS current_stock,
  COALESCE(stk.stock_value, 0)::float8 AS stock_value,
  CASE
    WHEN sold.last_sold_date IS NULL THEN 'NEVER_SOLD'
    WHEN (CURRENT_DATE - sold.last_sold_date) >= 90 AND COALESCE(stk.current_stock, 0) > 0 THEN 'NON_MOVING'
    WHEN (CURRENT_DATE - sold.last_sold_date) >= 30 THEN 'SLOW_MOVING'
    ELSE 'MOVING'
  END AS movement_status,
  COALESCE(CURRENT_DATE - sold.last_sold_date, 1000000) AS days_idle
FROM marg_products mprod
LEFT JOIN products p ON p.id = mprod.product_id AND p.tenant_id = mprod.tenant_id
LEFT JOIN product_companies pc ON pc.tenant_id = mprod.tenant_id AND pc.code = NULLIF(TRIM(COALESCE(p.product_company, mprod.g_code)), '')
LEFT JOIN product_salts ps ON ps.tenant_id = mprod.tenant_id AND ps.code = NULLIF(TRIM(COALESCE(p.salt, mprod.g_code3)), '')
LEFT JOIN unit_of_measures uom ON uom.tenant_id = mprod.tenant_id AND uom.code = NULLIF(TRIM(COALESCE(p.unit_of_measure, mprod.unit)), '')
LEFT JOIN (
  SELECT
    mt.tenant_id,
    mt.company_id,
    mt.pid,
    MIN(mv.date)::date AS first_sold_date,
    MAX(mv.date)::date AS last_sold_date,
    SUM(ABS(COALESCE(mt.qty, 0))) AS total_sold_quantity,
    SUM(ABS(COALESCE(mt.amount, 0)) + ABS(COALESCE(mt.gst_amount, 0))) AS total_net_sales,
    COUNT(DISTINCT mv.voucher) AS sale_count
  FROM marg_transactions mt
  JOIN marg_vouchers mv
    ON mv.tenant_id = mt.tenant_id
   AND mv.company_id = mt.company_id
   AND mv.voucher = mt.voucher
   AND mv.type = 'S'
  WHERE mt.type IN ('G', 'S', 'O')
    AND mt.is_cancelled IS DISTINCT FROM true
    AND mt.pid IS NOT NULL
  GROUP BY mt.tenant_id, mt.company_id, mt.pid
) sold
  ON sold.tenant_id = mprod.tenant_id
 AND sold.company_id = mprod.company_id
 AND sold.pid = mprod.pid
LEFT JOIN (
  SELECT
    ms.tenant_id,
    ms.company_id,
    ms.pid,
    SUM(COALESCE(ms.stock, 0)) AS current_stock,
    SUM(COALESCE(ms.stock, 0) * COALESCE(ms.p_rate, ms.lp_rate, 0)) AS stock_value
  FROM marg_stocks ms
  WHERE ms.source_deleted = false
  GROUP BY ms.tenant_id, ms.company_id, ms.pid
) stk
  ON stk.tenant_id = mprod.tenant_id
 AND stk.company_id = mprod.company_id
 AND stk.pid = mprod.pid;
