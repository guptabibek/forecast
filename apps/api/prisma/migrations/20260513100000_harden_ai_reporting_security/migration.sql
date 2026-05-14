ALTER TABLE ai_report_query_audits
  ADD COLUMN IF NOT EXISTS ai_call_count INTEGER NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS summary_call_count INTEGER NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS prompt_tokens INTEGER,
  ADD COLUMN IF NOT EXISTS completion_tokens INTEGER,
  ADD COLUMN IF NOT EXISTS total_tokens INTEGER;

CREATE INDEX IF NOT EXISTS ai_report_query_audits_tenant_created_idx
  ON ai_report_query_audits(tenant_id, created_at DESC);

CREATE INDEX IF NOT EXISTS ai_report_query_audits_tenant_company_created_idx
  ON ai_report_query_audits(tenant_id, company_id, created_at DESC);
