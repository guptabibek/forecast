-- Migration: Persist date-window / mode / scope metadata on every Marg sync log.
--
-- Without these columns, resume cannot reliably replay staging with the same
-- window the original run used. A bounded backfill that crashes mid-staging
-- could otherwise be resumed as if it were an unbounded incremental, which
-- would re-stage out-of-window rows.
--
-- All additions are nullable: existing rows from before this migration
-- preserve their NULL values, and resumeSync refuses any log whose
-- currentStage is also NULL (= predates the new pipeline).

ALTER TABLE "marg_sync_logs"
  ADD COLUMN IF NOT EXISTS "from_date"  VARCHAR(20),
  ADD COLUMN IF NOT EXISTS "end_date"   VARCHAR(20),
  ADD COLUMN IF NOT EXISTS "sync_scope" VARCHAR(20),
  ADD COLUMN IF NOT EXISTS "sync_mode"  VARCHAR(20);

-- Soft enums: only the documented values may be persisted when set.
-- syncScope: 'full' | 'accounting' (mirrors MARG_SYNC_SCOPE constants)
-- syncMode:  'fetch' | 'reproject' | 'resume' (mirrors MARG_SYNC_MODE constants)
ALTER TABLE "marg_sync_logs"
  DROP CONSTRAINT IF EXISTS "marg_sync_logs_sync_scope_check";
ALTER TABLE "marg_sync_logs"
  ADD CONSTRAINT "marg_sync_logs_sync_scope_check"
    CHECK ("sync_scope" IS NULL OR "sync_scope" IN ('full', 'accounting'));

ALTER TABLE "marg_sync_logs"
  DROP CONSTRAINT IF EXISTS "marg_sync_logs_sync_mode_check";
ALTER TABLE "marg_sync_logs"
  ADD CONSTRAINT "marg_sync_logs_sync_mode_check"
    CHECK ("sync_mode" IS NULL OR "sync_mode" IN ('fetch', 'reproject', 'resume'));
