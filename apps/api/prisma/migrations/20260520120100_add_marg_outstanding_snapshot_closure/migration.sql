-- Migration: Soft-deletion for staged Marg outstandings on authoritative
-- APIType=1 snapshots.
--
-- Outstanding rows represent open AR/AP balances pulled from Marg via the
-- APIType=1 payload. Marg only re-emits a row in subsequent syncs while it
-- remains open; once an outstanding is settled or cancelled at the source,
-- it simply disappears from the payload. Until now the staging table had no
-- mechanism to detect this disappearance, so AR/AP aging reports kept
-- displaying long-settled invoices indefinitely.
--
-- The fix is the standard staged-snapshot pattern:
--   1) Every staging row records `last_seen_sync_log_id` = the sync log that
--      most recently observed the row in the payload.
--   2) An *authoritative* snapshot pass (datastatus = 10 + no date-window
--      filter, i.e. Marg is emitting its complete current dataset) marks
--      every row whose `last_seen_sync_log_id` is not the current sync log
--      as `source_deleted = TRUE`.
--   3) Reports filter `WHERE NOT source_deleted` to exclude closed
--      outstandings from open-aging views.
--
-- Why soft-delete rather than hard-delete? Audit. An operator investigating
-- "why did the customer's overdue jump $50k month-on-month?" needs to be
-- able to see the row that was open last week but closed today. Hard-delete
-- destroys that trace. Soft-delete keeps it queryable.
--
-- `last_seen_sync_log_id` is intentionally NOT a foreign key. Sync logs are
-- pruned eventually for storage; we do not want outstandings to either
-- cascade-delete or block sync-log cleanup. The column is purely a
-- diagnostic breadcrumb.
--
-- Partial index keeps the common-case "live outstandings for this tenant"
-- query fast without bloating the index with soft-deleted history.

ALTER TABLE "marg_outstandings"
  ADD COLUMN IF NOT EXISTS "source_deleted" BOOLEAN NOT NULL DEFAULT FALSE,
  ADD COLUMN IF NOT EXISTS "last_seen_sync_log_id" UUID NULL;

CREATE INDEX IF NOT EXISTS "marg_outstandings_tenant_live_idx"
  ON "marg_outstandings" ("tenant_id", "date")
  WHERE "source_deleted" = FALSE;

CREATE INDEX IF NOT EXISTS "marg_outstandings_last_seen_idx"
  ON "marg_outstandings" ("tenant_id", "last_seen_sync_log_id");
