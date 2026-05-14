# Production Task: Deployment, Configuration, and Monitoring for AI Reporting

This is a production system. Do not implement demo, mock, stub, hardcoded, or temporary logic. Use the existing database, existing authentication, existing permissions, existing UI components, and existing report logic. If something is unclear, inspect the codebase and implement the safest production-grade solution.

You are a senior DevOps and production release engineer.

Prepare AI NLQ Reporting for production deployment in the existing ERP application.

## Goals

Ensure the feature can be deployed safely with configuration, monitoring, rollback, and operational visibility.

## Environment Variables

Add required environment variables:

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

Use existing config management pattern.

## Feature Flag

AI Reporting must be behind a feature flag:

```env
AI_REPORTING_ENABLED=true
```

If disabled:

- backend endpoints should return feature disabled
- frontend menu should hide AI Reporting

## Database Migration

Ensure migrations include:

- reporting views
- materialized views if any
- audit table
- indexes
- permissions if needed

Migrations must be reversible where possible.

## Monitoring

Add logs/metrics for:

- AI request count
- AI failures
- SQL execution failures
- average response time
- token usage if available
- slow queries
- top users/companies by usage
- unsupported questions

## Admin Controls

If existing admin settings exist, add controls for:

- enable AI reporting
- enable AI summary
- max rows
- monthly usage cap
- allowed roles
- sensitive masking

## Rollback Plan

Document rollback:

- disable feature flag
- revert frontend menu
- keep views harmless
- stop AI API calls
- preserve audit logs

## Production Checklist

Create:

`docs/ai-reporting/production-checklist.md`

Include:

- env variables configured
- API key configured
- feature flag tested
- views migrated
- indexes created
- permissions verified
- AI endpoint tested
- usage limit tested
- security tested
- rollback tested

## Acceptance Criteria

- Feature can be enabled/disabled safely.
- Missing AI API key does not crash application.
- Production logging exists.
- Usage limits exist.
- Rollback plan exists.
- Deployment documentation exists.
