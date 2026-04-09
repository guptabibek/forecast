ALTER TABLE "products"
  ADD COLUMN IF NOT EXISTS "category_id" UUID;

ALTER TABLE "products"
  ADD COLUMN IF NOT EXISTS "unit_of_measure_id" UUID;

WITH legacy_categories AS (
  SELECT DISTINCT
    "tenant_id",
    BTRIM("category") AS "category_name"
  FROM "products"
  WHERE "category" IS NOT NULL
    AND BTRIM("category") <> ''
)
INSERT INTO "product_categories" (
  "id",
  "tenant_id",
  "code",
  "name",
  "description",
  "sort_order",
  "is_active",
  "created_at",
  "updated_at"
)
SELECT
  uuid_generate_v4(),
  legacy_categories."tenant_id",
  'LEGACY_' || LEFT(UPPER(REGEXP_REPLACE(legacy_categories."category_name", '[^A-Za-z0-9]+', '_', 'g')), 34) || '_' || UPPER(SUBSTRING(MD5(LOWER(legacy_categories."category_name")) FROM 1 FOR 8)),
  legacy_categories."category_name",
  'Migrated from legacy product category text',
  999,
  TRUE,
  NOW(),
  NOW()
FROM legacy_categories
WHERE NOT EXISTS (
  SELECT 1
  FROM "product_categories" product_categories
  WHERE product_categories."tenant_id" = legacy_categories."tenant_id"
    AND (
      LOWER(product_categories."name") = LOWER(legacy_categories."category_name")
      OR LOWER(product_categories."code") = LOWER(legacy_categories."category_name")
    )
);

WITH legacy_uoms AS (
  SELECT DISTINCT
    "tenant_id",
    BTRIM("unit_of_measure") AS "uom_name"
  FROM "products"
  WHERE "unit_of_measure" IS NOT NULL
    AND BTRIM("unit_of_measure") <> ''
)
INSERT INTO "unit_of_measures" (
  "id",
  "tenant_id",
  "code",
  "name",
  "category",
  "description",
  "decimals",
  "is_base",
  "is_active",
  "sort_order",
  "created_at",
  "updated_at"
)
SELECT
  uuid_generate_v4(),
  legacy_uoms."tenant_id",
  LEFT(UPPER(REGEXP_REPLACE(legacy_uoms."uom_name", '[^A-Za-z0-9]+', '_', 'g')), 11) || '_' || UPPER(SUBSTRING(MD5(LOWER(legacy_uoms."uom_name")) FROM 1 FOR 8)),
  legacy_uoms."uom_name",
  'OTHER'::"UomCategory",
  'Migrated from legacy product unit of measure text',
  2,
  FALSE,
  TRUE,
  999,
  NOW(),
  NOW()
FROM legacy_uoms
WHERE NOT EXISTS (
  SELECT 1
  FROM "unit_of_measures" unit_of_measures
  WHERE unit_of_measures."tenant_id" = legacy_uoms."tenant_id"
    AND (
      LOWER(unit_of_measures."code") = LOWER(legacy_uoms."uom_name")
      OR LOWER(unit_of_measures."name") = LOWER(legacy_uoms."uom_name")
    )
);

WITH matched_categories AS (
  SELECT
    products."id" AS "product_id",
    category_match."id" AS "category_id"
  FROM "products" products
  JOIN LATERAL (
    SELECT product_categories."id"
    FROM "product_categories" product_categories
    WHERE product_categories."tenant_id" = products."tenant_id"
      AND products."category" IS NOT NULL
      AND BTRIM(products."category") <> ''
      AND (
        LOWER(product_categories."name") = LOWER(BTRIM(products."category"))
        OR LOWER(product_categories."code") = LOWER(BTRIM(products."category"))
      )
    ORDER BY CASE
      WHEN LOWER(product_categories."name") = LOWER(BTRIM(products."category")) THEN 0
      ELSE 1
    END,
    product_categories."created_at"
    LIMIT 1
  ) category_match ON TRUE
  WHERE products."category_id" IS NULL
)
UPDATE "products" products
SET "category_id" = matched_categories."category_id"
FROM matched_categories
WHERE products."id" = matched_categories."product_id";

WITH matched_uoms AS (
  SELECT
    products."id" AS "product_id",
    unit_of_measure_match."id" AS "unit_of_measure_id"
  FROM "products" products
  JOIN LATERAL (
    SELECT unit_of_measures."id"
    FROM "unit_of_measures" unit_of_measures
    WHERE unit_of_measures."tenant_id" = products."tenant_id"
      AND products."unit_of_measure" IS NOT NULL
      AND BTRIM(products."unit_of_measure") <> ''
      AND (
        LOWER(unit_of_measures."code") = LOWER(BTRIM(products."unit_of_measure"))
        OR LOWER(unit_of_measures."name") = LOWER(BTRIM(products."unit_of_measure"))
      )
    ORDER BY CASE
      WHEN LOWER(unit_of_measures."code") = LOWER(BTRIM(products."unit_of_measure")) THEN 0
      ELSE 1
    END,
    unit_of_measures."created_at"
    LIMIT 1
  ) unit_of_measure_match ON TRUE
  WHERE products."unit_of_measure_id" IS NULL
)
UPDATE "products" products
SET "unit_of_measure_id" = matched_uoms."unit_of_measure_id"
FROM matched_uoms
WHERE products."id" = matched_uoms."product_id";

UPDATE "products" products
SET "category" = product_categories."name"
FROM "product_categories" product_categories
WHERE products."category_id" = product_categories."id"
  AND products."category" IS DISTINCT FROM product_categories."name";

UPDATE "products" products
SET "unit_of_measure" = unit_of_measures."code"
FROM "unit_of_measures" unit_of_measures
WHERE products."unit_of_measure_id" = unit_of_measures."id"
  AND products."unit_of_measure" IS DISTINCT FROM unit_of_measures."code";

CREATE INDEX IF NOT EXISTS "products_tenant_id_category_id_idx" ON "products"("tenant_id", "category_id");
CREATE INDEX IF NOT EXISTS "products_tenant_id_unit_of_measure_id_idx" ON "products"("tenant_id", "unit_of_measure_id");

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'products_category_id_fkey'
  ) THEN
    ALTER TABLE "products"
      ADD CONSTRAINT "products_category_id_fkey"
      FOREIGN KEY ("category_id") REFERENCES "product_categories"("id") ON DELETE SET NULL ON UPDATE CASCADE;
  END IF;
END $$;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'products_unit_of_measure_id_fkey'
  ) THEN
    ALTER TABLE "products"
      ADD CONSTRAINT "products_unit_of_measure_id_fkey"
      FOREIGN KEY ("unit_of_measure_id") REFERENCES "unit_of_measures"("id") ON DELETE SET NULL ON UPDATE CASCADE;
  END IF;
END $$;