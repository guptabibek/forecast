-- Migration: add_marg_vouchers_saletypes_fields
-- Adds new marg staging tables (marg_vouchers, marg_sale_types)
-- Adds missing columns to existing marg tables
-- Changes marg_transactions.marg_id from INT to BIGINT

-- 1. Add code column to marg_branches
ALTER TABLE "marg_branches" ADD COLUMN IF NOT EXISTS "code" VARCHAR(20);

-- 2. Add missing columns to marg_parties
ALTER TABLE "marg_parties" ADD COLUMN IF NOT EXISTS "par_addr" TEXT;
ALTER TABLE "marg_parties" ADD COLUMN IF NOT EXISTS "mr" VARCHAR(100);
ALTER TABLE "marg_parties" ADD COLUMN IF NOT EXISTS "rate" VARCHAR(20);
ALTER TABLE "marg_parties" ADD COLUMN IF NOT EXISTS "cr_status" VARCHAR(20);
ALTER TABLE "marg_parties" ADD COLUMN IF NOT EXISTS "marg_code" VARCHAR(50);
ALTER TABLE "marg_parties" ADD COLUMN IF NOT EXISTS "add_field" TEXT;
ALTER TABLE "marg_parties" ADD COLUMN IF NOT EXISTS "dl_no" VARCHAR(100);
ALTER TABLE "marg_parties" ADD COLUMN IF NOT EXISTS "is_deleted" BOOLEAN NOT NULL DEFAULT false;

-- 3. Rename gstn_no to gst_no in marg_parties (if old column exists)
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='marg_parties' AND column_name='gstn_no')
     AND NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='marg_parties' AND column_name='gst_no')
  THEN
    ALTER TABLE "marg_parties" RENAME COLUMN "gstn_no" TO "gst_no";
  END IF;
END $$;

-- 4. Change marg_transactions.marg_id from INT to BIGINT
ALTER TABLE "marg_transactions" ALTER COLUMN "marg_id" TYPE BIGINT;

-- 5. Rename add_fields to add_field in marg_transactions (if old column exists)
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='marg_transactions' AND column_name='add_fields')
     AND NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='marg_transactions' AND column_name='add_field')
  THEN
    ALTER TABLE "marg_transactions" RENAME COLUMN "add_fields" TO "add_field";
  END IF;
END $$;

-- 6. Add bat_det column to marg_transactions
ALTER TABLE "marg_transactions" ADD COLUMN IF NOT EXISTS "bat_det" TEXT;

-- 7. Add add_field column to marg_stocks
ALTER TABLE "marg_stocks" ADD COLUMN IF NOT EXISTS "add_field" TEXT;

-- 8. Add vouchers_synced and sale_types_synced columns to marg_sync_logs
ALTER TABLE "marg_sync_logs" ADD COLUMN IF NOT EXISTS "vouchers_synced" INTEGER NOT NULL DEFAULT 0;
ALTER TABLE "marg_sync_logs" ADD COLUMN IF NOT EXISTS "sale_types_synced" INTEGER NOT NULL DEFAULT 0;

-- 9. Create marg_vouchers table
CREATE TABLE IF NOT EXISTS "marg_vouchers" (
    "id" UUID NOT NULL DEFAULT uuid_generate_v4(),
    "tenant_id" UUID NOT NULL,
    "marg_id" BIGINT NOT NULL,
    "company_id" INTEGER NOT NULL,
    "voucher" VARCHAR(50) NOT NULL,
    "type" VARCHAR(10) NOT NULL,
    "vcn" VARCHAR(50),
    "date" TIMESTAMP(3) NOT NULL,
    "cid" VARCHAR(50),
    "final_amt" DECIMAL(18,2),
    "cash" DECIMAL(18,2),
    "others" DECIMAL(18,2),
    "salesman" VARCHAR(100),
    "mr" VARCHAR(100),
    "route" VARCHAR(100),
    "area" VARCHAR(100),
    "orn" VARCHAR(100),
    "add_field" TEXT,
    "o_date" TIMESTAMP(3),
    "raw_data" JSONB NOT NULL DEFAULT '{}',
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "marg_vouchers_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX IF NOT EXISTS "marg_vouchers_tenant_id_company_id_voucher_type_key"
  ON "marg_vouchers"("tenant_id", "company_id", "voucher", "type");
CREATE INDEX IF NOT EXISTS "marg_vouchers_tenant_id_date_idx"
  ON "marg_vouchers"("tenant_id", "date");

-- 10. Create marg_sale_types table
CREATE TABLE IF NOT EXISTS "marg_sale_types" (
    "id" UUID NOT NULL DEFAULT uuid_generate_v4(),
    "tenant_id" UUID NOT NULL,
    "marg_id" INTEGER NOT NULL,
    "company_id" INTEGER NOT NULL,
    "sg_code" VARCHAR(50) NOT NULL,
    "s_code" VARCHAR(50) NOT NULL,
    "name" VARCHAR(255) NOT NULL,
    "main" VARCHAR(100),
    "marg_code" VARCHAR(50),
    "add_field" TEXT,
    "raw_data" JSONB NOT NULL DEFAULT '{}',
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "marg_sale_types_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX IF NOT EXISTS "marg_sale_types_tenant_id_company_id_sg_code_s_code_key"
  ON "marg_sale_types"("tenant_id", "company_id", "sg_code", "s_code");
CREATE INDEX IF NOT EXISTS "marg_sale_types_tenant_id_idx"
  ON "marg_sale_types"("tenant_id");
