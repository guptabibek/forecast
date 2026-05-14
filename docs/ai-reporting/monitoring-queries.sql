-- Operational monitoring queries for AI NLQ reporting.
-- These queries read only the AI reporting audit table and do not expose report rows.

-- Request volume, failures, latency, and AI-call counts by hour.
SELECT date_trunc('hour', created_at) AS hour,
       COUNT(*) AS request_count,
       COUNT(*) FILTER (WHERE status = 'error') AS failure_count,
       ROUND(AVG(execution_time_ms)::numeric, 2) AS avg_execution_ms,
       PERCENTILE_CONT(0.95) WITHIN GROUP (ORDER BY execution_time_ms) AS p95_execution_ms,
       SUM(ai_call_count) AS ai_call_count,
       SUM(summary_call_count) AS summary_call_count
FROM ai_report_query_audits
WHERE created_at >= now() - interval '24 hours'
GROUP BY 1
ORDER BY 1 DESC;

-- Top tenants and companies by AI usage in the current month.
SELECT tenant_id,
       company_id,
       COUNT(*) AS request_count,
       SUM(ai_call_count + summary_call_count) AS billable_ai_calls,
       COUNT(*) FILTER (WHERE status = 'error') AS failure_count
FROM ai_report_query_audits
WHERE created_at >= date_trunc('month', now())
GROUP BY tenant_id, company_id
ORDER BY billable_ai_calls DESC NULLS LAST, request_count DESC
LIMIT 50;

-- Top users by usage in the current day.
SELECT tenant_id,
       user_id,
       COUNT(*) AS request_count,
       SUM(ai_call_count + summary_call_count) AS ai_calls,
       MAX(created_at) AS last_request_at
FROM ai_report_query_audits
WHERE created_at >= date_trunc('day', now())
GROUP BY tenant_id, user_id
ORDER BY ai_calls DESC, request_count DESC
LIMIT 50;

-- Error breakdown for triage.
SELECT error_code,
       COUNT(*) AS occurrences,
       MAX(error_message) AS sample_message,
       MAX(created_at) AS last_seen_at
FROM ai_report_query_audits
WHERE status = 'error'
  AND created_at >= now() - interval '7 days'
GROUP BY error_code
ORDER BY occurrences DESC;

-- Unsupported or unsafe prompt patterns.
SELECT request_id,
       tenant_id,
       user_id,
       company_id,
       error_code,
       left(question, 300) AS question_sample,
       created_at
FROM ai_report_query_audits
WHERE error_code IN ('UNSUPPORTED_QUESTION', 'PROMPT_INJECTION_REJECTED', 'UNSAFE_SQL', 'INVALID_SEMANTIC_QUERY')
  AND created_at >= now() - interval '7 days'
ORDER BY created_at DESC
LIMIT 100;

-- Slow successful queries.
SELECT request_id,
       tenant_id,
       user_id,
       company_id,
       query_kind,
       execution_time_ms,
       row_count,
       sql_hash,
       created_at
FROM ai_report_query_audits
WHERE status = 'success'
  AND execution_time_ms >= 5000
  AND created_at >= now() - interval '7 days'
ORDER BY execution_time_ms DESC
LIMIT 100;
