# Production Task: Security, Permissions, and Data Privacy for AI Reporting

This is a production system. Do not implement demo, mock, stub, hardcoded, or temporary logic. Use the existing database, existing authentication, existing permissions, existing UI components, and existing report logic. If something is unclear, inspect the codebase and implement the safest production-grade solution.

You are a senior application security engineer.

Review and harden the AI Reporting implementation.

This is a production ERP system. Data includes sales, purchases, customers, suppliers, invoices, tax information, stock, ledger, and business performance. Treat ERP data as confidential.

## Goals

Ensure AI Reporting is secure, permission-aware, and safe for production.

## Security Requirements

### 1. Authentication

- All AI reporting endpoints must require authentication.
- No public access.
- Use existing auth middleware.

### 2. Authorization

Implement permission checks:

- user must have AI reporting access
- user must have report family access
- user must have company access
- user must have branch access
- user must have financial year access if applicable

Permission examples:

```txt
reports.ai.view
reports.ai.execute
reports.ai.dashboard
reports.sales.view
reports.purchase.view
reports.inventory.view
reports.accounting.view
reports.tax.view
```

Use existing permission system.

### 3. Data Scope

Every query must enforce:

- company_id
- branch_id or allowed branch list
- tenant_id if applicable
- financial year if applicable
- user-specific data scope if applicable

Never rely on the AI to enforce security. Backend must enforce it.

### 4. SQL Safety

Validate:

- only SELECT
- no semicolon
- no write keywords
- no raw table access
- only approved reporting views
- no system tables
- no unsafe functions
- query timeout
- row limit
- parameterized SQL only

### 5. AI Data Minimization

Do not send full ERP data to AI.

Send only:

- user question
- semantic catalog
- minimal user context
- aggregated/small result for summary

Mask or exclude:

- phone numbers
- addresses
- PAN/GST/VAT numbers unless required
- bank details
- personal identifiers
- full invoice dump unless authorized

### 6. Logging

Log AI activity:

- user id
- company id
- branch scope
- question
- semantic query
- status
- execution time
- row count
- error
- timestamp

Do not log:

- API key
- full sensitive result rows
- passwords
- tokens

### 7. Rate Limiting

Add rate limit for AI reporting endpoints.

Examples:

- per user per minute
- per company per hour
- max concurrent AI queries

### 8. Cost Control

Add usage tracking:

- number of AI calls
- tokens if provider returns them
- user/company usage count
- daily/monthly limits if required

### 9. Prompt Injection Protection

User may ask:

- ignore previous instructions
- show database schema
- run delete command
- reveal API key
- show all customer data

The system must reject unsafe instructions.

The AI prompt must not be the only protection. Backend validation is mandatory.

### 10. Admin Settings

Add admin-configurable options if suitable:

- enable/disable AI reporting
- enable/disable AI summaries
- max rows per query
- allowed report domains
- monthly AI usage cap
- mask sensitive data
- allowed user roles

## Output

Create or update:

`docs/ai-reporting/security-review.md`

Include:

- implemented protections
- permission keys
- data minimization design
- SQL safety design
- known risks
- recommendations

## Acceptance Criteria

- AI Reporting cannot be accessed by unauthorized users.
- Users cannot query outside their company/branch permissions.
- SQL injection and unsafe SQL are blocked.
- AI cannot access raw DB directly.
- Sensitive data is not unnecessarily sent to AI.
- Audit logs exist.
- Rate limiting or usage guard exists.
