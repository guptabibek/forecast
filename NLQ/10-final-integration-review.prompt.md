# Production Task: Final Integration Review for AI NLQ Reporting

This is a production system. Do not implement demo, mock, stub, hardcoded, or temporary logic. Use the existing database, existing authentication, existing permissions, existing UI components, and existing report logic. If something is unclear, inspect the codebase and implement the safest production-grade solution.

You are a principal engineer reviewing a production AI Reporting implementation.

Review the complete implementation end-to-end.

## Review Areas

### 1. Architecture

Confirm the implementation follows:

```txt
User NLQ
→ AI semantic parser
→ semantic JSON validation
→ backend SQL compiler
→ SQL safety validator
→ PostgreSQL execution
→ result rendering
→ optional AI summary
```

Confirm AI does not directly access raw database or execute arbitrary SQL.

### 2. Backend

Review:

- controllers
- routes
- services
- validators
- SQL compiler
- AI provider
- result summarizer
- audit logging
- error handling
- permissions
- rate limiting

### 3. Database

Review:

- reporting views
- materialized views
- indexes
- query performance
- security filters
- correctness against existing reports

### 4. Frontend

Review:

- page UX
- menu integration
- permissions
- table rendering
- chart rendering
- dashboard rendering
- loading/error states
- history
- follow-up questions

### 5. Security

Review:

- auth
- authorization
- company/branch scope
- SQL safety
- prompt injection
- data minimization
- sensitive masking
- logging

### 6. Production Readiness

Review:

- env variables
- feature flag
- monitoring
- deployment docs
- rollback
- tests
- performance
- maintainability

## Output

Create:

`docs/ai-reporting/final-review.md`

Include:

- implementation summary
- completed items
- remaining issues
- risks
- recommended fixes
- go-live readiness status

Status must be one of:

```txt
READY_FOR_PRODUCTION
READY_WITH_MINOR_FIXES
NOT_READY
```

## Important

Do not mark READY_FOR_PRODUCTION if:

- SQL safety is incomplete
- permissions are incomplete
- AI can query raw tables
- company/branch filter is missing
- tests are missing
- feature flag is missing
- existing reports are broken
- mock data/stubs remain

## Acceptance Criteria

- Full implementation is reviewed.
- Production blockers are clearly listed.
- No hidden assumptions remain.
- Go-live decision is documented.
