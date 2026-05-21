-- Migration: Materialise the per-voucher (bill) rollup as a first-class
-- table so commercial reports can SUM over ~36k pre-aggregated bill rows
-- instead of computing the aggregation live over 329k+ raw transaction
-- lines on every page load.
--
-- WHY A TABLE INSTEAD OF A MATERIALIZED VIEW
-- ------------------------------------------
-- Postgres materialized views do not support partial refresh — REFRESH
-- MATERIALIZED VIEW always recomputes every row, across every tenant. In a
-- multi-tenant SaaS that means the largest tenant's data dominates refresh
-- time and a single tenant's sync triggers global recomputation. With a
-- regular table we can DELETE + INSERT just the rows for the tenant that
-- just synced, keeping refresh time proportional to that tenant's data.
--
-- WHAT GETS MATERIALISED
-- ----------------------
-- One row per (tenant_id, company_id, voucher, type) — i.e. one row per
-- bill. Columns mirror what bill_rollup CTEs across the report layer
-- compute:
--   - Identity / dimensions: company, voucher, type, vcn, family, date,
--     cid, salesman, etc. (kept so reports can filter/group without joining
--     back to marg_vouchers)
--   - Per-bill numeric aggregates: quantity, item_count, gross_amount,
--     discount, tax_amount, net_amount, cost_amount
--   - Pre-computed family signs (sales / purchase) so reports can SUM
--     amount × sign directly without re-deriving the sign per query
--   - Pre-computed signed totals (signed_net_amount, signed_quantity)
--     so headline totals are SUM(signed_net_amount) — no per-row CASE
--
-- WHAT IS NOT MATERIALISED
-- ------------------------
-- Display-only joins (party name, branch name, salesman name) stay live in
-- the report queries. Those tables are small (parties/branches/salesmen
-- are cached in PG buffer cache) and joining them per-bill at read time is
-- effectively free, while denormalising them into the rollup means every
-- party rename forces a rollup refresh.
--
-- CANCELLATION
-- ------------
-- Only LIVE rows participate. Both source filters (mv.is_cancelled = FALSE
-- AND mt.is_cancelled = FALSE) are applied at refresh time. Cancelled
-- vouchers are NOT in the rollup at all, so report queries don't need to
-- repeat that filter — it's structurally enforced.
--
-- KEYS / INDEXES
-- --------------
-- Primary key (tenant_id, company_id, voucher, type) matches the natural
-- bill identity and supports cheap UPSERT-on-conflict on refresh.
-- Secondary indexes match the dominant report shapes:
--   - (tenant_id, date, family)       — headline / trend reports
--   - (tenant_id, cid)                — per-party drilldown
--   - (tenant_id, salesman)           — per-salesman drilldown
--
-- BACKFILL
-- --------
-- The migration ends with an initial population pass so reports work on
-- first load AFTER deploy without needing a fresh sync first. Sync paths
-- (runSync / runReprojection) refresh per-tenant going forward.

CREATE TABLE IF NOT EXISTS "marg_bill_rollup" (
  "tenant_id"            UUID         NOT NULL,
  "company_id"           INT          NOT NULL,
  "voucher"              VARCHAR(50)  NOT NULL,
  "type"                 VARCHAR(10)  NOT NULL,
  "vcn"                  VARCHAR(50),
  "family"               TEXT         NOT NULL,
  "date"                 DATE         NOT NULL,
  "cid"                  VARCHAR(20),
  "cash"                 DECIMAL(18, 4),
  "others"               DECIMAL(18, 4),
  "salesman"             VARCHAR(100),
  "mr"                   VARCHAR(100),
  "route"                VARCHAR(100),
  "area"                 VARCHAR(100),
  "final_amt"            DECIMAL(18, 4),
  -- Signs: precomputed so reports do SUM(amount * sales_sign) without a
  -- per-row CASE. The expressions mirror margSalesAmountSignSql /
  -- margPurchaseAmountSignSql exactly.
  "sales_amount_sign"    SMALLINT     NOT NULL,
  "purchase_amount_sign" SMALLINT     NOT NULL,
  -- Per-bill aggregates: each is the value the original bill_rollup CTE
  -- would have computed via SUM/COUNT over the bill's line rows.
  "quantity"             DOUBLE PRECISION NOT NULL DEFAULT 0,
  "item_count"           INT          NOT NULL DEFAULT 0,
  "gross_amount"         DOUBLE PRECISION NOT NULL DEFAULT 0,
  "discount"             DOUBLE PRECISION NOT NULL DEFAULT 0,
  "tax_amount"           DOUBLE PRECISION NOT NULL DEFAULT 0,
  "net_amount"           DOUBLE PRECISION NOT NULL DEFAULT 0,
  "cost_amount"          DOUBLE PRECISION NOT NULL DEFAULT 0,
  -- Pre-signed totals: enables headline SUM with no per-row computation.
  -- These are net_amount × sales_amount_sign and quantity × sales_amount_sign
  -- (and same for purchase via purchase_amount_sign). Stored explicitly
  -- to keep the report SQL trivial.
  "signed_sales_amount"  DOUBLE PRECISION NOT NULL DEFAULT 0,
  "signed_sales_quantity" DOUBLE PRECISION NOT NULL DEFAULT 0,
  "signed_purchase_amount" DOUBLE PRECISION NOT NULL DEFAULT 0,
  "signed_purchase_quantity" DOUBLE PRECISION NOT NULL DEFAULT 0,
  "refreshed_at"         TIMESTAMPTZ  NOT NULL DEFAULT NOW(),

  PRIMARY KEY ("tenant_id", "company_id", "voucher", "type")
);

CREATE INDEX IF NOT EXISTS "marg_bill_rollup_tenant_date_family_idx"
  ON "marg_bill_rollup" ("tenant_id", "date", "family");

CREATE INDEX IF NOT EXISTS "marg_bill_rollup_tenant_cid_idx"
  ON "marg_bill_rollup" ("tenant_id", "cid")
  WHERE "cid" IS NOT NULL;

CREATE INDEX IF NOT EXISTS "marg_bill_rollup_tenant_salesman_idx"
  ON "marg_bill_rollup" ("tenant_id", "salesman")
  WHERE "salesman" IS NOT NULL;

-- ============================================================
-- One-time backfill: populate the rollup for every existing tenant so
-- reports don't show empty data on first load after deploy. After this,
-- maintenance is driven by per-tenant refresh at the end of each sync /
-- reprojection — see MargEdeService.refreshMargBillRollup().
--
-- The query mirrors what refreshMargBillRollup() does at runtime; keeping
-- the two in sync is enforced by the test that asserts a backfill +
-- reprojection produce identical row sets.
-- ============================================================
INSERT INTO "marg_bill_rollup" (
  tenant_id, company_id, voucher, type, vcn, family, date, cid,
  cash, others, salesman, mr, route, area, final_amt,
  sales_amount_sign, purchase_amount_sign,
  quantity, item_count, gross_amount, discount, tax_amount,
  net_amount, cost_amount,
  signed_sales_amount, signed_sales_quantity,
  signed_purchase_amount, signed_purchase_quantity,
  refreshed_at
)
SELECT
  mv.tenant_id,
  mv.company_id,
  mv.voucher,
  mv.type,
  mv.vcn,
  mv.family,
  mv.date,
  mv.cid,
  mv.cash,
  mv.others,
  mv.salesman,
  mv.mr,
  mv.route,
  mv.area,
  mv.final_amt,
  (CASE mv.family WHEN 'SALES_INVOICE' THEN 1 WHEN 'SALES_RETURN'  THEN -1 ELSE 0 END)::smallint AS sales_amount_sign,
  (CASE mv.family WHEN 'PURCHASE_INVOICE' THEN 1 WHEN 'PURCHASE_RETURN'  THEN -1 ELSE 0 END)::smallint AS purchase_amount_sign,
  COALESCE(SUM(ABS(COALESCE(mt.qty, 0))), 0)::float8 AS quantity,
  COUNT(DISTINCT mt.pid) FILTER (WHERE mt.pid IS NOT NULL)::int AS item_count,
  COALESCE(SUM(ABS(COALESCE(mt.qty, 0)) * COALESCE(mt.rate, 0)), 0)::float8 AS gross_amount,
  COALESCE(SUM(GREATEST(ABS(COALESCE(mt.qty, 0)) * COALESCE(mt.rate, 0) - ABS(COALESCE(mt.amount, 0)), 0)), 0)::float8 AS discount,
  COALESCE(SUM(ABS(COALESCE(mt.gst_amount, 0))), 0)::float8 AS tax_amount,
  COALESCE(MAX(mv.final_amt)::float8, SUM(ABS(COALESCE(mt.amount, 0)) + ABS(COALESCE(mt.gst_amount, 0))), 0)::float8 AS net_amount,
  COALESCE(SUM(ABS(COALESCE(mt.qty, 0)) * COALESCE(ms.p_rate, ms.lp_rate, 0)), 0)::float8 AS cost_amount,
  -- Pre-signed totals: net_amount × sales_amount_sign, etc. Computed
  -- inline using the same CASE so the row is fully self-consistent.
  (COALESCE(MAX(mv.final_amt)::float8, SUM(ABS(COALESCE(mt.amount, 0)) + ABS(COALESCE(mt.gst_amount, 0))), 0)
    * (CASE mv.family WHEN 'SALES_INVOICE' THEN 1 WHEN 'SALES_RETURN'  THEN -1 ELSE 0 END))::float8 AS signed_sales_amount,
  (COALESCE(SUM(ABS(COALESCE(mt.qty, 0))), 0)
    * (CASE mv.family WHEN 'SALES_INVOICE' THEN 1 WHEN 'SALES_RETURN'  THEN -1 ELSE 0 END))::float8 AS signed_sales_quantity,
  (COALESCE(MAX(mv.final_amt)::float8, SUM(ABS(COALESCE(mt.amount, 0)) + ABS(COALESCE(mt.gst_amount, 0))), 0)
    * (CASE mv.family WHEN 'PURCHASE_INVOICE' THEN 1 WHEN 'PURCHASE_RETURN'  THEN -1 ELSE 0 END))::float8 AS signed_purchase_amount,
  (COALESCE(SUM(ABS(COALESCE(mt.qty, 0))), 0)
    * (CASE mv.family WHEN 'PURCHASE_INVOICE' THEN 1 WHEN 'PURCHASE_RETURN'  THEN -1 ELSE 0 END))::float8 AS signed_purchase_quantity,
  NOW() AS refreshed_at
FROM marg_vouchers mv
LEFT JOIN marg_transactions mt
  ON mt.tenant_id     = mv.tenant_id
  AND mt.company_id    = mv.company_id
  AND mt.voucher       = mv.voucher
  AND mt.is_cancelled  = FALSE
LEFT JOIN LATERAL (
  SELECT p_rate, lp_rate
  FROM marg_stocks ms
  WHERE ms.tenant_id  = mv.tenant_id
    AND ms.company_id = mv.company_id
    AND ms.pid        = mt.pid
    AND (mt.batch IS NULL OR ms.batch = mt.batch)
  ORDER BY CASE WHEN mt.batch IS NOT NULL AND ms.batch = mt.batch THEN 0 ELSE 1 END,
           ms.updated_at DESC
  LIMIT 1
) ms ON TRUE
WHERE mv.is_cancelled = FALSE
GROUP BY
  mv.tenant_id, mv.company_id, mv.voucher, mv.type, mv.vcn, mv.family,
  mv.date, mv.cid, mv.cash, mv.others, mv.salesman, mv.mr, mv.route, mv.area,
  mv.final_amt
ON CONFLICT (tenant_id, company_id, voucher, type) DO NOTHING;

ANALYZE "marg_bill_rollup";
