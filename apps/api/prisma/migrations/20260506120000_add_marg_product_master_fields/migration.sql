-- Persist Marg item master classification fields on the core product master.
-- Marg type-2 Product payload exposes:
--   GCode  -> product company
--   GCode3 -> salt
--   GCode5 -> product group
--   GCode6 -> HSN code

ALTER TABLE "products"
ADD COLUMN "product_company" VARCHAR(100),
ADD COLUMN "salt" VARCHAR(100),
ADD COLUMN "product_group" VARCHAR(100),
ADD COLUMN "hsn_code" VARCHAR(50);

ALTER TABLE "marg_products"
ALTER COLUMN "g_code" TYPE VARCHAR(100),
ALTER COLUMN "g_code3" TYPE VARCHAR(100),
ALTER COLUMN "g_code5" TYPE VARCHAR(100),
ALTER COLUMN "g_code6" TYPE VARCHAR(50);

UPDATE "products" p
SET
  "product_company" = COALESCE(NULLIF(p."product_company", ''), NULLIF(mp."g_code", ''), NULLIF(p."attributes"->>'margGCode', '')),
  "salt" = COALESCE(NULLIF(p."salt", ''), NULLIF(mp."g_code3", ''), NULLIF(p."attributes"->>'margGCode3', '')),
  "product_group" = COALESCE(NULLIF(p."product_group", ''), NULLIF(mp."g_code5", ''), NULLIF(p."attributes"->>'margGCode5', '')),
  "hsn_code" = COALESCE(NULLIF(p."hsn_code", ''), NULLIF(mp."g_code6", ''), NULLIF(p."attributes"->>'margHsn', ''))
FROM "marg_products" mp
WHERE mp."product_id" = p."id";

CREATE INDEX "products_tenant_id_product_company_idx" ON "products"("tenant_id", "product_company");
CREATE INDEX "products_tenant_id_product_group_idx" ON "products"("tenant_id", "product_group");
CREATE INDEX "products_tenant_id_hsn_code_idx" ON "products"("tenant_id", "hsn_code");
