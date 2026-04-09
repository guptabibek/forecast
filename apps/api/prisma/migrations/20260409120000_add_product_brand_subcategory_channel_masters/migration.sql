ALTER TYPE "UserRole" ADD VALUE IF NOT EXISTS 'FORECAST_PLANNER';
ALTER TYPE "UserRole" ADD VALUE IF NOT EXISTS 'FORECAST_VIEWER';

CREATE TABLE "product_brands" (
  "id" UUID NOT NULL DEFAULT uuid_generate_v4(),
  "tenant_id" UUID NOT NULL,
  "code" VARCHAR(50) NOT NULL,
  "name" VARCHAR(100) NOT NULL,
  "description" VARCHAR(500),
  "sort_order" INTEGER NOT NULL DEFAULT 0,
  "is_active" BOOLEAN NOT NULL DEFAULT true,
  "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "product_brands_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "product_brands_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "tenants"("id") ON DELETE CASCADE ON UPDATE CASCADE
);

CREATE UNIQUE INDEX "product_brands_tenant_id_code_key" ON "product_brands"("tenant_id", "code");
CREATE INDEX "product_brands_tenant_id_is_active_idx" ON "product_brands"("tenant_id", "is_active");

CREATE TABLE "product_subcategories" (
  "id" UUID NOT NULL DEFAULT uuid_generate_v4(),
  "tenant_id" UUID NOT NULL,
  "code" VARCHAR(50) NOT NULL,
  "name" VARCHAR(100) NOT NULL,
  "description" VARCHAR(500),
  "category_id" UUID,
  "sort_order" INTEGER NOT NULL DEFAULT 0,
  "is_active" BOOLEAN NOT NULL DEFAULT true,
  "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "product_subcategories_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "product_subcategories_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "tenants"("id") ON DELETE CASCADE ON UPDATE CASCADE,
  CONSTRAINT "product_subcategories_category_id_fkey" FOREIGN KEY ("category_id") REFERENCES "product_categories"("id") ON DELETE SET NULL ON UPDATE CASCADE
);

CREATE UNIQUE INDEX "product_subcategories_tenant_id_code_key" ON "product_subcategories"("tenant_id", "code");
CREATE INDEX "product_subcategories_tenant_id_category_id_idx" ON "product_subcategories"("tenant_id", "category_id");
CREATE INDEX "product_subcategories_tenant_id_is_active_idx" ON "product_subcategories"("tenant_id", "is_active");

CREATE TABLE "channels" (
  "id" UUID NOT NULL DEFAULT uuid_generate_v4(),
  "tenant_id" UUID NOT NULL,
  "code" VARCHAR(50) NOT NULL,
  "name" VARCHAR(100) NOT NULL,
  "description" VARCHAR(500),
  "channel_type" VARCHAR(50),
  "sort_order" INTEGER NOT NULL DEFAULT 0,
  "is_active" BOOLEAN NOT NULL DEFAULT true,
  "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "channels_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "channels_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "tenants"("id") ON DELETE CASCADE ON UPDATE CASCADE
);

CREATE UNIQUE INDEX "channels_tenant_id_code_key" ON "channels"("tenant_id", "code");
CREATE INDEX "channels_tenant_id_is_active_idx" ON "channels"("tenant_id", "is_active");

ALTER TABLE "products"
  ADD COLUMN "subcategory_id" UUID,
  ADD COLUMN "brand_id" UUID;

ALTER TABLE "products"
  ADD CONSTRAINT "products_subcategory_id_fkey" FOREIGN KEY ("subcategory_id") REFERENCES "product_subcategories"("id") ON DELETE SET NULL ON UPDATE CASCADE,
  ADD CONSTRAINT "products_brand_id_fkey" FOREIGN KEY ("brand_id") REFERENCES "product_brands"("id") ON DELETE SET NULL ON UPDATE CASCADE;

CREATE INDEX "products_tenant_id_subcategory_id_idx" ON "products"("tenant_id", "subcategory_id");
CREATE INDEX "products_tenant_id_brand_id_idx" ON "products"("tenant_id", "brand_id");

CREATE TABLE "promotion_channel_targets" (
  "promotion_id" UUID NOT NULL,
  "channel_id" UUID NOT NULL,
  CONSTRAINT "promotion_channel_targets_pkey" PRIMARY KEY ("promotion_id", "channel_id"),
  CONSTRAINT "promotion_channel_targets_promotion_id_fkey" FOREIGN KEY ("promotion_id") REFERENCES "promotions"("id") ON DELETE CASCADE ON UPDATE CASCADE,
  CONSTRAINT "promotion_channel_targets_channel_id_fkey" FOREIGN KEY ("channel_id") REFERENCES "channels"("id") ON DELETE CASCADE ON UPDATE CASCADE
);

CREATE INDEX "promotion_channel_targets_channel_id_idx" ON "promotion_channel_targets"("channel_id");

WITH brand_source AS (
  SELECT p.tenant_id, btrim(p.brand) AS name
  FROM "products" p
  WHERE p.brand IS NOT NULL AND btrim(p.brand) <> ''
  GROUP BY p.tenant_id, btrim(p.brand)
), brand_ranked AS (
  SELECT
    tenant_id,
    name,
    CASE
      WHEN trim(both '_' FROM regexp_replace(upper(name), '[^A-Z0-9]+', '_', 'g')) = '' THEN 'BRAND'
      ELSE left(trim(both '_' FROM regexp_replace(upper(name), '[^A-Z0-9]+', '_', 'g')), 40)
    END AS base_code,
    row_number() OVER (PARTITION BY tenant_id ORDER BY name) AS seq
  FROM brand_source
)
INSERT INTO "product_brands" (
  "id",
  "tenant_id",
  "code",
  "name",
  "sort_order",
  "is_active"
)
SELECT
  uuid_generate_v4(),
  tenant_id,
  left(base_code, 40) || '_' || lpad(seq::text, 4, '0'),
  name,
  seq,
  true
FROM brand_ranked;

UPDATE "products" p
SET
  "brand" = b.name,
  "brand_id" = b.id
FROM "product_brands" b
WHERE p.tenant_id = b.tenant_id
  AND p.brand IS NOT NULL
  AND btrim(p.brand) <> ''
  AND lower(btrim(p.brand)) = lower(b.name);

WITH subcategory_source AS (
  SELECT p.tenant_id, p.category_id, btrim(p.subcategory) AS name
  FROM "products" p
  WHERE p.subcategory IS NOT NULL AND btrim(p.subcategory) <> ''
  GROUP BY p.tenant_id, p.category_id, btrim(p.subcategory)
), subcategory_ranked AS (
  SELECT
    tenant_id,
    category_id,
    name,
    CASE
      WHEN trim(both '_' FROM regexp_replace(upper(name), '[^A-Z0-9]+', '_', 'g')) = '' THEN 'SUBCATEGORY'
      ELSE left(trim(both '_' FROM regexp_replace(upper(name), '[^A-Z0-9]+', '_', 'g')), 36)
    END AS base_code,
    row_number() OVER (PARTITION BY tenant_id ORDER BY coalesce(category_id::text, ''), name) AS seq
  FROM subcategory_source
)
INSERT INTO "product_subcategories" (
  "id",
  "tenant_id",
  "code",
  "name",
  "category_id",
  "sort_order",
  "is_active"
)
SELECT
  uuid_generate_v4(),
  tenant_id,
  left(base_code, 36) || '_' || lpad(seq::text, 4, '0'),
  name,
  category_id,
  seq,
  true
FROM subcategory_ranked;

UPDATE "products" p
SET
  "subcategory" = s.name,
  "subcategory_id" = s.id
FROM "product_subcategories" s
WHERE p.tenant_id = s.tenant_id
  AND p.subcategory IS NOT NULL
  AND btrim(p.subcategory) <> ''
  AND lower(btrim(p.subcategory)) = lower(s.name)
  AND p.category_id IS NOT DISTINCT FROM s.category_id;

WITH channel_source AS (
  SELECT p.tenant_id, btrim(channel_value) AS name
  FROM "promotions" p
  CROSS JOIN LATERAL unnest(coalesce(p.channel_ids, ARRAY[]::text[])) AS channel_value
  WHERE btrim(channel_value) <> ''
  GROUP BY p.tenant_id, btrim(channel_value)
), channel_ranked AS (
  SELECT
    tenant_id,
    name,
    CASE
      WHEN trim(both '_' FROM regexp_replace(upper(name), '[^A-Z0-9]+', '_', 'g')) = '' THEN 'CHANNEL'
      ELSE left(trim(both '_' FROM regexp_replace(upper(name), '[^A-Z0-9]+', '_', 'g')), 40)
    END AS base_code,
    row_number() OVER (PARTITION BY tenant_id ORDER BY name) AS seq
  FROM channel_source
)
INSERT INTO "channels" (
  "id",
  "tenant_id",
  "code",
  "name",
  "sort_order",
  "is_active"
)
SELECT
  uuid_generate_v4(),
  tenant_id,
  left(base_code, 40) || '_' || lpad(seq::text, 4, '0'),
  name,
  seq,
  true
FROM channel_ranked;

INSERT INTO "promotion_channel_targets" ("promotion_id", "channel_id")
SELECT DISTINCT p.id, c.id
FROM "promotions" p
CROSS JOIN LATERAL unnest(coalesce(p.channel_ids, ARRAY[]::text[])) AS channel_value
JOIN "channels" c
  ON c.tenant_id = p.tenant_id
 AND lower(c.name) = lower(btrim(channel_value))
WHERE btrim(channel_value) <> ''
ON CONFLICT DO NOTHING;

UPDATE "promotions" p
SET "channel_ids" = COALESCE(
  (
    SELECT array_agg(pct.channel_id::text ORDER BY pct.channel_id::text)
    FROM "promotion_channel_targets" pct
    WHERE pct.promotion_id = p.id
  ),
  ARRAY[]::text[]
);