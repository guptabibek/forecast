# Production Task: Implement Frontend UI for AI NLQ Reporting

This is a production system. Do not implement demo, mock, stub, hardcoded, or temporary logic. Use the existing database, existing authentication, existing permissions, existing UI components, and existing report logic. If something is unclear, inspect the codebase and implement the safest production-grade solution.

You are a senior frontend engineer working on an existing production ERP application.

Implement the frontend UI for AI-powered NLQ reporting.

This is NOT a demo, MVP, stub, or static page. It must integrate with the real backend APIs, authentication, permissions, themes, layout, and production UI patterns.

## Goal

Add an AI Reporting interface where users can type natural language questions and get report output as:

- table
- KPI cards
- bar chart
- line chart
- pie chart
- dashboard widgets
- AI summary
- follow-up question suggestions

## Required UI Features

### 1. AI Reporting Page

Create a route/page such as:

```txt
/reports/ai
```

or follow existing project routing convention.

Page title:

```txt
AI Reporting
```

Subtitle:

```txt
Ask questions about your sales, purchases, stock, customers, suppliers, and reports.
```

### 2. Query Input

Add a professional input area:

- large text input or textarea
- placeholder examples:
  - "Show top selling products this month"
  - "Give salesman-wise sales for last 7 days"
  - "Show supplier-wise purchase report"
  - "Generate sales dashboard for this month"
- submit button
- loading state
- enter-to-submit support
- prevent duplicate submission
- show validation if empty

### 3. Suggested Questions

Show dynamic suggested questions from backend catalog or static fallback based on available report templates.

Examples:

- Top selling products this month
- Salesman-wise sales today
- Customer-wise sales this financial year
- Top purchasing items last month
- Stock below minimum
- Supplier-wise purchase summary

Clicking a suggestion should fill and submit the query.

### 4. Result Renderer

Create reusable components:

```txt
AiReportResult
AiReportTable
AiKpiCard
AiChartRenderer
AiDashboardRenderer
AiSummaryPanel
AiAssumptionsPanel
AiFollowUpQuestions
AiErrorState
AiLoadingState
```

Use existing UI component library and styling conventions.

### 5. Table Output

Table must support:

- column labels from backend
- proper number formatting
- currency formatting
- date formatting
- pagination if rows are large
- horizontal scroll
- empty state
- export button if existing export system supports it

### 6. Chart Output

Support at least:

- bar chart
- line chart
- pie chart
- KPI card

Use existing chart library if present. If not present, add a suitable library consistent with the project.

Chart must use backend visualization config:

```json
{
  "type": "bar",
  "x": "product_name",
  "y": "total_quantity"
}
```

### 7. Dashboard Output

If backend returns dashboard widgets, render:

- responsive grid
- KPI cards
- chart widgets
- table widgets
- widget loading/error states
- summary section

### 8. AI Summary

Show AI-generated summary clearly.

Also show assumptions:

```txt
Assumptions:
- Top selling means highest sold quantity.
- Cancelled invoices were excluded.
- Date range used: current month.
```

### 9. Follow-up Questions

Show clickable follow-up suggestions.

Example:

- Compare with last month
- Show by sales value
- Show salesman-wise breakup
- Export this report

### 10. History

Add basic query history panel:

- recent questions
- timestamp
- status
- click to rerun

Use backend history endpoint if available.

### 11. Error Handling

Handle:

- unsupported question
- clarification required
- permission denied
- AI service unavailable
- database timeout
- no data found
- server error

Messages must be user-friendly.

Do not expose stack traces or SQL to normal users.

### 12. Permission Handling

Only show AI Reporting page/menu if user has permission.

Add permission key if system uses permission mapping:

```txt
reports.ai_reporting.view
reports.ai_reporting.execute
```

Do not bypass existing permission architecture.

### 13. Menu Integration

Add AI Reporting under Reports menu or appropriate existing menu.

Do not expand all menus by default. Respect existing menu UX.

### 14. Design Requirements

UI must be:

- professional
- compact
- production-ready
- responsive
- consistent with existing ERP UI
- not chatbot-looking only; it should feel like a reporting tool
- suitable for business users

### 15. API Integration

Integrate with:

```txt
POST /api/ai-reporting/query
POST /api/ai-reporting/dashboard
GET /api/ai-reporting/catalog
GET /api/ai-reporting/history
```

Use existing API client/auth token handling.

## Acceptance Criteria

- User can ask a natural language question.
- Backend real API is called.
- Real result is rendered.
- Tables and charts work.
- Dashboard widgets work.
- Loading/error/empty states work.
- Permissions are respected.
- No mock data remains.
- UI is compact and production-quality.
