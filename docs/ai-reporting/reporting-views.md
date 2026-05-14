# AI Reporting Views

Generated on 2026-05-12. These views are the approved PostgreSQL datasets for AI/NLQ reporting. They do not replace existing report services, do not change production report output, and should be queried only through the existing authenticated/authorized backend layer with tenant, company, branch/location, and date filters applied by application code.

## Migration

Migration file: `apps/api/prisma/migrations/20260512120000_add_ai_reporting_views/migration.sql`

No materialized views were created in this step. The base views are non-aggregated or invoice-grain rollups over existing indexed production tables. Refresh functions are therefore not required. If production query telemetry later shows repeated heavy aggregate workloads, add materialized summaries separately with `REFRESH MATERIALIZED VIEW CONCURRENTLY` and a unique index.

## View Inventory

| View | Domain | Grain | Purpose | Primary Source Tables | Supported Reports |
|---|---|---|---|---|---|
| `vw_ai_sales_items` | sales | item line | Item-level Marg sales and sales-return lines with party, salesman, product, tax, margin, branch, and fiscal metadata. | `marg_vouchers`, `marg_transactions`, `marg_products`, `products`, `marg_parties`, `marg_branches`, `marg_stocks` | Sales overview, sales bills drilldown, sales item drilldown, sales dimensions, growth comparison, customer 360, item 360, tax summary. |
| `vw_ai_sales_invoices` | sales | invoice | Invoice-level rollup preserving existing bill logic: header `final_amt` wins over summed line net when present. | `vw_ai_sales_items` | Sales bills, top customers, salesman-wise sales, sales dashboard, customer-wise sales. |
| `vw_ai_purchase_items` | purchase | item line | Item-level Marg purchase and purchase-return lines with supplier, product, tax, branch, and fiscal metadata. | `marg_vouchers`, `marg_transactions`, `marg_products`, `products`, `marg_parties`, `suppliers`, `marg_branches`, `marg_stocks` | Purchase overview, purchase bills drilldown, purchase item analytics, supplier 360, item 360, tax summary. |
| `vw_ai_purchase_invoices` | purchase | invoice | Invoice-level purchase rollup preserving `final_amt` behavior. | `vw_ai_purchase_items` | Purchase bills, supplier-wise purchase, most purchasing items, purchase dashboard. |
| `vw_ai_stock_summary` | inventory | product-location | Current stock and replenishment fields from the production inventory level table. | `inventory_levels`, `products`, `locations`, `inventory_policies` | Current stock, reorder/low stock, stock below minimum, inventory KPIs, dead/slow, turnover, stock-out reconciliation. |
| `vw_ai_stock_batches` | inventory/expiry | product-location-batch | Batch stock and expiry dataset. Kept separate because batch/expiry reports are not the same grain as current stock. | `batches`, `products`, `locations`, `suppliers` | Batch inventory, near expiry, expired stock, FEFO, expiry risk, stock ageing, item 360. |
| `vw_ai_stock_ledger` | inventory | ledger entry | Append-only stock movement ledger with product, location, batch, reference, cost, and running balance. | `inventory_ledger`, `products`, `locations`, `batches` | Movement ledger, stock-out, inventory value trend, item 360 movement history. |
| `vw_ai_party_outstanding` | outstanding | invoice/party balance line | Marg outstanding invoice lines with customer/supplier classification, ageing, signed balance, exposure, and credit balance. | `marg_outstandings`, `marg_parties`, `marg_account_groups`, `marg_branches` | Financial outstanding, outstanding groups, outstanding detail, customer 360, supplier 360. |
| `vw_ai_tax_register` | tax | item tax line | Unified sales/purchase tax line register from approved item views. | `vw_ai_sales_items`, `vw_ai_purchase_items` | Sales/purchase tax summary, GST/VAT/PAN analysis, item tax drilldowns. |
| `vw_ai_ledger_entries` | accounting | ledger line | Unified accounting line view for core GL journal lines and Marg party ledger postings. | `journal_entries`, `journal_entry_lines`, `gl_accounts`, `marg_account_postings` | Trial balance, account ledger, party ledger, financial 360 panels. |

## Business Rules Preserved

- Tenant scope is a mandatory security filter on every view through `tenant_id`.
- Marg sales rows use voucher types `S`, `R`, and `T`.
- Marg purchase rows use voucher types `P` and `B`.
- Compatible line matching mirrors production code:
  - `S` header uses transaction types `G`, `S`, `O`.
  - `R` header uses transaction type `R`.
  - `T` header uses transaction types `X`, `T`.
  - `P` header uses transaction type `P`.
  - `B` header uses transaction type `B`.
- Sales returns are exposed as `status = 'RETURN'` for voucher types `R` and `T`.
- Purchase returns are exposed as `status = 'RETURN'` for voucher type `B`.
- Quantities and Marg line amounts use `ABS()` as existing sales/purchase reports do.
- Gross amount is `ABS(qty) * rate`.
- Discount amount is `GREATEST(gross_amount - ABS(amount), 0)`.
- Tax amount is `ABS(gst_amount)`.
- Line net amount is `ABS(amount) + ABS(gst_amount)`.
- Invoice net amount uses `marg_vouchers.final_amt` when available; otherwise it falls back to summed line net amount.
- Sales cost and profit use `marg_stocks.p_rate`, then `marg_stocks.lp_rate`, then `products.standard_cost`, matching production report fallback.
- Payment mode uses existing bill logic: `MIXED` when both cash and others are positive, `CASH` when only cash is positive, otherwise `CREDIT`.
- Current stock is sourced from `inventory_levels`; batch/expiry reports are sourced from `batches`.
- Reportable batch stock is flagged with `status NOT IN ('CONSUMED', 'RECALLED')` and non-zero quantity. The view keeps all batch rows and exposes `is_reportable_stock` so consumers can choose the existing report behavior explicitly.
- Outstanding party type follows existing Marg group-prefix logic: `C%` is customer, `D%` is supplier, otherwise other.
- Marg party ledger postings preserve Marg signed amount convention: positive is debit, negative is credit.
- Core GL entries include all statuses; production trial balance/account ledger should filter `status = 'POSTED'`.

## Security Filters

Application code must apply these filters before AI responses are generated:

- `tenant_id` is mandatory for every query.
- `company_id` is mandatory where the user/session is company-scoped and the view exposes it.
- `branch_id` or `warehouse_id` is mandatory where the user/session is branch/location-scoped and the view exposes it.
- Existing role/module permissions remain outside the views and must be enforced by the current controllers/guards.
- The AI layer must not query base tables directly and must not execute arbitrary SQL generated by a model.

## Indexes

No new indexes were added in this migration. Existing reporting indexes already cover the main access paths:

- `marg_vouchers(tenant_id, date)`
- `marg_transactions(tenant_id, date)`
- `inventory_levels(tenant_id, location_id)` and unique product-location key
- batch reporting indexes from `20260418000000_pharma_reporting_indexes`
- `inventory_ledger(tenant_id, product_id, location_id)` and `inventory_ledger(tenant_id, transaction_date)`
- `marg_outstandings(tenant_id, date)` and `marg_outstandings(tenant_id, company_id, ord)`
- `marg_account_postings(tenant_id, date)` and `marg_account_postings(tenant_id, company_id, voucher)`
- `journal_entries(tenant_id, entry_date)` and `journal_entry_lines(gl_account_id)`

If production plans show slow Marg item queries by `(tenant_id, company_id, voucher, type)`, add indexes in a separate operational migration or maintenance window after measuring table size and lock impact.

## NLQ Dataset Guidance

- Use `vw_ai_sales_items` for product, batch, tax, HSN, company/manufacturer, salt, and item-margin questions.
- Use `vw_ai_sales_invoices` for customer-wise, salesman-wise, invoice-wise, payment-mode, and dashboard questions.
- Use `vw_ai_purchase_items` for purchasing-item, supplier-item, batch, and purchase-tax questions.
- Use `vw_ai_purchase_invoices` for supplier-wise purchase and purchase dashboard questions.
- Use `vw_ai_stock_summary` for "current stock", "stock below minimum", "reorder", and inventory valuation.
- Use `vw_ai_stock_batches` for expiry, FEFO, stock ageing, and batch inspection questions.
- Use `vw_ai_stock_ledger` for movement, stock-out, and running-balance questions.
- Use `vw_ai_party_outstanding` for receivables/payables and ageing questions.
- Use `vw_ai_tax_register` for GST/VAT/PAN tax questions.
- Use `vw_ai_ledger_entries` for GL, trial balance, account ledger, and Marg party ledger questions.

## Risks And Unknowns

- `is_cancelled` is exposed as `NULL` for Marg sales/purchase views because the inspected Marg source tables do not expose a cancellation flag. Consumers should rely on `status` until a real source cancellation field exists.
- `financial_year` is populated only when a tenant default fiscal calendar and matching fiscal period exist.
- Core inventory tables do not expose `company_id`; inventory views expose `branch_id`/`warehouse_id` through `locations`.
- Supplier ID mapping for Marg purchase parties is best-effort through local supplier `code` or known external id pattern; report totals continue to use Marg party code/name as the source of truth.
- `vw_ai_ledger_entries` combines core GL journal lines and Marg party postings under `ledger_source`. Queries that need strict trial-balance semantics must filter `ledger_source = 'CORE_GL'` and `status = 'POSTED'`.

## Next Implementation Steps

1. Run the migration in a staging database with production-like Marg data.
2. Execute `docs/ai-reporting/view-validation.sql` for row counts, sample checks, tenant/company/branch filtering checks, and comparisons against current report logic.
3. Add an NLQ semantic catalog that maps natural-language intents to only these approved views and allowlisted columns.
4. Implement a backend AI-report endpoint that enforces existing authentication, role/module permissions, tenant scope, company scope, branch scope, SQL allowlists, query timeouts, and row limits.
5. Add regression tests comparing selected production reports to equivalent view queries for sales invoices, purchase invoices, current stock, batch inventory, outstanding, and trial balance.
