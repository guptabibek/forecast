-- Tenant-owned AI provider configuration and usage tracking.
-- API keys are stored encrypted by the API service; plaintext keys are never returned.

CREATE TABLE IF NOT EXISTS ai_tenant_provider_configs (
  id UUID NOT NULL DEFAULT uuid_generate_v4(),
  tenant_id UUID NOT NULL,
  provider VARCHAR(50) NOT NULL DEFAULT 'openai',
  model VARCHAR(120) NOT NULL,
  summary_model VARCHAR(120),
  api_key_encrypted TEXT,
  api_key_last4 VARCHAR(8),
  api_key_fingerprint VARCHAR(64),
  endpoint_url VARCHAR(500),
  organization_id VARCHAR(255),
  enabled BOOLEAN NOT NULL DEFAULT true,
  max_tokens INTEGER,
  temperature NUMERIC(4, 3),
  monthly_token_limit INTEGER,
  monthly_cost_limit_cents INTEGER,
  input_token_cost_per_1m_cents INTEGER,
  output_token_cost_per_1m_cents INTEGER,
  configured_by_id UUID,
  last_tested_at TIMESTAMP(3),
  last_test_status VARCHAR(30),
  last_test_error VARCHAR(500),
  created_at TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT ai_tenant_provider_configs_pkey PRIMARY KEY (id),
  CONSTRAINT ai_tenant_provider_configs_tenant_id_key UNIQUE (tenant_id),
  CONSTRAINT ai_tenant_provider_configs_tenant_id_fkey FOREIGN KEY (tenant_id) REFERENCES tenants(id) ON DELETE CASCADE ON UPDATE CASCADE,
  CONSTRAINT ai_tenant_provider_configs_configured_by_id_fkey FOREIGN KEY (configured_by_id) REFERENCES users(id) ON DELETE SET NULL ON UPDATE CASCADE,
  CONSTRAINT ai_tenant_provider_configs_provider_check CHECK (provider IN ('openai')),
  CONSTRAINT ai_tenant_provider_configs_max_tokens_check CHECK (max_tokens IS NULL OR (max_tokens >= 1 AND max_tokens <= 200000)),
  CONSTRAINT ai_tenant_provider_configs_temperature_check CHECK (temperature IS NULL OR (temperature >= 0 AND temperature <= 2)),
  CONSTRAINT ai_tenant_provider_configs_monthly_token_limit_check CHECK (monthly_token_limit IS NULL OR monthly_token_limit > 0),
  CONSTRAINT ai_tenant_provider_configs_monthly_cost_limit_check CHECK (monthly_cost_limit_cents IS NULL OR monthly_cost_limit_cents > 0),
  CONSTRAINT ai_tenant_provider_configs_input_cost_check CHECK (input_token_cost_per_1m_cents IS NULL OR input_token_cost_per_1m_cents >= 0),
  CONSTRAINT ai_tenant_provider_configs_output_cost_check CHECK (output_token_cost_per_1m_cents IS NULL OR output_token_cost_per_1m_cents >= 0)
);

CREATE INDEX IF NOT EXISTS ai_tenant_provider_configs_tenant_enabled_idx
  ON ai_tenant_provider_configs (tenant_id, enabled);

CREATE TABLE IF NOT EXISTS ai_report_usage_events (
  id UUID NOT NULL DEFAULT uuid_generate_v4(),
  tenant_id UUID NOT NULL,
  user_id UUID,
  request_id UUID,
  provider VARCHAR(50) NOT NULL,
  model VARCHAR(120),
  call_type VARCHAR(50) NOT NULL,
  status VARCHAR(30) NOT NULL,
  prompt_tokens INTEGER,
  completion_tokens INTEGER,
  total_tokens INTEGER,
  estimated_cost_cents NUMERIC(12, 4),
  latency_ms INTEGER,
  error_code VARCHAR(80),
  error_message VARCHAR(500),
  created_at TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT ai_report_usage_events_pkey PRIMARY KEY (id),
  CONSTRAINT ai_report_usage_events_tenant_id_fkey FOREIGN KEY (tenant_id) REFERENCES tenants(id) ON DELETE CASCADE ON UPDATE CASCADE,
  CONSTRAINT ai_report_usage_events_user_id_fkey FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE SET NULL ON UPDATE CASCADE,
  CONSTRAINT ai_report_usage_events_status_check CHECK (status IN ('success', 'error')),
  CONSTRAINT ai_report_usage_events_token_check CHECK (total_tokens IS NULL OR total_tokens >= 0)
);

CREATE INDEX IF NOT EXISTS ai_report_usage_events_tenant_created_idx
  ON ai_report_usage_events (tenant_id, created_at DESC);

CREATE INDEX IF NOT EXISTS ai_report_usage_events_tenant_month_idx
  ON ai_report_usage_events (tenant_id, date_trunc('month', created_at));

CREATE INDEX IF NOT EXISTS ai_report_usage_events_request_idx
  ON ai_report_usage_events (request_id);

CREATE INDEX IF NOT EXISTS ai_report_usage_events_tenant_provider_model_idx
  ON ai_report_usage_events (tenant_id, provider, model, created_at DESC);
