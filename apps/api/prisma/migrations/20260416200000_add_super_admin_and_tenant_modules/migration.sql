-- Add SUPER_ADMIN to UserRole enum
ALTER TYPE "UserRole" ADD VALUE IF NOT EXISTS 'SUPER_ADMIN' BEFORE 'ADMIN';

-- Create tenant_modules table
CREATE TABLE IF NOT EXISTS "tenant_modules" (
    "id" UUID NOT NULL DEFAULT uuid_generate_v4(),
    "tenant_id" UUID NOT NULL,
    "module" VARCHAR(50) NOT NULL,
    "enabled" BOOLEAN NOT NULL DEFAULT true,
    "config" JSONB NOT NULL DEFAULT '{}',
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "tenant_modules_pkey" PRIMARY KEY ("id"),
    CONSTRAINT "tenant_modules_tenant_id_fkey" FOREIGN KEY ("tenant_id")
        REFERENCES "tenants"("id") ON DELETE CASCADE ON UPDATE CASCADE
);

-- Unique constraint: one record per tenant+module
CREATE UNIQUE INDEX IF NOT EXISTS "tenant_modules_tenant_id_module_key"
    ON "tenant_modules"("tenant_id", "module");

-- Performance index
CREATE INDEX IF NOT EXISTS "tenant_modules_tenant_id_idx"
    ON "tenant_modules"("tenant_id");

-- Initialize default modules for all existing tenants
INSERT INTO "tenant_modules" ("id", "tenant_id", "module", "enabled", "created_at", "updated_at")
SELECT uuid_generate_v4(), t.id, m.module, m.enabled, NOW(), NOW()
FROM "tenants" t
CROSS JOIN (VALUES
    ('planning', true),
    ('forecasting', true),
    ('manufacturing', false),
    ('reports', true),
    ('data', true),
    ('marg-ede', false)
) AS m(module, enabled)
WHERE NOT EXISTS (
    SELECT 1 FROM "tenant_modules" tm
    WHERE tm."tenant_id" = t.id AND tm."module" = m.module
);
