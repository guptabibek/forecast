-- Migration: Persist Marg's "soft delete" cancellation markers on staged rows.
--
-- Marg encodes cancellation as a `CANCELLED : 1` + `CANCELLEDON : dd-MM-yyyy
-- HH:mm:ss` token at the tail of the AddField string on Dis (line) and
-- occasionally MDis (voucher header) rows. Until now we re-parsed AddField at
-- projection time, which:
--   1) Forced every SQL report that aggregates Marg vouchers to either repeat
--      the regex parse (slow + duplicated) or silently include cancelled
--      documents in totals (wrong).
--   2) Made it impossible to filter cancelled rows at the staging layer for
--      diagnostics, dashboards, drilldowns, exports, etc.
--   3) Coupled the read-time "is this still alive?" decision to the projection
--      code path — meaning new consumers (reports, KPIs, BI) had to know to
--      parse AddField themselves or risk double-counting.
--
-- Lifting `is_cancelled` and `cancelled_on` into first-class staging columns
-- collapses all of the above to a single `WHERE NOT is_cancelled` filter.
-- The values are populated at staging time by parseMargCancellation() and
-- treated as immutable for the row's lifetime (a Marg row that becomes
-- cancelled is re-emitted by Marg with the marker, replacing the staged row).
--
-- All additions are additive and default-FALSE so already-staged rows pass
-- through this migration as "not cancelled" until the next sync re-stages
-- them with the correct value. That matches the prior behaviour (no
-- cancellation handling at staging time) so reports / projections don't
-- spuriously start treating live rows as cancelled the moment this migration
-- runs.
--
-- Partial indexes ON (tenant_id) WHERE NOT is_cancelled are the right shape
-- because the dominant access pattern is "give me all live rows for this
-- tenant" — full indexes on the boolean would waste space on the cancelled
-- minority that's rarely scanned.

ALTER TABLE "marg_vouchers"
  ADD COLUMN IF NOT EXISTS "is_cancelled" BOOLEAN NOT NULL DEFAULT FALSE,
  ADD COLUMN IF NOT EXISTS "cancelled_on" TIMESTAMP(3) NULL;

ALTER TABLE "marg_transactions"
  ADD COLUMN IF NOT EXISTS "is_cancelled" BOOLEAN NOT NULL DEFAULT FALSE,
  ADD COLUMN IF NOT EXISTS "cancelled_on" TIMESTAMP(3) NULL;

CREATE INDEX IF NOT EXISTS "marg_vouchers_tenant_live_idx"
  ON "marg_vouchers" ("tenant_id")
  WHERE "is_cancelled" = FALSE;

CREATE INDEX IF NOT EXISTS "marg_transactions_tenant_live_idx"
  ON "marg_transactions" ("tenant_id")
  WHERE "is_cancelled" = FALSE;
