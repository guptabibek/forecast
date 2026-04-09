UPDATE "sop_cycles" sop_cycles
SET "demand_manager" = NULL
WHERE "demand_manager" IS NOT NULL
  AND NOT EXISTS (
    SELECT 1
    FROM "users" users
    WHERE users."id" = sop_cycles."demand_manager"
      AND users."tenant_id" = sop_cycles."tenant_id"
  );

UPDATE "sop_cycles" sop_cycles
SET "supply_manager" = NULL
WHERE "supply_manager" IS NOT NULL
  AND NOT EXISTS (
    SELECT 1
    FROM "users" users
    WHERE users."id" = sop_cycles."supply_manager"
      AND users."tenant_id" = sop_cycles."tenant_id"
  );

UPDATE "sop_cycles" sop_cycles
SET "finance_manager" = NULL
WHERE "finance_manager" IS NOT NULL
  AND NOT EXISTS (
    SELECT 1
    FROM "users" users
    WHERE users."id" = sop_cycles."finance_manager"
      AND users."tenant_id" = sop_cycles."tenant_id"
  );

UPDATE "sop_cycles" sop_cycles
SET "executive_sponsor" = NULL
WHERE "executive_sponsor" IS NOT NULL
  AND NOT EXISTS (
    SELECT 1
    FROM "users" users
    WHERE users."id" = sop_cycles."executive_sponsor"
      AND users."tenant_id" = sop_cycles."tenant_id"
  );

CREATE INDEX IF NOT EXISTS "sop_cycles_tenant_id_demand_manager_idx" ON "sop_cycles"("tenant_id", "demand_manager");
CREATE INDEX IF NOT EXISTS "sop_cycles_tenant_id_supply_manager_idx" ON "sop_cycles"("tenant_id", "supply_manager");
CREATE INDEX IF NOT EXISTS "sop_cycles_tenant_id_finance_manager_idx" ON "sop_cycles"("tenant_id", "finance_manager");
CREATE INDEX IF NOT EXISTS "sop_cycles_tenant_id_executive_sponsor_idx" ON "sop_cycles"("tenant_id", "executive_sponsor");

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'sop_cycles_demand_manager_fkey'
  ) THEN
    ALTER TABLE "sop_cycles"
      ADD CONSTRAINT "sop_cycles_demand_manager_fkey"
      FOREIGN KEY ("demand_manager") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;
  END IF;
END $$;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'sop_cycles_supply_manager_fkey'
  ) THEN
    ALTER TABLE "sop_cycles"
      ADD CONSTRAINT "sop_cycles_supply_manager_fkey"
      FOREIGN KEY ("supply_manager") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;
  END IF;
END $$;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'sop_cycles_finance_manager_fkey'
  ) THEN
    ALTER TABLE "sop_cycles"
      ADD CONSTRAINT "sop_cycles_finance_manager_fkey"
      FOREIGN KEY ("finance_manager") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;
  END IF;
END $$;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'sop_cycles_executive_sponsor_fkey'
  ) THEN
    ALTER TABLE "sop_cycles"
      ADD CONSTRAINT "sop_cycles_executive_sponsor_fkey"
      FOREIGN KEY ("executive_sponsor") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;
  END IF;
END $$;