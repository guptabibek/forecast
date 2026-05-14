ALTER TABLE "cost_centers"
  ADD COLUMN IF NOT EXISTS "manager_id" UUID;

WITH email_matches AS (
  SELECT
    cost_centers."id" AS "cost_center_id",
    users."id" AS "manager_id",
    CONCAT_WS(' ', users."first_name", users."last_name") AS "manager_name"
  FROM "cost_centers" cost_centers
  JOIN "users" users
    ON users."tenant_id" = cost_centers."tenant_id"
   AND users."status" = 'ACTIVE'::"UserStatus"
   AND cost_centers."manager" IS NOT NULL
   AND BTRIM(cost_centers."manager") <> ''
   AND LOWER(users."email") = LOWER(BTRIM(cost_centers."manager"))
  WHERE cost_centers."manager_id" IS NULL
)
UPDATE "cost_centers" cost_centers
SET
  "manager_id" = email_matches."manager_id",
  "manager" = email_matches."manager_name"
FROM email_matches
WHERE cost_centers."id" = email_matches."cost_center_id";

WITH unique_name_matches AS (
  SELECT
    cost_centers."id" AS "cost_center_id",
    MIN(users."id"::text)::uuid AS "manager_id",
    MIN(CONCAT_WS(' ', users."first_name", users."last_name")) AS "manager_name"
  FROM "cost_centers" cost_centers
  JOIN "users" users
    ON users."tenant_id" = cost_centers."tenant_id"
   AND users."status" = 'ACTIVE'::"UserStatus"
   AND cost_centers."manager" IS NOT NULL
   AND BTRIM(cost_centers."manager") <> ''
   AND LOWER(CONCAT_WS(' ', users."first_name", users."last_name")) = LOWER(BTRIM(cost_centers."manager"))
  WHERE cost_centers."manager_id" IS NULL
  GROUP BY cost_centers."id"
  HAVING COUNT(*) = 1
)
UPDATE "cost_centers" cost_centers
SET
  "manager_id" = unique_name_matches."manager_id",
  "manager" = unique_name_matches."manager_name"
FROM unique_name_matches
WHERE cost_centers."id" = unique_name_matches."cost_center_id";

CREATE INDEX IF NOT EXISTS "cost_centers_tenant_id_manager_id_idx" ON "cost_centers"("tenant_id", "manager_id");

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'cost_centers_manager_id_fkey'
  ) THEN
    ALTER TABLE "cost_centers"
      ADD CONSTRAINT "cost_centers_manager_id_fkey"
      FOREIGN KEY ("manager_id") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;
  END IF;
END $$;