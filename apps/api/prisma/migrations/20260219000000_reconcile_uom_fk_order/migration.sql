-- Reconcile UOM relation columns and foreign keys after baseline schema is present.
-- This migration is idempotent and safe for both fresh and existing databases.

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
    WHERE table_schema = 'public' AND table_name = 'unit_of_measures'
  )
  AND EXISTS (
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
