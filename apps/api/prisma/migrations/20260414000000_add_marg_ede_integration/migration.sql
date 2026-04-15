-- Marg EDE Integration Tables
-- Adds staging tables + config for syncing data from Marg ERP 9+ via the Corporate EDE API

-- Sync status enum
CREATE TYPE "MargSyncStatus" AS ENUM ('IDLE', 'RUNNING', 'COMPLETED', 'FAILED');

-- Add MARG_EDE to ExternalDataType enum
ALTER TYPE "ExternalDataType" ADD VALUE IF NOT EXISTS 'MARG_EDE';

-- Marg sync configuration per tenant
CREATE TABLE "marg_sync_configs" (
    "id" UUID NOT NULL DEFAULT uuid_generate_v4(),
    "tenant_id" UUID NOT NULL,
    "company_code" VARCHAR(100) NOT NULL,
    "marg_key" VARCHAR(255) NOT NULL,
    "decryption_key" VARCHAR(255) NOT NULL,
    "api_base_url" VARCHAR(500) NOT NULL DEFAULT 'https://corporate.margerp.com',
    "company_id" INTEGER NOT NULL DEFAULT 0,
    "is_active" BOOLEAN NOT NULL DEFAULT true,
    "sync_frequency" VARCHAR(20) NOT NULL DEFAULT 'DAILY',
    "last_sync_at" TIMESTAMP(3),
    "last_sync_status" "MargSyncStatus" NOT NULL DEFAULT 'IDLE',
    "last_sync_index" INTEGER NOT NULL DEFAULT 0,
    "last_sync_datetime" VARCHAR(50),
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "marg_sync_configs_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "marg_sync_configs_tenant_id_company_code_key" ON "marg_sync_configs"("tenant_id", "company_code");
CREATE INDEX "marg_sync_configs_tenant_id_idx" ON "marg_sync_configs"("tenant_id");

-- Marg sync log
CREATE TABLE "marg_sync_logs" (
    "id" UUID NOT NULL DEFAULT uuid_generate_v4(),
    "tenant_id" UUID NOT NULL,
    "config_id" UUID NOT NULL,
    "status" "MargSyncStatus" NOT NULL DEFAULT 'RUNNING',
    "started_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "completed_at" TIMESTAMP(3),
    "products_synced" INTEGER NOT NULL DEFAULT 0,
    "parties_synced" INTEGER NOT NULL DEFAULT 0,
    "transactions_synced" INTEGER NOT NULL DEFAULT 0,
    "stock_synced" INTEGER NOT NULL DEFAULT 0,
    "branches_synced" INTEGER NOT NULL DEFAULT 0,
    "errors" JSONB NOT NULL DEFAULT '[]',
    "sync_index" INTEGER,
    "sync_datetime" VARCHAR(50),
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "marg_sync_logs_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "marg_sync_logs_tenant_id_started_at_idx" ON "marg_sync_logs"("tenant_id", "started_at");
CREATE INDEX "marg_sync_logs_config_id_idx" ON "marg_sync_logs"("config_id");

ALTER TABLE "marg_sync_logs" ADD CONSTRAINT "marg_sync_logs_config_id_fkey"
    FOREIGN KEY ("config_id") REFERENCES "marg_sync_configs"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- Marg branch/store master
CREATE TABLE "marg_branches" (
    "id" UUID NOT NULL DEFAULT uuid_generate_v4(),
    "tenant_id" UUID NOT NULL,
    "marg_id" INTEGER NOT NULL,
    "company_id" INTEGER NOT NULL,
    "name" VARCHAR(255) NOT NULL,
    "store_id" VARCHAR(50),
    "licence" VARCHAR(50),
    "branch" VARCHAR(100),
    "raw_data" JSONB,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "marg_branches_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "marg_branches_tenant_id_company_id_key" ON "marg_branches"("tenant_id", "company_id");
CREATE INDEX "marg_branches_tenant_id_idx" ON "marg_branches"("tenant_id");

-- Marg product staging
CREATE TABLE "marg_products" (
    "id" UUID NOT NULL DEFAULT uuid_generate_v4(),
    "tenant_id" UUID NOT NULL,
    "marg_id" INTEGER NOT NULL,
    "company_id" INTEGER NOT NULL,
    "pid" VARCHAR(20) NOT NULL,
    "code" VARCHAR(50) NOT NULL,
    "name" VARCHAR(255) NOT NULL,
    "unit" VARCHAR(20),
    "pack" DECIMAL(18,4),
    "g_code" VARCHAR(20),
    "g_code3" VARCHAR(20),
    "g_code5" VARCHAR(20),
    "g_code6" VARCHAR(20),
    "gst" DECIMAL(5,2),
    "marg_code" VARCHAR(50),
    "add_field" VARCHAR(255),
    "product_id" UUID,
    "raw_data" JSONB,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "marg_products_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "marg_products_tenant_id_company_id_pid_key" ON "marg_products"("tenant_id", "company_id", "pid");
CREATE INDEX "marg_products_tenant_id_idx" ON "marg_products"("tenant_id");
CREATE INDEX "marg_products_product_id_idx" ON "marg_products"("product_id");

-- Marg party/customer staging
CREATE TABLE "marg_parties" (
    "id" UUID NOT NULL DEFAULT uuid_generate_v4(),
    "tenant_id" UUID NOT NULL,
    "marg_id" INTEGER NOT NULL,
    "company_id" INTEGER NOT NULL,
    "cid" VARCHAR(20) NOT NULL,
    "par_name" VARCHAR(255) NOT NULL,
    "par_add1" VARCHAR(255),
    "par_add2" VARCHAR(255),
    "gstn_no" VARCHAR(50),
    "phone1" VARCHAR(20),
    "phone2" VARCHAR(20),
    "phone3" VARCHAR(20),
    "phone4" VARCHAR(20),
    "route" VARCHAR(20),
    "area" VARCHAR(20),
    "s_code" VARCHAR(20),
    "credit" INTEGER,
    "cr_days" INTEGER,
    "cr_bills" INTEGER,
    "pin" VARCHAR(20),
    "lat" VARCHAR(50),
    "lng" VARCHAR(50),
    "customer_id" UUID,
    "raw_data" JSONB,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "marg_parties_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "marg_parties_tenant_id_company_id_cid_key" ON "marg_parties"("tenant_id", "company_id", "cid");
CREATE INDEX "marg_parties_tenant_id_idx" ON "marg_parties"("tenant_id");
CREATE INDEX "marg_parties_customer_id_idx" ON "marg_parties"("customer_id");

-- Marg transaction staging
CREATE TABLE "marg_transactions" (
    "id" UUID NOT NULL DEFAULT uuid_generate_v4(),
    "tenant_id" UUID NOT NULL,
    "marg_id" INTEGER NOT NULL,
    "company_id" INTEGER NOT NULL,
    "source_key" VARCHAR(255) NOT NULL,
    "voucher" VARCHAR(50) NOT NULL,
    "type" VARCHAR(10) NOT NULL,
    "vcn" VARCHAR(50),
    "date" DATE NOT NULL,
    "cid" VARCHAR(20),
    "pid" VARCHAR(20),
    "g_code" VARCHAR(20),
    "batch" VARCHAR(50),
    "qty" DECIMAL(18,4),
    "free" DECIMAL(18,4),
    "mrp" DECIMAL(18,4),
    "rate" DECIMAL(18,4),
    "discount" DECIMAL(18,4),
    "amount" DECIMAL(18,4),
    "gst" DECIMAL(5,2),
    "gst_amount" DECIMAL(18,4),
    "add_fields" TEXT,
    "actual_id" UUID,
    "raw_data" JSONB,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "marg_transactions_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "marg_transactions_tenant_id_company_id_source_key_key" ON "marg_transactions"("tenant_id", "company_id", "source_key");
CREATE INDEX "marg_transactions_tenant_id_date_idx" ON "marg_transactions"("tenant_id", "date");
CREATE INDEX "marg_transactions_actual_id_idx" ON "marg_transactions"("actual_id");

-- Marg stock staging
CREATE TABLE "marg_stocks" (
    "id" UUID NOT NULL DEFAULT uuid_generate_v4(),
    "tenant_id" UUID NOT NULL,
    "marg_id" INTEGER NOT NULL,
    "company_id" INTEGER NOT NULL,
    "pid" VARCHAR(20) NOT NULL,
    "g_code" VARCHAR(20),
    "batch" VARCHAR(50) NOT NULL DEFAULT '_default',
    "bat_date" DATE,
    "bat_det" VARCHAR(50),
    "expiry" DATE,
    "sup_invo" VARCHAR(50),
    "sup_date" DATE,
    "sup_code" VARCHAR(20),
    "opening" DECIMAL(18,4),
    "stock" DECIMAL(18,4),
    "brk_stock" DECIMAL(18,4),
    "lp_rate" DECIMAL(18,4),
    "p_rate" DECIMAL(18,4),
    "mrp" DECIMAL(18,4),
    "rate_a" DECIMAL(18,4),
    "rate_b" DECIMAL(18,4),
    "rate_c" DECIMAL(18,4),
    "raw_data" JSONB,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "marg_stocks_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "marg_stocks_tenant_id_company_id_pid_batch_key" ON "marg_stocks"("tenant_id", "company_id", "pid", "batch");
CREATE INDEX "marg_stocks_tenant_id_idx" ON "marg_stocks"("tenant_id");
