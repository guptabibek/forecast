-- Move AI reporting operational config from env to the per-tenant table.
-- All limits/timeouts/feature flags live on ai_tenant_provider_configs so a tenant
-- admin owns the whole AI Reporting configuration. The superadmin gates the
-- entire module via the tenant_modules table (key: 'ai-reporting').

ALTER TABLE ai_tenant_provider_configs
  ADD COLUMN IF NOT EXISTS timeout_ms INTEGER NOT NULL DEFAULT 30000,
  ADD COLUMN IF NOT EXISTS max_result_rows INTEGER NOT NULL DEFAULT 500,
  ADD COLUMN IF NOT EXISTS max_summary_rows INTEGER NOT NULL DEFAULT 50,
  ADD COLUMN IF NOT EXISTS daily_user_call_limit INTEGER NOT NULL DEFAULT 100,
  ADD COLUMN IF NOT EXISTS daily_tenant_call_limit INTEGER NOT NULL DEFAULT 2000,
  ADD COLUMN IF NOT EXISTS monthly_company_call_limit INTEGER NOT NULL DEFAULT 5000,
  ADD COLUMN IF NOT EXISTS mask_sensitive_fields BOOLEAN NOT NULL DEFAULT true,
  ADD COLUMN IF NOT EXISTS summaries_enabled BOOLEAN NOT NULL DEFAULT true,
  ADD COLUMN IF NOT EXISTS rate_per_user_per_minute INTEGER NOT NULL DEFAULT 20,
  ADD COLUMN IF NOT EXISTS rate_per_tenant_per_hour INTEGER NOT NULL DEFAULT 500,
  ADD COLUMN IF NOT EXISTS max_concurrent_per_user INTEGER NOT NULL DEFAULT 2,
  ADD COLUMN IF NOT EXISTS max_concurrent_per_tenant INTEGER NOT NULL DEFAULT 20;

ALTER TABLE ai_tenant_provider_configs
  ADD CONSTRAINT ai_tenant_provider_configs_timeout_check
    CHECK (timeout_ms BETWEEN 1000 AND 600000),
  ADD CONSTRAINT ai_tenant_provider_configs_max_result_rows_check
    CHECK (max_result_rows BETWEEN 1 AND 10000),
  ADD CONSTRAINT ai_tenant_provider_configs_max_summary_rows_check
    CHECK (max_summary_rows BETWEEN 1 AND 500),
  ADD CONSTRAINT ai_tenant_provider_configs_daily_user_call_limit_check
    CHECK (daily_user_call_limit BETWEEN 1 AND 100000),
  ADD CONSTRAINT ai_tenant_provider_configs_daily_tenant_call_limit_check
    CHECK (daily_tenant_call_limit BETWEEN 1 AND 1000000),
  ADD CONSTRAINT ai_tenant_provider_configs_monthly_company_call_limit_check
    CHECK (monthly_company_call_limit BETWEEN 1 AND 10000000),
  ADD CONSTRAINT ai_tenant_provider_configs_rate_per_user_per_minute_check
    CHECK (rate_per_user_per_minute BETWEEN 1 AND 10000),
  ADD CONSTRAINT ai_tenant_provider_configs_rate_per_tenant_per_hour_check
    CHECK (rate_per_tenant_per_hour BETWEEN 1 AND 1000000),
  ADD CONSTRAINT ai_tenant_provider_configs_max_concurrent_per_user_check
    CHECK (max_concurrent_per_user BETWEEN 1 AND 100),
  ADD CONSTRAINT ai_tenant_provider_configs_max_concurrent_per_tenant_check
    CHECK (max_concurrent_per_tenant BETWEEN 1 AND 1000);
