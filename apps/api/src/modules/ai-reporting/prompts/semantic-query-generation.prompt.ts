export interface SemanticQueryPromptInput {
  userQuestion: string;
  userContextJson: string;
  currentDate: string;
  financialYearJson: string;
  semanticCatalogJson: string;
}

export function buildSemanticQueryGenerationPrompt(input: SemanticQueryPromptInput): string {
  return `Convert the user's natural language question into semantic query JSON.

User question:
${input.userQuestion}

User context:
${input.userContextJson}

Current date:
${input.currentDate}

Financial year:
${input.financialYearJson}

Semantic catalog:
${input.semanticCatalogJson}

Return only valid JSON in this format:

{
  "status": "ok | clarification_required | unsupported",
  "queryKind": "single_report | dashboard | follow_up | explanation",
  "mode": "aggregate | detail | ranking | trend | comparison | dashboard | kpi",
  "domain": "sales | purchase | inventory | accounting | outstanding | tax | mixed",
  "datasetId": "string | null",
  "metrics": [
    {
      "metricId": "string",
      "alias": "string"
    }
  ],
  "dimensions": [
    {
      "dimensionId": "string"
    }
  ],
  "displayColumns": [
    {
      "columnId": "string"
    }
  ],
  "filters": [
    {
      "filterId": "string",
      "operator": "= | != | > | >= | < | <= | in | not_in | contains | between",
      "value": "string | number | boolean | array | object"
    }
  ],
  "time": {
    "dateFieldId": "string | null",
    "rangeType": "today | yesterday | this_week | last_week | this_month | last_month | this_quarter | last_quarter | current_financial_year | last_financial_year | custom | unspecified",
    "startDate": "YYYY-MM-DD | null",
    "endDate": "YYYY-MM-DD | null"
  },
  "comparison": {
    "enabled": false,
    "type": "previous_period | previous_year | custom | none",
    "startDate": null,
    "endDate": null
  },
  "sort": [
    {
      "byMetricId": "string | null",
      "byDimensionId": "string | null",
      "byColumnId": "string | null",
      "direction": "asc | desc"
    }
  ],
  "limit": 50,
  "output": {
    "showGrid": true,
    "showChart": false,
    "chartType": "bar | line | pie | kpi | none",
    "xField": "string | null",
    "yField": "string | null"
  },
  "assumptions": [],
  "clarifyingQuestion": null,
  "unsupportedReason": null
}

Rules:
1. Use only IDs that exist in the catalog above. No invented IDs, no schema/column names from outside the catalog.
2. Output JSON only - no prose, no markdown fences, no comments, no SQL.
3. If a question cannot be answered with the catalog, set status="unsupported" and include unsupportedReason that names the missing metric, dimension, or dataset (for example: "Tried metric net_margin and dimension manufacturer - neither is in the catalog.").
4. If the question is ambiguous, set status="clarification_required" with one short clarifyingQuestion.
5. For relative date ranges not represented by rangeType, use rangeType "custom" with concrete startDate and endDate in YYYY-MM-DD.
6. If a report template exactly matches the question, you may align with its dataset/metrics/dimensions/sort as a shortcut, but still emit a complete semantic query JSON.
7. If no template clearly matches, dynamically choose datasetId, metrics, dimensions, displayColumns, filters, date range, sort, limit, and output from the catalog.
8. Use mode="detail" with displayColumns for row, list, bill-wise, invoice-wise, ledger-line, and detail questions.
9. Use mode="ranking" for top/bottom questions; set limit to the requested N (default 10). Use mode="trend" for date/month movement; chartType "line". Use mode="kpi" for single-value totals; chartType "kpi". Use mode="comparison" for period-vs-period questions and populate the comparison block.
10. Grid output is the default. Set showChart=true only when a chart is useful for ranking, trend, KPI, or simple breakdown output. xField must be a dimension key/label column in the result; yField must be a metricId you selected.
11. Filters must reference filterId from the catalog wherever possible. Free-text filter values are allowed only for catalog filters that expose a text column (e.g. customer_filter, product_filter).
12. Time field must be a fieldId from the catalog matching the chosen dataset. Do not invent date columns.
13. Limit must be a positive integer; default 100, max 1000.
14. Every assumption you make about ambiguous parts of the question MUST be listed in assumptions[] in one short sentence each.`;
}
