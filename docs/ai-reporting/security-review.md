# AI Reporting Security Review

Last updated: 2026-05-13

## Implemented Protections

AI Reporting is implemented as an authenticated backend feature under the existing API guard stack. The controller uses `JwtAuthGuard`, `RolesGuard`, and the existing `@RequireModule('reports')` module gate.

Runtime query execution is backend-controlled:

- AI receives the user question and the approved semantic catalog only.
- AI returns semantic JSON only.
- Backend validates dataset, metric, dimension, filter, sort, date range, and limit IDs.
- Backend compiles SQL programmatically from the semantic catalog.
- AI never receives raw database credentials and never executes SQL.

## Permission Keys

The current permission model includes:

- `report:read`
- `reports.ai.view`
- `reports.ai.execute`
- `reports.ai.dashboard`
- `reports.ai_reporting.view`
- `reports.ai_reporting.execute`
- `reports.sales.view`
- `reports.purchase.view`
- `reports.inventory.view`
- `reports.outstanding.view`
- `reports.accounting.view`
- `reports.tax.view`

Endpoint checks:

- `GET /ai-reporting/catalog`: `report:read`, `reports.ai.view`
- `GET /ai-reporting/history`: `report:read`, `reports.ai.view`
- `POST /ai-reporting/query`: `report:read`, `reports.ai.execute`
- `POST /ai-reporting/dashboard`: `report:read`, `reports.ai.execute`, `reports.ai.dashboard`

Semantic validation also enforces report-family permissions based on dataset domain.

## Data Scope

Every compiled query applies:

- `tenant_id`
- `company_id` for datasets requiring company scope
- `branch_id` or `warehouse_id` for datasets requiring branch or warehouse scope
- date filtering for dated datasets, defaulting to the current financial year when no date is provided

Company and branch request parameters are intersected with the authenticated user's explicit scope when available. If the user has no explicit company or branch scope, the service falls back to tenant Marg/company/location scope and still compiles those security filters.

## SQL Safety

Compiled SQL is validated before execution:

- must start with `SELECT`
- semicolons are rejected
- write/control keywords are rejected
- system schemas and dangerous functions are rejected
- only catalog-approved reporting views are allowed
- tenant filter is mandatory
- company/branch filters must use typed parameter binding
- `LIMIT` must be parameterized
- execution runs in a read-only transaction with statement timeout

The executor uses parameter binding for values. User text is never concatenated into SQL identifiers or expressions.

## AI Data Minimization

Parser prompt input includes:

- user question
- current date
- role/permissions
- requested company/branch IDs
- counts of allowed companies/branches
- current financial year
- safe semantic catalog metadata

It does not send raw ERP rows to the parser.

Result summarization sends at most 25 rows and excludes sensitive keys matching PAN, VAT, GST, phone, address, email, bank, license, secret, or token. The response sanitizer also removes sensitive columns from AI report output unless the user role and report domain allow them.

## Prompt Injection Protection

Unsafe natural-language requests are rejected before the AI provider call when they ask to:

- ignore or bypass instructions
- reveal system prompts, API keys, tokens, passwords, or credentials
- dump raw schema or table structures
- run write SQL or administrative database commands
- request raw SQL/direct SQL
- export all customer/supplier/party personal details

This is a backend validator, separate from prompt instructions.

## Logging And Usage

AI activity is logged to `ai_report_query_audits`:

- tenant/user/request IDs
- company and branch scope
- question
- semantic query JSON
- SQL hash, not raw SQL
- execution time
- row count
- status/error
- AI call counts and summary call counts
- timestamp

The audit log does not store API keys, tokens, passwords, or full result rows.

## Rate And Cost Controls

Runtime guards enforce:

- `AI_REPORTING_ENABLED`
- `AI_REPORT_RATE_PER_USER_PER_MINUTE`
- `AI_REPORT_RATE_PER_TENANT_PER_HOUR`
- `AI_REPORT_MAX_CONCURRENT_PER_USER`
- `AI_REPORT_MAX_CONCURRENT_PER_TENANT`
- `AI_REPORT_DAILY_AI_CALL_LIMIT_PER_TENANT`
- `AI_REPORT_SUMMARIES_ENABLED`

Usage counts are derived from the audit table. Concurrent request limits are enforced in-process; for multi-instance deployments, add a shared lock or distributed rate-limit backend.

## Known Risks

- Existing custom roles will not automatically receive new AI/domain permissions unless updated by an admin.
- In-process concurrency limits are not global across multiple API replicas.
- Token usage fields are prepared in the audit schema, but provider token usage is not yet persisted.
- Financial-year access is enforced through default date scoping, but there is no separate per-user fiscal-year assignment model in the inspected codebase.

## Recommendations

- Add an admin settings UI for AI reporting flags and limits if these need tenant-level administration instead of environment configuration.
- Persist provider token usage when provider responses are extended to expose usage metadata.
- Use Redis or PostgreSQL advisory locks for global concurrency control in horizontally scaled deployments.
- Review custom roles after deployment and grant only the required AI and domain permissions.
