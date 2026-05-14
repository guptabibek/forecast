ALTER TABLE "marg_sync_configs"
ADD COLUMN "last_accounting_sync_at" TIMESTAMPTZ(6),
ADD COLUMN "last_accounting_sync_status" "MargSyncStatus" NOT NULL DEFAULT 'IDLE',
ADD COLUMN "last_accounting_sync_index" INTEGER NOT NULL DEFAULT 0,
ADD COLUMN "last_accounting_sync_datetime" VARCHAR(50);

ALTER TABLE "marg_sync_logs"
ADD COLUMN "account_groups_synced" INTEGER NOT NULL DEFAULT 0,
ADD COLUMN "account_postings_synced" INTEGER NOT NULL DEFAULT 0,
ADD COLUMN "account_group_balances_synced" INTEGER NOT NULL DEFAULT 0,
ADD COLUMN "party_balances_synced" INTEGER NOT NULL DEFAULT 0,
ADD COLUMN "outstandings_synced" INTEGER NOT NULL DEFAULT 0;

CREATE TABLE "marg_account_groups" (
    "id" UUID NOT NULL DEFAULT uuid_generate_v4(),
    "tenant_id" UUID NOT NULL,
    "marg_id" BIGINT NOT NULL,
    "company_id" INTEGER NOT NULL,
    "aid" VARCHAR(20) NOT NULL,
    "name" VARCHAR(255) NOT NULL,
    "under" VARCHAR(20),
    "add_field" TEXT,
    "raw_data" JSONB,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "marg_account_groups_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "marg_account_groups_tenant_id_company_id_aid_key"
ON "marg_account_groups"("tenant_id", "company_id", "aid");

CREATE INDEX "marg_account_groups_tenant_id_idx"
ON "marg_account_groups"("tenant_id");

CREATE TABLE "marg_account_postings" (
    "id" UUID NOT NULL DEFAULT uuid_generate_v4(),
    "tenant_id" UUID NOT NULL,
    "marg_id" BIGINT NOT NULL,
    "company_id" INTEGER NOT NULL,
    "voucher" VARCHAR(50),
    "date" DATE NOT NULL,
    "code" VARCHAR(20),
    "amount" NUMERIC(18,4) NOT NULL,
    "book" VARCHAR(20) NOT NULL,
    "code1" VARCHAR(20),
    "g_code" VARCHAR(20),
    "remark" VARCHAR(255),
    "add_field" TEXT,
    "raw_data" JSONB,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "marg_account_postings_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "marg_account_postings_tenant_id_company_id_marg_id_key"
ON "marg_account_postings"("tenant_id", "company_id", "marg_id");

CREATE INDEX "marg_account_postings_tenant_id_date_idx"
ON "marg_account_postings"("tenant_id", "date");

CREATE INDEX "marg_account_postings_tenant_id_company_id_voucher_idx"
ON "marg_account_postings"("tenant_id", "company_id", "voucher");

CREATE INDEX "marg_account_postings_tenant_id_company_id_g_code_idx"
ON "marg_account_postings"("tenant_id", "company_id", "g_code");

CREATE TABLE "marg_account_group_balances" (
    "id" UUID NOT NULL DEFAULT uuid_generate_v4(),
    "tenant_id" UUID NOT NULL,
    "marg_id" BIGINT NOT NULL,
    "company_id" INTEGER NOT NULL,
    "aid" VARCHAR(20) NOT NULL,
    "opening" NUMERIC(18,4),
    "balance" NUMERIC(18,4),
    "raw_data" JSONB,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "marg_account_group_balances_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "marg_account_group_balances_tenant_id_company_id_aid_key"
ON "marg_account_group_balances"("tenant_id", "company_id", "aid");

CREATE INDEX "marg_account_group_balances_tenant_id_idx"
ON "marg_account_group_balances"("tenant_id");

CREATE TABLE "marg_party_balances" (
    "id" UUID NOT NULL DEFAULT uuid_generate_v4(),
    "tenant_id" UUID NOT NULL,
    "marg_id" BIGINT NOT NULL,
    "company_id" INTEGER NOT NULL,
    "cid" VARCHAR(20) NOT NULL,
    "opening" NUMERIC(18,4),
    "balance" NUMERIC(18,4),
    "raw_data" JSONB,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "marg_party_balances_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "marg_party_balances_tenant_id_company_id_cid_key"
ON "marg_party_balances"("tenant_id", "company_id", "cid");

CREATE INDEX "marg_party_balances_tenant_id_idx"
ON "marg_party_balances"("tenant_id");

CREATE TABLE "marg_outstandings" (
    "id" UUID NOT NULL DEFAULT uuid_generate_v4(),
    "tenant_id" UUID NOT NULL,
    "marg_id" BIGINT NOT NULL,
    "company_id" INTEGER NOT NULL,
    "ord" VARCHAR(20) NOT NULL,
    "date" DATE NOT NULL,
    "vcn" VARCHAR(50),
    "days" INTEGER NOT NULL DEFAULT 0,
    "final_amt" NUMERIC(18,4),
    "balance" NUMERIC(18,4),
    "pd_less" NUMERIC(18,4),
    "group_code" VARCHAR(20),
    "voucher" VARCHAR(50),
    "s_voucher" VARCHAR(50),
    "add_field" TEXT,
    "raw_data" JSONB,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "marg_outstandings_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "marg_outstandings_tenant_id_company_id_marg_id_key"
ON "marg_outstandings"("tenant_id", "company_id", "marg_id");

CREATE INDEX "marg_outstandings_tenant_id_date_idx"
ON "marg_outstandings"("tenant_id", "date");

CREATE INDEX "marg_outstandings_tenant_id_company_id_ord_idx"
ON "marg_outstandings"("tenant_id", "company_id", "ord");
