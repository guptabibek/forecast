CREATE TABLE IF NOT EXISTS "promotion_product_targets" (
  "promotion_id" UUID NOT NULL,
  "product_id" UUID NOT NULL,

  CONSTRAINT "promotion_product_targets_pkey" PRIMARY KEY ("promotion_id", "product_id")
);

CREATE TABLE IF NOT EXISTS "promotion_location_targets" (
  "promotion_id" UUID NOT NULL,
  "location_id" UUID NOT NULL,

  CONSTRAINT "promotion_location_targets_pkey" PRIMARY KEY ("promotion_id", "location_id")
);

CREATE TABLE IF NOT EXISTS "promotion_customer_targets" (
  "promotion_id" UUID NOT NULL,
  "customer_id" UUID NOT NULL,

  CONSTRAINT "promotion_customer_targets_pkey" PRIMARY KEY ("promotion_id", "customer_id")
);

CREATE INDEX IF NOT EXISTS "promotion_product_targets_product_id_idx"
  ON "promotion_product_targets"("product_id");

CREATE INDEX IF NOT EXISTS "promotion_location_targets_location_id_idx"
  ON "promotion_location_targets"("location_id");

CREATE INDEX IF NOT EXISTS "promotion_customer_targets_customer_id_idx"
  ON "promotion_customer_targets"("customer_id");

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'promotion_product_targets_promotion_id_fkey'
  ) THEN
    ALTER TABLE "promotion_product_targets"
      ADD CONSTRAINT "promotion_product_targets_promotion_id_fkey"
      FOREIGN KEY ("promotion_id") REFERENCES "promotions"("id") ON DELETE CASCADE ON UPDATE CASCADE;
  END IF;
END $$;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'promotion_product_targets_product_id_fkey'
  ) THEN
    ALTER TABLE "promotion_product_targets"
      ADD CONSTRAINT "promotion_product_targets_product_id_fkey"
      FOREIGN KEY ("product_id") REFERENCES "products"("id") ON DELETE CASCADE ON UPDATE CASCADE;
  END IF;
END $$;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'promotion_location_targets_promotion_id_fkey'
  ) THEN
    ALTER TABLE "promotion_location_targets"
      ADD CONSTRAINT "promotion_location_targets_promotion_id_fkey"
      FOREIGN KEY ("promotion_id") REFERENCES "promotions"("id") ON DELETE CASCADE ON UPDATE CASCADE;
  END IF;
END $$;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'promotion_location_targets_location_id_fkey'
  ) THEN
    ALTER TABLE "promotion_location_targets"
      ADD CONSTRAINT "promotion_location_targets_location_id_fkey"
      FOREIGN KEY ("location_id") REFERENCES "locations"("id") ON DELETE CASCADE ON UPDATE CASCADE;
  END IF;
END $$;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'promotion_customer_targets_promotion_id_fkey'
  ) THEN
    ALTER TABLE "promotion_customer_targets"
      ADD CONSTRAINT "promotion_customer_targets_promotion_id_fkey"
      FOREIGN KEY ("promotion_id") REFERENCES "promotions"("id") ON DELETE CASCADE ON UPDATE CASCADE;
  END IF;
END $$;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'promotion_customer_targets_customer_id_fkey'
  ) THEN
    ALTER TABLE "promotion_customer_targets"
      ADD CONSTRAINT "promotion_customer_targets_customer_id_fkey"
      FOREIGN KEY ("customer_id") REFERENCES "customers"("id") ON DELETE CASCADE ON UPDATE CASCADE;
  END IF;
END $$;

INSERT INTO "promotion_product_targets" ("promotion_id", "product_id")
SELECT
  promotions."id",
  products."id"
FROM "promotions" promotions
CROSS JOIN LATERAL UNNEST(COALESCE(promotions."product_ids", ARRAY[]::TEXT[])) AS raw_product_id("value")
JOIN "products" products
  ON products."tenant_id" = promotions."tenant_id"
 AND products."id" = raw_product_id."value"::uuid
WHERE raw_product_id."value" ~* '^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$'
ON CONFLICT ("promotion_id", "product_id") DO NOTHING;

INSERT INTO "promotion_location_targets" ("promotion_id", "location_id")
SELECT
  promotions."id",
  locations."id"
FROM "promotions" promotions
CROSS JOIN LATERAL UNNEST(COALESCE(promotions."location_ids", ARRAY[]::TEXT[])) AS raw_location_id("value")
JOIN "locations" locations
  ON locations."tenant_id" = promotions."tenant_id"
 AND locations."id" = raw_location_id."value"::uuid
WHERE raw_location_id."value" ~* '^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$'
ON CONFLICT ("promotion_id", "location_id") DO NOTHING;

INSERT INTO "promotion_customer_targets" ("promotion_id", "customer_id")
SELECT
  promotions."id",
  customers."id"
FROM "promotions" promotions
CROSS JOIN LATERAL UNNEST(COALESCE(promotions."customer_ids", ARRAY[]::TEXT[])) AS raw_customer_id("value")
JOIN "customers" customers
  ON customers."tenant_id" = promotions."tenant_id"
 AND customers."id" = raw_customer_id."value"::uuid
WHERE raw_customer_id."value" ~* '^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$'
ON CONFLICT ("promotion_id", "customer_id") DO NOTHING;

WITH aggregated_product_targets AS (
  SELECT
    promotions."id" AS "promotion_id",
    COALESCE(
      ARRAY_AGG(targets."product_id"::TEXT ORDER BY targets."product_id"::TEXT)
        FILTER (WHERE targets."product_id" IS NOT NULL),
      ARRAY[]::TEXT[]
    ) AS "product_ids"
  FROM "promotions" promotions
  LEFT JOIN "promotion_product_targets" targets
    ON targets."promotion_id" = promotions."id"
  GROUP BY promotions."id"
)
UPDATE "promotions" promotions
SET "product_ids" = aggregated_product_targets."product_ids"
FROM aggregated_product_targets
WHERE promotions."id" = aggregated_product_targets."promotion_id";

WITH aggregated_location_targets AS (
  SELECT
    promotions."id" AS "promotion_id",
    COALESCE(
      ARRAY_AGG(targets."location_id"::TEXT ORDER BY targets."location_id"::TEXT)
        FILTER (WHERE targets."location_id" IS NOT NULL),
      ARRAY[]::TEXT[]
    ) AS "location_ids"
  FROM "promotions" promotions
  LEFT JOIN "promotion_location_targets" targets
    ON targets."promotion_id" = promotions."id"
  GROUP BY promotions."id"
)
UPDATE "promotions" promotions
SET "location_ids" = aggregated_location_targets."location_ids"
FROM aggregated_location_targets
WHERE promotions."id" = aggregated_location_targets."promotion_id";

WITH aggregated_customer_targets AS (
  SELECT
    promotions."id" AS "promotion_id",
    COALESCE(
      ARRAY_AGG(targets."customer_id"::TEXT ORDER BY targets."customer_id"::TEXT)
        FILTER (WHERE targets."customer_id" IS NOT NULL),
      ARRAY[]::TEXT[]
    ) AS "customer_ids"
  FROM "promotions" promotions
  LEFT JOIN "promotion_customer_targets" targets
    ON targets."promotion_id" = promotions."id"
  GROUP BY promotions."id"
)
UPDATE "promotions" promotions
SET "customer_ids" = aggregated_customer_targets."customer_ids"
FROM aggregated_customer_targets
WHERE promotions."id" = aggregated_customer_targets."promotion_id";