-- Migration: Add tenantId to RefreshToken + Multi-Tenant Hardening
-- This migration:
-- 1. Adds tenant_id column to refresh_tokens table
-- 2. Backfills from user's tenant
-- 3. Makes column NOT NULL
-- 4. Adds FK constraint and index

-- Step 1: Add nullable tenant_id column
ALTER TABLE "refresh_tokens"
ADD COLUMN "tenant_id" UUID;

-- Step 2: Backfill tenant_id from the related user's tenant
UPDATE "refresh_tokens" rt
SET "tenant_id" = u."tenant_id"
FROM "users" u
WHERE rt."user_id" = u."id";

-- Step 3: Delete any orphaned refresh tokens (user deleted, no tenant resolvable)
DELETE FROM "refresh_tokens" WHERE "tenant_id" IS NULL;

-- Step 4: Make column NOT NULL
ALTER TABLE "refresh_tokens"
ALTER COLUMN "tenant_id" SET NOT NULL;

-- Step 5: Add FK constraint
ALTER TABLE "refresh_tokens"
ADD CONSTRAINT "refresh_tokens_tenant_id_fkey"
FOREIGN KEY ("tenant_id") REFERENCES "tenants"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- Step 6: Add index on tenant_id
CREATE INDEX "refresh_tokens_tenant_id_idx" ON "refresh_tokens"("tenant_id");
