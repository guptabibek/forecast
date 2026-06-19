-- India fiscal year starts 1 April, not 1 January.
-- The original schema shipped with @default(1) (January) which is wrong for
-- this India-only deployment. Update every tenant that still carries the
-- out-of-the-box default so reporting presets (QTD, YTD, last-FY, quarters)
-- align to April–March without requiring manual settings changes.
--
-- Tenants that have already been explicitly changed away from 1 are left alone.

ALTER TABLE "tenants" ALTER COLUMN "fiscalYearStart" SET DEFAULT 4;

UPDATE "tenants"
SET "fiscalYearStart" = 4
WHERE "fiscalYearStart" = 1;
