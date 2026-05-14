# AI NLQ Reporting Production Checklist

AI reporting is disabled by default. Enable it only after migrations, permissions, security tests, and provider configuration are verified in staging.

## Configuration

Required environment variables:

```env
AI_REPORTING_ENABLED=false
AI_PROVIDER=openai
AI_API_KEY=
AI_MODEL=
AI_SUMMARY_MODEL=
AI_TEMPERATURE=0
AI_TIMEOUT_MS=30000
AI_MAX_RESULT_ROWS=500
AI_MAX_SUMMARY_ROWS=50
AI_DAILY_USER_LIMIT=100
AI_MONTHLY_COMPANY_LIMIT=5000
AI_MASK_SENSITIVE_FIELDS=true
```

Additional supported controls:

```env
AI_MAX_TOKENS=1500
AI_REPORT_QUERY_TIMEOUT_MS=30000
AI_REPORT_SUMMARIES_ENABLED=true
AI_REPORT_RATE_PER_USER_PER_MINUTE=20
AI_REPORT_RATE_PER_TENANT_PER_HOUR=500
AI_REPORT_MAX_CONCURRENT_PER_USER=2
AI_REPORT_MAX_CONCURRENT_PER_TENANT=20
AI_REPORT_DAILY_AI_CALL_LIMIT_PER_TENANT=2000
AI_SLOW_QUERY_MS=5000
```

Configuration checks:

- [ ] `AI_REPORTING_ENABLED=false` is set before deployment.
- [ ] `AI_PROVIDER=openai` is set only for environments intended to use OpenAI.
- [ ] `AI_API_KEY` is configured in the runtime secret manager, not committed to source.
- [ ] `AI_MODEL` is configured before setting `AI_REPORTING_ENABLED=true`.
- [ ] `AI_SUMMARY_MODEL` is configured, or summaries intentionally use `AI_MODEL`.
- [ ] `AI_TIMEOUT_MS` and `AI_REPORT_QUERY_TIMEOUT_MS` match production SLOs.
- [ ] `AI_MAX_RESULT_ROWS` is no higher than operationally approved.
- [ ] `AI_MAX_SUMMARY_ROWS` is capped at 50 or lower.
- [ ] `AI_DAILY_USER_LIMIT` and `AI_MONTHLY_COMPANY_LIMIT` are approved by operations/finance.
- [ ] `AI_MASK_SENSITIVE_FIELDS=true` unless a documented exception is approved.

Missing provider key/model does not crash application startup. Requests fail safely with an AI service unavailable error until credentials are configured.

## Feature Flag

- [ ] With `AI_REPORTING_ENABLED=false`, `/api/v1/ai-reporting/query`, `/dashboard`, `/catalog`, and `/history` return a feature-disabled error for authenticated users.
- [ ] With `AI_REPORTING_ENABLED=false`, tenant settings report `aiReporting.environmentEnabled=false`.
- [ ] Frontend hides `/reports/ai` when tenant settings report `aiReporting.enabled=false`.
- [ ] With `AI_REPORTING_ENABLED=true`, tenant admin can still disable AI reporting for the tenant in Settings.
- [ ] Re-enabling the tenant setting makes the Reports menu item visible only to users with AI reporting permissions.

## Database

Migrations included:

- [ ] AI reporting views: `apps/api/prisma/migrations/20260512120000_add_ai_reporting_views/migration.sql`
- [ ] Audit table: `apps/api/prisma/migrations/20260512123000_add_ai_reporting_audit/migration.sql`
- [ ] Audit indexes and usage columns: `apps/api/prisma/migrations/20260513100000_harden_ai_reporting_security/migration.sql`
- [ ] Permission keys seeded by role/auth services are deployed.
- [ ] No materialized views are deployed unless a later migration documents refresh strategy.

Migration validation:

- [ ] Run `prisma migrate deploy` in staging.
- [ ] Run `docs/ai-reporting/view-validation.sql`.
- [ ] Run `docs/ai-reporting/report-correctness-validation.sql` for an authorized tenant/company/branch/date scope.
- [ ] Compare AI view totals with selected existing production reports.
- [ ] Confirm audit indexes exist with `\d ai_report_query_audits`.

Rollback note: Prisma migrations do not include automatic down migrations. Operational rollback is feature-flag based; views and audit tables are read-only/append-only and can remain in place harmlessly.

## Permissions

- [ ] Role has `report:read`.
- [ ] Role has `reports.ai.view` to see metadata/history.
- [ ] Role has `reports.ai.execute` to run a question.
- [ ] Role has `reports.ai.dashboard` for dashboard generation.
- [ ] Domain permissions are assigned as needed: `reports.sales.view`, `reports.purchase.view`, `reports.inventory.view`, `reports.outstanding.view`, `reports.accounting.view`, `reports.tax.view`.
- [ ] Company and branch scopes are configured and tested with a restricted user.
- [ ] Tenant Settings `AI Reporting Controls` allowed roles, max rows, summary setting, usage cap, and sensitive masking are reviewed.

## Monitoring

Implemented visibility:

- Audit records include request id, user id, tenant id, company id, branch scope, question, semantic query, SQL hash, status, error, row count, execution time, and AI call counts.
- Service logs successful and failed AI report requests with request id, tenant/user ids, row count, duration, and call counts.
- Executor logs slow AI report SQL when duration exceeds `AI_SLOW_QUERY_MS`.
- Provider errors are logged without API keys.
- Full result rows, tokens, passwords, and API keys are not logged.

Operational queries:

- [ ] Add `docs/ai-reporting/monitoring-queries.sql` to DBA/runbook dashboards.
- [ ] Monitor request count and failure rate hourly.
- [ ] Monitor slow queries and review `EXPLAIN` output before increasing limits.
- [ ] Monitor top users/companies by AI calls.
- [ ] Review `PROMPT_INJECTION_REJECTED`, `UNSAFE_SQL`, and `INVALID_SEMANTIC_QUERY` events.
- [ ] If provider token usage becomes available, map it to `prompt_tokens`, `completion_tokens`, and `total_tokens` audit columns.

## Security Smoke

- [ ] Unauthenticated requests are rejected.
- [ ] Users without AI permissions are rejected.
- [ ] Users cannot query outside allowed company/branch scope.
- [ ] Prompt injection test cases from `docs/ai-reporting/test-plan.md` are rejected.
- [ ] SQL safety rejects raw tables, semicolons, write keywords, system schemas, and unsafe functions.
- [ ] Sensitive fields are masked for normal report output and summaries.
- [ ] AI provider receives only question, minimal context, catalog metadata, and limited/masked result samples.

## Release Steps

1. Deploy code with `AI_REPORTING_ENABLED=false`.
2. Run migrations.
3. Run backend and frontend smoke tests.
4. Verify Settings shows AI Reporting Controls with environment disabled.
5. Configure provider secret and models in the runtime secret manager.
6. Set `AI_REPORTING_ENABLED=true`.
7. Enable AI reporting for one pilot tenant in Settings.
8. Assign permissions to a pilot role.
9. Run controlled queries and compare with existing reports.
10. Watch audit and monitoring queries for failures, slow queries, and usage.
11. Broaden tenant/role access only after sign-off.

## Rollback Plan

Primary rollback:

1. Set `AI_REPORTING_ENABLED=false`.
2. Restart/redeploy API processes so the config is active.
3. Confirm AI reporting endpoints return feature-disabled errors.
4. Confirm frontend menu hides AI Reporting after settings refresh.
5. Leave reporting views and audit tables in place.
6. Keep audit logs for security and troubleshooting.

Secondary rollback:

- Remove AI reporting permissions from affected roles if a tenant-specific rollback is needed.
- Disable the tenant AI Reporting setting in Settings.
- Revert frontend menu/route code only if a full application rollback is already being performed.
- Do not drop audit tables during incident rollback unless approved by data retention owners.

## Final Go/No-Go

- [ ] Env variables configured.
- [ ] API key and model configured in secrets.
- [ ] Feature flag disabled-by-default tested.
- [ ] Reporting views migrated.
- [ ] Audit indexes created.
- [ ] Permissions verified.
- [ ] AI endpoints tested with authenticated pilot user.
- [ ] Usage limits tested.
- [ ] Security tests passed.
- [ ] Report correctness checks passed.
- [ ] Monitoring queries available.
- [ ] Rollback tested.
