# Production Task: Build Semantic Catalog for NLQ Reporting

This is a production system. Do not implement demo, mock, stub, hardcoded, or temporary logic. Use the existing database, existing authentication, existing permissions, existing UI components, and existing report logic. If something is unclear, inspect the codebase and implement the safest production-grade solution.

You are an AI semantic layer architect for a production ERP reporting system.

We now have AI-ready PostgreSQL reporting views. Build a semantic catalog that maps natural language business terms to approved datasets, metrics, dimensions, filters, and report templates.

This semantic catalog will be used by the AI NLQ layer. It must be production-safe.

## Inputs

Use:

- `docs/ai-reporting/reporting-views.schema.json`
- `docs/ai-reporting/report-inventory.json`
- `docs/ai-reporting/discovery-report.md`
- existing report logic
- existing business terminology

## Goal

Create a machine-readable semantic catalog so the AI can understand user questions without directly seeing raw database complexity.

## Required File

Create:

`api/ai-reporting/semantic-catalog.json`

Or use the equivalent backend config location based on the existing project structure.

## Catalog Requirements

The catalog must include:

1. datasets
2. metrics
3. dimensions
4. filters
5. time fields
6. synonyms
7. default assumptions
8. report templates
9. dashboard templates
10. disallowed operations
11. security requirements

## Important Natural Language Terms

Support business-user wording such as:

- most selling product
- highest selling item
- fast moving item
- top item
- purchase item
- most purchasing item
- salesman wise
- party wise
- customer wise
- supplier wise
- invoice wise
- bill wise
- item details wise
- taxable
- non taxable
- VAT
- GST
- net amount
- gross amount
- stock
- low stock
- outstanding
- ledger
- trial balance

## Ambiguity Rules

Add explicit ambiguity handling:

- "most selling product" means highest sold quantity by default.
- "highest sales product" means highest net sales value by default.
- "party wise" may mean customer or supplier depending on sales/purchase context.
- "bill wise" means invoice-wise.
- "item wise" means grouped by product/item.
- If no date range is provided, use current financial year unless existing system default is different.
- Cancelled invoices must be excluded unless user explicitly asks for cancelled data.
- Sales returns and purchase returns must follow existing production report logic.

## Catalog Structure

Use this structure:

```json
{
  "catalogVersion": "1.0",
  "datasets": [],
  "metrics": [],
  "dimensions": [],
  "filters": [],
  "timeFields": [],
  "synonyms": [],
  "defaultAssumptions": [],
  "reportTemplates": [],
  "dashboardTemplates": [],
  "securityRules": [],
  "disallowedOperations": []
}
```

## Dataset Example

```json
{
  "datasetId": "sales_items",
  "viewName": "vw_ai_sales_items",
  "domain": "sales",
  "grain": "item_level",
  "description": "Item-level sales invoice dataset",
  "allowedForNlq": true,
  "requiredSecurityFilters": ["company_id", "branch_id"],
  "defaultFilters": [
    {
      "column": "is_cancelled",
      "operator": "=",
      "value": false
    }
  ],
  "dateFields": [
    {
      "fieldId": "invoice_date",
      "column": "invoice_date",
      "default": true
    }
  ]
}
```

## Metric Example

```json
{
  "metricId": "sold_quantity",
  "displayName": "Sold Quantity",
  "datasetId": "sales_items",
  "expression": "SUM(quantity)",
  "aggregation": "sum",
  "dataType": "number",
  "synonyms": ["sold qty", "sales quantity", "most selling", "fast moving"],
  "defaultSortDirection": "desc",
  "businessRules": ["Uses non-cancelled sales invoice item quantity"]
}
```

## Dimension Example

```json
{
  "dimensionId": "product",
  "displayName": "Product",
  "datasetId": "sales_items",
  "columns": ["product_id", "product_code", "product_name"],
  "labelColumn": "product_name",
  "synonyms": ["item", "product", "sku", "medicine", "goods"]
}
```

## Report Template Example

```json
{
  "templateId": "top_selling_products",
  "displayName": "Top Selling Products",
  "datasetId": "sales_items",
  "analysisType": "ranking",
  "defaultMetrics": ["sold_quantity", "net_sales"],
  "defaultDimensions": ["product"],
  "defaultFilters": [],
  "defaultSort": [
    {
      "metricId": "sold_quantity",
      "direction": "desc"
    }
  ],
  "defaultLimit": 10,
  "visualization": "bar",
  "synonyms": ["most selling product", "top selling item", "fast moving product"]
}
```

## Security Rules

Add semantic security rules:

- AI can only use approved datasets.
- AI can only use approved metrics/dimensions/filters.
- company_id filter is mandatory when applicable.
- branch filtering must respect user allowed branches.
- user permissions must be checked before executing reports.
- raw SQL must not be exposed to normal users.
- sensitive customer/supplier data must be masked or excluded unless report requires it.
- PAN/VAT/GST fields should only be included in tax reports or authorized detailed reports.

## Acceptance Criteria

- Semantic catalog is complete for all approved reporting views.
- Existing 30 reports are mapped to report templates where possible.
- Synonyms cover common user wording.
- Catalog does not include raw tables.
- Catalog does not include unsafe operations.
- Catalog is versioned.
- Catalog can be loaded by backend service.
