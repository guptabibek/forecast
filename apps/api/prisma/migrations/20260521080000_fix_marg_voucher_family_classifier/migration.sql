-- Migration: Fix marg_vouchers.family classifier so it matches the TS
-- classifier (resolveMargType2ProjectionDecision) for every supported
-- header type, not just for tenant 11093's VCN prefix scheme.
--
-- BUG THIS FIXES
-- --------------
-- The previous migration (20260520130000_add_marg_voucher_family_generated_column)
-- gated SALES_INVOICE on `vcn LIKE 'STR%'`. That was the VCN prefix tenant
-- 11093's fixture data used. Tenants with different invoice numbering
-- (e.g. 'INV-001', 'BILL-001', a tenant-specific series) saw their
-- S-type vouchers fall through to ELSE 'UNKNOWN'. Because the sign helper
-- maps UNKNOWN → 0, those tenants' actual invoices contributed NOTHING to
-- sales totals, while their CN returns continued to contribute -1, producing
-- NEGATIVE reported sales (returns minus zero = negative).
--
-- The TS classifier (resolveMargType2ProjectionDecision in
-- marg-ede.service.ts) has always defaulted any S-type voucher that doesn't
-- match CHAL to SALES_INVOICE (with MEDIUM confidence for the non-canonical
-- VCN case). The SQL classifier must match.
--
-- WHAT CHANGES
-- ------------
-- Drop and recreate `family` as a STORED GENERATED column with an expression
-- whose default arm for every recognised header type is the family the TS
-- classifier would assign. CHAL/STAR-CHAL is the only intra-type
-- distinction we need to make (challan vs invoice within S). Everything
-- else defaults by `type` alone.
--
-- Mapping (mirrors resolveMargType2ProjectionDecision):
--   S + CHAL/*CHAL  → SALES_CHALLAN
--   S (anything else) → SALES_INVOICE
--   V               → SALES_ORDER
--   P               → PURCHASE_INVOICE
--   R               → SALES_RETURN
--   T               → SALES_RETURN_ADJUSTMENT
--   B               → PURCHASE_RETURN
--   X               → PURCHASE_ORDER
--   D               → STOCK_RECEIVE
--   L               → STOCK_ISSUE
--   anything else   → UNKNOWN
--
-- DEPLOY NOTES
-- ------------
-- - Postgres recomputes a STORED GENERATED column for every row when the
--   column is recreated. With marg_vouchers in the tens of thousands of rows
--   per tenant, this completes in seconds. Larger tenants may take longer
--   but the operation is one-shot.
-- - Dropping the column also drops indexes on it; the family index is
--   recreated below to preserve query plans.
-- - Reports stop seeing NEGATIVE sales the moment this migration completes
--   (no app code change required — the SQL helper already references
--   `mv.family`).

ALTER TABLE "marg_vouchers" DROP COLUMN IF EXISTS "family";

ALTER TABLE "marg_vouchers"
  ADD COLUMN "family" TEXT GENERATED ALWAYS AS (
    CASE
      WHEN "type" = 'S'
        AND (
          UPPER(COALESCE("vcn", '')) LIKE 'CHAL%'
          OR UPPER(COALESCE("vcn", '')) LIKE '*CHAL%'
        )
        THEN 'SALES_CHALLAN'
      WHEN "type" = 'S'
        THEN 'SALES_INVOICE'
      WHEN "type" = 'V'
        THEN 'SALES_ORDER'
      WHEN "type" = 'P'
        THEN 'PURCHASE_INVOICE'
      WHEN "type" = 'R'
        THEN 'SALES_RETURN'
      WHEN "type" = 'T'
        THEN 'SALES_RETURN_ADJUSTMENT'
      WHEN "type" = 'B'
        THEN 'PURCHASE_RETURN'
      WHEN "type" = 'X'
        THEN 'PURCHASE_ORDER'
      WHEN "type" = 'D'
        THEN 'STOCK_RECEIVE'
      WHEN "type" = 'L'
        THEN 'STOCK_ISSUE'
      ELSE 'UNKNOWN'
    END
  ) STORED;

CREATE INDEX IF NOT EXISTS "marg_vouchers_tenant_family_idx"
  ON "marg_vouchers" ("tenant_id", "family");

-- Additional index targeting the dominant report shape:
-- WHERE tenant_id = ? AND is_cancelled = FALSE AND date BETWEEN ? AND ?
-- with downstream filtering by family. Composite (tenant_id, date) lets
-- Postgres seek the date range cheaply, and including family means index-
-- only scans for the headline sales aggregate. The partial predicate keeps
-- the index small (cancelled vouchers shouldn't appear in commercial
-- reports anyway).
CREATE INDEX IF NOT EXISTS "marg_vouchers_tenant_date_family_live_idx"
  ON "marg_vouchers" ("tenant_id", "date", "family")
  WHERE "is_cancelled" = FALSE;

-- Force a fresh statistics pass so the planner picks the new family index
-- on the first report query after deploy. Without ANALYZE, Postgres uses
-- the old statistics from before the column was recreated and may pick a
-- sequential scan for the first few minutes.
ANALYZE "marg_vouchers";
