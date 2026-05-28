# Plan: Scoped Reorder Policies (by Product Company / HSN / Salt / Product Group / Supplier)

> **Status:** Planning. To be implemented later.
> **Author context:** Client wants the ability to configure reorder parameters not just per product×location, but at higher grouping levels — **Product Company, HSN code, Salt, Product Group, and Supplier**. This document captures what already exists, the real remaining gap, and a concrete implementation plan.

---

## 1. TL;DR — the surprising part

**Most of this feature is already built — for the Inventory → Reorder report.** Do **not** rebuild it. The remaining work is mostly:

1. **Make the Procurement → Suggested Purchase report honor the same scoped policies** (it currently only reads product-level policies, so it diverges from the Reorder screen on any scoped config). ← _primary gap_
2. Surface the **policy source** (which level a row's config came from) in the Procurement UI, matching the Reorder screen.
3. Tests + a short verification pass.

Everything else (data model, resolution precedence, CRUD APIs, scope-option search, CSV import, Reorder UI) is in place.

---

## 2. Current state (verified in code)

### 2.1 Data model — DONE
- `enum InventoryPolicyScopeType { PRODUCT_COMPANY, HSN_CODE, SALT, PRODUCT_GROUP, SUPPLIER }` — [schema.prisma](../apps/api/prisma/schema.prisma) (~line 2327). **Exactly the 5 scopes the client asked for.**
- `model InventoryPolicyScope` → table `inventory_policy_scopes` ([schema.prisma](../apps/api/prisma/schema.prisma) ~line 1200). Columns: `scopeType`, `scopeCode` (for company/HSN/salt/group), `scopeId` (for supplier UUID), `locationId` (nullable = all locations), `priority`, all reorder fields (`reorderPoint`, `reorderQty`, `minOrderQty`, `maxOrderQty`, `multipleOrderQty`, `safetyStockQty`, `safetyStockDays`, `leadTimeDays`, `abcClass`), and `effectiveFrom`/`effectiveTo`.
- `model InventoryPolicy` → `inventory_policies` (product×location level), unique on `(tenantId, productId, locationId)`.
- Denormalised product columns used for matching: `products.product_company`, `products.hsn_code`, `products.salt`, `products.product_group`, `products.hsn_code`.

> **No migration needed** — the table and enum already exist in the deployed schema.

### 2.2 Resolution + precedence — DONE (Reorder report only)
`getReorderReport` in [inventory-reports.service.ts](../apps/api/src/modules/pharma-reports/services/inventory-reports.service.ts) (method ~line 732) resolves the effective policy per product×location:

- A `LEFT JOIN LATERAL (... FROM inventory_policy_scopes ips ...)` (~lines 889–917) picks the **single best matching scope row**:
  - matches `PRODUCT_COMPANY`→`p.product_company`, `HSN_CODE`→`p.hsn_code`, `SALT`→`p.salt`, `PRODUCT_GROUP`→`p.product_group`, `SUPPLIER`→resolved `supplier_match.supplier_id`;
  - honors `location_id IS NULL OR = location` and `effective_from/to`;
  - ordered by **location-specific first, then `priority DESC`, then `updated_at DESC`**, `LIMIT 1`;
  - also computes a human-readable `scope_label`.
- Effective config is `COALESCE(ip.<field>, scope_policy.<field>, <computed default>)` (~lines 829–848) → **product-level policy overrides scope-level**, which overrides computed defaults. Correct precedence.
- Emits `policy_source` ∈ `PRODUCT_LOCATION | SCOPED | COMPUTED` (~line 833), plus `policy_scope_type` and `policy_scope_label`.

### 2.3 CRUD + APIs — DONE
[pharma-reports.controller.ts](../apps/api/src/modules/pharma-reports/pharma-reports.controller.ts):
- `GET inventory/reorder-config/scopes` → `getReorderPolicyScopes`
- `GET inventory/reorder-config/scope-options` → `getReorderScopeOptions` (typeahead search of company/HSN/salt/group/supplier values)
- `POST inventory/reorder-config/scopes` → `upsertReorderPolicyScopes` (bulk upsert; matches by `scopeId` for SUPPLIER, `scopeCode` otherwise)
- `DELETE inventory/reorder-config/scopes/:id` → `deleteReorderPolicyScope`
- Service methods: `getReorderPolicyScopes` (~1078), `getReorderScopeOptions` (~1137), `upsertReorderPolicyScopes` (~1232), `deleteReorderPolicyScope` (~1363).

### 2.4 Frontend — DONE (Reorder config)
[ReorderConfigPage.tsx](../apps/web/src/pages/pharma-reports/ReorderConfigPage.tsx):
- Tabs `product | scope` (~line 115). Scope tab has `SCOPE_TYPE_OPTIONS` for all 5 types, a scope form (scopeType, scopeCode/scopeId via typeahead, location, priority, reorder fields), list with pagination, CSV import (`parseReorderScopeConfigCsv`), and hooks (`useReorderPolicyScopes`, `useReorderScopeOptions`, `useUpsertReorderPolicyScopes`, `useDeleteReorderPolicyScope`).

### 2.5 The gap — Suggested Purchase ignores scopes
`getSuggestedPurchase` in [procurement-reports.service.ts](../apps/api/src/modules/pharma-reports/services/procurement-reports.service.ts) was recently aligned to the Reorder engine's **core math** (net-sales demand, lot logic, gate) but its `base` CTE only does `LEFT JOIN inventory_policies ip` and resolves config as `ip.<field>` — **no `inventory_policy_scopes` lateral join, no `COALESCE(ip, scope)` precedence.**

**Consequence:** a client who sets, say, a Product-Company-level reorder point sees it honored on the Inventory → Reorder screen but **ignored** on the Procurement → Suggested Purchase screen. The two screens disagree exactly where the client is investing configuration effort.

---

## 3. Goal

Make scoped reorder policies authoritative **everywhere replenishment is computed**, so configuring a policy by Company/HSN/Salt/Group/Supplier produces identical effective parameters on both the Reorder and Suggested Purchase screens, with the same precedence and the same transparency about where each row's config came from.

---

## 4. Implementation plan

### Task A — Resolve scope policies in Suggested Purchase _(primary, required)_
File: [procurement-reports.service.ts](../apps/api/src/modules/pharma-reports/services/procurement-reports.service.ts), method `getSuggestedPurchase`.

1. In the `base` CTE, **add the supplier-match lateral and the `scope_policy` lateral join** exactly as in `getReorderReport` (copy lines ~889–917, plus the `supplier_match` lateral the SUPPLIER scope depends on). Keep the existing `LEFT JOIN inventory_policies ip`.
2. Change the `cfg_*` resolution from `ip.<field>` to `COALESCE(ip.<field>, scope_policy.<field>)` and apply the same fallback for `lead_time_days` / `safety_stock_qty` (mirror lines ~842–848). This is the only behavioural change to the numbers.
3. Carry `policy_source`, `policy_scope_type`, `policy_scope_label` through the CTEs into the `sp` projection (mirror lines ~829–837).
4. Select the new columns in the final `SELECT` and extend `SuggestedPurchaseRow` (interface ~line 109) with:
   - `policy_source: 'PRODUCT_LOCATION' | 'SCOPED' | 'COMPUTED'`
   - `policy_scope_type: string | null`
   - `policy_scope_label: string | null`
5. Add these to `SUGGESTED_PURCHASE_COLUMNS` (bare names) so they're filterable/sortable.
6. **Refactor to avoid drift:** extract the shared replenishment CTE (demand → on_order → supplier_match → scope_policy → base → calc → r1…rr) into a single private SQL builder used by **both** `getReorderReport` and `getSuggestedPurchase`. This is the durable fix for "the two screens keep diverging." If a full extraction is too risky in one pass, at minimum copy the scope lateral verbatim and add a code comment cross-referencing `getReorderReport` so future edits stay in sync.

> **Demand-source note:** Reorder uses net sales from `actuals` (ActualType=SALES). Suggested Purchase was aligned to the same source in the prior change. Keep them identical.

### Task B — Surface policy source in the Procurement UI _(recommended)_
Files: [pharma-reports.service.ts](../apps/web/src/services/api/pharma-reports.service.ts) (`SuggestedPurchaseRow` type), [ProcurementPage.tsx](../apps/web/src/pages/pharma-reports/ProcurementPage.tsx).

- Add the 3 new fields to the web `SuggestedPurchaseRow` type.
- Add a "Policy" column to the Suggested Purchase table showing `policy_scope_label` (e.g. "Salt: PARACETAMOL") or "Product-level" / "Computed", matching how the Reorder screen displays `policy_source`/`policy_scope_label`. Reuse the Reorder screen's badge/renderer for consistency.

### Task C — Discoverability of the existing config _(optional, low effort, high value)_
The client may not realise scoped config already exists. Add a small "Configure by company / salt / HSN / group / supplier" link from both the Reorder and Suggested Purchase screens to `ReorderConfigPage` → scope tab (deep-link with `?tab=scope`). Confirms the feature is reachable.

### Task D — Tests
- Backend unit/SQL test mirroring [inventory-reports.service.spec.ts](../apps/api/src/modules/pharma-reports/services/inventory-reports.service.spec.ts) (which asserts `FROM inventory_policy_scopes ips` is present) — add the same assertion for the Suggested Purchase query.
- Scenario test: a product with **no** product-level policy but a matching SALT scope policy → Suggested Purchase `reorder_point`/`suggested_purchase_qty` reflect the scope values and `policy_source = 'SCOPED'`.
- Precedence test: product-level policy + scope policy both present → product-level wins (`policy_source = 'PRODUCT_LOCATION'`).
- Parity test: same product appears with identical effective `reorder_point` and `suggested qty` on both Reorder and Suggested Purchase for the same horizon params.

---

## 5. Precedence & resolution rules (formal spec — already implemented for Reorder; replicate for Suggested Purchase)

For each (product, location), the effective value of each reorder parameter is the **first non-null** of:

1. **Product×location policy** (`inventory_policies`) — most specific, always wins.
2. **Best-matching scope policy** (`inventory_policy_scopes`), chosen by:
   - scope matches the product's company / HSN / salt / group, or the product's resolved supplier;
   - within `effective_from`/`effective_to`;
   - location-specific scope rows beat all-location (`location_id IS NULL`) rows;
   - then highest `priority`; then most recently updated.
3. **Computed default** (demand × lead time + safety), using the screen's horizon controls.

`policy_source` reports which tier supplied the row: `PRODUCT_LOCATION` → `SCOPED` → `COMPUTED`.

> **Note on multiple matching scopes:** the current design resolves to a *single* best scope row via `ORDER BY … LIMIT 1` (priority-based), it does **not** merge fields across multiple scope rows. If the client wants field-level layering (e.g. lead time from Supplier scope + min-order from Company scope), that is an enhancement — see §7.

---

## 6. Data model & API impact
- **DB migration:** none. `inventory_policy_scopes` + enum already deployed.
- **API:** no new endpoints. Suggested Purchase response gains 3 fields (additive, backward-compatible).
- **Config management:** reuse the existing scope CRUD/CSV on `ReorderConfigPage`.

---

## 7. Optional enhancements (out of scope unless requested)
- **Field-level layering** across multiple matching scopes (vs single-best-row today).
- **Additional scope types** the schema doesn't yet enumerate: Brand, Subcategory, Route/Therapy, Salesman/Area. Each needs (a) an enum value, (b) a matching predicate against a denormalised product column, (c) a scope-options search branch. Low effort each.
- **"Effective policy explainer"** drill-down: given a product, show every candidate scope row and why the winner was chosen.
- **Conflict/override warnings** in the config UI when a product-level policy shadows a scope policy.
- **Apply scoped policies to MRP / planned orders** (manufacturing) if that path also computes reorder independently — audit needed.

---

## 8. Acceptance criteria
1. Setting a reorder policy at Company/HSN/Salt/Group/Supplier level changes the **Suggested Purchase** numbers for all matching products that lack a product-level override.
2. A product-level policy still overrides any scope policy on both screens.
3. Both screens show **identical** effective reorder point and suggested quantity for the same product and horizon settings.
4. The Suggested Purchase table shows where each row's policy came from (product / scope label / computed).
5. No regression for tenants with only product-level policies (scope join returns nothing → behaves as before).

---

## 9. Risks & edge cases
- **Performance:** the scope lateral adds a correlated subquery per row. It already runs on the Reorder report at this tenant's scale; validate Suggested Purchase timing on the largest tenant (14k+ products). Indexes exist: `inventory_policy_scopes(tenant_id, scope_type, scope_code)` and `(…, scope_id)`.
- **Supplier scope dependency:** SUPPLIER matching relies on `supplier_match` (supplier_products + PO history). Products with no resolvable supplier simply won't match SUPPLIER scopes — acceptable.
- **Denormalised product columns** (`product_company`, `salt`, `product_group`, `hsn_code`) must be populated from the Marg sync for matching to work; blank/`NULL` values are correctly excluded via `NULLIF(TRIM(...), '')`.
- **Drift risk:** the two reports must keep the same resolution logic. Task A.6 (shared CTE builder) is the mitigation; if skipped, the spec parity test (Task D) is the safety net.

---

## 10. Effort estimate (rough)
- Task A (backend scope resolution in Suggested Purchase): **0.5–1 day** (mostly SQL mirroring + the optional shared-CTE refactor).
- Task B (UI policy column): **0.5 day**.
- Task C (deep links): **1–2 hours**.
- Task D (tests): **0.5 day**.
- **Total: ~1.5–2.5 days**, no migration, no new endpoints.

---

## 11. Implementer prompt (paste to kick off)

> Implement scoped reorder policies in the Procurement → Suggested Purchase report so it matches the Inventory → Reorder report.
>
> Context: `inventory_policy_scopes` (enum `InventoryPolicyScopeType`: PRODUCT_COMPANY, HSN_CODE, SALT, PRODUCT_GROUP, SUPPLIER) and full scope resolution already exist in `getReorderReport` ([inventory-reports.service.ts](../apps/api/src/modules/pharma-reports/services/inventory-reports.service.ts), scope lateral ~lines 889–917, precedence `COALESCE(ip, scope_policy)` ~lines 829–848, emits `policy_source`/`policy_scope_label`). `getSuggestedPurchase` ([procurement-reports.service.ts](../apps/api/src/modules/pharma-reports/services/procurement-reports.service.ts)) currently resolves only product-level `inventory_policies` and must be brought to parity.
>
> Do:
> 1. Add the `supplier_match` + `scope_policy` lateral joins to the Suggested Purchase `base` CTE and switch `cfg_*`/lead/safety resolution to `COALESCE(ip.x, scope_policy.x, default)` — identical to `getReorderReport`.
> 2. Carry `policy_source`, `policy_scope_type`, `policy_scope_label` through to the `sp` projection and final SELECT; extend `SuggestedPurchaseRow` (API + web types) and `SUGGESTED_PURCHASE_COLUMNS`.
> 3. Prefer extracting one shared replenishment-CTE builder used by both methods to prevent future drift.
> 4. Add a "Policy" column to the Suggested Purchase table in [ProcurementPage.tsx](../apps/web/src/pages/pharma-reports/ProcurementPage.tsx) showing the scope label / source.
> 5. Add tests: scope-only product reflects scope values (`policy_source='SCOPED'`); product-level overrides scope; Reorder vs Suggested Purchase parity for the same product/horizon.
>
> Constraints: no DB migration (table exists); additive API change only; both `tsc` clean; validate the SQL against a real tenant; don't change the net-sales demand source.
