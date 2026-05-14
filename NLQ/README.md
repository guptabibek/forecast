# NLQ AI Reporting Production Prompt Pack

Use these prompts in order to implement production-level NLQ AI Reporting for an existing Marg-synced ERP application with PostgreSQL.

Recommended order:

1. `01-discovery-and-system-audit.prompt.md`
2. `02-postgres-reporting-views.prompt.md`
3. `03-semantic-catalog.prompt.md`
4. `04-backend-ai-reporting-service.prompt.md`
5. `05-ai-runtime-prompts.prompt.md`
6. `06-frontend-ai-reporting-ui.prompt.md`
7. `07-security-permissions-audit.prompt.md`
8. `08-testing-and-quality.prompt.md`
9. `09-production-deployment.prompt.md`
10. `10-final-integration-review.prompt.md`

Add this instruction at the top of every coding-agent prompt:

> This is a production system. Do not implement demo, mock, stub, hardcoded, or temporary logic. Use the existing database, existing authentication, existing permissions, existing UI components, and existing report logic. If something is unclear, inspect the codebase and implement the safest production-grade solution.
