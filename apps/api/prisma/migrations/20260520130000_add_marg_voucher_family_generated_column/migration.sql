-- Migration: Materialise the Marg voucher family classification as a
-- Postgres GENERATED STORED column on marg_vouchers.
--
-- Until now the SQL family classification lived in two places:
--   1) `margVoucherFamilySql(alias)` in marg-voucher-family.sql.ts — a CASE
--      expression that callers spliced into their queries.
--   2) The TypeScript `resolveMargType2ProjectionDecision` classifier.
--
-- Two sources of truth invite drift. Two callers had subtly different
-- expectations of "what is this voucher", and the SQL helper required every
-- new aggregation query to remember to wrap its sums in the helper or risk
-- treating a CHAL challan as an STR invoice. By materialising the
-- classification into a column at the staging layer:
--   - Every report just queries `mv.family` directly. No helper to forget.
--   - The classification can be indexed (it's STORED, not VIRTUAL).
--   - Operators can run `SELECT family, COUNT(*) FROM marg_vouchers ...`
--     interactively for diagnostics without remembering the CASE shape.
--   - Postgres recomputes the column atomically on INSERT/UPDATE of any
--     contributing column (type, vcn), so staging upserts stay correct.
--
-- The expression itself is identical to the CASE the SQL helper used to
-- emit — see `margVoucherFamilySql` in marg-voucher-family.sql.ts which is
-- now updated to read this column instead of re-emitting the CASE. Both
-- representations must stay aligned with the TypeScript projection
-- classifier; the alignment is documented in marg-voucher-family.sql.ts.
--
-- All required inputs (type, vcn) are IMMUTABLE under the COALESCE/UPPER/LIKE
-- expression tree, which is the prerequisite for GENERATED ALWAYS STORED.
-- The column is NOT NULL (always evaluates — falls through to 'UNKNOWN').
--
-- Postgres backfills the column atomically when the ALTER TABLE runs, so
-- already-staged rows pick up their family on migration without a separate
-- UPDATE statement.

ALTER TABLE "marg_vouchers"
  ADD COLUMN IF NOT EXISTS "family" TEXT GENERATED ALWAYS AS (
    CASE
      WHEN "type" = 'S' AND UPPER(COALESCE("vcn", '')) LIKE 'STR%'
        THEN 'SALES_INVOICE'
      WHEN "type" = 'S'
        AND (
          UPPER(COALESCE("vcn", '')) LIKE 'CHAL%'
          OR UPPER(COALESCE("vcn", '')) LIKE '*CHAL%'
        )
        THEN 'SALES_CHALLAN'
      WHEN "type" = 'V' AND UPPER(COALESCE("vcn", '')) LIKE 'OS%'
        THEN 'SALES_ORDER'
      WHEN "type" = 'P'
        THEN 'PURCHASE_INVOICE'
      WHEN "type" = 'R' AND UPPER(COALESCE("vcn", '')) LIKE 'CN%'
        THEN 'SALES_RETURN'
      WHEN "type" = 'T' AND UPPER(COALESCE("vcn", '')) LIKE 'SC%'
        THEN 'SALES_RETURN_ADJUSTMENT'
      WHEN "type" = 'B' AND UPPER(COALESCE("vcn", '')) LIKE 'DN%'
        THEN 'PURCHASE_RETURN'
      WHEN "type" = 'X' AND UPPER(COALESCE("vcn", '')) LIKE 'PO-%'
        THEN 'PURCHASE_ORDER'
      WHEN "type" = 'D' AND UPPER(COALESCE("vcn", '')) LIKE 'AD%'
        THEN 'STOCK_RECEIVE'
      WHEN "type" = 'L'
        THEN 'STOCK_ISSUE'
      ELSE 'UNKNOWN'
    END
  ) STORED;

-- Index supports family-filtered reports (e.g. "all sales invoices for
-- tenant X"). Per-tenant scoping keeps the index small even on large
-- multi-tenant deployments.
CREATE INDEX IF NOT EXISTS "marg_vouchers_tenant_family_idx"
  ON "marg_vouchers" ("tenant_id", "family");
