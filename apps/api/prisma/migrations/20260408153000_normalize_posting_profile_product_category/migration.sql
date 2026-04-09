ALTER TABLE "posting_profiles"
  ADD COLUMN IF NOT EXISTS "product_category_id" UUID;

WITH matched_categories AS (
  SELECT
    posting_profiles."id" AS "posting_profile_id",
    category_match."id" AS "product_category_id"
  FROM "posting_profiles" posting_profiles
  JOIN LATERAL (
    SELECT product_categories."id"
    FROM "product_categories" product_categories
    WHERE product_categories."tenant_id" = posting_profiles."tenant_id"
      AND posting_profiles."product_category" IS NOT NULL
      AND BTRIM(posting_profiles."product_category") <> ''
      AND (
        LOWER(product_categories."name") = LOWER(BTRIM(posting_profiles."product_category"))
        OR LOWER(product_categories."code") = LOWER(BTRIM(posting_profiles."product_category"))
      )
    ORDER BY CASE
      WHEN LOWER(product_categories."name") = LOWER(BTRIM(posting_profiles."product_category")) THEN 0
      ELSE 1
    END,
    product_categories."created_at"
    LIMIT 1
  ) category_match ON TRUE
  WHERE posting_profiles."product_category_id" IS NULL
)
UPDATE "posting_profiles" posting_profiles
SET "product_category_id" = matched_categories."product_category_id"
FROM matched_categories
WHERE posting_profiles."id" = matched_categories."posting_profile_id";

UPDATE "posting_profiles" posting_profiles
SET "product_category" = product_categories."name"
FROM "product_categories" product_categories
WHERE posting_profiles."product_category_id" = product_categories."id"
  AND posting_profiles."product_category" IS DISTINCT FROM product_categories."name";

CREATE INDEX IF NOT EXISTS "posting_profiles_tenant_id_product_category_id_idx" ON "posting_profiles"("tenant_id", "product_category_id");

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'posting_profiles_product_category_id_fkey'
  ) THEN
    ALTER TABLE "posting_profiles"
      ADD CONSTRAINT "posting_profiles_product_category_id_fkey"
      FOREIGN KEY ("product_category_id") REFERENCES "product_categories"("id") ON DELETE SET NULL ON UPDATE CASCADE;
  END IF;
END $$;