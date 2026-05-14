-- AlterTable: Add company_type to tenants
ALTER TABLE "tenants" ADD COLUMN "company_type" VARCHAR(50) NOT NULL DEFAULT 'pharma';
