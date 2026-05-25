CREATE TYPE "InventoryPolicyScopeType" AS ENUM (
  'PRODUCT_COMPANY',
  'HSN_CODE',
  'SALT',
  'PRODUCT_GROUP',
  'SUPPLIER'
);

CREATE TABLE "inventory_policy_scopes" (
  "id" UUID NOT NULL DEFAULT uuid_generate_v4(),
  "tenant_id" UUID NOT NULL,
  "scope_type" "InventoryPolicyScopeType" NOT NULL,
  "scope_code" VARCHAR(100),
  "scope_id" UUID,
  "location_id" UUID,
  "priority" INTEGER NOT NULL DEFAULT 0,
  "reorder_point" DECIMAL(18,4),
  "reorder_qty" DECIMAL(18,4),
  "min_order_qty" DECIMAL(18,4),
  "max_order_qty" DECIMAL(18,4),
  "multiple_order_qty" DECIMAL(18,4),
  "safety_stock_qty" DECIMAL(18,4),
  "safety_stock_days" INTEGER,
  "lead_time_days" INTEGER,
  "abc_class" VARCHAR(1),
  "effective_from" DATE NOT NULL DEFAULT CURRENT_DATE,
  "effective_to" DATE,
  "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

  CONSTRAINT "inventory_policy_scopes_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "inventory_policy_scopes_scope_identity_chk" CHECK (
    (
      "scope_type" = 'SUPPLIER'
      AND "scope_id" IS NOT NULL
      AND "scope_code" IS NULL
    )
    OR
    (
      "scope_type" <> 'SUPPLIER'
      AND "scope_code" IS NOT NULL
      AND btrim("scope_code") <> ''
      AND "scope_id" IS NULL
    )
  ),
  CONSTRAINT "inventory_policy_scopes_non_negative_chk" CHECK (
    COALESCE("reorder_point", 0) >= 0
    AND COALESCE("reorder_qty", 0) >= 0
    AND COALESCE("min_order_qty", 0) >= 0
    AND COALESCE("max_order_qty", 0) >= 0
    AND COALESCE("multiple_order_qty", 0) >= 0
    AND COALESCE("safety_stock_qty", 0) >= 0
    AND COALESCE("safety_stock_days", 0) >= 0
    AND COALESCE("lead_time_days", 0) >= 0
  ),
  CONSTRAINT "inventory_policy_scopes_effective_dates_chk" CHECK (
    "effective_to" IS NULL OR "effective_to" >= "effective_from"
  )
);

CREATE INDEX "inventory_policy_scopes_tenant_scope_code_idx"
  ON "inventory_policy_scopes"("tenant_id", "scope_type", "scope_code");

CREATE INDEX "inventory_policy_scopes_tenant_scope_id_idx"
  ON "inventory_policy_scopes"("tenant_id", "scope_type", "scope_id");

CREATE INDEX "inventory_policy_scopes_tenant_location_idx"
  ON "inventory_policy_scopes"("tenant_id", "location_id");

CREATE UNIQUE INDEX "inventory_policy_scopes_unique_code_scope"
  ON "inventory_policy_scopes"(
    "tenant_id",
    "scope_type",
    "scope_code",
    COALESCE("location_id", '00000000-0000-0000-0000-000000000000'::uuid)
  )
  WHERE "scope_code" IS NOT NULL;

CREATE UNIQUE INDEX "inventory_policy_scopes_unique_id_scope"
  ON "inventory_policy_scopes"(
    "tenant_id",
    "scope_type",
    "scope_id",
    COALESCE("location_id", '00000000-0000-0000-0000-000000000000'::uuid)
  )
  WHERE "scope_id" IS NOT NULL;
