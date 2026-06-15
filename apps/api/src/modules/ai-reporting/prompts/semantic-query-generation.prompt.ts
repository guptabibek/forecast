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
      "operator": "= | != | > | >= | < | <= | in | not_in | contains | not_contains | between",
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
  "unsupportedReason": null,
  "errorCode": null,
  "missingCapabilities": [],
  "availableAlternatives": [],
  "recommendedSchemaFix": null
}

Rules:
1. Use only IDs that exist in the catalog above. No invented IDs, no schema/column names from outside the catalog.
2. Output JSON only - no prose, no markdown fences, no comments, no SQL.
3. If a question cannot be answered with the catalog, set status="unsupported" and include unsupportedReason that names the missing metric, dimension, or dataset (for example: "Tried metric net_margin and dimension manufacturer - neither is in the catalog."). Preserve structured unsupported details in errorCode, missingCapabilities, availableAlternatives, and recommendedSchemaFix when applicable. NEVER answer an absence/negation question ("not sold", "never sold", "no sales", "without X", "items that did not ...") by querying a transactional dataset for the POSITIVE case (e.g. filtering sales_items to a date returns items that DID sell - the opposite). Map it to a dataset that models absence (item_velocity) or return status="unsupported".
4. If the question is ambiguous, set status="clarification_required" with one short clarifyingQuestion.
5. For relative date ranges not represented by rangeType, use rangeType "custom" with concrete startDate and endDate in YYYY-MM-DD.
6. If a report template exactly matches the question, you may align with its dataset/metrics/dimensions/sort as a shortcut, but still emit a complete semantic query JSON.
7. If no template clearly matches, dynamically choose datasetId, metrics, dimensions, displayColumns, filters, date range, sort, limit, and output from the catalog.
8. Use mode="detail" with displayColumns for row, list, bill-wise, invoice-wise, ledger-line, and detail questions.
9. Use mode="ranking" for top/bottom questions; set limit to the requested N (default 10). Use mode="trend" for date/month movement; chartType "line". Use mode="kpi" for single-value totals; chartType "kpi". Use mode="comparison" for period-vs-period questions and populate the comparison block.
9a. A ranking/grouped question ("top N <entity>", "<entity> with most/highest/lowest <measure>", "best performing <entity>") MUST group: include the dimension for <entity>, aggregate metrics, sort by the measure, and the requested limit. NEVER answer such a question with an ungrouped detail/list query. If no catalog dimension matches <entity> on any dataset, set status="unsupported" naming the missing dimension instead of degrading.
9b. When the requested dimension exists only on one dataset (e.g. regional route/area dimensions on the net datasets), choose THAT dataset and its metrics, even if another dataset also matches the measure.
9c. For "biggest increase/decrease/growth/drop compared to a previous period" rankings ("top 10 items whose sales decreased vs previous month"), set mode="comparison", the entity dimension, the measure metric, time = the CURRENT period, comparison = {"enabled": true, "type": "previous_period" (or previous_year), "rankBy": "change"}, sort direction asc for decrease/drop (most negative change first) or desc for increase/growth, and the requested limit. NEVER answer these with two stacked period lists or with a single-period ranking.
10. Grid output is mandatory for successful reports. Set showChart=true only when a chart is useful for ranking, trend, KPI, or simple breakdown output. xField must be a label/display field that will exist in the backend result rows; yField must be a metricId you selected.
11. Filters must reference filterId from the catalog wherever possible. Free-text filter values are allowed only for catalog filters that expose a text column (e.g. customer_filter, product_filter).
12. Time field must be a fieldId from the catalog matching the chosen dataset. Do not invent date columns.
13. Limit must be a positive integer; default 100, max 1000.
14. Expiry and due-date questions may use future dates when the catalog exposes a matching future-valid date field. Future sales/purchase transaction queries are unsupported unless the catalog exposes forecast/projection datasets and metrics.
15. "How many" expiry questions are KPI/aggregate count reports, not detail/list reports. Product or batch expiry lists are detail reports with product, batch, expiry date, stock quantity, and stock value display columns when the catalog exposes them.
16. Between filters must keep value as {"from": "...", "to": "..."}.
17. Every assumption you make about ambiguous parts of the question MUST be listed in assumptions[] in one short sentence each.
18. Items that did NOT sell, never sold, are non-moving / dead stock / slow moving / idle / stale, or "days/time since last sold" MUST use dataset item_velocity (the per-product item master). For "not sold in/since a period" use a SINGLE days_since_last_sold_filter (operator ">=", value = the period length in days: yesterday/today=1, this week=7, this month=30, 60, 90 ...); it already includes items that never sold, so do NOT also add never_sold_filter (combining them returns nothing). Use never_sold_filter (value true) ONLY for "never sold". Use movement_status_filter (NEVER_SOLD/NON_MOVING/SLOW_MOVING/MOVING) for movement buckets. Show the count via velocity_days_since_last_sold display column. Never put a time range on item_velocity. ADD an assumptions[] line stating the interpretation.
19. Use operator not_contains to EXCLUDE rows by text ("excluding/except/without items whose name starts with or contains X"). Never express text exclusion with "=", "!=", or "in".`;
}
