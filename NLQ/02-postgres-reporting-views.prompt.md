# Production Task: Create AI-Ready PostgreSQL Reporting Views

This is a production system. Do not implement demo, mock, stub, hardcoded, or temporary logic. Use the existing database, existing authentication, existing permissions, existing UI components, and existing report logic. If something is unclear, inspect the codebase and implement the safest production-grade solution.

You are a senior PostgreSQL engineer and ERP reporting architect.

We already analyzed the existing production reports. Now implement clean PostgreSQL reporting views for AI-powered NLQ reporting.

This is NOT an MVP, demo, or stub. These views must be production-grade and must preserve existing report logic.

## Inputs

Use:

- `docs/ai-reporting/discovery-report.md`
- `docs/ai-reporting/report-inventory.json`
- existing database schema
- existing report SQL/query logic
- existing backend services

## Goal

Create reusable reporting views that support existing reports and future natural-language reporting.

The AI layer should not query raw transactional tables directly. It should only use approved reporting views.

## Required Views

Analyze the report inventory and create only the views that are actually required.

Likely views may include:

- `vw_ai_sales_items`
- `vw_ai_sales_invoices`
- `vw_ai_purchase_items`
- `vw_ai_purchase_invoices`
- `vw_ai_stock_summary`
- `vw_ai_stock_ledger`
- `vw_ai_customer_outstanding`
- `vw_ai_supplier_outstanding`
- `vw_ai_tax_register`
- `vw_ai_ledger_entries`

Do not create unnecessary views. Do not create one view per report unless absolutely necessary.

## View Design Rules

1. Use existing Marg-synced tables as source.
2. Preserve existing production report logic.
3. Include both code and name columns where required.
4. Include IDs where required for joins and filters.
5. Include company_id, branch_id, financial_year, and tenant filters where available.
6. Include date fields clearly.
7. Include cancellation/status fields.
8. Include tax/VAT/GST fields where available.
9. Include taxable and non-taxable fields where available.
10. Include customer/supplier legal fields if needed for VAT/tax reports, such as PAN/VAT/GST number.
11. Keep item-level views item-level.
12. Keep invoice-level views invoice-level.
13. Do not pre-aggregate base views unless creating a materialized summary view.
14. Use clear and stable column aliases.
15. Do not break existing migrations.
16. Follow the existing migration structure of the project.
17. Add indexes only where useful and safe.
18. If materialized views are needed, include refresh strategy.

## Required Column Categories

For sales item view, include where available:

- company_id
- branch_id
- financial_year
- invoice_id
- invoice_no
- invoice_date
- customer_id
- customer_code
- customer_name
- customer_pan_no / vat_no / gst_no if available
- salesman_id
- salesman_code
- salesman_name
- product_id
- product_code
- product_name
- product_group
- product_category
- company/manufacturer
- salt
- batch_no
- warehouse
- uom_code
- uom_name
- quantity
- rate
- gross_amount
- discount_amount
- taxable_amount
- non_taxable_amount
- tax_rate
- tax_amount
- net_amount
- is_cancelled/status
- source/marg reference fields

For purchase item view, include similar supplier and purchase fields.

For stock views, include:

- company_id
- branch_id
- warehouse_id
- product_id
- product_code
- product_name
- batch_no
- expiry_date if available
- current_stock
- stock_value
- minimum_stock
- maximum_stock
- reorder_level if available
- uom

## Materialized Views

Only create materialized views for heavy summary data such as:

- daily sales summary
- monthly sales summary
- product monthly sales
- salesman monthly sales
- stock ageing summary

Do not create materialized views blindly.

If creating materialized views:

- add refresh function
- add indexes
- document refresh strategy
- ensure refresh does not block production unnecessarily

## Documentation

Create or update:

`docs/ai-reporting/reporting-views.md`

Include:

- each view name
- purpose
- source tables
- columns
- business meaning
- supported reports
- indexes
- refresh strategy if materialized

Create:

`docs/ai-reporting/reporting-views.schema.json`

Format:

```json
{
  "views": [
    {
      "viewName": "vw_ai_sales_items",
      "type": "view",
      "domain": "sales",
      "grain": "item_level",
      "description": "Item-level sales invoice reporting dataset",
      "columns": [
        {
          "name": "invoice_date",
          "type": "date",
          "description": "Sales invoice date",
          "isMetricBase": false,
          "isDimension": false,
          "isFilter": true,
          "isSecurityFilter": false
        }
      ],
      "defaultFilters": [],
      "mandatorySecurityFilters": [],
      "supportedReports": []
    }
  ]
}
```

## Validation

For every new view:

1. Run basic select count.
2. Compare sample output with existing report data.
3. Check nulls in important columns.
4. Check performance with realistic date range.
5. Confirm company/branch filtering works.
6. Confirm cancelled/status logic is preserved.

Create validation SQL file:

`docs/ai-reporting/view-validation.sql`

## Acceptance Criteria

- Views are created through proper migrations.
- Views use only real production tables and columns.
- Existing reports still work.
- New views can reproduce existing report results.
- Documentation and JSON schema are created.
- No mock data or placeholder logic exists.
