# AI NLQ Reporting Implementation README

## Purpose

This README is the single implementation guide for fixing and completing the production AI/NLQ Reporting feature in the existing ERP/reporting application.

The application syncs Marg ERP data into PostgreSQL. The current AI Reporting feature works for some fixed patterns but fails for many valid business queries. The goal is to make it a production-grade, schema-driven BI/NLQ reporting system.

This is not a demo, MVP, prototype, stub, or hardcoded feature. All implementation must use the real database schema, real reporting views, real existing report logic, real permissions, real backend APIs, and real UI components.

---

## Core Principle

The system must not behave like this:

```txt
User question
→ fixed template match
→ if matched, run fixed query
→ otherwise unsupported/error
```

It must behave like this:

```txt
User question
→ AI semantic parser
→ dynamic semantic query JSON
→ schema/catalog validation
→ entity resolution if needed
→ safe SQL compiler
→ SQL safety validation
→ PostgreSQL execution
→ grid/table by default
→ chart where useful
→ optional AI summary
→ frontend rendering
```

The LLM must not directly execute SQL.

The backend must compile safe parameterized SQL from validated semantic JSON.

OpenAI/AI provider should receive metadata/catalog/schema capability only during query planning, not actual ERP rows.

---

## High-Priority Problems to Fix

### 1. Grid/table is missing

Every successful AI report must show a grid/table by default. Charts are additional, not replacements.

### 2. Chart labels are wrong

For product-wise reports, the chart currently shows `-` instead of product names. This means the backend/frontend mapping is broken.

Example bad output:

```txt
x-axis labels: - - - - -
```

Expected:

```txt
VONOSTRUM 20 10X10 TABS
PANCREATE 25000 10*10 CAPS
LOCAL FRIGHT 18%
```

### 3. Backend response shape is inconsistent

Summary has product names, but chart does not. That means summary, grid, and chart are not using one canonical result set.

### 4. Semantic catalog is incomplete

Fields like product name, customer VAT number, supplier VAT number, invoice number, taxable amount, tax amount, and net amount must be exposed as metadata when they exist in the actual schema.

### 5. NLQ is too template-based

The system must answer any query that can be represented using approved datasets, metrics, dimensions, filters, display columns, date fields, and permissions.

---

## Implementation Rules

Do not:

- create mock data
- create stub services
- hardcode product names
- hardcode report results
- invent database columns
- invent views
- invent metrics
- bypass authentication
- bypass permissions
- expose raw SQL to normal users
- send full ERP data to AI
- break existing reports

Do:

- inspect the real schema
- use existing report logic
- use approved reporting views
- validate every semantic query
- compile SQL safely
- enforce company/tenant/branch scope
- return grid by default
- render charts only as additional visualization
- provide useful unsupported/error messages

---

## Required Backend Response Contract

Every successful response must include:

```json
{
  "requestId": "uuid",
  "status": "success",
  "title": "string",
  "queryKind": "single_report",
  "mode": "aggregate | detail | ranking | trend | comparison | kpi",
  "metadata": {
    "metricLabel": "string",
    "groupedBy": "string",
    "periodLabel": "string"
  },
  "kpis": [
    {
      "label": "Total Sales",
      "value": 123456,
      "dataType": "currency"
    }
  ],
  "grid": {
    "columns": [
      {
        "field": "product_name",
        "label": "Product",
        "dataType": "text"
      },
      {
        "field": "net_sales",
        "label": "Net Sales",
        "dataType": "currency"
      }
    ],
    "rows": [
      {
        "product_name": "Product A",
        "net_sales": 10000
      }
    ],
    "totals": {
      "net_sales": 10000
    }
  },
  "chart": {
    "enabled": true,
    "type": "bar | line | pie | kpi | none",
    "xField": "product_name",
    "yField": "net_sales",
    "data": [
      {
        "product_name": "Product A",
        "net_sales": 10000
      }
    ]
  },
  "summary": "string",
  "assumptions": [],
  "followUpQuestions": [],
  "clarification": null,
  "unsupportedReason": null,
  "availableAlternatives": [],
  "missingCapabilities": [],
  "recommendedSchemaFix": null
}
```

Important:

- `grid.columns[].field` must exist in `grid.rows[]`.
- `chart.xField` must exist in `chart.data[]`.
- `chart.yField` must exist in `chart.data[]`.
- Grid and chart must use the same canonical rows.
- Summary must be generated from the same canonical rows.

---

## Correct Product-Wise Sales Response

For the query:

```txt
top 20 items wise sales for the month of may
```

Expected response shape:

```json
{
  "title": "Top 20 Products by Sales Value - May 2026",
  "mode": "ranking",
  "metadata": {
    "metricLabel": "Net Sales, Sold Quantity",
    "groupedBy": "Product",
    "periodLabel": "May 2026"
  },
  "grid": {
    "columns": [
      {
        "field": "product_name",
        "label": "Product",
        "dataType": "text"
      },
      {
        "field": "net_sales",
        "label": "Net Sales",
        "dataType": "currency"
      },
      {
        "field": "sold_quantity",
        "label": "Sold Quantity",
        "dataType": "number"
      }
    ],
    "rows": [
      {
        "product_name": "VONOSTRUM 20 10X10 TABS",
        "net_sales": 413347.94,
        "sold_quantity": 834
      }
    ]
  },
  "chart": {
    "enabled": true,
    "type": "bar",
    "xField": "product_name",
    "yField": "net_sales",
    "data": [
      {
        "product_name": "VONOSTRUM 20 10X10 TABS",
        "net_sales": 413347.94,
        "sold_quantity": 834
      }
    ]
  }
}
```

If product code exists, return both:

```txt
Product Code
Product Name
Net Sales
Sold Quantity
```

Chart should use `product_name` as label.

Fallback rule:

```txt
product_name → product_code → Unknown Product
```

Never show `-` for all product labels.

---

## Correct Month-Wise Purchase Response

For the query:

```txt
what is the total purchase this fiscal year month wise
```

Expected output:

### Title

```txt
Monthly Purchase Summary - Current Financial Year
```

### Metadata

```txt
Metric: Net Purchase
Grouped by: Month
Period: Current Financial Year
```

### KPI Cards

- Total Purchase
- Number of Months
- Highest Purchase Month
- Lowest Purchase Month

### Grid

| Month | Net Purchase |
|---|---:|
| Apr 2026 | ₹86,874,850.88 |
| May 2026 | ₹2,361,200.16 |
| Total | ₹89,236,051.04 |

### Chart

- Type: line or bar
- X-axis: `Apr 2026`, `May 2026`
- Y-axis: formatted currency
- Tooltip: full currency value

Do not show raw ISO dates like:

```txt
2026-05-01T00:00:00.000Z
```

Use:

```txt
May 2026
```

---

## Semantic Catalog Requirements

The semantic catalog must be generated/fixed from the actual schema.

For every approved dataset/view, define:

```json
{
  "datasetId": "sales_items",
  "viewName": "vw_ai_sales_items",
  "domain": "sales",
  "grain": "item_level",
  "allowedForNlq": true,
  "defaultFilters": [],
  "requiredSecurityFilters": [],
  "dateFields": [],
  "metrics": [],
  "dimensions": [],
  "filters": [],
  "displayColumns": [],
  "defaultDetailColumns": [],
  "defaultAggregateMetrics": [],
  "synonyms": []
}
```

Only include fields that actually exist or can be correctly built from existing report logic.

---

## Product Dimension Definition

The product dimension must define a real label column:

```json
{
  "dimensionId": "product",
  "displayName": "Product",
  "datasetId": "sales_items",
  "columns": ["product_id", "product_code", "product_name"],
  "labelColumn": "product_name",
  "fallbackLabelColumn": "product_code",
  "synonyms": ["item", "product", "sku", "medicine", "goods"]
}
```

The SQL compiler and chart builder must use `labelColumn` for chart labels.

---

## Legal/Tax Fields

If these fields exist in the real schema, expose them as metadata in the catalog:

### Sales

- customer_id
- customer_code
- customer_name
- customer_pan_no
- customer_vat_no
- customer_gst_no
- invoice_no
- invoice_date
- taxable_amount
- non_taxable_amount
- tax_rate
- tax_amount
- net_amount
- gross_amount

### Purchase

- supplier_id
- supplier_code
- supplier_name
- supplier_pan_no
- supplier_vat_no
- supplier_gst_no
- purchase_invoice_no
- purchase_invoice_date
- taxable_amount
- non_taxable_amount
- tax_rate
- tax_amount
- net_amount
- gross_amount

Mark these as sensitive:

- customer_pan_no
- customer_vat_no
- customer_gst_no
- supplier_pan_no
- supplier_vat_no
- supplier_gst_no

Sensitive fields may be shown only in authorized tax/register/detail reports.

Do not send sensitive values to AI prompts, summaries, or logs by default.

---

## SQL Compiler Requirements

The SQL compiler must compile parameterized PostgreSQL SQL from validated semantic JSON only.

Do not execute raw LLM SQL.

For product-wise sales:

```sql
SELECT
  product_name AS product_name,
  SUM(net_amount) AS net_sales,
  SUM(quantity) AS sold_quantity
FROM vw_ai_sales_items
WHERE company_id = $1
  AND branch_id = ANY($2)
  AND invoice_date BETWEEN $3 AND $4
GROUP BY product_name
ORDER BY net_sales DESC
LIMIT $5
```

If product code exists:

```sql
SELECT
  product_code,
  product_name,
  SUM(net_amount) AS net_sales,
  SUM(quantity) AS sold_quantity
FROM vw_ai_sales_items
WHERE company_id = $1
  AND branch_id = ANY($2)
  AND invoice_date BETWEEN $3 AND $4
GROUP BY product_code, product_name
ORDER BY net_sales DESC
LIMIT $5
```

Rules:

- use approved views only
- use approved metric expressions only
- use approved dimension columns only
- use approved display columns only
- apply company/tenant filter
- apply branch filter
- apply date filter where applicable
- apply default filters
- use parameterized SQL
- enforce row limits
- reject unknown IDs
- reject unsafe operators
- reject non-catalog columns

---

## Chart Builder Requirements

For grouped/ranking queries, chart xField must be the actual label field present in rows.

Mapping examples:

| Dimension | Chart Label Field |
|---|---|
| product | product_name |
| customer | customer_name |
| supplier | supplier_name |
| salesman | salesman_name |
| branch | branch_name |
| month | month_label |
| invoice | invoice_no |
| warehouse | warehouse_name |
| batch | batch_no |

Add a helper:

```ts
resolveDimensionLabelField(dimension, dataset): string
```

This must return a row field that actually exists in the canonical rows.

Do not use internal dimension ID as chart xField unless that exact field exists in the row.

Bad:

```json
{
  "xField": "product"
}
```

Good:

```json
{
  "xField": "product_name"
}
```

---

## Frontend Rendering Requirements

The frontend result layout must be:

1. Report header
2. KPI cards if applicable
3. Chart if applicable
4. Grid/table always
5. Summary
6. Assumptions
7. Follow-up questions
8. Export/actions

Do not put the AI summary above the actual data as the main content.

Do not show chart-only output.

---

## Grid Requirements

Grid must support:

- dynamic columns
- text
- number
- currency
- percentage
- date
- totals row
- horizontal scroll
- pagination
- empty state
- export if existing export system exists

For product-wise sales grid, show:

- Product Name
- Net Sales
- Sold Quantity

If available:

- Product Code
- Product Name
- Net Sales
- Sold Quantity

---

## Chart Requirements

Charts must:

- never replace grid
- use backend `chart.xField` and `chart.yField`
- show human-readable labels
- format currency values correctly
- not clip y-axis labels
- show full values in tooltip
- handle long product names

For top 20 products:

- prefer horizontal bar chart if supported
- otherwise truncate x-axis labels but show full tooltip
- rotate labels or increase margins if needed
- never show all labels as `-`

If chart label field is missing for most rows, do not silently show `-`. Log a developer warning and still render the grid.

---

## Date Formatting

Do not display raw ISO values.

Use:

| Type | Format |
|---|---|
| month | Apr 2026 |
| day | 13 May 2026 |
| financial year | FY 2025-26 |
| quarter | Q1 FY 2025-26 |

Prefer backend-provided display fields:

- month_label
- date_label
- period_label

---

## Available Report Areas

Remove duplicates.

Bad:

```txt
sales sales purchase purchase inventory inventory inventory
```

Good:

```txt
Sales Purchase Inventory Outstanding Tax Accounting
```

Deduplicate in backend catalog endpoint or frontend.

---

## Suggested Questions

Suggestions must be catalog-driven and unique.

Examples:

- Total purchase this fiscal year month-wise
- Supplier-wise purchase this month
- Item-wise purchase last month
- Top selling products this month
- Customer-wise sales this fiscal year
- Stock below minimum
- Expiring stock in next 90 days
- Customer outstanding summary
- Sales register with VAT details
- Purchase register with VAT details

---

## Recent AI Reports

Improve history panel.

Each item should show:

- question
- status
- timestamp
- retry action
- error reason if failed

For failed queries, show:

- unsupported reason
- missing field/metric
- available alternatives
- whether schema/catalog fix is required

---

## Error Handling

Use useful BI-style errors.

Bad:

```txt
Unable to process query
```

Good:

```txt
Customer VAT number is not available in the sales dataset. Available customer fields are customer_name and customer_code. To support this, expose customer_vat_no in the sales reporting view.
```

Error taxonomy:

- MISSING_DATASET
- MISSING_FIELD
- MISSING_METRIC
- MISSING_DIMENSION
- MISSING_FILTER
- MISSING_DATE_FIELD
- AMBIGUOUS_ENTITY
- AMBIGUOUS_DOMAIN
- PERMISSION_DENIED
- UNSUPPORTED_OPERATION
- QUERY_TOO_BROAD
- SQL_VALIDATION_FAILED
- AI_PROVIDER_ERROR
- DB_TIMEOUT
- NO_DATA_FOUND

---

## Testing Requirements

Add or update tests for:

### Product-wise sales

Query:

```txt
top 20 items wise sales for the month of may
```

Verify:

- status success
- grid exists
- grid rows contain product_name or valid product label field
- chart exists
- chart.xField exists in every chart.data row
- chart labels are not all `-`
- chart xField is product_name or valid product label field
- grid columns include Product/Product Name
- summary, grid, and chart use consistent row fields
- no raw ISO date labels
- no mock data

### Month-wise purchase

Query:

```txt
what is the total purchase this fiscal year month wise
```

Verify:

- status success
- grid exists
- grid has Month and Net Purchase columns
- chart exists
- chart labels are human-readable
- KPI total exists
- summary exists below data
- assumptions exist
- no raw ISO dates

### Other tests

- top selling products this month
- supplier-wise purchase this month
- item-wise purchase last month
- stock below minimum
- sales register with VAT details
- unsupported field query
- no data query
- chart rendering fallback
- prompt injection attempts

---

## Acceptance Criteria

Implementation is complete only when:

1. Every successful AI report displays grid/table by default.
2. Product-wise chart shows product names, not `-`.
3. Grid product names match summary product names.
4. Chart xField matches an actual row field.
5. SQL selects product display columns.
6. Product dimension uses labelColumn from catalog.
7. Chart tooltip shows full product name.
8. Long product names are handled professionally.
9. Month/date labels are human-readable.
10. Currency/number formatting is correct and not clipped.
11. KPI cards appear where useful.
12. AI summary is below the actual data.
13. Available report areas are unique.
14. Suggested questions are diverse and catalog-driven.
15. Recent report errors are useful and actionable.
16. Backend response contract supports grid, chart, KPI, summary, assumptions.
17. Frontend handles success, no-data, unsupported, clarification, and error states.
18. Existing reports are not broken.
19. No mock/demo/stub/hardcoded logic is added.
20. Tests are added or updated.
21. Build/typecheck/lint/tests pass if available.

---

## Final Instruction

Do not only write documentation.

Inspect the real implementation and fix the actual code across:

- backend response generation
- semantic catalog
- SQL compiler
- chart builder
- grid builder
- frontend result renderer
- chart renderer
- formatting utilities
- recent history
- error handling
- tests

The summary already knows product names, so do not say the data is unavailable. The bug is in canonical rows → grid → chart mapping. Fix the mapping at the root.
