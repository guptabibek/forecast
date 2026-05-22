-- Migration: Replace the `marg_vouchers.family` GENERATED column with a
-- tenant-agnostic classifier built on `(UPPER(type), add_field[0])` plus
-- the existing `cid[0]` Marg convention for direction-sensitive accounting
-- adjustments. Removes the VCN-prefix heuristic introduced by 20260521080000
-- and adds first-class support for Marg's BRK/EXP, challan-return, and
-- price-difference document families.
--
-- WHY THIS MIGRATION
-- ------------------
-- The previous classifier (20260521080000) used `vcn LIKE 'CHAL%'` /
-- `vcn LIKE '*CHAL%'` to carve challans out of type=S. That worked for
-- tenants whose challans use a CHAL-prefixed VCN series, but failed for
-- every tenant whose challan / challan-return series uses a different
-- prefix (CA*, L*, SN*, CCN*, CCNB*, …). The classifier also did not
-- handle five Marg document types that exist in production data for the
-- pharma tenant:
--
--   * type Q (BRK/EXP Return) — 4,808 vouchers / ₹2.12 cr silently dropped
--   * type W (BRK/EXP Receive — Credit Note flow) — 6,310 / ₹1.64 cr dropped
--   * type U (Price Difference Debit Note) — 15 / ₹1.66 lakh dropped
--   * Lowercase type variants (v, u) — case-sensitive comparison left them
--     as UNKNOWN with sign 0
--
-- These rows fell into the `ELSE 'UNKNOWN'` branch and contributed nothing
-- to commercial totals, inventory, or ledger projections — even though
-- they represent real stock movement and real accounting impact per Marg's
-- official type definitions.
--
-- CLASSIFIER CONTRACT (NEW)
-- -------------------------
-- The new expression uses only columns Marg emits identically across every
-- tenant install:
--
--   * `type`: documented Marg header type (S/R/P/B/T/V/X/D/L/Q/W/U/...).
--     Normalised with UPPER() so lowercase variants from auto-generated
--     vouchers (v, u) classify the same as their uppercase counterparts.
--   * `add_field` first character: `I` for invoice / commercial actual,
--     `C` for challan / inventory-only. Per Marg's documented AddField
--     convention — both axes are present in raw MDis rows and unit-test
--     fixtures confirm the rule (`marg-ede.service.spec.ts:295-340`).
--   * `cid` first character: only used to guard against direction-mismatch
--     on type U (price-diff DN should always be supplier-side per Marg;
--     a customer-side U row is surfaced as a diagnostic family rather
--     than silently classified).
--
-- VCN is NOT consulted. The migration history documents two prior incidents
-- where VCN-based heuristics silently broke reporting for tenants whose
-- VCN series differed from the test fixture's series. The new rule is
-- tenant-agnostic by construction.
--
-- FAMILY MAPPING (mirrors resolveMargType2ProjectionDecision):
--
--   ┌─────────────────────────────┬─────────────────────────────────────────┐
--   │ Family                      │ Trigger                                 │
--   ├─────────────────────────────┼─────────────────────────────────────────┤
--   │ SALES_INVOICE               │ S + add_field starts 'I'                │
--   │ SALES_CHALLAN               │ S + add_field starts 'C'                │
--   │ UNKNOWN_S_NO_AF             │ S + add_field missing / unrecognised    │
--   │ SALES_RETURN                │ R + add_field starts 'I'                │
--   │ SALES_CHALLAN_RETURN        │ R + add_field starts 'C'                │
--   │ UNKNOWN_R_NO_AF             │ R + add_field missing / unrecognised    │
--   │ SALES_RETURN_ADJUSTMENT     │ T (SC price-diff CN — A/R only)         │
--   │ SALES_BRK_EXP_RECEIVE       │ W + add_field starts 'I'                │
--   │ SALES_BRK_EXP_RECEIVE_CHALLAN │ W + add_field starts 'C'              │
--   │ UNKNOWN_W_NO_AF             │ W + add_field missing / unrecognised    │
--   │ PURCHASE_INVOICE            │ P + add_field starts 'I'                │
--   │ PURCHASE_CHALLAN            │ P + add_field starts 'C'                │
--   │ UNKNOWN_P_NO_AF             │ P + add_field missing / unrecognised    │
--   │ PURCHASE_RETURN             │ B + add_field starts 'I'                │
--   │ PURCHASE_CHALLAN_RETURN     │ B + add_field starts 'C'                │
--   │ UNKNOWN_B_NO_AF             │ B + add_field missing / unrecognised    │
--   │ PURCHASE_BRK_EXP_RETURN     │ Q + add_field starts 'I'                │
--   │ PURCHASE_BRK_EXP_RETURN_CHALLAN │ Q + add_field starts 'C'            │
--   │ UNKNOWN_Q_NO_AF             │ Q + add_field missing / unrecognised    │
--   │ PURCHASE_PRICE_DIFF_ADJUSTMENT │ U + cid starts 'S' (supplier-side)   │
--   │ UNKNOWN_U_UNEXPECTED_CID    │ U + cid starts 'C' (per Marg, U should  │
--   │                             │ never be customer-side — diagnostic)    │
--   │ SALES_ORDER                 │ V                                       │
--   │ PURCHASE_ORDER              │ X                                       │
--   │ STOCK_RECEIVE               │ D                                       │
--   │ STOCK_ISSUE                 │ L                                       │
--   │ UNKNOWN                     │ any other type (Marg add-on / unmapped) │
--   └─────────────────────────────┴─────────────────────────────────────────┘
--
-- UNKNOWN_*_NO_AF families are diagnostic buckets — they classify rows
-- whose header type IS recognised but whose add_field is missing or has
-- an unexpected first character. Reports treat them like UNKNOWN (sign 0,
-- no commercial impact), but the typed family name lets operators filter
-- on them for data-quality investigations.
--
-- DEPLOY NOTES
-- ------------
-- - Postgres recomputes a STORED GENERATED column for every row when the
--   column is recreated. On the pharma tenant's data (≈36k rows) the
--   recompute completes in seconds; larger tenants may take longer but
--   the operation is one-shot and does not require downtime.
-- - The 20260521080000 indexes on `family` are recreated below to preserve
--   query plans.
-- - The `marg_bill_rollup` table derives its `family` snapshot from
--   marg_vouchers and will be refreshed by the application's existing
--   rollup-rebuild job on the next sync, OR can be force-rebuilt by an
--   operator immediately by running the seed rollup script. Until then,
--   the rollup retains the old classification — reports that hit the
--   rollup path (no line-level drill filters) will reflect the new
--   classifier only after the next rollup refresh. Tests assert this
--   behaviour via the `rollup-summary matches live-summary` integration
--   spec, which exercises both paths against the same fixture.
-- - Reports stop seeing inflated sales totals and start seeing BRK/EXP
--   activity the moment this migration completes — no app code change is
--   required for the SQL aggregation path, since the helpers in
--   marg-voucher-family.sql.ts already reference `mv.family`. The TS
--   classifier (resolveMargType2ProjectionDecision) ships its mirror
--   update in the same commit so projection-time classification stays
--   aligned.
--
-- BACKFILL NOTES
-- --------------
-- Historical Actual rows projected under the OLD classifier may be stale
-- (e.g. a row that was previously classified as SALES_INVOICE but now
-- classifies as SALES_CHALLAN should not be present as a commercial sales
-- Actual). These are reversed automatically by the existing
-- "skipped row with prior actualId" sweep the next time the affected
-- voucher is re-synced. Operators wanting an immediate cleanup can
-- trigger a window-scoped re-sync via the existing reset endpoints —
-- no migration-time backfill is included here because that would
-- require holding a write lock across the entire marg_transactions
-- table for the duration of the recompute, which is unnecessary.

ALTER TABLE "marg_vouchers" DROP COLUMN IF EXISTS "family";

ALTER TABLE "marg_vouchers"
  ADD COLUMN "family" TEXT GENERATED ALWAYS AS (
    CASE
      -- Sales actuals (S): invoice or challan based on add_field tag
      WHEN UPPER("type") = 'S' AND LEFT(TRIM(COALESCE("add_field", '')), 1) = 'I'
        THEN 'SALES_INVOICE'
      WHEN UPPER("type") = 'S' AND LEFT(TRIM(COALESCE("add_field", '')), 1) = 'C'
        THEN 'SALES_CHALLAN'
      WHEN UPPER("type") = 'S'
        THEN 'UNKNOWN_S_NO_AF'

      -- Sales returns / Credit Notes (R)
      WHEN UPPER("type") = 'R' AND LEFT(TRIM(COALESCE("add_field", '')), 1) = 'I'
        THEN 'SALES_RETURN'
      WHEN UPPER("type") = 'R' AND LEFT(TRIM(COALESCE("add_field", '')), 1) = 'C'
        THEN 'SALES_CHALLAN_RETURN'
      WHEN UPPER("type") = 'R'
        THEN 'UNKNOWN_R_NO_AF'

      -- CN adjustment / SC (T) — accounting-only, no add_field branching
      WHEN UPPER("type") = 'T'
        THEN 'SALES_RETURN_ADJUSTMENT'

      -- BRK/EXP Receive (W) — Credit Note flow
      WHEN UPPER("type") = 'W' AND LEFT(TRIM(COALESCE("add_field", '')), 1) = 'I'
        THEN 'SALES_BRK_EXP_RECEIVE'
      WHEN UPPER("type") = 'W' AND LEFT(TRIM(COALESCE("add_field", '')), 1) = 'C'
        THEN 'SALES_BRK_EXP_RECEIVE_CHALLAN'
      WHEN UPPER("type") = 'W'
        THEN 'UNKNOWN_W_NO_AF'

      -- Purchases (P)
      WHEN UPPER("type") = 'P' AND LEFT(TRIM(COALESCE("add_field", '')), 1) = 'I'
        THEN 'PURCHASE_INVOICE'
      WHEN UPPER("type") = 'P' AND LEFT(TRIM(COALESCE("add_field", '')), 1) = 'C'
        THEN 'PURCHASE_CHALLAN'
      WHEN UPPER("type") = 'P'
        THEN 'UNKNOWN_P_NO_AF'

      -- Purchase returns / Debit Notes (B)
      WHEN UPPER("type") = 'B' AND LEFT(TRIM(COALESCE("add_field", '')), 1) = 'I'
        THEN 'PURCHASE_RETURN'
      WHEN UPPER("type") = 'B' AND LEFT(TRIM(COALESCE("add_field", '')), 1) = 'C'
        THEN 'PURCHASE_CHALLAN_RETURN'
      WHEN UPPER("type") = 'B'
        THEN 'UNKNOWN_B_NO_AF'

      -- BRK/EXP Return (Q) — Debit Note flow
      WHEN UPPER("type") = 'Q' AND LEFT(TRIM(COALESCE("add_field", '')), 1) = 'I'
        THEN 'PURCHASE_BRK_EXP_RETURN'
      WHEN UPPER("type") = 'Q' AND LEFT(TRIM(COALESCE("add_field", '')), 1) = 'C'
        THEN 'PURCHASE_BRK_EXP_RETURN_CHALLAN'
      WHEN UPPER("type") = 'Q'
        THEN 'UNKNOWN_Q_NO_AF'

      -- DN adjustment (U) — accounting-only, supplier-side per Marg.
      -- A customer-side U row is unexpected; surface as diagnostic family
      -- rather than silently classifying it as a purchase adjustment.
      WHEN UPPER("type") = 'U' AND LEFT(TRIM(COALESCE("cid", '')), 1) = 'C'
        THEN 'UNKNOWN_U_UNEXPECTED_CID'
      WHEN UPPER("type") = 'U'
        THEN 'PURCHASE_PRICE_DIFF_ADJUSTMENT'

      -- Orders / stock movements (type alone is sufficient — these families
      -- never have add_field branching in Marg's data model)
      WHEN UPPER("type") = 'V'
        THEN 'SALES_ORDER'
      WHEN UPPER("type") = 'X'
        THEN 'PURCHASE_ORDER'
      WHEN UPPER("type") = 'D'
        THEN 'STOCK_RECEIVE'
      WHEN UPPER("type") = 'L'
        THEN 'STOCK_ISSUE'

      ELSE 'UNKNOWN'
    END
  ) STORED;

-- Recreate the family-by-tenant index that the prior migration created.
-- Dropping the column drops dependent indexes, so we need to re-add them.
CREATE INDEX IF NOT EXISTS "marg_vouchers_tenant_family_idx"
  ON "marg_vouchers" ("tenant_id", "family");

-- Re-create the dominant report-path partial index. Composite (tenant_id,
-- date, family) lets Postgres seek the date range cheaply and include
-- family for index-only scans on commercial aggregates. Partial on
-- is_cancelled = FALSE keeps the index small (cancelled vouchers are
-- always excluded from commercial reports).
CREATE INDEX IF NOT EXISTS "marg_vouchers_tenant_date_family_live_idx"
  ON "marg_vouchers" ("tenant_id", "date", "family")
  WHERE "is_cancelled" = FALSE;

-- Force a fresh statistics pass so the planner picks the new family index
-- on the first report query after deploy. Without ANALYZE, Postgres uses
-- the old statistics from before the column was recreated and may pick a
-- sequential scan for the first few minutes of post-deploy traffic.
ANALYZE "marg_vouchers";

-- ============================================================
-- Rebuild marg_bill_rollup with the new family classifier.
-- ============================================================
-- The rollup table caches per-bill signed amounts via
-- (sales_amount_sign, purchase_amount_sign, signed_sales_amount,
-- signed_sales_quantity, signed_purchase_amount, signed_purchase_quantity)
-- columns that are POPULATED AT REFRESH TIME, not GENERATED — so they do
-- not auto-recompute when the marg_vouchers.family classifier changes.
-- After this migration runs, marg_vouchers.family carries the new
-- classification but marg_bill_rollup still carries the OLD family +
-- OLD signs from the most recent refresh.
--
-- Leaving the rollup stale would mean:
--   - The rollup fast-path keeps returning old totals (e.g. CCN/CCNB
--     challan-returns continue subtracting from sales) until the next
--     per-tenant sync triggers refreshMargBillRollup().
--   - Tests asserting rollup-summary == live-summary would fail post-
--     migration.
--   - The point of this migration — fixing reported sales/purchase
--     totals immediately — would be deferred to the next sync window.
--
-- Solution: DELETE every rollup row in this migration, then re-INSERT
-- with the new CASE expressions (mirroring refreshMargBillRollup in
-- marg-ede.service.ts). This runs once at deploy time, across every
-- tenant, in a single migration transaction.
--
-- TRUNCATE is preferred over DELETE because the table is empty
-- afterwards and we're rebuilding from scratch — TRUNCATE skips the
-- per-row WAL writes and runs in milliseconds even on large tables.
TRUNCATE TABLE "marg_bill_rollup";

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
  -- Signs MUST mirror margSalesAmountSignSql / margPurchaseAmountSignSql
  -- in marg-voucher-family.sql.ts AND the CASE expressions in
  -- refreshMargBillRollup (marg-ede.service.ts). Three places must
  -- stay aligned — the unit test in marg-voucher-family.sql.spec.ts
  -- locks the contract on the helpers; integration tests on
  -- refreshMargBillRollup lock the runtime function; this migration
  -- locks the deploy-time state.
  (CASE mv.family
    WHEN 'SALES_INVOICE'         THEN 1
    WHEN 'SALES_RETURN'          THEN -1
    WHEN 'SALES_BRK_EXP_RECEIVE' THEN -1
    ELSE 0
  END)::smallint AS sales_amount_sign,
  (CASE mv.family
    WHEN 'PURCHASE_INVOICE'        THEN 1
    WHEN 'PURCHASE_RETURN'         THEN -1
    WHEN 'PURCHASE_BRK_EXP_RETURN' THEN -1
    ELSE 0
  END)::smallint AS purchase_amount_sign,
  COALESCE(SUM(ABS(COALESCE(mt.qty, 0))), 0)::float8 AS quantity,
  COUNT(DISTINCT mt.pid) FILTER (WHERE mt.pid IS NOT NULL)::int AS item_count,
  COALESCE(SUM(ABS(COALESCE(mt.qty, 0)) * COALESCE(mt.rate, 0)), 0)::float8 AS gross_amount,
  COALESCE(SUM(GREATEST(ABS(COALESCE(mt.qty, 0)) * COALESCE(mt.rate, 0) - ABS(COALESCE(mt.amount, 0)), 0)), 0)::float8 AS discount,
  COALESCE(SUM(ABS(COALESCE(mt.gst_amount, 0))), 0)::float8 AS tax_amount,
  COALESCE(MAX(mv.final_amt)::float8, SUM(ABS(COALESCE(mt.amount, 0)) + ABS(COALESCE(mt.gst_amount, 0))), 0)::float8 AS net_amount,
  COALESCE(SUM(ABS(COALESCE(mt.qty, 0)) * COALESCE(ms.p_rate, ms.lp_rate, 0)), 0)::float8 AS cost_amount,
  (COALESCE(MAX(mv.final_amt)::float8, SUM(ABS(COALESCE(mt.amount, 0)) + ABS(COALESCE(mt.gst_amount, 0))), 0)
    * (CASE mv.family
        WHEN 'SALES_INVOICE'         THEN 1
        WHEN 'SALES_RETURN'          THEN -1
        WHEN 'SALES_BRK_EXP_RECEIVE' THEN -1
        ELSE 0
      END))::float8 AS signed_sales_amount,
  (COALESCE(SUM(ABS(COALESCE(mt.qty, 0))), 0)
    * (CASE mv.family
        WHEN 'SALES_INVOICE'         THEN 1
        WHEN 'SALES_RETURN'          THEN -1
        WHEN 'SALES_BRK_EXP_RECEIVE' THEN -1
        ELSE 0
      END))::float8 AS signed_sales_quantity,
  (COALESCE(MAX(mv.final_amt)::float8, SUM(ABS(COALESCE(mt.amount, 0)) + ABS(COALESCE(mt.gst_amount, 0))), 0)
    * (CASE mv.family
        WHEN 'PURCHASE_INVOICE'        THEN 1
        WHEN 'PURCHASE_RETURN'         THEN -1
        WHEN 'PURCHASE_BRK_EXP_RETURN' THEN -1
        ELSE 0
      END))::float8 AS signed_purchase_amount,
  (COALESCE(SUM(ABS(COALESCE(mt.qty, 0))), 0)
    * (CASE mv.family
        WHEN 'PURCHASE_INVOICE'        THEN 1
        WHEN 'PURCHASE_RETURN'         THEN -1
        WHEN 'PURCHASE_BRK_EXP_RETURN' THEN -1
        ELSE 0
      END))::float8 AS signed_purchase_quantity,
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
  mv.final_amt;

ANALYZE "marg_bill_rollup";
