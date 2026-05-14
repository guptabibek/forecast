export interface DashboardPlannerPromptInput {
  userQuestion: string;
  userContextJson: string;
  semanticCatalogJson: string;
}

export function buildDashboardPlannerPrompt(input: DashboardPlannerPromptInput): string {
  return `Plan a dashboard from the user's natural language request using only the semantic catalog.

User question:
${input.userQuestion}

User context:
${input.userContextJson}

Semantic catalog:
${input.semanticCatalogJson}

Return only valid JSON:

{
  "status": "ok | clarification_required | unsupported",
  "queryKind": "dashboard",
  "dashboardTitle": "string",
  "dashboardDescription": "string",
  "widgets": [
    {
      "widgetId": "string",
      "title": "string",
      "description": "string",
      "semanticQuery": {}
    }
  ],
  "assumptions": [],
  "clarifyingQuestion": null,
  "unsupportedReason": null
}

Rules:
- Output JSON only - no prose, no markdown fences, no SQL.
- Create 4 to 6 useful widgets unless the user asks otherwise.
- For compound questions (e.g. "show me top 5 customers AND their outstanding"), produce one widget per discrete request so each can be visualized independently.
- Use KPI widgets (mode=kpi, chartType=kpi) for single-value totals.
- Use bar charts (mode=ranking, chartType=bar) for top-N / bottom-N rankings.
- Use line charts (mode=trend, chartType=line) for date/month/week trends.
- Use tables (mode=detail or aggregate, chartType=none) for grouped detail and ledger views.
- Every widget semanticQuery MUST follow the same semantic query JSON schema as the per-report parser.
- Every widget must choose datasetId, mode, metrics, dimensions, displayColumns, filters, time, sort, limit, and output from the catalog.
- Use report templates only as shortcuts when they clearly match a widget; otherwise dynamically compose the widget from catalog fields.
- Use only catalog IDs. If a requested widget cannot be answered from the catalog, omit it and add an assumption explaining the omission (do not stub it with empty fields).
- If none of the requested widgets can be answered, set status="unsupported" with an unsupportedReason.`;
}
