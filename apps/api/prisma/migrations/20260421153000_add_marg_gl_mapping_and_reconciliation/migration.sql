ALTER TABLE "marg_sync_logs"
ADD COLUMN "journal_entries_synced" INTEGER NOT NULL DEFAULT 0;

CREATE TABLE "marg_gl_mapping_rules" (
    "id" UUID NOT NULL DEFAULT uuid_generate_v4(),
    "tenant_id" UUID NOT NULL,
    "rule_name" VARCHAR(100) NOT NULL,
    "company_id" INTEGER,
    "book_code" VARCHAR(20),
    "group_code" VARCHAR(20),
    "party_code" VARCHAR(20),
    "counterparty_code" VARCHAR(20),
    "remark_contains" VARCHAR(100),
    "gl_account_id" UUID NOT NULL,
    "is_receivable_control" BOOLEAN NOT NULL DEFAULT false,
    "priority" INTEGER NOT NULL DEFAULT 0,
    "is_active" BOOLEAN NOT NULL DEFAULT true,
    "description" TEXT,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "marg_gl_mapping_rules_pkey" PRIMARY KEY ("id"),
    CONSTRAINT "marg_gl_mapping_rules_gl_account_id_fkey"
      FOREIGN KEY ("gl_account_id") REFERENCES "gl_accounts"("id") ON DELETE RESTRICT ON UPDATE CASCADE
);

CREATE UNIQUE INDEX "marg_gl_mapping_rules_tenant_id_rule_name_key"
ON "marg_gl_mapping_rules"("tenant_id", "rule_name");

CREATE INDEX "marg_gl_mapping_rules_tenant_id_idx"
ON "marg_gl_mapping_rules"("tenant_id");

CREATE INDEX "marg_gl_mapping_rules_tenant_id_priority_idx"
ON "marg_gl_mapping_rules"("tenant_id", "priority");

CREATE INDEX "marg_gl_mapping_rules_tenant_id_company_id_idx"
ON "marg_gl_mapping_rules"("tenant_id", "company_id");

CREATE INDEX "marg_gl_mapping_rules_gl_account_id_idx"
ON "marg_gl_mapping_rules"("gl_account_id");

CREATE TABLE "marg_account_journal_projections" (
    "id" UUID NOT NULL DEFAULT uuid_generate_v4(),
    "tenant_id" UUID NOT NULL,
    "company_id" INTEGER NOT NULL,
    "group_key" VARCHAR(255) NOT NULL,
    "book_code" VARCHAR(20),
    "voucher" VARCHAR(50),
    "entry_date" DATE NOT NULL,
    "content_hash" VARCHAR(64) NOT NULL,
    "journal_entry_id" UUID,
    "last_sync_log_id" UUID,
    "last_projected_at" TIMESTAMPTZ(6) NOT NULL,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "marg_account_journal_projections_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "marg_account_journal_projections_tenant_id_group_key_key"
ON "marg_account_journal_projections"("tenant_id", "group_key");

CREATE INDEX "marg_account_journal_projections_tenant_id_idx"
ON "marg_account_journal_projections"("tenant_id");

CREATE INDEX "marg_account_journal_projections_tenant_id_entry_date_idx"
ON "marg_account_journal_projections"("tenant_id", "entry_date");

CREATE INDEX "marg_account_journal_projections_journal_entry_id_idx"
ON "marg_account_journal_projections"("journal_entry_id");

CREATE INDEX "marg_account_journal_projections_last_sync_log_id_idx"
ON "marg_account_journal_projections"("last_sync_log_id");

CREATE TYPE "MargReconciliationType" AS ENUM ('STOCK', 'AR_AGING', 'ACCOUNTING_BALANCE');
CREATE TYPE "MargReconciliationStatus" AS ENUM ('PASSED', 'WARNING', 'FAILED');

CREATE TABLE "marg_reconciliation_results" (
    "id" UUID NOT NULL DEFAULT uuid_generate_v4(),
    "tenant_id" UUID NOT NULL,
    "sync_log_id" UUID NOT NULL,
    "reconciliation_type" "MargReconciliationType" NOT NULL,
    "status" "MargReconciliationStatus" NOT NULL DEFAULT 'PASSED',
    "issue_count" INTEGER NOT NULL DEFAULT 0,
    "summary" JSONB NOT NULL DEFAULT '{}'::jsonb,
    "issues" JSONB NOT NULL DEFAULT '[]'::jsonb,
    "started_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "completed_at" TIMESTAMPTZ(6),
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "marg_reconciliation_results_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "marg_reconciliation_results_sync_log_id_reconciliation_type_key"
ON "marg_reconciliation_results"("sync_log_id", "reconciliation_type");

CREATE INDEX "marg_reconciliation_results_tenant_id_idx"
ON "marg_reconciliation_results"("tenant_id");

CREATE INDEX "marg_reconciliation_results_tenant_id_reconciliation_type_created_at_idx"
ON "marg_reconciliation_results"("tenant_id", "reconciliation_type", "created_at");

CREATE INDEX "marg_reconciliation_results_sync_log_id_idx"
ON "marg_reconciliation_results"("sync_log_id");