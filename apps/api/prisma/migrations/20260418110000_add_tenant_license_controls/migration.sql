DO $$
BEGIN
    CREATE TYPE "TenantLicenseStatus" AS ENUM ('ACTIVE', 'SUSPENDED');
EXCEPTION
    WHEN duplicate_object THEN NULL;
END $$;

ALTER TABLE "tenants"
    ADD COLUMN IF NOT EXISTS "license_status" "TenantLicenseStatus" NOT NULL DEFAULT 'ACTIVE',
    ADD COLUMN IF NOT EXISTS "license_expires_at" TIMESTAMP(3);