# AI NLQ Reporting Final Integration Review

Review date: 2026-05-13

Go-live readiness status: **READY_WITH_MINOR_FIXES**

## Implementation Summary

The implementation follows the intended production architecture:

```text
User NLQ
-> authenticated backend API
-> AI semantic parser
-> semantic JSON validation
-> backend SQL compiler
-> SQL safety validator
-> PostgreSQL read-only execution
-> result rendering
-> optional AI summary
-> audit logging
```

The AI provider is used only to produce semantic JSON and optional result summaries. It does not receive raw database access and does not execute SQL. SQL is compiled by backend code from `apps/api/ai-reporting/semantic-catalog.json`, restricted to approved reporting views, validated before execution, parameterized, and executed in a read-only transaction.

## Completed Items

### Architecture

- Semantic catalog, reporting view schema, prompts, parser, validator, SQL compiler, safety validator, executor, summarizer, audit logging, and frontend renderers are implemented.
- AI outputs are treated as untrusted semantic JSON and are validated before query compilation.
- Raw transactional tables are not exposed to the NLQ layer; the compiler targets approved `vw_ai_*` reporting views only.
- Prompt injection protection exists before the AI call and backend validators still enforce schema, catalog, permissions, scope, and SQL safety.

### Backend

- AI reporting endpoints are implemented under `ai-reporting` for query, dashboard, catalog metadata, and history.
- Endpoints use `JwtAuthGuard`, `RolesGuard`, `RequireModule('reports')`, and explicit AI reporting permissions.
- Service-level checks enforce feature flag, tenant settings, allowed roles, AI permissions, domain permissions, company scope, branch or warehouse scope, and runtime row limits.
- AI provider supports configured provider/model, timeout, JSON output validation, and safe error handling.
- SQL compiler applies tenant filters, company filters where required, branch/warehouse filters where required, default dataset filters, date filters, grouping, sorting, and parameterized limits.
- SQL safety validator rejects non-SELECT SQL, semicolons, write keywords, system tables, dangerous functions, unapproved views, missing tenant filters, and unsafe company/branch filter compilation.
- Report executor sets the transaction read-only, applies statement timeout, logs slow queries, normalizes result rows, and maps database timeouts to friendly errors.
- Audit logging records request/user/tenant/company/branch scope, question, semantic query, SQL hash, execution timing, row count, status, error, AI call counts, summary call counts, and token fields.
- Usage guard enforces per-user minute rate limits, tenant hourly limits, daily user/tenant AI call limits, monthly company limits when company scope is supplied, and concurrent query limits.

### Database

- Reporting views are created through migrations:
  - `vw_ai_sales_items`
  - `vw_ai_sales_invoices`
  - `vw_ai_purchase_items`
  - `vw_ai_purchase_invoices`
  - `vw_ai_stock_summary`
  - `vw_ai_stock_batches`
  - `vw_ai_stock_ledger`
  - `vw_ai_party_outstanding`
  - `vw_ai_tax_register`
  - `vw_ai_ledger_entries`
- Audit table and reporting/audit indexes are included in migrations.
- No materialized views were added, which is appropriate until production query profiles justify refresh complexity.
- Validation SQL and report correctness comparison SQL are documented for staging execution.

### Frontend

- `/reports/ai` page is implemented with compact reporting-focused UX.
- Page visibility is feature-flag and permission gated.
- Reports menu integration hides AI Reporting when disabled or unauthorized.
- Query input supports validation, loading state, enter-to-submit, duplicate prevention, suggestions, and history rerun.
- Result renderer supports table, KPI, bar, line, pie, dashboard widgets, summaries, assumptions, follow-up questions, empty states, and friendly errors.
- Frontend uses the existing API client/auth flow and backend catalog/history endpoints.

### Security And Privacy

- AI Reporting is disabled by default through `AI_REPORTING_ENABLED=false`.
- Tenant-level settings can further disable AI Reporting, summaries, row limits, monthly cap, and sensitive masking.
- Backend enforces data scope; it does not rely on the AI prompt to enforce company, branch, warehouse, or tenant constraints.
- Sensitive result fields are masked/excluded for summaries and for normal report responses unless an authorized role and domain explicitly allow unmasked data.
- Prompt templates require JSON-only responses and forbid SQL/schema invention.
- Catalog metadata sent to frontend is limited and excludes raw SQL internals.
- Provider secrets are not required when the feature flag is off, and committed env files contain placeholders rather than real AI Reporting credentials.

### Production Readiness

- Environment variables are documented in `.env.example`, `.env.production.example`, and `.env.docker`.
- Environment validation only requires AI provider/model when AI Reporting is enabled.
- Feature flag behavior is enforced in backend endpoints, usage guard, frontend menu, and page access.
- Monitoring SQL and production checklist are documented.
- Rollback plan is documented: disable feature flag, leave harmless views/audit table in place, and stop AI API calls.

## Verification Evidence

Last successful verification performed during implementation:

- API tests: `npx jest ai-reporting --runInBand` passed 7 suites / 51 tests.
- Web tests: `npx vitest run src/services/api/ai-reporting.service.test.ts src/components/reports/AiReportResult.test.tsx src/pages/reports/AiReporting.test.tsx` passed 3 files / 16 tests.
- API build: `npm run build` passed.
- Web build: `npm run build` passed.
- Whitespace check: `git diff --check` passed with CRLF warnings only.

## Remaining Issues

1. **Staging data correctness validation is still required before broad production enablement.**
   The repository includes validation SQL and comparison SQL, but this review did not execute those checks against production-like Marg data. Run `docs/ai-reporting/view-validation.sql` and `docs/ai-reporting/report-correctness-validation.sql`, then compare selected outputs with existing production reports.

2. **Production query performance must be measured on real tenant data.**
   The views are normal PostgreSQL views over Marg-synced tables. Compiler limits and statement timeouts reduce blast radius, but high-volume tenants still need `EXPLAIN ANALYZE` checks for common questions such as top products, invoice-wise sales, stock summary, party outstanding, and tax register.

3. **Tenant allowed-role configuration is backend-supported but not fully exposed as a rich admin UI control.**
   The backend can enforce allowed roles from tenant settings, and RBAC remains the primary permission mechanism. Add a simple admin selector if operations needs tenant-specific AI role restrictions without direct settings edits.

4. **Provider token accounting fields exist, but token usage is not fully wired from provider responses.**
   Audit columns can store token counts, but current monitoring should rely on AI call counts until provider response usage is mapped.

5. **Monthly company usage cap applies when a company scope is resolved for the request.**
   User and tenant limits always apply. For questions that run across all allowed companies, add an aggregate company/tenant cap policy if finance requires strict per-company billing attribution.

## Risks

- Semantic catalog changes can change report meaning. Treat catalog edits as production code changes requiring review and tests.
- Disabling sensitive masking for authorized finance/tax contexts can expose PAN/VAT/GST-style fields. Keep masking enabled by default and restrict unmasked access to explicitly approved roles.
- AI summaries can still phrase insights poorly even when based on real rows. The implementation limits rows and masks sensitive fields, but business users should treat summaries as commentary over the table, not as source of record.
- Reporting views depend on current Marg sync conventions. Any Marg table/schema change must be accompanied by view, catalog, and correctness test updates.

## Recommended Fixes Before Broad Go-Live

1. Run all validation SQL on staging with a recent production-like Marg dataset and attach result evidence to the release ticket.
2. Run performance checks for the top 10 expected NLQ questions using realistic date ranges and tenant sizes.
3. Pilot-enable `AI_REPORTING_ENABLED=true` for one internal tenant only, with summaries enabled after base query validation.
4. Add or document the admin workflow for tenant-specific allowed AI roles.
5. Map AI provider token usage into audit fields if cost dashboards require token-level accounting.
6. Add release-monitoring alerts for AI failure rate, query timeouts, slow queries, usage cap hits, and unsupported question spikes.

## Go-Live Decision

The implementation is not blocked by architectural, SQL safety, permission, feature-flag, or test coverage gaps. It is suitable for a controlled production rollout after staging data correctness and performance validation are completed.

Final status: **READY_WITH_MINOR_FIXES**
