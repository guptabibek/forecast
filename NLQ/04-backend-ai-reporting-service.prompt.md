# Production Task: Implement Backend NLQ AI Reporting Service

This is a production system. Do not implement demo, mock, stub, hardcoded, or temporary logic. Use the existing database, existing authentication, existing permissions, existing UI components, and existing report logic. If something is unclear, inspect the codebase and implement the safest production-grade solution.

You are a senior backend engineer implementing production AI reporting in an existing ERP application.

The system already has:

- PostgreSQL database
- Marg-synced data
- reporting views
- semantic catalog
- existing authentication and permissions

Now implement the backend service for NLQ reporting.

This is NOT an MVP, demo, or stub. Implement production-grade backend architecture.

## Goal

Create backend APIs that allow users to ask natural language report questions. The backend should:

1. authenticate user
2. load user company/branch permissions
3. send the user question and semantic catalog to AI
4. receive semantic query JSON
5. validate semantic query JSON
6. compile semantic query to safe PostgreSQL SQL
7. execute SQL using safe read-only logic
8. return table/chart/dashboard output
9. optionally summarize result using AI
10. log audit trail

## Important

Prefer backend programmatic SQL compilation from semantic JSON.

Do not let AI directly execute SQL.

If existing backend is Node.js/TypeScript, implement in TypeScript. If existing backend is another stack, follow the existing stack and conventions.

## Required Backend Modules

Create modules using existing project structure:

```txt
api/ai-reporting/
  semantic-catalog.loader.ts
  ai-provider.service.ts
  nlq-parser.service.ts
  semantic-query.types.ts
  semantic-query.validator.ts
  sql-compiler.service.ts
  sql-safety.validator.ts
  report-executor.service.ts
  result-summarizer.service.ts
  ai-reporting.controller.ts
  ai-reporting.routes.ts
  ai-reporting.audit.ts
  ai-reporting.errors.ts
```

Adjust names to match project conventions.

## API Endpoints

Implement production endpoints:

### 1. Ask AI Report

`POST /api/ai-reporting/query`

Request:

```json
{
  "question": "Show top selling products this month",
  "outputMode": "auto",
  "includeSummary": true
}
```

Response:

```json
{
  "requestId": "uuid",
  "status": "success",
  "title": "Top Selling Products This Month",
  "queryKind": "single_report",
  "visualization": {
    "type": "bar",
    "x": "product_name",
    "y": "total_quantity"
  },
  "columns": [],
  "rows": [],
  "summary": "string",
  "assumptions": [],
  "followUpQuestions": []
}
```

### 2. Dashboard Query

`POST /api/ai-reporting/dashboard`

Request:

```json
{
  "question": "Generate sales dashboard for this month",
  "includeSummary": true
}
```

Response must support multiple widgets.

### 3. Metadata Endpoint

`GET /api/ai-reporting/catalog`

Return limited catalog metadata for frontend suggestions. Do not expose unsafe internals.

### 4. History Endpoint

`GET /api/ai-reporting/history`

Return user's previous AI report queries.

## AI Provider Service

Implement provider abstraction so we can change models later.

Support environment variables:

```env
AI_PROVIDER=openai
AI_API_KEY=
AI_MODEL=
AI_SUMMARY_MODEL=
AI_MAX_TOKENS=
AI_TEMPERATURE=0
AI_TIMEOUT_MS=30000
```

The provider service must:

- apply timeout
- retry only safely
- log errors without leaking API keys
- support JSON response mode if provider supports it
- validate AI output as JSON
- fail gracefully

## NLQ Parser

The parser sends:

- user question
- current date
- company_id
- branch_id
- allowed branches
- user role
- semantic catalog
- fiscal year

It must return semantic query JSON only.

## Semantic Query Validation

Validate AI output strictly.

Reject if:

- unknown datasetId
- unknown metricId
- unknown dimensionId
- unknown filterId
- disallowed operator
- missing required security filter
- invalid date range
- invalid limit
- unsupported report kind
- suspicious values
- missing required dataset
- user does not have permission

## SQL Compiler

Compile semantic query JSON into SQL programmatically.

Rules:

1. Use only catalog-approved views.
2. Use only catalog-approved metric expressions.
3. Use only catalog-approved dimension columns.
4. Use only catalog-approved filters.
5. Always apply company_id filter if available.
6. Always apply allowed branch filter if available.
7. Always apply date filter.
8. Always apply default filters.
9. Always parameterize values.
10. Never concatenate unsafe user input.
11. Always add LIMIT for detail/ranking reports.
12. Use query timeout.
13. Use read-only DB connection if available.

Generated SQL should use parameter binding.

Example output:

```ts
{
  sql: "SELECT product_name, SUM(quantity) AS total_quantity FROM vw_ai_sales_items WHERE company_id = $1 AND branch_id = ANY($2) AND invoice_date BETWEEN $3 AND $4 GROUP BY product_name ORDER BY total_quantity DESC LIMIT $5",
  params: [companyId, allowedBranches, startDate, endDate, limit]
}
```

## SQL Safety Validator

Even though SQL is programmatically compiled, validate:

- query starts with SELECT
- no semicolon
- no write keywords
- only allowed view names
- no system tables
- no dangerous functions
- has limit when needed
- has company filter when needed
- has branch filter when needed

## Report Executor

Execute query safely:

- use existing DB connection pattern
- set statement timeout if possible
- limit max rows
- handle empty results
- handle DB errors
- log performance
- return columns and rows

## Result Summarizer

Optional AI call after data execution.

Rules:

- do not send large raw datasets
- limit rows sent to summarizer
- mask sensitive fields
- summarize only based on actual rows
- do not invent insights
- if result is empty, say no matching data found

## Audit Logging

Create audit table or use existing logging system.

Log:

- request_id
- user_id
- company_id
- branch_id
- question
- parsed semantic query
- generated SQL hash or safe SQL record
- execution time
- row count
- status
- error message if any
- created_at

Do not log API keys.

## Error Handling

Return friendly errors:

- unsupported question
- clarification required
- permission denied
- report unavailable
- query too broad
- AI service unavailable
- database timeout

## Acceptance Criteria

- Backend endpoint works with authenticated users.
- AI cannot access raw database.
- AI cannot execute unsafe SQL.
- Semantic query is strictly validated.
- SQL is parameterized.
- User permissions are enforced.
- Company/branch filters are enforced.
- Audit logs are created.
- Existing reports are unaffected.
- No mock data or stub response exists.
