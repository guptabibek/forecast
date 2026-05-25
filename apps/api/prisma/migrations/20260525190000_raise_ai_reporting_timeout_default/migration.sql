-- 30 seconds is too short for production AI planning + SQL execution + optional
-- summarization. Keep the constraint max unchanged, but move tenants that still
-- have the old default to the new default.

ALTER TABLE ai_tenant_provider_configs
  ALTER COLUMN timeout_ms SET DEFAULT 120000;

UPDATE ai_tenant_provider_configs
SET timeout_ms = 120000,
    updated_at = CURRENT_TIMESTAMP
WHERE timeout_ms = 30000;
