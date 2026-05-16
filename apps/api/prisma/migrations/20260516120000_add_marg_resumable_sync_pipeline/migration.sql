-- Migration: Resumable Marg EDE sync pipeline
--
-- All changes are additive and backward-compatible:
--   * MargSyncLog gains stage / progress / heartbeat / retry / failure-class
--     columns. Existing rows continue to satisfy the new constraints because
--     every new column is either nullable or has a safe default.
--   * MargRawSyncPage is a new table that records one row per Marg API page
--     so a staging failure does not require refetching a 50MB encrypted
--     payload from Marg. Decrypted/parsed payload bytes are persisted by the
--     application to a payload-storage backend (filesystem by default); only
--     the storage_path + hash + metadata live in Postgres to avoid DB bloat.
--
-- Safe to apply in production: no destructive operations, all indexes use
-- IF NOT EXISTS, all column additions use IF NOT EXISTS. The new RLS policy
-- mirrors the permissive-when-NULL pattern already used by the other marg_*
-- tables (see 20260416100000_add_row_level_security).

-- ============================================================================
-- 1. Extend marg_sync_logs with resumable-pipeline progress columns
-- ============================================================================

ALTER TABLE "marg_sync_logs"
  ADD COLUMN IF NOT EXISTS "current_stage"            VARCHAR(40),
  ADD COLUMN IF NOT EXISTS "current_api_type"         VARCHAR(2),
  ADD COLUMN IF NOT EXISTS "current_request_index"    INTEGER,
  ADD COLUMN IF NOT EXISTS "current_response_index"   INTEGER,
  ADD COLUMN IF NOT EXISTS "current_entity_type"      VARCHAR(50),
  ADD COLUMN IF NOT EXISTS "current_batch_number"     INTEGER,
  ADD COLUMN IF NOT EXISTS "rows_processed"           BIGINT NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS "total_rows_discovered"    BIGINT,
  ADD COLUMN IF NOT EXISTS "last_heartbeat_at"        TIMESTAMP(3),
  ADD COLUMN IF NOT EXISTS "retry_count"              INTEGER NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS "failure_type"             VARCHAR(20),
  ADD COLUMN IF NOT EXISTS "resumed_from_sync_log_id" UUID;

-- failure_type is a soft enum: only the two listed values are valid when set.
-- Drop-then-add makes the migration re-runnable if a previous partial apply
-- already created the constraint.
ALTER TABLE "marg_sync_logs"
  DROP CONSTRAINT IF EXISTS "marg_sync_logs_failure_type_check";
ALTER TABLE "marg_sync_logs"
  ADD CONSTRAINT "marg_sync_logs_failure_type_check"
    CHECK ("failure_type" IS NULL OR "failure_type" IN ('RETRYABLE', 'FATAL'));

-- Stale-running recovery scan: scheduler finds RUNNING logs with stale
-- last_heartbeat_at and marks them FAILED_RETRYABLE for resume.
CREATE INDEX IF NOT EXISTS "marg_sync_logs_tenant_status_heartbeat_idx"
  ON "marg_sync_logs"("tenant_id", "status", "last_heartbeat_at");

-- Per-config status filtering used by status endpoint and resume lookups.
CREATE INDEX IF NOT EXISTS "marg_sync_logs_tenant_config_status_idx"
  ON "marg_sync_logs"("tenant_id", "config_id", "status");

-- ============================================================================
-- 2. New table: marg_raw_sync_pages
-- ============================================================================

CREATE TABLE IF NOT EXISTS "marg_raw_sync_pages" (
  "id"                  UUID         NOT NULL DEFAULT uuid_generate_v4(),
  "tenant_id"           UUID         NOT NULL,
  "config_id"           UUID         NOT NULL,
  "sync_log_id"         UUID         NOT NULL,
  "api_type"            VARCHAR(2)   NOT NULL,
  "company_id"          INTEGER      NOT NULL,
  "request_index"       INTEGER      NOT NULL,
  "response_index"      INTEGER,
  "request_datetime"    VARCHAR(50),
  "response_datetime"   VARCHAR(50),
  "data_status"         INTEGER,
  "encrypted_size"      INTEGER,
  "decrypted_size"      INTEGER,
  "row_counts"          JSONB,
  "storage_path"        VARCHAR(500),
  "payload_hash"        VARCHAR(64),
  "status"              VARCHAR(30)  NOT NULL DEFAULT 'PENDING_STAGE',
  "error"               JSONB,
  "staged_at"           TIMESTAMP(3),
  "created_at"          TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at"          TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "marg_raw_sync_pages_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "marg_raw_sync_pages_status_check"
    CHECK ("status" IN ('PENDING_STAGE', 'STAGING', 'STAGED', 'STAGING_FAILED', 'DISCARDED')),
  CONSTRAINT "marg_raw_sync_pages_sync_log_id_fkey"
    FOREIGN KEY ("sync_log_id")
    REFERENCES "marg_sync_logs"("id")
    ON DELETE CASCADE
    ON UPDATE NO ACTION
);

-- Idempotency: the same (syncLogId, apiType, requestIndex) tuple may be
-- re-saved if the worker is killed between fetch and DB commit and retried.
-- Upsert into the same row instead of duplicating.
CREATE UNIQUE INDEX IF NOT EXISTS "marg_raw_sync_pages_sync_log_id_api_type_request_index_key"
  ON "marg_raw_sync_pages"("sync_log_id", "api_type", "request_index");

CREATE INDEX IF NOT EXISTS "marg_raw_sync_pages_tenant_config_api_request_idx"
  ON "marg_raw_sync_pages"("tenant_id", "config_id", "api_type", "request_index");

CREATE INDEX IF NOT EXISTS "marg_raw_sync_pages_sync_log_status_idx"
  ON "marg_raw_sync_pages"("sync_log_id", "status");

CREATE INDEX IF NOT EXISTS "marg_raw_sync_pages_tenant_config_status_idx"
  ON "marg_raw_sync_pages"("tenant_id", "config_id", "status");

-- ============================================================================
-- 3. Row Level Security on the new table
-- ============================================================================

ALTER TABLE "marg_raw_sync_pages" ENABLE ROW LEVEL SECURITY;

-- Permissive when no tenant context is set (matches superuser/migration
-- behavior used elsewhere). Application code sets app.current_tenant_id via
-- set_config() inside the Prisma middleware for tenant-scoped operations.
DROP POLICY IF EXISTS "tenant_isolation" ON "marg_raw_sync_pages";
CREATE POLICY "tenant_isolation" ON "marg_raw_sync_pages"
  USING (current_tenant_id() IS NULL OR tenant_id = current_tenant_id())
  WITH CHECK (current_tenant_id() IS NULL OR tenant_id = current_tenant_id());
