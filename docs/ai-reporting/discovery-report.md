# AI Reporting Discovery Report

Generated from source inspection on 2026-05-12. This is an analysis artifact only. No production report logic was changed.

## Scope

The current report surface is split across:

- Frontend routes under `apps/web/src/pages/pharma-reports/*` and the generic `/reports` dashboard/saved-report page.
- Backend controllers `apps/api/src/modules/pharma-reports/pharma-reports.controller.ts` and `apps/api/src/modules/reports/reports.controller.ts`.
- Core report services in `apps/api/src/modules/pharma-reports/services/*`, `apps/api/src/modules/reports/*`, and financial Marg methods in `apps/api/src/modules/marg-ede/marg-ede.service.ts`.
- Operational report/list pages that are mounted under the Reports menu but served by manufacturing APIs: purchase orders, purchase invoices, suppliers, batches, GL accounts, and journal entries.

The production NLQ system should treat these services and their query allowlists as the source of truth. It should not let AI execute arbitrary SQL.

## Current Report Inventory

| Report | Family | Frontend | Backend | Service | Main tables | Notes |
|---|---|---|---|---|---|---|
| Executive inventory KPIs | dashboard/inventory | `/dashboard`, pharma service | `GET /pharma-reports/dashboard/kpis` | `DashboardKpiService.getDashboardKPIs` | `inventory_levels`, `batches`, `inventory_transactions` | Inventory value, SKU/location/batch counts, turnover, near-expiry %, dead stock %, negative stock. |
| Expiry loss trend | dashboard/expiry | `/dashboard`, pharma service | `GET /pharma-reports/dashboard/expiry-loss-trend` | `DashboardKpiService.getExpiryLossTrend` | `batches` | 12-month expired value/qty/count trend. |
| Inventory value trend | dashboard/inventory | `/dashboard`, pharma service | `GET /pharma-reports/dashboard/inventory-value-trend` | `DashboardKpiService.getInventoryValueTrend` | `inventory_transactions` | Monthly receipt/issue value trend. |
| Current stock | inventory | `/pharma-reports/inventory` | `GET /pharma-reports/inventory/current-stock` | `InventoryReportsService.getCurrentStock` | `inventory_levels`, `products`, `locations`, `product_companies`, `product_salts`, `product_categories`, `unit_of_measures` | Current product-location balances. Exports as `current-stock`. |
| Batch-wise inventory | inventory | `/pharma-reports/inventory` | `GET /pharma-reports/inventory/batch-wise` | `InventoryReportsService.getBatchInventory` | `batches`, `products`, `locations` | Positive non-consumed/non-recalled batch stock sorted by expiry. Exports as `batch-inventory`. |
| Stock movement ledger | inventory | `/pharma-reports/inventory` | `GET /pharma-reports/inventory/movement-ledger` | `InventoryReportsService.getMovementLedger` | `inventory_ledger`, `products`, `locations`, `batches` | Full stock ledger with running balance and reference. Exports as `movement-ledger`. |
| Reorder / low stock | stock/procurement | `/pharma-reports/inventory` | `GET /pharma-reports/inventory/reorder` | `InventoryReportsService.getReorderReport` | `inventory_levels`, `inventory_policies`, `inventory_transactions`, `products`, `locations` | Suggested reorder based on average issue demand and policy. Exports as `reorder`. |
| Stock ageing | inventory | `/pharma-reports/inventory` | `GET /pharma-reports/inventory/ageing` | `InventoryReportsService.getStockAgeing` | `batches`, `products`, `locations` | Age buckets from manufacturing/inward date; summary by bucket. Exports as `stock-ageing`. |
| Near expiry | expiry | `/pharma-reports/expiry` | `GET /pharma-reports/expiry/near` | `ExpiryReportsService.getNearExpiry` | `batches`, `products`, `locations` | Positive active batches expiring within threshold. Exports as `near-expiry`. |
| Expired stock | expiry | `/pharma-reports/expiry` | `GET /pharma-reports/expiry/expired` | `ExpiryReportsService.getExpiredStock` | `batches`, `products`, `locations` | Positive active batches already expired. Exports as `expired-stock`. |
| FEFO picking | expiry | `/pharma-reports/expiry` | `GET /pharma-reports/expiry/fefo` | `ExpiryReportsService.getFEFOPickingSequence` | `batches`, `products`, `locations` | Earliest expiry sequence by product/location. Exports as `fefo-picking`. |
| Expiry risk | expiry/dashboard | `/pharma-reports/expiry` | `GET /pharma-reports/expiry/risk` | `ExpiryReportsService.getExpiryRiskAnalysis` | `batches`, `products`, `locations` | Expired and near-expiry value at 30/90/180/270 days plus monthly trend. Exports as `expiry-risk`. |
| Dead / slow stock | stock | `/pharma-reports/analysis` | `GET /pharma-reports/analysis/dead-slow` | `StockAnalysisService.getDeadSlowStock` | `inventory_levels`, `inventory_transactions`, `products`, `locations` | Classifies dead/slow by last issue date. Exports as `dead-slow`. |
| ABC analysis | stock | `/pharma-reports/analysis` | `GET /pharma-reports/analysis/abc` | `StockAnalysisService.getABCAnalysis` | `inventory_transactions`, `inventory_levels`, `products` | Consumption-value classification. Exports as `abc-analysis`. |
| XYZ analysis | stock | `/pharma-reports/analysis` | `GET /pharma-reports/analysis/xyz` | `StockAnalysisService.getXYZAnalysis` | `inventory_transactions`, `products` | Demand variability classification. Exports as `xyz-analysis`. |
| Inventory turnover | stock | `/pharma-reports/analysis` | `GET /pharma-reports/analysis/turnover` | `StockAnalysisService.getInventoryTurnover` | `inventory_transactions`, `inventory_levels`, `products`, `locations` | COGS over inventory value; days of inventory. Exports as `inventory-turnover`. |
| Sales overview | sales | `/pharma-reports/sales-purchase` | `GET /pharma-reports/analysis/sales/overview` | `SalesPurchaseAnalysisService.getOverview` | `marg_vouchers`, `marg_transactions`, `marg_products`, `marg_parties`, `marg_stocks` | Summary, trend, top parties/items, tax, payment mode. |
| Sales bills | sales | `/pharma-reports/sales-purchase` | `GET /pharma-reports/analysis/sales/bills` | `SalesPurchaseAnalysisService.getBills` | `marg_vouchers`, `marg_transactions`, `marg_products`, `products`, `marg_parties`, `marg_branches`, `salesmen`, `marg_stocks` | Invoice-level report. Exports as `sales-analysis-bills`. |
| Sales bill drilldown | sales | `/pharma-reports/sales-purchase` | `GET /pharma-reports/analysis/sales/bills/:billKey` | `SalesPurchaseAnalysisService.getBillDrilldown` | same sales bill tables | Header plus item lines. |
| Sales item drilldown | sales/inventory | `/pharma-reports/sales-purchase` | `GET /pharma-reports/analysis/sales/items/:itemKey` | `SalesPurchaseAnalysisService.getItemDrilldown` | `marg_vouchers`, `marg_transactions`, `marg_products`, `products`, `marg_stocks`, `marg_branches`, `marg_parties` | Item metrics, stock, batch stock, movement/bill history. |
| Sales party drilldown | sales/customer | `/pharma-reports/sales-purchase` | `GET /pharma-reports/analysis/sales/parties/:partyCode` | `SalesPurchaseAnalysisService.getPartyDrilldown` | same sales bill tables plus financial outstanding through Marg service | Party metrics, top items, bill history, outstanding snapshot. |
| Purchase overview | purchase | `/pharma-reports/sales-purchase` | `GET /pharma-reports/analysis/purchase/overview` | `SalesPurchaseAnalysisService.getOverview` | `marg_vouchers`, `marg_transactions`, `marg_products`, `marg_parties`, `marg_stocks` | Same shape as sales overview for purchase vouchers. |
| Purchase bills | purchase | `/pharma-reports/sales-purchase` | `GET /pharma-reports/analysis/purchase/bills` | `SalesPurchaseAnalysisService.getBills` | `marg_vouchers`, `marg_transactions`, `marg_products`, `products`, `marg_parties`, `marg_branches`, `salesmen`, `marg_stocks` | Purchase bill-level report. Exports as `purchase-analysis-bills`. |
| Purchase bill drilldown | purchase | `/pharma-reports/sales-purchase` | `GET /pharma-reports/analysis/purchase/bills/:billKey` | `SalesPurchaseAnalysisService.getBillDrilldown` | same purchase bill tables | Header plus item lines. |
| Sales/purchase dimension analysis | sales/purchase | `/pharma-reports/sales-purchase` | `GET /pharma-reports/analysis/:kind/dimension/:dimension` | `SalesPurchaseAnalysisService.getDimensionAnalysis` | same bill tables plus `product_companies`, `product_salts`, `product_categories`, `salesmen` by subquery | Group by salesman, salt, product company, product group, product, or HSN. |
| Growth / degrowth comparison | sales/purchase | `/pharma-reports/growth` | `GET /pharma-reports/analysis/:kind/comparison` | `SalesPurchaseAnalysisService.getComparison` | same bill tables | Current vs comparison period, optional dimension breakdown. |
| Suggested purchase | procurement | `/pharma-reports/procurement` | `GET /pharma-reports/procurement/suggested-purchase` | `ProcurementReportsService.getSuggestedPurchase` | `inventory_levels`, `inventory_policies`, `inventory_transactions`, `purchase_orders`, `purchase_order_lines`, `suppliers`, `products`, `locations` | Demand-driven purchase suggestion. Exports as `suggested-purchase`. |
| Supplier performance | supplier/procurement | `/pharma-reports/procurement` | `GET /reports/supplier-performance` and legacy `GET /pharma-reports/procurement/supplier-performance` | `ProcurementReportsService.getSupplierPerformanceReport` / older `getSupplierPerformance` | `purchase_orders`, `purchase_order_lines`, `goods_receipts`, `goods_receipt_lines`, `quality_inspections`, `suppliers` | Current scorecard is core PO/GRN/QC driven. Exports as `supplier-performance`. |
| Supplier performance PO drilldown | supplier/procurement | `/pharma-reports/procurement` | `GET /reports/supplier-performance/:supplierKey/purchase-orders` | `ProcurementReportsService.getSupplierPerformancePurchaseOrders` | `purchase_orders`, `purchase_order_lines`, `suppliers` | Detail for local supplier keys only. |
| Supplier performance PI drilldown | supplier/procurement | `/pharma-reports/procurement` | `GET /reports/supplier-performance/:supplierKey/purchase-invoices` | `ProcurementReportsService.getSupplierPerformancePurchaseInvoices` | `goods_receipts`, `goods_receipt_lines`, `purchase_orders`, `purchase_order_lines`, `suppliers` | Core purchase invoice/GRN detail. |
| Stock-out | stock/procurement | `/pharma-reports/procurement` | `GET /reports/stock-out` and legacy `GET /pharma-reports/procurement/stockouts` | `ProcurementReportsService.getStockOutReport` / older `getStockOuts` | `inventory_ledger`, `inventory_levels`, `products`, `locations` | Stock-out periods and current-stock reconciliation. Exports as `stock-out`. |
| Party outstanding | outstanding/accounting | `/pharma-reports/financial` | `GET /pharma-reports/financial/outstanding` | `MargEdeService.getMargOutstandingSummary` | `marg_outstandings`, `marg_parties`, `marg_account_groups`, `marg_party_balances` for DSO | Open AR/AP grouped by party with dynamic ageing buckets. Exports as `financial-outstanding`. |
| Outstanding by group | outstanding/accounting | `/pharma-reports/financial` | `GET /pharma-reports/financial/outstanding-groups` | `MargEdeService.getMargOutstandingByGroup` | `marg_outstandings`, `marg_account_groups` | Ageing rollup by Marg group. Exports as `financial-outstanding-groups`. |
| Outstanding invoice detail | outstanding/accounting | `/pharma-reports/financial` | `GET /pharma-reports/financial/outstanding/:partyCode` | `MargEdeService.getMargOutstandingDetail` | `marg_outstandings`, `marg_parties` | Invoice-level open/settled detail. Exports as `financial-outstanding-detail`. |
| Party ledger | accounting | `/pharma-reports/financial` | `GET /pharma-reports/financial/ledger/:partyCode` | `MargEdeService.getMargPartyLedger` | `marg_account_postings`, `marg_party_balances`, `marg_vouchers`, `marg_parties` | Tally-style party ledger with opening/running/closing. Exports as `financial-party-ledger`. |
| Item 360 | mixed | `/pharma-reports/360` | `GET /pharma-reports/360/item` | `ThreeSixtyReportsService.getItem360` | `products`, `marg_products`, `marg_vouchers`, `marg_transactions`, `marg_stocks`, `batches`, `inventory_ledger`, `purchase_orders`, `purchase_order_lines`, lookup masters | Product profile, stock, sales, purchases, expiry, buyers. |
| Customer 360 | mixed/customer | `/pharma-reports/360` | `GET /pharma-reports/360/customer` | `ThreeSixtyReportsService.getCustomer360` | `customers`, `marg_parties`, `marg_vouchers`, `marg_transactions`, `marg_outstandings`, `marg_account_postings`, `marg_stocks` | Sales, outstanding, ageing, buying pattern, risk. |
| Supplier 360 | mixed/supplier | `/pharma-reports/360` | `GET /pharma-reports/360/supplier` | `ThreeSixtyReportsService.getSupplier360` | `suppliers`, `marg_parties`, `marg_vouchers`, `marg_transactions`, `marg_outstandings`, `purchase_orders`, `purchase_order_lines`, `goods_receipts`, `goods_receipt_lines`, `quality_inspections` | Purchase, payable, PO, delivery, quality, item contribution. |
| 360 search | mixed | `/pharma-reports/360` | `GET /pharma-reports/360/search` | `ThreeSixtyReportsService.searchOptions` | `products`, `marg_products`, `customers`, `suppliers`, `marg_parties` | Entity picker for item/customer/supplier 360. |
| Alerts | inventory/expiry | `/pharma-reports/alerts` | `GET /pharma-reports/alerts` | `InventoryAlertsService.getActiveAlerts` | `batches`, `inventory_levels`, `inventory_policies`, `products`, `locations` | Near expiry, low stock, newly expired alerts. Exports as `alerts`. |
| Trial balance | accounting | `/pharma-reports/trial-balance` | `GET /pharma-reports/accounting/trial-balance` | `AccountingReportsService.getTrialBalance` | `gl_accounts`, `journal_entries`, `journal_entry_lines` | Opening, period debit/credit, closing. Exports as `trial-balance`. |
| Account ledger | accounting | `/pharma-reports/trial-balance` | `GET /pharma-reports/accounting/trial-balance/:accountId/ledger` | `AccountingReportsService.getAccountLedger` | `gl_accounts`, `journal_entries`, `journal_entry_lines` | GL account drill-through with running balance. Exports as `account-ledger`. |
| GL accounts list | accounting | `/pharma-reports/gl-accounts` | `GET /manufacturing/gl-accounts` | `ManufacturingService` accounting methods | `gl_accounts` | Mounted under Reports menu, operational list. |
| Journal entries list | accounting | `/pharma-reports/journal-entries` | `GET /manufacturing/journal-entries` | `ManufacturingService` accounting methods | `journal_entries`, `journal_entry_lines`, `gl_accounts` | Mounted under Reports menu, operational list. |
| Purchase orders list | purchase/procurement | `/pharma-reports/purchase-orders` | `GET /manufacturing/purchase-orders` | `ManufacturingService` purchase order methods | `purchase_orders`, `purchase_order_lines`, `suppliers`, `products` | Operational procurement list and detail. |
| Purchase invoices list | purchase/procurement | `/pharma-reports/purchase-invoices` | `GET /manufacturing/purchase-invoices` | `PurchaseInvoicesService.list/getById` | `goods_receipts`, `goods_receipt_lines`, `purchase_orders`, `purchase_order_lines`, `suppliers`, `products` | Core GRN-backed invoice report/list; Marg sync identified by markers/notes. |
| Suppliers list | supplier/procurement | `/pharma-reports/suppliers` | `GET /manufacturing/suppliers` | supplier/manufacturing APIs | `suppliers`, `supplier_products`, `products`, procurement tables for performance | Operational supplier list and detail. |
| Batches list | inventory | `/pharma-reports/batches` | `GET /manufacturing/batches` | batch/manufacturing APIs | `batches`, `products`, `locations` | Operational batch list and detail. |
| Generic executive dashboard | dashboard/forecasting | `/dashboard` | `GET /reports/dashboard/*` | `ReportsService` | `marg_vouchers`, `marg_transactions`, `marg_products`, `marg_parties`, `marg_branches`, `forecasts`, `forecast_results`, `forecast_runs`, `plan_versions`, `actuals`, `audit_logs` | Forecast vs actual and sales-derived dashboard endpoints. |
| Generic saved reports | mixed | `/reports` | `GET/POST/PATCH/DELETE /reports`, `GET /reports/:id/data` | `ReportsManagementService` | `reports`, `marg_vouchers`, `marg_transactions`, `marg_products`, `products`, `forecast_runs`, `forecast_results`, `actuals` | CRUD is persisted, but `saveReport`, `exportReport`, and schedule helpers return generated URLs/IDs only; do not reuse as NLQ execution semantics without hardening. |

## Report Families

- Sales reports: sales overview, sales bills, sales drilldowns, sales dimensions, growth comparison, generic dashboard sales actuals.
- Purchase reports: purchase overview, purchase bills, purchase drilldowns, purchase order list, purchase invoice list, supplier 360, procurement reports.
- Inventory reports: current stock, batch stock, movement ledger, stock ageing, inventory KPIs, inventory value trend, batches list.
- Stock reports: reorder/low stock, dead/slow, ABC, XYZ, turnover, stock-out.
- Customer reports: customer 360, sales party drilldown, party outstanding when party type is `CUSTOMER`.
- Supplier reports: supplier performance, supplier 360, supplier list, party outstanding when party type is `SUPPLIER`.
- Salesman reports: sales/purchase dimension analysis with `salesman`, bill-level salesman/user filters.
- Tax reports: sales/purchase tax summary from `marg_transactions.gst` and `gst_amount`; no standalone tax register UI was found.
- Ledger/accounting reports: party ledger, GL accounts, journal entries, trial balance, account ledger.
- Outstanding reports: party outstanding, outstanding by group, invoice detail.
- Dashboard reports: pharma inventory KPIs/trends, alerts, generic `/reports/dashboard/*`.
- 360/mixed reports: item 360, customer 360, supplier 360, 360 search.

## Current Backend Endpoints

Primary production report endpoints:

- `/pharma-reports/dashboard/kpis`
- `/pharma-reports/dashboard/expiry-loss-trend`
- `/pharma-reports/dashboard/inventory-value-trend`
- `/pharma-reports/inventory/current-stock`
- `/pharma-reports/inventory/batch-wise`
- `/pharma-reports/inventory/movement-ledger`
- `/pharma-reports/inventory/reorder`
- `/pharma-reports/inventory/ageing`
- `/pharma-reports/expiry/near`
- `/pharma-reports/expiry/expired`
- `/pharma-reports/expiry/fefo`
- `/pharma-reports/expiry/risk`
- `/pharma-reports/analysis/dead-slow`
- `/pharma-reports/analysis/abc`
- `/pharma-reports/analysis/xyz`
- `/pharma-reports/analysis/turnover`
- `/pharma-reports/analysis/:kind/overview`
- `/pharma-reports/analysis/:kind/bills`
- `/pharma-reports/analysis/:kind/bills/:billKey`
- `/pharma-reports/analysis/:kind/items/:itemKey`
- `/pharma-reports/analysis/:kind/parties/:partyCode`
- `/pharma-reports/analysis/:kind/dimension/:dimension`
- `/pharma-reports/analysis/:kind/comparison`
- `/pharma-reports/procurement/suggested-purchase`
- `/reports/supplier-performance`
- `/reports/supplier-performance/:supplierKey/purchase-orders`
- `/reports/supplier-performance/:supplierKey/purchase-invoices`
- `/reports/stock-out`
- `/pharma-reports/financial/outstanding`
- `/pharma-reports/financial/outstanding-groups`
- `/pharma-reports/financial/outstanding/:partyCode`
- `/pharma-reports/financial/ledger/:partyCode`
- `/pharma-reports/360/search`
- `/pharma-reports/360/item`
- `/pharma-reports/360/customer`
- `/pharma-reports/360/supplier`
- `/pharma-reports/alerts`
- `/pharma-reports/accounting/trial-balance`
- `/pharma-reports/accounting/trial-balance/:accountId/ledger`
- `/pharma-reports/export`
- `/pharma-reports/share-pdf`, `/pharma-reports/share-report-pdf`, `/pharma-reports/export-pdf`

Related dashboard and operational endpoints:

- `/reports/dashboard/*`, `/reports`, `/reports/:id/data`, `/reports/summary`
- `/manufacturing/purchase-orders`, `/manufacturing/purchase-invoices`, `/manufacturing/suppliers`, `/manufacturing/batches`, `/manufacturing/gl-accounts`, `/manufacturing/journal-entries`

## Common Datasets Recommended for NLQ

Create these as semantic datasets first, then decide whether to materialize as Postgres views later:

1. `sales_invoice_lines`: `marg_vouchers` + compatible `marg_transactions` + `marg_products` + `products` + `marg_parties` + branch/salesman/cost lookup.
2. `sales_invoice_summary`: bill-grain rollup from sales lines with gross, discount, tax, round-off, net, cost, profit, quantity, item count, payment mode, status.
3. `purchase_invoice_lines`: purchase-compatible `marg_vouchers` + `marg_transactions` + item/supplier/branch/cost lookup.
4. `purchase_invoice_summary`: bill-grain rollup for purchase vouchers and returns.
5. `current_stock_summary`: product-location balances from `inventory_levels` with product classification lookup.
6. `batch_stock_summary`: active positive `batches` with expiry/manufacturing age and location/product metadata.
7. `stock_movement_ledger`: `inventory_ledger` joined to product/location/batch.
8. `stock_policy_demand`: `inventory_levels` + `inventory_policies` + issue history from `inventory_transactions`.
9. `supplier_procurement_scorecard`: core `purchase_orders`, `purchase_order_lines`, `goods_receipts`, `goods_receipt_lines`, `quality_inspections`, `suppliers`.
10. `party_outstanding`: `marg_outstandings` with dynamic ageing and party/group lookup.
11. `party_ledger`: `marg_account_postings` + party balance/opening + voucher/counterparty enrichment.
12. `gl_trial_balance`: `gl_accounts` + posted journal lines.
13. `product_master_enriched`: `products` + `marg_products` + named company/salt/category/UOM masters.
14. `entity_360_sources`: item/customer/supplier profile datasets that wrap the existing 360 services.

Do not create these as final SQL views until the next step validates exact metric parity with existing reports.

## Required Metrics Found

- Sales: gross sales, net sales, taxable amount, GST/tax amount, discount amount, discount %, round off, sales quantity, bill count, item count, average bill value, cost amount, gross profit, margin %, return impact, top item value/share, payment-mode amount.
- Purchase: purchase value, purchase quantity, purchase bill count, supplier count, top purchased items, average bill value, return impact, purchase tax amount, purchase trend.
- Inventory/stock: on hand, available, allocated, reserved, quarantine, in transit, on order, unit cost, inventory value, batch quantity, batch value, current stock delta, running balance, COGS, turnover ratio, days of inventory, days of stock.
- Expiry: days to expiry, expired value, near-expiry value by 30/90/180/270 days, value at risk, expired quantity, expiring batch count.
- Replenishment: average daily sales/demand, reorder point, safety stock, lead time, suggested order qty, suggested purchase qty, demand during lead time, estimated cost.
- Stock classification: consumption value, consumption quantity, % of total, cumulative %, ABC class, average monthly demand, demand stddev, coefficient of variation, XYZ class.
- Supplier/procurement: total orders, purchase invoice count, on-time delivery %, average lead time, fulfillment %, rejection %, total spend, ordered qty, received qty, pending qty.
- Outstanding: open invoice count, outstanding balance, credit/advance balance, signed balance, PD less, bucket amounts, average days outstanding, DSO, overdue amount.
- Ledger/accounting: opening balance, debit, credit, net balance, closing balance, running balance, journal count.
- Forecast/generic dashboard: actual sales, forecast amount, variance, variance %, forecast accuracy/MAPE, coverage, demand/supply gap, fill rate, model bias.

## Required Dimensions Found

- Product/item: product id, SKU/code, Marg PID, product name, HSN, UOM, product company/manufacturer, product group/category, salt, brand/subcategory where available.
- Party: customer/supplier code, customer/supplier name, Marg CID, group code/name, city/area/route, credit terms.
- Salesman/user: salesman/MR code, salesman name, user display.
- Document: company id, voucher, VCN, invoice number, ORN, purchase order number, goods receipt number, status, payment mode.
- Time: date, month, period, ageing days, expiry date, manufacturing date, inward date, fiscal period/date range.
- Location: branch, warehouse/location id, location code/name, Marg branch/company mapping.
- Batch: batch id, batch number, batch status, lot/expiry.
- Accounting: GL account id/number/name/type, normal balance, book, counterparty, account group.

## Filters Found

Shared report filters:

- Pagination: `limit`, `offset`.
- Sorting: `sortBy`, `sortDir`.
- Column filters: JSON `filters` using allowlisted fields/operators.
- Product, location, batch: `productIds`, `locationIds`, `batchIds`, `category`.
- Date ranges: `startDate`, `endDate`, `fromDate`, `toDate`, `asOfDate`.
- Sales/purchase: `companyId`, `branchId`, `warehouseId`, `partyCode`, `customerCode`, `supplierCode`, `item`, `category`, `brand`, `batch`, `user`, `paymentMode`, `taxType`, `status`, `minAmount`, `maxAmount`, `minQuantity`, `maxQuantity`.
- Comparison: `compareStartDate`, `compareEndDate`, `dimension`.
- Expiry/stock: `thresholdDays`, `deadMonths`, `avgSalesDays`, `bucketDays`, `periodMonths`, ABC/XYZ thresholds.
- Procurement: `supplierIds`, `status`, `includeFallbackPurchaseOrders`, `safetyMultiplier`.
- Financial: `partyType`, `companyId`, `includeSettled`, `bucketBoundaries`, `bucketIndex`, `dsoDays`.
- 360: `type`, `search`, `period`, `locationId`.
- Alerts: `nearExpiryDays`, `aClassOnly`, `alertLimit`, UI-level alert type/severity.

## Business Rules Found

- Tenant isolation: all report services scope by `user.tenantId`; raw SQL includes `tenant_id = ${tenantId}::uuid`.
- Authentication: controllers use `JwtAuthGuard` and `RolesGuard`.
- Module gating: `/reports` controller uses `@RequireModule('reports')`; frontend `/pharma-reports/*` route checks enabled `reports` module.
- Role gating: sales/purchase analysis, supplier performance, stock-out allow `ADMIN`, `PLANNER`, `FINANCE`, `VIEWER`; financial outstanding and party ledger allow `ADMIN`, `FINANCE`, `PLANNER`; accounting trial balance/account ledger allow `ADMIN`, `FINANCE`, `PLANNER`, `SUPER_ADMIN`; frontend accounting routes mirror that.
- Raw SQL safety: pharma reports use `pharma-filter.helper.ts` with developer-authored allowlisted SQL expressions; unknown filter fields are rejected and sort fields fall back.
- Marg sales voucher mapping: sales document types are `S` plus returns `R`, `T`; compatible line types are `S -> G/S/O`, `R -> R`, `T -> X/T`.
- Marg purchase voucher mapping: purchase document types are `P` plus return `B`; compatible line types are `P -> P`, `B -> B`.
- Sales/purchase return handling: bill status is `RETURN` when voucher type is `R`, `T`, or `B`; otherwise `POSTED`.
- Amount signs: sales and purchase reports use `ABS()` on quantities, amounts, and GST amounts for headline rollups.
- Net amount: bill-level net amount prefers `marg_vouchers.final_amt`; fallback is sum of absolute line amount plus GST.
- Gross amount: sum of `abs(qty) * rate`.
- Discount: `GREATEST(abs(qty)*rate - abs(amount), 0)`, with discount % over gross.
- Tax: `abs(marg_transactions.gst_amount)`, grouped by `marg_transactions.gst` for tax summaries.
- Cost/profit: cost uses batch/item cost lookup from `marg_stocks.p_rate`, `marg_stocks.lp_rate`, falling back to `products.standard_cost`.
- Payment mode: cash when `cash > 0` and `others = 0`; credit when `cash = 0`; mixed when both cash and others are positive.
- Branch filtering: Marg company id is mapped to branch/location through `marg_branches.location_id`; branch/warehouse filters are implemented as `EXISTS` against `marg_branches`.
- Company filtering: Marg reports accept `companyId` and compare to `marg_vouchers.company_id` or Marg accounting company id.
- Batch stock visibility: batch reports require `quantity > 0` and exclude `CONSUMED`, `RECALLED`.
- Expiry: near-expiry uses `CURRENT_DATE` to threshold; expired stock is expiry date before `CURRENT_DATE`.
- Stock ageing: age is computed from manufacturing/inward date to `CURRENT_DATE`; configurable buckets are supported.
- Demand/COGS: issue-driven inventory analytics use `inventory_transactions` with `ISSUE` and `PRODUCTION_ISSUE`.
- Reorder: average daily sales is issue quantity over configurable days divided by day count; suggested order considers reorder point and stock.
- Suggested purchase: average daily demand uses 90-day issues; preferred supplier is latest non-cancelled/non-draft PO supplier.
- Supplier scorecard: current production report is core PO/GRN/QC driven; Marg invoice-only documents should already be materialized during sync.
- Stock-out: periods derive from `inventory_ledger.running_balance <= 0`; current stock cross-checks `inventory_levels` and latest Marg ledger projection.
- Outstanding ageing: default buckets are current/31-60/61-90/91+, but `bucketBoundaries` can override; explicit `asOfDate` recomputes age from invoice date instead of stored `days`.
- Outstanding signs: customer/supplier exposure handles debit/credit balances differently and tracks credit/advance separately.
- Party type: Marg group code starting with `C` is treated as customer/debtor; supplier/payable uses non-`C` group logic.
- Party ledger: opening can come from `marg_party_balances`; computed opening/closing is available from postings.
- Trial balance: uses posted `journal_entries` and `journal_entry_lines`; opening is before start date, period movement is start/end bounded, zero rows hidden unless `showZero`.

## Performance Concerns

- Sales/purchase reports repeatedly scan `marg_vouchers` plus `marg_transactions` and use lateral cost lookups into `marg_stocks`; high-cardinality tenants will need indexed/materialized semantic datasets.
- Dimension and comparison reports perform bill-grain rollups after line scans; NLQ "top N" should call `getDimensionAnalysis` or a future tested equivalent rather than recomputing per prompt.
- 360 reports fan out across many datasets and include multiple raw SQL blocks; they should remain service-backed and bounded by entity selection.
- Financial outstanding currently loads matching Marg outstanding rows into memory for grouping/filtering. It is acceptable for current UI but may need SQL/materialized aging datasets for NLQ at scale.
- JSON column filters and dynamic buckets are powerful but must stay bounded by existing allowlists.
- Export paths can request large limits (`100000` in several in-memory exports); NLQ should have row limits and summary-first behavior.
- Generic `/reports` management has some persisted CRUD plus helper methods returning generated IDs/download URLs; do not use those as production NLQ primitives until hardened.

## Risks And Unknowns

- No explicit financial year selector was found in pharma reports; date filters and accounting fiscal periods exist elsewhere. NLQ must clarify whether "this month", "FY", or custom period should use calendar dates, tenant fiscal calendar, or Marg financial year.
- Branch restrictions beyond explicit branch filter were not discovered. Existing code scopes by tenant and role/module; any per-user branch ACL should be verified before NLQ implementation.
- Cancelled Marg invoice handling is not directly visible in sales/purchase reports. Current logic filters by voucher type/status semantics but does not show a generic `cancelled` flag in report SQL.
- Standalone VAT/GST register reports were not found; tax is present as summaries within sales/purchase analysis.
- Generic `/reports` saved report operations mix real persisted report data with methods that return generated URLs/IDs. They are not NLQ-ready without production hardening.
- Some operational report/list pages under Reports menu are CRUD/list surfaces rather than analytical reports; include them in semantic catalog only where NLQ needs their data.
- 360 report logic is rich and should be treated as composite service output. Reproducing it as SQL views in one step would be high risk.

## Next Implementation Steps

1. Build a semantic catalog from `report-inventory.json` with stable dataset IDs, allowed metrics, allowed dimensions, required roles, and filter schemas.
2. Add a backend NLQ planner that maps questions to existing report services/endpoints first. Do not expose raw SQL to AI.
3. Add an allowlisted query execution layer for approved semantic datasets only, reusing `pharma-filter.helper.ts` patterns.
4. Implement date phrase resolution with tenant timezone and a clear fiscal-calendar policy.
5. Implement permission checks that reuse current JWT, role, module, tenant, and any discovered branch/company constraints.
6. Create parity tests: each semantic dataset/report mapping must match the existing endpoint for representative filters.
7. Add materialized/reporting views only after parity tests prove existing report results are unchanged.
8. Add audit logging for NLQ prompts, resolved intent, selected report/dataset, filters, and exported output.
9. Add row limits, timeout limits, PII controls, and export controls for AI-generated reports.
