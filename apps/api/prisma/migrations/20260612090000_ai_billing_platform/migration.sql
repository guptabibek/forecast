-- AI Billing, Credit Management & Governance Platform — additive schema.
-- 13 tables + 16 enums. The ledger (ai_wallet_transactions) and the audit
-- log (ai_billing_audit_logs) are append-only, enforced by DB triggers at
-- the end of this migration.

-- CreateEnum
CREATE TYPE "AiBillingProviderStatus" AS ENUM ('ACTIVE', 'DISABLED');

-- CreateEnum
CREATE TYPE "AiBillingModelStatus" AS ENUM ('ACTIVE', 'DISABLED');

-- CreateEnum
CREATE TYPE "AiPricingScope" AS ENUM ('GLOBAL', 'PLAN', 'TENANT');

-- CreateEnum
CREATE TYPE "AiPricingStatus" AS ENUM ('ACTIVE', 'DISABLED');

-- CreateEnum
CREATE TYPE "AiWalletStatus" AS ENUM ('ACTIVE', 'SUSPENDED', 'CLOSED');

-- CreateEnum
CREATE TYPE "AiLedgerType" AS ENUM ('PURCHASE', 'MANUAL_CREDIT', 'USAGE_CHARGE', 'REFUND', 'BONUS_CREDIT', 'PROMO_CREDIT', 'DISPUTE_RESOLUTION', 'CHARGE_REVERSAL', 'CREDIT_EXPIRY', 'ADMIN_ADJUSTMENT', 'CORRECTION');

-- CreateEnum
CREATE TYPE "AiReservationStatus" AS ENUM ('ACTIVE', 'FINALIZED', 'RELEASED', 'EXPIRED');

-- CreateEnum
CREATE TYPE "AiPurchaseMethod" AS ENUM ('STRIPE', 'BANK_TRANSFER');

-- CreateEnum
CREATE TYPE "AiPurchaseStatus" AS ENUM ('PENDING', 'COMPLETED', 'REJECTED', 'CANCELLED', 'EXPIRED', 'REFUNDED');

-- CreateEnum
CREATE TYPE "AiAccessScope" AS ENUM ('USER', 'TENANT', 'PLAN');

-- CreateEnum
CREATE TYPE "AiAccessStatus" AS ENUM ('ENABLED', 'DISABLED', 'SUSPENDED');

-- CreateEnum
CREATE TYPE "AiDisputeType" AS ENUM ('UNEXPECTED_CHARGE', 'DUPLICATE_CHARGE', 'FAILED_REQUEST', 'INCORRECT_BILLING', 'REFUND_REQUEST', 'TOKEN_USAGE_DISAGREEMENT');

-- CreateEnum
CREATE TYPE "AiDisputeStatus" AS ENUM ('OPEN', 'UNDER_INVESTIGATION', 'AWAITING_CUSTOMER', 'RESOLVED', 'CLOSED');

-- CreateEnum
CREATE TYPE "AiRefundKind" AS ENUM ('WALLET_CREDIT', 'CASH');

-- CreateEnum
CREATE TYPE "AiRefundStatus" AS ENUM ('PENDING', 'COMPLETED', 'FAILED');

-- CreateEnum
CREATE TYPE "AiUsageBillingStatus" AS ENUM ('CHARGED', 'FAILED', 'UNBILLED');

-- CreateTable
CREATE TABLE "ai_billing_providers" (
    "id" UUID NOT NULL DEFAULT uuid_generate_v4(),
    "name" VARCHAR(100) NOT NULL,
    "kind" VARCHAR(40) NOT NULL,
    "api_key_encrypted" TEXT,
    "api_key_last4" VARCHAR(8),
    "endpoint_url" VARCHAR(500),
    "organization_id" VARCHAR(200),
    "priority" INTEGER NOT NULL DEFAULT 100,
    "status" "AiBillingProviderStatus" NOT NULL DEFAULT 'ACTIVE',
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "ai_billing_providers_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ai_billing_models" (
    "id" UUID NOT NULL DEFAULT uuid_generate_v4(),
    "provider_id" UUID NOT NULL,
    "model_code" VARCHAR(120) NOT NULL,
    "display_name" VARCHAR(160) NOT NULL,
    "status" "AiBillingModelStatus" NOT NULL DEFAULT 'ACTIVE',
    "max_context" INTEGER,
    "is_default" BOOLEAN NOT NULL DEFAULT false,
    "capabilities" JSONB NOT NULL DEFAULT '{}',
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "ai_billing_models_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ai_model_pricing" (
    "id" UUID NOT NULL DEFAULT uuid_generate_v4(),
    "model_id" UUID NOT NULL,
    "scope" "AiPricingScope" NOT NULL DEFAULT 'GLOBAL',
    "plan_tier" "TenantTier",
    "tenant_id" UUID,
    "currency" VARCHAR(3) NOT NULL DEFAULT 'USD',
    "status" "AiPricingStatus" NOT NULL DEFAULT 'ACTIVE',
    "effective_from" TIMESTAMP(3) NOT NULL,
    "effective_to" TIMESTAMP(3),
    "provider_input_cost" DECIMAL(18,6) NOT NULL DEFAULT 0,
    "provider_output_cost" DECIMAL(18,6) NOT NULL DEFAULT 0,
    "provider_cached_input_cost" DECIMAL(18,6) NOT NULL DEFAULT 0,
    "provider_reasoning_cost" DECIMAL(18,6) NOT NULL DEFAULT 0,
    "provider_embedding_cost" DECIMAL(18,6) NOT NULL DEFAULT 0,
    "provider_image_cost" DECIMAL(18,6) NOT NULL DEFAULT 0,
    "customer_input_price" DECIMAL(18,6) NOT NULL DEFAULT 0,
    "customer_output_price" DECIMAL(18,6) NOT NULL DEFAULT 0,
    "customer_cached_input_price" DECIMAL(18,6) NOT NULL DEFAULT 0,
    "customer_reasoning_price" DECIMAL(18,6) NOT NULL DEFAULT 0,
    "customer_embedding_price" DECIMAL(18,6) NOT NULL DEFAULT 0,
    "customer_image_price" DECIMAL(18,6) NOT NULL DEFAULT 0,
    "created_by_id" UUID,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "ai_model_pricing_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ai_wallets" (
    "id" UUID NOT NULL DEFAULT uuid_generate_v4(),
    "tenant_id" UUID NOT NULL,
    "currency" VARCHAR(3) NOT NULL DEFAULT 'USD',
    "balance" DECIMAL(18,6) NOT NULL DEFAULT 0,
    "reserved_balance" DECIMAL(18,6) NOT NULL DEFAULT 0,
    "total_purchased" DECIMAL(18,6) NOT NULL DEFAULT 0,
    "total_consumed" DECIMAL(18,6) NOT NULL DEFAULT 0,
    "total_refunded" DECIMAL(18,6) NOT NULL DEFAULT 0,
    "total_adjusted" DECIMAL(18,6) NOT NULL DEFAULT 0,
    "status" "AiWalletStatus" NOT NULL DEFAULT 'ACTIVE',
    "low_balance_threshold" DECIMAL(18,6),
    "critical_balance_threshold" DECIMAL(18,6),
    "suspend_threshold" DECIMAL(18,6),
    "auto_recharge_enabled" BOOLEAN NOT NULL DEFAULT false,
    "auto_recharge_threshold" DECIMAL(18,6),
    "auto_recharge_amount" DECIMAL(18,6),
    "auto_recharge_monthly_limit" DECIMAL(18,6),
    "last_activity_at" TIMESTAMP(3),
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "ai_wallets_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ai_wallet_transactions" (
    "id" UUID NOT NULL DEFAULT uuid_generate_v4(),
    "wallet_id" UUID NOT NULL,
    "tenant_id" UUID NOT NULL,
    "type" "AiLedgerType" NOT NULL,
    "amount" DECIMAL(18,6) NOT NULL,
    "balance_before" DECIMAL(18,6) NOT NULL,
    "balance_after" DECIMAL(18,6) NOT NULL,
    "reference_no" VARCHAR(40) NOT NULL,
    "related_entity_type" VARCHAR(40),
    "related_entity_id" VARCHAR(64),
    "created_by_id" UUID,
    "notes" VARCHAR(1000),
    "metadata" JSONB NOT NULL DEFAULT '{}',
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ai_wallet_transactions_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ai_credit_reservations" (
    "id" UUID NOT NULL DEFAULT uuid_generate_v4(),
    "wallet_id" UUID NOT NULL,
    "tenant_id" UUID NOT NULL,
    "user_id" UUID,
    "amount" DECIMAL(18,6) NOT NULL,
    "status" "AiReservationStatus" NOT NULL DEFAULT 'ACTIVE',
    "request_id" UUID,
    "expires_at" TIMESTAMP(3) NOT NULL,
    "finalized_at" TIMESTAMP(3),
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ai_credit_reservations_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ai_credit_purchases" (
    "id" UUID NOT NULL DEFAULT uuid_generate_v4(),
    "tenant_id" UUID NOT NULL,
    "wallet_id" UUID NOT NULL,
    "user_id" UUID NOT NULL,
    "method" "AiPurchaseMethod" NOT NULL,
    "amount" DECIMAL(18,6) NOT NULL,
    "currency" VARCHAR(3) NOT NULL DEFAULT 'USD',
    "status" "AiPurchaseStatus" NOT NULL DEFAULT 'PENDING',
    "stripe_session_id" VARCHAR(255),
    "stripe_payment_intent_id" VARCHAR(255),
    "stripe_event_id" VARCHAR(255),
    "proof_url" VARCHAR(1000),
    "proof_note" VARCHAR(2000),
    "reviewed_by_id" UUID,
    "reviewed_at" TIMESTAMP(3),
    "review_note" VARCHAR(2000),
    "idempotency_key" VARCHAR(120),
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "ai_credit_purchases_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ai_usage_logs" (
    "id" UUID NOT NULL DEFAULT uuid_generate_v4(),
    "tenant_id" UUID NOT NULL,
    "user_id" UUID,
    "provider_id" UUID,
    "provider_name" VARCHAR(100) NOT NULL,
    "model_id" UUID,
    "model_code" VARCHAR(120) NOT NULL,
    "request_id" UUID,
    "call_type" VARCHAR(40) NOT NULL,
    "prompt_tokens" INTEGER NOT NULL DEFAULT 0,
    "completion_tokens" INTEGER NOT NULL DEFAULT 0,
    "cached_tokens" INTEGER NOT NULL DEFAULT 0,
    "reasoning_tokens" INTEGER NOT NULL DEFAULT 0,
    "total_tokens" INTEGER NOT NULL DEFAULT 0,
    "execution_ms" INTEGER,
    "provider_cost" DECIMAL(18,6) NOT NULL DEFAULT 0,
    "customer_charge" DECIMAL(18,6) NOT NULL DEFAULT 0,
    "margin" DECIMAL(18,6) NOT NULL DEFAULT 0,
    "reservation_id" UUID,
    "transaction_id" UUID,
    "pricing_id" UUID,
    "status" "AiUsageBillingStatus" NOT NULL DEFAULT 'CHARGED',
    "metadata" JSONB NOT NULL DEFAULT '{}',
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ai_usage_logs_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ai_access_policies" (
    "id" UUID NOT NULL DEFAULT uuid_generate_v4(),
    "scope" "AiAccessScope" NOT NULL,
    "tenant_id" UUID,
    "user_id" UUID,
    "plan_tier" "TenantTier",
    "status" "AiAccessStatus" NOT NULL DEFAULT 'ENABLED',
    "allowed_model_codes" JSONB,
    "daily_request_limit" INTEGER,
    "monthly_request_limit" INTEGER,
    "max_query_cost" DECIMAL(18,6),
    "max_daily_spend" DECIMAL(18,6),
    "max_monthly_spend" DECIMAL(18,6),
    "notes" VARCHAR(1000),
    "created_by_id" UUID,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "ai_access_policies_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ai_disputes" (
    "id" UUID NOT NULL DEFAULT uuid_generate_v4(),
    "tenant_id" UUID NOT NULL,
    "raised_by_id" UUID NOT NULL,
    "type" "AiDisputeType" NOT NULL,
    "status" "AiDisputeStatus" NOT NULL DEFAULT 'OPEN',
    "subject" VARCHAR(300) NOT NULL,
    "description" VARCHAR(5000) NOT NULL,
    "related_transaction_id" UUID,
    "related_usage_log_id" UUID,
    "assigned_to_id" UUID,
    "resolution_notes" VARCHAR(5000),
    "resolved_by_id" UUID,
    "resolved_at" TIMESTAMP(3),
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "ai_disputes_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ai_dispute_messages" (
    "id" UUID NOT NULL DEFAULT uuid_generate_v4(),
    "dispute_id" UUID NOT NULL,
    "tenant_id" UUID NOT NULL,
    "author_id" UUID,
    "author_role" VARCHAR(20) NOT NULL,
    "body" VARCHAR(5000) NOT NULL,
    "attachment_url" VARCHAR(1000),
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ai_dispute_messages_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ai_refunds" (
    "id" UUID NOT NULL DEFAULT uuid_generate_v4(),
    "tenant_id" UUID NOT NULL,
    "wallet_id" UUID NOT NULL,
    "purchase_id" UUID,
    "dispute_id" UUID,
    "amount" DECIMAL(18,6) NOT NULL,
    "kind" "AiRefundKind" NOT NULL,
    "reason" VARCHAR(1000) NOT NULL,
    "status" "AiRefundStatus" NOT NULL DEFAULT 'PENDING',
    "approved_by_id" UUID NOT NULL,
    "stripe_refund_id" VARCHAR(255),
    "transaction_id" UUID,
    "evidence_url" VARCHAR(1000),
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "ai_refunds_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ai_billing_audit_logs" (
    "id" UUID NOT NULL DEFAULT uuid_generate_v4(),
    "actor_id" UUID,
    "actor_email" VARCHAR(255),
    "actor_role" VARCHAR(40),
    "tenant_id" UUID,
    "action" VARCHAR(80) NOT NULL,
    "entity_type" VARCHAR(60) NOT NULL,
    "entity_id" VARCHAR(64),
    "before_state" JSONB,
    "after_state" JSONB,
    "reason" VARCHAR(2000),
    "ip_address" VARCHAR(64),
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ai_billing_audit_logs_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "ai_billing_providers_name_key" ON "ai_billing_providers"("name");

-- CreateIndex
CREATE INDEX "ai_billing_providers_status_priority_idx" ON "ai_billing_providers"("status", "priority");

-- CreateIndex
CREATE INDEX "ai_billing_models_status_is_default_idx" ON "ai_billing_models"("status", "is_default");

-- CreateIndex
CREATE UNIQUE INDEX "ai_billing_models_provider_id_model_code_key" ON "ai_billing_models"("provider_id", "model_code");

-- CreateIndex
CREATE INDEX "ai_model_pricing_model_id_scope_status_effective_from_idx" ON "ai_model_pricing"("model_id", "scope", "status", "effective_from");

-- CreateIndex
CREATE INDEX "ai_model_pricing_tenant_id_status_idx" ON "ai_model_pricing"("tenant_id", "status");

-- CreateIndex
CREATE UNIQUE INDEX "ai_wallets_tenant_id_key" ON "ai_wallets"("tenant_id");

-- CreateIndex
CREATE INDEX "ai_wallets_status_idx" ON "ai_wallets"("status");

-- CreateIndex
CREATE INDEX "ai_wallet_transactions_wallet_id_created_at_idx" ON "ai_wallet_transactions"("wallet_id", "created_at");

-- CreateIndex
CREATE INDEX "ai_wallet_transactions_tenant_id_type_created_at_idx" ON "ai_wallet_transactions"("tenant_id", "type", "created_at");

-- CreateIndex
CREATE UNIQUE INDEX "ai_wallet_transactions_reference_no_key" ON "ai_wallet_transactions"("reference_no");

-- CreateIndex
CREATE INDEX "ai_credit_reservations_wallet_id_status_idx" ON "ai_credit_reservations"("wallet_id", "status");

-- CreateIndex
CREATE INDEX "ai_credit_reservations_status_expires_at_idx" ON "ai_credit_reservations"("status", "expires_at");

-- CreateIndex
CREATE UNIQUE INDEX "ai_credit_purchases_stripe_session_id_key" ON "ai_credit_purchases"("stripe_session_id");

-- CreateIndex
CREATE UNIQUE INDEX "ai_credit_purchases_stripe_event_id_key" ON "ai_credit_purchases"("stripe_event_id");

-- CreateIndex
CREATE UNIQUE INDEX "ai_credit_purchases_idempotency_key_key" ON "ai_credit_purchases"("idempotency_key");

-- CreateIndex
CREATE INDEX "ai_credit_purchases_tenant_id_status_created_at_idx" ON "ai_credit_purchases"("tenant_id", "status", "created_at");

-- CreateIndex
CREATE INDEX "ai_credit_purchases_method_status_idx" ON "ai_credit_purchases"("method", "status");

-- CreateIndex
CREATE INDEX "ai_usage_logs_tenant_id_created_at_idx" ON "ai_usage_logs"("tenant_id", "created_at");

-- CreateIndex
CREATE INDEX "ai_usage_logs_tenant_id_user_id_created_at_idx" ON "ai_usage_logs"("tenant_id", "user_id", "created_at");

-- CreateIndex
CREATE INDEX "ai_usage_logs_model_code_created_at_idx" ON "ai_usage_logs"("model_code", "created_at");

-- CreateIndex
CREATE INDEX "ai_access_policies_scope_tenant_id_idx" ON "ai_access_policies"("scope", "tenant_id");

-- CreateIndex
CREATE INDEX "ai_access_policies_scope_user_id_idx" ON "ai_access_policies"("scope", "user_id");

-- CreateIndex
CREATE INDEX "ai_access_policies_scope_plan_tier_idx" ON "ai_access_policies"("scope", "plan_tier");

-- CreateIndex
CREATE INDEX "ai_disputes_tenant_id_status_created_at_idx" ON "ai_disputes"("tenant_id", "status", "created_at");

-- CreateIndex
CREATE INDEX "ai_disputes_status_assigned_to_id_idx" ON "ai_disputes"("status", "assigned_to_id");

-- CreateIndex
CREATE INDEX "ai_dispute_messages_dispute_id_created_at_idx" ON "ai_dispute_messages"("dispute_id", "created_at");

-- CreateIndex
CREATE INDEX "ai_refunds_tenant_id_created_at_idx" ON "ai_refunds"("tenant_id", "created_at");

-- CreateIndex
CREATE INDEX "ai_billing_audit_logs_tenant_id_created_at_idx" ON "ai_billing_audit_logs"("tenant_id", "created_at");

-- CreateIndex
CREATE INDEX "ai_billing_audit_logs_entity_type_entity_id_idx" ON "ai_billing_audit_logs"("entity_type", "entity_id");

-- CreateIndex
CREATE INDEX "ai_billing_audit_logs_action_created_at_idx" ON "ai_billing_audit_logs"("action", "created_at");

-- AddForeignKey
ALTER TABLE "ai_billing_models" ADD CONSTRAINT "ai_billing_models_provider_id_fkey" FOREIGN KEY ("provider_id") REFERENCES "ai_billing_providers"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ai_model_pricing" ADD CONSTRAINT "ai_model_pricing_model_id_fkey" FOREIGN KEY ("model_id") REFERENCES "ai_billing_models"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ai_wallet_transactions" ADD CONSTRAINT "ai_wallet_transactions_wallet_id_fkey" FOREIGN KEY ("wallet_id") REFERENCES "ai_wallets"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ai_credit_reservations" ADD CONSTRAINT "ai_credit_reservations_wallet_id_fkey" FOREIGN KEY ("wallet_id") REFERENCES "ai_wallets"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ai_dispute_messages" ADD CONSTRAINT "ai_dispute_messages_dispute_id_fkey" FOREIGN KEY ("dispute_id") REFERENCES "ai_disputes"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- ── Immutability guards ──────────────────────────────────────────────────────
-- The financial ledger and the billing audit log are append-only BY DATABASE
-- RULE, not just application convention: any UPDATE or DELETE is rejected.
CREATE OR REPLACE FUNCTION ai_billing_reject_mutation() RETURNS trigger AS $$
BEGIN
  RAISE EXCEPTION '% rows are immutable (append-only financial record)', TG_TABLE_NAME;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS ai_wallet_transactions_immutable ON ai_wallet_transactions;
CREATE TRIGGER ai_wallet_transactions_immutable
  BEFORE UPDATE OR DELETE ON ai_wallet_transactions
  FOR EACH ROW EXECUTE FUNCTION ai_billing_reject_mutation();

DROP TRIGGER IF EXISTS ai_billing_audit_logs_immutable ON ai_billing_audit_logs;
CREATE TRIGGER ai_billing_audit_logs_immutable
  BEFORE UPDATE OR DELETE ON ai_billing_audit_logs
  FOR EACH ROW EXECUTE FUNCTION ai_billing_reject_mutation();
