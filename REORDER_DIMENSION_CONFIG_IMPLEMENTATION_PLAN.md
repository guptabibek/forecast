# Reorder Dimension Config Implementation Plan

## Implementation Status

Implemented in this branch:

- Exact product-location policies remain in `inventory_policies`.
- Scoped policies are stored in `inventory_policy_scopes` with `InventoryPolicyScopeType`.
- Supported scopes: product company, HSN, salt, product group, and supplier.
- Inventory Reorder and Procurement Suggested Purchase now use the same precedence rules.
- Reorder Config UI now has Product-location and Scoped policies tabs.
- Scoped CSV import/export, report columns, filters, exports, and focused tests are included.

## Goal

Extend the existing reorder configuration so users can configure and review reorder rules not only per product and location, but also by:

- Product company
- HSN code
- Salt
- Product group
- Product supplier

The same policy resolution must drive both:

- Inventory > Reorder / Low Stock
- Procurement > Suggested Purchase

## Current State

The current implementation stores explicit product-location overrides in `inventory_policies`.

Important existing files:

- API DTOs: `apps/api/src/modules/pharma-reports/dto/reorder-config.dto.ts`
- API filters: `apps/api/src/modules/pharma-reports/dto/common-filters.dto.ts`
- Reorder API engine: `apps/api/src/modules/pharma-reports/services/inventory-reports.service.ts`
- Suggested purchase API engine: `apps/api/src/modules/pharma-reports/services/procurement-reports.service.ts`
- Reorder routes: `apps/api/src/modules/pharma-reports/pharma-reports.controller.ts`
- Frontend API types: `apps/web/src/services/api/pharma-reports.service.ts`
- Frontend hooks: `apps/web/src/hooks/usePharmaReports.ts`
- Reorder config UI: `apps/web/src/pages/pharma-reports/ReorderConfigPage.tsx`
- Reorder report UI: `apps/web/src/pages/pharma-reports/InventoryReportsPage.tsx`
- Suggested purchase UI: `apps/web/src/pages/pharma-reports/ProcurementPage.tsx`
- CSV parser: `apps/web/src/pages/pharma-reports/reorderConfigCsv.ts`

Product master already has these fields:

- `products.product_company`
- `products.hsn_code`
- `products.salt`
- `products.product_group`

Named masters already exist for display:

- `product_companies`
- `product_salts`
- `product_categories`

Supplier/product mapping exists through:

- `supplier_products`
- `suppliers`
- purchase history fallback from `purchase_orders` and `purchase_order_lines`

## Recommended Design

Keep the existing `inventory_policies` table for exact product-location policies. Add a new scoped policy table for dimension-level policies. This avoids breaking the existing natural key and keeps exact product overrides simple.

### New Table

Add a Prisma model and migration for `inventory_policy_scopes`.

Suggested columns:

```prisma
model InventoryPolicyScope {
  id                    String   @id @default(dbgenerated("uuid_generate_v4()")) @db.Uuid
  tenantId              String   @map("tenant_id") @db.Uuid
  scopeType             InventoryPolicyScopeType @map("scope_type")
  scopeCode             String?  @map("scope_code") @db.VarChar(100)
  scopeId               String?  @map("scope_id") @db.Uuid
  locationId            String?  @map("location_id") @db.Uuid
  priority              Int      @default(0)

  reorderPoint          Decimal? @map("reorder_point") @db.Decimal(18, 4)
  reorderQty            Decimal? @map("reorder_qty") @db.Decimal(18, 4)
  minOrderQty           Decimal? @map("min_order_qty") @db.Decimal(18, 4)
  maxOrderQty           Decimal? @map("max_order_qty") @db.Decimal(18, 4)
  multipleOrderQty      Decimal? @map("multiple_order_qty") @db.Decimal(18, 4)
  safetyStockQty        Decimal? @map("safety_stock_qty") @db.Decimal(18, 4)
  safetyStockDays       Int?     @map("safety_stock_days")
  leadTimeDays          Int?     @map("lead_time_days")
  abcClass              String?  @map("abc_class") @db.VarChar(1)

  effectiveFrom         DateTime @default(now()) @map("effective_from") @db.Date
  effectiveTo           DateTime? @map("effective_to") @db.Date
  createdAt             DateTime @default(now()) @map("created_at")
  updatedAt             DateTime @updatedAt @map("updated_at")

  @@index([tenantId, scopeType, scopeCode])
  @@index([tenantId, scopeType, scopeId])
  @@index([tenantId, locationId])
  @@map("inventory_policy_scopes")
}
```

Use `scopeType` values:

- `PRODUCT_COMPANY`
- `HSN_CODE`
- `SALT`
- `PRODUCT_GROUP`
- `SUPPLIER`

Use `scopeCode` for product company, HSN, salt, and product group. Use `scopeId` for supplier UUID. Keep `locationId` nullable so a policy can apply to all locations or only one location.

### Policy Precedence

Use deterministic resolution:

1. Existing exact `inventory_policies` product-location row wins.
2. Location-specific scoped policy wins over all-location scoped policy.
3. Higher `priority` wins when multiple scoped policies match.
4. Newer `updated_at` wins as final tie-breaker.
5. If nothing matches, use existing demand-driven defaults.

Recommended default priority:

- Supplier: 90
- Product group: 80
- Product company: 70
- Salt: 60
- HSN: 50

Allow users to edit priority later if business rules require different precedence.

## Backend Implementation

### 1. Add DTOs

Extend `reorder-config.dto.ts` with:

- `ReorderPolicyScopeType`
- `ReorderPolicyScopeRowDto`
- `ReorderPolicyScopeBulkDto`

Fields should mirror the current `ReorderPolicyRowDto` numeric policy fields, plus:

- `scopeType`
- `scopeCode`
- `scopeId`
- `locationId`
- `locationCode`
- `priority`

Validation rules:

- `scopeType` is required and must be one of the supported values.
- For `SUPPLIER`, require `scopeId` or supplier code/name resolution.
- For non-supplier scopes, require `scopeCode`.
- Numeric fields must be non-negative.

### 2. Add API Endpoints

Add these routes in `pharma-reports.controller.ts`:

- `GET /pharma-reports/inventory/reorder-config/scopes`
- `GET /pharma-reports/inventory/reorder-config/scope-options?scopeType=&search=`
- `POST /pharma-reports/inventory/reorder-config/scopes`
- `DELETE /pharma-reports/inventory/reorder-config/scopes/:id`
- Optional: `GET /pharma-reports/inventory/reorder-config/scopes/template`

Restrict writes to the same roles as the current config route: `ADMIN` and `PLANNER`.

### 3. Add Service Methods

In `InventoryReportsService`, add:

- `getReorderPolicyScopes`
- `getReorderScopeOptions`
- `upsertReorderPolicyScopes`
- `deleteReorderPolicyScope`
- `getReorderPolicyScopeTemplate`

Scope options query source:

- Product company: `product_companies` plus distinct `products.product_company`
- Salt: `product_salts` plus distinct `products.salt`
- Product group: `product_categories` plus distinct `products.product_group`
- HSN: distinct `products.hsn_code`
- Supplier: `suppliers`, optionally only suppliers linked through `supplier_products`

### 4. Resolve Product Supplier

Create a shared SQL CTE for supplier matching:

1. Prefer `supplier_products.is_primary = true`.
2. Then use lowest `supplier_products.priority`.
3. Then fallback to latest non-draft/non-cancelled purchase order for the product.

Expose these output fields in reorder and suggested purchase:

- `supplier_id`
- `supplier_code`
- `supplier_name`
- `supplier_display`

### 5. Apply Scoped Policy in Reorder Math

Both `getReorderReport` and `getSuggestedPurchase` currently duplicate the reorder CTE. Add the scoped-policy join to both, or preferably extract a shared CTE builder so both reports cannot drift.

Inside the base CTE, include product dimension fields:

- `product_company`
- `product_company_display`
- `salt`
- `salt_display`
- `product_group`
- `product_group_display`
- `hsn_code`
- supplier fields from the supplier CTE

Add a `scope_policy` lateral join:

```sql
LEFT JOIN LATERAL (
  SELECT ips.*
  FROM inventory_policy_scopes ips
  WHERE ips.tenant_id = il.tenant_id
    AND (ips.location_id IS NULL OR ips.location_id = il.location_id)
    AND CURRENT_DATE >= ips.effective_from
    AND (ips.effective_to IS NULL OR CURRENT_DATE <= ips.effective_to)
    AND (
      (ips.scope_type = 'PRODUCT_COMPANY' AND ips.scope_code = NULLIF(TRIM(p.product_company), ''))
      OR (ips.scope_type = 'HSN_CODE' AND ips.scope_code = NULLIF(TRIM(p.hsn_code), ''))
      OR (ips.scope_type = 'SALT' AND ips.scope_code = NULLIF(TRIM(p.salt), ''))
      OR (ips.scope_type = 'PRODUCT_GROUP' AND ips.scope_code = NULLIF(TRIM(p.product_group), ''))
      OR (ips.scope_type = 'SUPPLIER' AND ips.scope_id = supplier_match.supplier_id)
    )
  ORDER BY
    CASE WHEN ips.location_id = il.location_id THEN 1 ELSE 0 END DESC,
    ips.priority DESC,
    ips.updated_at DESC
  LIMIT 1
) sip ON TRUE
```

Then policy field fallback should become:

```sql
COALESCE(ip.reorder_point, sip.reorder_point, computed_value)
COALESCE(ip.reorder_qty, sip.reorder_qty)
COALESCE(ip.min_order_qty, sip.min_order_qty)
COALESCE(ip.multiple_order_qty, sip.multiple_order_qty)
COALESCE(ip.max_order_qty, sip.max_order_qty)
COALESCE(ip.safety_stock_qty, sip.safety_stock_qty, ...)
COALESCE(ip.safety_stock_days, sip.safety_stock_days, ...)
COALESCE(NULLIF(ip.lead_time_days, 0), sip.lead_time_days, defaultLeadTime)
COALESCE(ip.abc_class, sip.abc_class)
```

Add output fields:

- `is_configured`: exact or scoped policy exists
- `policy_source`: `PRODUCT_LOCATION`, `SCOPED`, or `COMPUTED`
- `policy_scope_type`
- `policy_scope_label`

### 6. Add Filter/Sort Support

Add these to `REORDER_COLUMNS` and `SUGGESTED_PURCHASE_COLUMNS`:

- `product_company`
- `product_company_display`
- `salt`
- `salt_display`
- `product_group`
- `product_group_display`
- `hsn_code`
- `supplier_name`
- `supplier_code`
- `policy_source`
- `policy_scope_type`

Also add optional explicit DTO filters for fast top-level filters:

- `productCompany`
- `hsnCode`
- `salt`
- `productGroup`
- `supplierIds`

Use the existing `filters` JSON column filter mechanism for table filtering, but add explicit DTO fields for dropdown filters and export payloads.

### 7. Export Updates

Update `report-export.service.ts` so reorder and suggested purchase exports include the new dimension columns and apply the same scoped policy logic.

Recommended export columns:

- SKU
- Product
- Product company
- Salt
- Product group
- HSN
- Supplier
- Location
- On hand
- On order
- Reorder point
- Suggested qty
- Policy source
- Policy scope

## Frontend Implementation

### 1. API Types

Update `pharma-reports.service.ts`:

- Add dimension fields to `ReorderRow` and `SuggestedPurchaseRow`.
- Add `policy_source`, `policy_scope_type`, `policy_scope_label`.
- Add `ReorderPolicyScopeRow`, `ReorderPolicyScopeInput`, and scope option types.
- Add service methods for the new scope endpoints.

### 2. Hooks

Update `usePharmaReports.ts`:

- Add query keys for scoped policies and scope options.
- Add `useReorderPolicyScopes`.
- Add `useReorderScopeOptions`.
- Add `useUpsertReorderPolicyScopes`.
- Add `useDeleteReorderPolicyScope`.
- On scoped policy mutation success, invalidate both `pharmaKeys.inventory()` and `pharmaKeys.procurement()`.

### 3. Reorder Config Page

Change `ReorderConfigPage.tsx` to have two tabs:

- Product-location policies: current behavior unchanged.
- Scoped policies: new mode.

Scoped policy form fields:

- Scope type select: Product company, HSN, Salt, Product group, Supplier
- Scope value searchable select
- Location select with "All locations"
- Priority
- Existing numeric fields
- ABC class

Table columns:

- Scope type
- Scope value
- Location
- Priority
- Policy numbers
- ABC class
- Updated at
- Actions

CSV import/export:

- Keep current product-location CSV unchanged.
- Add scoped CSV with headers:

```csv
scopeType,scopeCode,supplierCode,locationCode,priority,reorderPoint,minOrderQty,maxOrderQty,multipleOrderQty,reorderQty,safetyStockQty,safetyStockDays,leadTimeDays,abcClass
```

Rules:

- `supplierCode` is only used when `scopeType=SUPPLIER`.
- `scopeCode` is used for company, HSN, salt, and product group.
- Blank `locationCode` means all locations.

### 4. Inventory Reorder Page

In `InventoryReportsPage.tsx`, add optional columns:

- Product company
- Salt
- Product group
- HSN
- Supplier
- Policy source / scope

Add top-level quick filters:

- Scope type dropdown
- Scope value selector

Keep existing column filters active, because users may still filter directly in the table.

### 5. Suggested Purchase Page

In `ProcurementPage.tsx`, add the same dimension fields to the suggested purchase table:

- Product company
- Salt
- Product group
- HSN
- Supplier
- Policy source / scope

The suggested purchase quantity must match the reorder screen for the same product-location and horizon params.

## Test Plan

### Backend

Add or update tests for:

- Exact product-location policy still works.
- Scoped product company policy applies when no exact policy exists.
- HSN, salt, product group, and supplier policies apply.
- Exact policy wins over scoped policy.
- Location-specific scoped policy wins over all-location scoped policy.
- Higher priority wins when multiple scoped policies match.
- Reorder and suggested purchase produce matching suggested quantities for the same inputs.
- Supplier matching uses primary supplier first, then priority, then purchase history fallback.
- Filters for company, HSN, salt, group, supplier work on both reports.

### Frontend

Add or update tests for:

- Current product-location CSV parser remains backward compatible.
- New scoped CSV parser accepts valid rows and rejects bad scope rows.
- Reorder config page can switch between product-location and scoped policy tabs.
- Scoped policy save invalidates reorder and suggested purchase queries.
- Reorder and suggested purchase tables render the new dimension columns.

## Rollout Plan

1. Add migration and Prisma model.
2. Add DTOs and service methods for scoped config CRUD.
3. Add scoped policy resolution to reorder and suggested purchase CTEs.
4. Add dimension columns and filters to API responses.
5. Update frontend API types and hooks.
6. Update Reorder Config UI with scoped policy tab.
7. Update Inventory Reorder and Suggested Purchase tables.
8. Update exports.
9. Add tests.
10. Validate with a real tenant dataset:
    - One company-level policy
    - One HSN-level policy
    - One salt-level policy
    - One group-level policy
    - One supplier-level policy
    - One exact product-location override that should win over all scoped policies

## Open Decisions

- Should supplier policy match only explicit `supplier_products`, or also purchase-history fallback?
- Should users be allowed to create overlapping scoped policies, relying on priority, or should the UI warn about overlaps?
- Should location be required for scoped policies, or should all-location policies be allowed? Recommended: allow all-location policies.
- Should scoped policies support effective dates on the first release? Recommended: store effective dates now, but keep UI simple with active policies only.
- Should product company and product group use code only, or code plus master ID? Recommended: code, because product fields currently store codes.

## Ready Implementation Prompt

Use this prompt when starting the actual implementation:

```text
Implement scoped reorder policies for Inventory > Reorder / Low Stock and Procurement > Suggested Purchase.

Current exact product-location policies use inventory_policies and must remain backward compatible. Add a new inventory_policy_scopes table/model for dimension policies by PRODUCT_COMPANY, HSN_CODE, SALT, PRODUCT_GROUP, and SUPPLIER. Scoped policies should have the same policy fields as inventory_policies plus nullable location_id and priority.

Policy resolution must be:
1. exact product-location inventory_policies row,
2. matching scoped policy, preferring location-specific over all-location,
3. highest priority,
4. newest updated_at,
5. computed demand defaults.

Apply the same policy resolution to both apps/api/src/modules/pharma-reports/services/inventory-reports.service.ts getReorderReport and apps/api/src/modules/pharma-reports/services/procurement-reports.service.ts getSuggestedPurchase so the two screens stay consistent.

Expose product company, salt, product group, HSN, supplier, policy_source, policy_scope_type, and policy_scope_label in both report responses. Add allowlisted server-side filters/sorts for those fields.

Add CRUD/list/options APIs for scoped policies under the existing reorder-config route family, with ADMIN/PLANNER write access. Update frontend service types, hooks, ReorderConfigPage with a Scoped Policies tab, CSV import/export for scoped policies, and add the dimension/filter columns to InventoryReportsPage reorder tab and ProcurementPage suggested purchase tab. Update report exports and tests.
```
