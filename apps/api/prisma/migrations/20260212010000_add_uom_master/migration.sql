-- Ensure uuid_generate_v4() is available for UUID defaults.
CREATE EXTENSION IF NOT EXISTS "uuid-ossp";

-- CreateEnum
DO $$ BEGIN
    CREATE TYPE "UomCategory" AS ENUM ('WEIGHT', 'LENGTH', 'VOLUME', 'AREA', 'COUNT', 'TIME', 'TEMPERATURE', 'ENERGY', 'PRESSURE', 'OTHER');
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

-- CreateTable
CREATE TABLE "unit_of_measures" (
    "id" UUID NOT NULL DEFAULT uuid_generate_v4(),
    "tenant_id" UUID NOT NULL,
    "code" VARCHAR(20) NOT NULL,
    "name" VARCHAR(100) NOT NULL,
    "symbol" VARCHAR(10),
    "category" "UomCategory" NOT NULL DEFAULT 'OTHER',
    "description" VARCHAR(500),
    "decimals" INTEGER NOT NULL DEFAULT 2,
    "is_base" BOOLEAN NOT NULL DEFAULT false,
    "is_active" BOOLEAN NOT NULL DEFAULT true,
    "sort_order" INTEGER NOT NULL DEFAULT 0,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "unit_of_measures_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "unit_of_measures_tenant_id_code_key" ON "unit_of_measures"("tenant_id", "code");
CREATE INDEX "unit_of_measures_tenant_id_category_idx" ON "unit_of_measures"("tenant_id", "category");
CREATE INDEX "unit_of_measures_tenant_id_is_active_idx" ON "unit_of_measures"("tenant_id", "is_active");

-- Add FK columns to unit_of_measure_conversions
DO $$
BEGIN
    IF EXISTS (
        SELECT 1
        FROM information_schema.tables
        WHERE table_schema = 'public' AND table_name = 'unit_of_measure_conversions'
    ) THEN
        ALTER TABLE "unit_of_measure_conversions" ADD COLUMN IF NOT EXISTS "from_uom_id" UUID;
        ALTER TABLE "unit_of_measure_conversions" ADD COLUMN IF NOT EXISTS "to_uom_id" UUID;

        EXECUTE 'CREATE INDEX IF NOT EXISTS "unit_of_measure_conversions_tenant_id_from_uom_id_idx" ON "unit_of_measure_conversions"("tenant_id", "from_uom_id")';
        EXECUTE 'CREATE INDEX IF NOT EXISTS "unit_of_measure_conversions_tenant_id_to_uom_id_idx" ON "unit_of_measure_conversions"("tenant_id", "to_uom_id")';
    END IF;
END $$;

DO $$
BEGIN
    IF EXISTS (
        SELECT 1
        FROM information_schema.tables
        WHERE table_schema = 'public' AND table_name = 'tenants'
    )
    AND NOT EXISTS (
        SELECT 1 FROM pg_constraint WHERE conname = 'unit_of_measures_tenant_id_fkey'
    ) THEN
        ALTER TABLE "unit_of_measures"
            ADD CONSTRAINT "unit_of_measures_tenant_id_fkey"
            FOREIGN KEY ("tenant_id") REFERENCES "tenants"("id") ON DELETE CASCADE ON UPDATE CASCADE;
    END IF;
END $$;

DO $$
BEGIN
    IF EXISTS (
        SELECT 1
        FROM information_schema.tables
        WHERE table_schema = 'public' AND table_name = 'unit_of_measure_conversions'
    )
    AND EXISTS (
        SELECT 1
        FROM information_schema.columns
        WHERE table_schema = 'public' AND table_name = 'unit_of_measure_conversions' AND column_name = 'from_uom_id'
    )
    AND EXISTS (
        SELECT 1
        FROM information_schema.tables
        WHERE table_schema = 'public' AND table_name = 'unit_of_measures'
    )
    AND NOT EXISTS (
        SELECT 1 FROM pg_constraint WHERE conname = 'unit_of_measure_conversions_from_uom_id_fkey'
    ) THEN
        ALTER TABLE "unit_of_measure_conversions"
            ADD CONSTRAINT "unit_of_measure_conversions_from_uom_id_fkey"
            FOREIGN KEY ("from_uom_id") REFERENCES "unit_of_measures"("id") ON DELETE SET NULL ON UPDATE CASCADE;
    END IF;
END $$;

DO $$
BEGIN
    IF EXISTS (
        SELECT 1
        FROM information_schema.tables
        WHERE table_schema = 'public' AND table_name = 'unit_of_measure_conversions'
    )
    AND EXISTS (
        SELECT 1
        FROM information_schema.columns
        WHERE table_schema = 'public' AND table_name = 'unit_of_measure_conversions' AND column_name = 'to_uom_id'
    )
    AND EXISTS (
        SELECT 1
        FROM information_schema.tables
        WHERE table_schema = 'public' AND table_name = 'unit_of_measures'
    )
    AND NOT EXISTS (
        SELECT 1 FROM pg_constraint WHERE conname = 'unit_of_measure_conversions_to_uom_id_fkey'
    ) THEN
        ALTER TABLE "unit_of_measure_conversions"
            ADD CONSTRAINT "unit_of_measure_conversions_to_uom_id_fkey"
            FOREIGN KEY ("to_uom_id") REFERENCES "unit_of_measures"("id") ON DELETE SET NULL ON UPDATE CASCADE;
    END IF;
END $$;
