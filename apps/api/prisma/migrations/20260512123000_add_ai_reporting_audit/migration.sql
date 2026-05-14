-- Audit/history store for production AI NLQ reporting.
-- Stores semantic intent and execution metadata, not API keys or result payloads.

CREATE TABLE IF NOT EXISTS ai_report_query_audits (
  id UUID NOT NULL DEFAULT uuid_generate_v4(),
  tenant_id UUID NOT NULL,
  user_id UUID,
  request_id UUID NOT NULL,
  company_id INTEGER,
  branch_ids UUID[],
  question TEXT NOT NULL,
  output_mode VARCHAR(30),
  query_kind VARCHAR(50),
  semantic_query JSONB,
  sql_hash VARCHAR(64),
  execution_time_ms INTEGER,
  row_count INTEGER,
  status VARCHAR(30) NOT NULL,
  error_code VARCHAR(80),
  error_message VARCHAR(1000),
  created_at TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT ai_report_query_audits_pkey PRIMARY KEY (id),
  CONSTRAINT ai_report_query_audits_request_id_key UNIQUE (request_id),
  CONSTRAINT ai_report_query_audits_tenant_id_fkey FOREIGN KEY (tenant_id) REFERENCES tenants(id) ON DELETE CASCADE ON UPDATE CASCADE,
  CONSTRAINT ai_report_query_audits_user_id_fkey FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE SET NULL ON UPDATE CASCADE
);

CREATE INDEX IF NOT EXISTS ai_report_query_audits_tenant_user_created_idx
  ON ai_report_query_audits (tenant_id, user_id, created_at DESC);

CREATE INDEX IF NOT EXISTS ai_report_query_audits_tenant_status_created_idx
  ON ai_report_query_audits (tenant_id, status, created_at DESC);
