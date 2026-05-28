-- Reconstructed migration (idempotent).
--
-- This migration creates the `marg_movement_rollup` staging table. Its original
-- migration.sql was applied to existing databases but never committed to version
-- control (it was authored in an uncommitted local session on 2026-05-25). The
-- table definition below was reproduced faithfully from the live database schema
-- so that (a) the migration history is contiguous and (b) fresh environments
-- create an identical table. `IF NOT EXISTS` makes it a safe no-op where the
-- table already exists.
CREATE TABLE IF NOT EXISTS "marg_movement_rollup" (
    "tenant_id"         UUID NOT NULL,
    "company_id"        INTEGER NOT NULL,
    "voucher"           VARCHAR(50) NOT NULL,
    "voucher_type"      VARCHAR(10) NOT NULL,
    "family"            TEXT,
    "movement_date"     DATE NOT NULL,
    "kind"              VARCHAR(20) NOT NULL,
    "transaction_type"  VARCHAR(10) NOT NULL,
    "pid"               VARCHAR(20) NOT NULL DEFAULT '',
    "product_id"        UUID,
    "customer_id"       UUID,
    "branch_id"         UUID,
    "location_id"       UUID,
    "signed_quantity"   NUMERIC(18,4) NOT NULL DEFAULT 0,
    "signed_amount"     NUMERIC(18,4) NOT NULL DEFAULT 0,
    "source_updated_at" TIMESTAMPTZ,
    "created_at"        TIMESTAMPTZ NOT NULL DEFAULT now(),
    "updated_at"        TIMESTAMPTZ NOT NULL DEFAULT now(),
    CONSTRAINT "marg_movement_rollup_pkey" PRIMARY KEY ("tenant_id", "company_id", "voucher", "voucher_type", "kind", "transaction_type", "pid")
);
