# Production Task: Analyze Existing ERP Reporting System for NLQ AI Reporting

This is a production system. Do not implement demo, mock, stub, hardcoded, or temporary logic. Use the existing database, existing authentication, existing permissions, existing UI components, and existing report logic. If something is unclear, inspect the codebase and implement the safest production-grade solution.

You are a senior full-stack engineer, PostgreSQL data architect, and production AI integration specialist.

We have an existing production ERP/reporting application that syncs data from Marg ERP into PostgreSQL. The application already has around 30 production reports. We now want to implement an AI-powered Natural Language Query reporting system.

This is NOT an MVP, demo, prototype, stub, or static implementation. This must be implemented properly in the existing production system.

## Goal

Analyze the current application and prepare the foundation for production-level NLQ reporting.

The final system should allow users to ask natural language questions like:

- "Show top selling products this month"
- "Give salesman-wise sales for last 7 days"
- "Show customer-wise sales"
- "Show invoice-wise sales for Ram Traders"
- "What are the most purchasing items?"
- "Show supplier-wise purchase report"
- "Show stock below minimum"
- "Generate sales dashboard for this month"

The system must use the existing Marg-synced PostgreSQL data and existing report logic wherever possible.

## Important Rules

1. Do not remove or break any existing report.
2. Do not change existing report results.
3. Do not invent tables, columns, or business logic.
4. Do not create fake data, demo data, mock reports, or placeholder logic.
5. Do not hardcode report output.
6. Do not expose raw database access to AI.
7. Do not allow AI to directly execute unsafe SQL.
8. Respect company, branch, financial year, and user permission logic.
9. All changes must be production-safe.
10. Existing authentication and authorization must continue to work.

## Tasks

### 1. Analyze Existing Report Modules

Find all current report modules in the frontend and backend.

For each report, document:

- report name
- frontend route/component
- backend API endpoint
- service/controller used
- database tables used
- SQL/query builder logic
- filters available in UI
- output columns
- grouping logic
- aggregation logic
- sorting logic
- export logic if any
- permission logic
- company/branch/financial year handling
- performance concerns

### 2. Identify Report Families

Group existing reports into families such as:

- sales reports
- purchase reports
- inventory reports
- stock reports
- customer reports
- supplier reports
- salesman reports
- tax/VAT/GST reports
- ledger/accounting reports
- outstanding reports
- dashboard reports

### 3. Identify Common Datasets

From the 30 production reports, identify reusable reporting datasets.

Possible examples:

- sales item-level dataset
- sales invoice-level dataset
- purchase item-level dataset
- purchase invoice-level dataset
- stock ledger dataset
- current stock summary dataset
- customer outstanding dataset
- supplier outstanding dataset
- tax register dataset
- ledger transaction dataset

Do not create final views yet. First produce a clear analysis.

### 4. Identify Required Metrics

Extract metrics already used in production reports.

Examples:

- sold quantity
- net sales
- gross sales
- discount amount
- taxable amount
- non-taxable amount
- tax amount
- purchase quantity
- purchase value
- invoice count
- customer outstanding
- supplier outstanding
- current stock
- stock value

### 5. Identify Required Dimensions

Extract dimensions already used in production reports.

Examples:

- product/item
- product code
- product name
- customer
- supplier
- salesman
- invoice
- branch
- company
- warehouse
- batch
- city
- date
- month
- category
- group
- company/manufacturer
- salt
- UOM

### 6. Identify Business Rules

Find existing business rules, including:

- cancelled invoice handling
- sales return handling
- purchase return handling
- tax/VAT/GST calculation
- net amount calculation
- gross amount calculation
- taxable and non-taxable split
- invoice date vs created date
- financial year handling
- branch restrictions
- company restrictions
- user role restrictions

### 7. Output Required

Create a new documentation file:

`docs/ai-reporting/discovery-report.md`

Include:

- current report inventory
- report families
- current backend endpoints
- current database tables involved
- recommended reusable datasets
- metrics list
- dimensions list
- filters list
- business rules list
- risks and unknowns
- next implementation steps

Also create machine-readable JSON:

`docs/ai-reporting/report-inventory.json`

Format:

```json
{
  "reports": [
    {
      "reportId": "string",
      "reportName": "string",
      "family": "sales | purchase | inventory | accounting | tax | outstanding | mixed",
      "frontendPath": "string",
      "backendEndpoint": "string",
      "sourceTables": [],
      "filters": [],
      "outputColumns": [],
      "metrics": [],
      "dimensions": [],
      "businessRules": [],
      "permissions": [],
      "notes": []
    }
  ]
}
```

## Acceptance Criteria

- All existing reports are discovered and documented.
- No production logic is changed in this step unless required for safe inspection.
- The documentation clearly identifies what datasets/views are needed for NLQ.
- The result must be useful for creating production reporting views and semantic catalog.
