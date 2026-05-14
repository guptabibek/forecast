-- CreateTable: tenant_roles for dynamic RBAC
CREATE TABLE IF NOT EXISTS "tenant_roles" (
    "id" UUID NOT NULL DEFAULT uuid_generate_v4(),
    "tenant_id" UUID NOT NULL,
    "name" VARCHAR(100) NOT NULL,
    "slug" VARCHAR(100) NOT NULL,
    "description" VARCHAR(500),
    "module_access" JSONB NOT NULL DEFAULT '{}',
    "permissions" JSONB NOT NULL DEFAULT '[]',
    "is_system" BOOLEAN NOT NULL DEFAULT false,
    "is_default" BOOLEAN NOT NULL DEFAULT false,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "tenant_roles_pkey" PRIMARY KEY ("id")
);

-- AddColumn: custom_role_id on users
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='users' AND column_name='custom_role_id') THEN
    ALTER TABLE "users" ADD COLUMN "custom_role_id" UUID;
  END IF;
END $$;

-- CreateIndex: tenant_roles unique tenant+slug
CREATE UNIQUE INDEX IF NOT EXISTS "tenant_roles_tenant_id_slug_key" ON "tenant_roles"("tenant_id", "slug");

-- CreateIndex: tenant_roles tenant lookup
CREATE INDEX IF NOT EXISTS "tenant_roles_tenant_id_idx" ON "tenant_roles"("tenant_id");

-- AddForeignKey: tenant_roles -> tenants
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'tenant_roles_tenant_id_fkey') THEN
    ALTER TABLE "tenant_roles" ADD CONSTRAINT "tenant_roles_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "tenants"("id") ON DELETE CASCADE ON UPDATE CASCADE;
  END IF;
END $$;

-- AddForeignKey: users.custom_role_id -> tenant_roles
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'users_custom_role_id_fkey') THEN
    ALTER TABLE "users" ADD CONSTRAINT "users_custom_role_id_fkey" FOREIGN KEY ("custom_role_id") REFERENCES "tenant_roles"("id") ON DELETE SET NULL ON UPDATE CASCADE;
  END IF;
END $$;

-- Seed system roles for every existing tenant (skip if already seeded)
INSERT INTO "tenant_roles" ("id", "tenant_id", "name", "slug", "description", "module_access", "permissions", "is_system", "is_default", "created_at", "updated_at")
SELECT
  uuid_generate_v4(),
  t.id,
  r.name,
  r.slug,
  r.description,
  r.module_access::jsonb,
  r.permissions::jsonb,
  true,
  r.slug = 'viewer',
  NOW(),
  NOW()
FROM "tenants" t
CROSS JOIN (
  SELECT 'Admin' AS name, 'admin' AS slug, 'Full access to all features and settings' AS description,
    '{"planning":true,"forecasting":true,"manufacturing":true,"reports":true,"data":true,"marg-ede":true}' AS module_access,
    '["dashboard:read","plan:read","plan:create","plan:edit","plan:delete","plan:approve","forecast:read","forecast:create","forecast:edit","forecast:delete","forecast:run","scenario:read","scenario:create","scenario:edit","scenario:delete","manufacturing:read","manufacturing:create","manufacturing:edit","manufacturing:delete","report:read","report:create","report:export","data:read","data:import","data:export","settings:read","settings:edit","users:read","users:invite","users:edit","users:delete","roles:read","roles:create","roles:edit","roles:delete"]' AS permissions
  UNION ALL
  SELECT 'Planner', 'planner', 'Create and manage plans and forecasts',
    '{"planning":true,"forecasting":true,"manufacturing":true,"reports":true,"data":true,"marg-ede":false}',
    '["dashboard:read","plan:read","plan:create","plan:edit","forecast:read","forecast:create","forecast:edit","forecast:run","scenario:read","scenario:create","scenario:edit","manufacturing:read","report:read","data:read","data:import"]'
  UNION ALL
  SELECT 'Forecast Planner', 'forecast-planner', 'Planning, forecast, and data access without manufacturing',
    '{"planning":true,"forecasting":true,"manufacturing":false,"reports":true,"data":true,"marg-ede":false}',
    '["dashboard:read","plan:read","plan:create","plan:edit","forecast:read","forecast:create","forecast:edit","forecast:run","scenario:read","scenario:create","scenario:edit","report:read","data:read","data:import"]'
  UNION ALL
  SELECT 'Finance', 'finance', 'View reports and approve forecasts',
    '{"planning":true,"forecasting":true,"manufacturing":false,"reports":true,"data":false,"marg-ede":false}',
    '["dashboard:read","plan:read","plan:approve","forecast:read","scenario:read","report:read","report:export"]'
  UNION ALL
  SELECT 'Viewer', 'viewer', 'Read-only access to dashboards and reports',
    '{"planning":true,"forecasting":true,"manufacturing":false,"reports":true,"data":false,"marg-ede":false}',
    '["dashboard:read","plan:read","forecast:read","scenario:read","report:read"]'
  UNION ALL
  SELECT 'Forecast Viewer', 'forecast-viewer', 'Forecast-only read access with reduced navigation',
    '{"planning":true,"forecasting":true,"manufacturing":false,"reports":true,"data":false,"marg-ede":false}',
    '["dashboard:read","plan:read","forecast:read","scenario:read","report:read"]'
) AS r
WHERE NOT EXISTS (
  SELECT 1 FROM "tenant_roles" tr WHERE tr."tenant_id" = t.id AND tr."slug" = r.slug
);

-- Back-fill: link existing users to their matching system TenantRole
UPDATE "users" u
SET "custom_role_id" = tr.id
FROM "tenant_roles" tr
WHERE tr."tenant_id" = u."tenant_id"
  AND tr."is_system" = true
  AND u."custom_role_id" IS NULL
  AND (
    (u."role" = 'ADMIN'             AND tr."slug" = 'admin')
    OR (u."role" = 'PLANNER'        AND tr."slug" = 'planner')
    OR (u."role" = 'FORECAST_PLANNER' AND tr."slug" = 'forecast-planner')
    OR (u."role" = 'FINANCE'        AND tr."slug" = 'finance')
    OR (u."role" = 'VIEWER'         AND tr."slug" = 'viewer')
    OR (u."role" = 'FORECAST_VIEWER' AND tr."slug" = 'forecast-viewer')
  );
