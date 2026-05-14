-- Persist Marg named masters explicitly so reports can show code and full name.

CREATE TABLE "product_companies" (
  "id" UUID NOT NULL DEFAULT uuid_generate_v4(),
  "tenant_id" UUID NOT NULL,
  "code" VARCHAR(50) NOT NULL,
  "name" VARCHAR(100) NOT NULL,
  "description" VARCHAR(500),
  "is_active" BOOLEAN NOT NULL DEFAULT true,
  "source_system" VARCHAR(50),
  "raw_data" JSONB,
  "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "product_companies_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "product_salts" (
  "id" UUID NOT NULL DEFAULT uuid_generate_v4(),
  "tenant_id" UUID NOT NULL,
  "code" VARCHAR(50) NOT NULL,
  "name" VARCHAR(255) NOT NULL,
  "description" VARCHAR(500),
  "is_active" BOOLEAN NOT NULL DEFAULT true,
  "source_system" VARCHAR(50),
  "raw_data" JSONB,
  "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "product_salts_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "salesmen" (
  "id" UUID NOT NULL DEFAULT uuid_generate_v4(),
  "tenant_id" UUID NOT NULL,
  "code" VARCHAR(50) NOT NULL,
  "name" VARCHAR(255) NOT NULL,
  "description" VARCHAR(500),
  "is_active" BOOLEAN NOT NULL DEFAULT true,
  "source_system" VARCHAR(50),
  "raw_data" JSONB,
  "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "salesmen_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "product_companies_tenant_id_code_key" ON "product_companies"("tenant_id", "code");
CREATE INDEX "product_companies_tenant_id_is_active_idx" ON "product_companies"("tenant_id", "is_active");
CREATE UNIQUE INDEX "product_salts_tenant_id_code_key" ON "product_salts"("tenant_id", "code");
CREATE INDEX "product_salts_tenant_id_is_active_idx" ON "product_salts"("tenant_id", "is_active");
CREATE UNIQUE INDEX "salesmen_tenant_id_code_key" ON "salesmen"("tenant_id", "code");
CREATE INDEX "salesmen_tenant_id_is_active_idx" ON "salesmen"("tenant_id", "is_active");

ALTER TABLE "product_companies"
  ADD CONSTRAINT "product_companies_tenant_id_fkey"
  FOREIGN KEY ("tenant_id") REFERENCES "tenants"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "product_salts"
  ADD CONSTRAINT "product_salts_tenant_id_fkey"
  FOREIGN KEY ("tenant_id") REFERENCES "tenants"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "salesmen"
  ADD CONSTRAINT "salesmen_tenant_id_fkey"
  FOREIGN KEY ("tenant_id") REFERENCES "tenants"("id") ON DELETE CASCADE ON UPDATE CASCADE;
