# Frontend React App — Comprehensive Deep Audit

**Scope:** `apps/web/src/` — Services, Types, Pages, Router, Hooks, Auth Store  
**Date:** Generated from full codebase read

---

## Table of Contents

1. [Type Mismatches & Duplicates](#1-type-mismatches--duplicates)
2. [Backend Endpoints with No Frontend Page](#2-backend-endpoints-with-no-frontend-page)
3. [Frontend Pages Calling Non-Existent / Inconsistent Backends](#3-frontend-pages-calling-non-existent--inconsistent-backends)
4. [Missing Form Validation](#4-missing-form-validation)
5. [Missing Error / Loading / Empty States](#5-missing-error--loading--empty-states)
6. [Missing Pagination](#6-missing-pagination)
7. [Dead / Unreachable Code](#7-dead--unreachable-code)
8. [Service Layer Issues](#8-service-layer-issues)
9. [Router & Navigation Issues](#9-router--navigation-issues)
10. [Hook Issues](#10-hook-issues)
11. [Auth Store Issues](#11-auth-store-issues)
12. [Miscellaneous Issues](#12-miscellaneous-issues)

---

## 1. Type Mismatches & Duplicates

### 1.1 Duplicate `Plan` vs `PlanVersion` Types

**Files:** `types/index.ts`

- `PlanVersion` (line 58) uses `periodType` field and has fields like `fiscalYear`, `isLocked`, `approvedById`, `scenarios[]`, `forecasts[]`, `assumptions[]`
- `Plan` (line 469) uses `granularity` field and a simpler shape without `fiscalYear`, `isLocked`, `approvedById`
- Both share `id`, `name`, `description`, `status`, `startDate`, `endDate`, `createdBy`, `_count`
- **Impact:** Pages import `PlanVersion` (Plans.tsx line 1, PlanDetail.tsx line 1, Scenarios.tsx line 1) while the duplicate `Plan` type at line 469 is never imported by any page. This creates confusion and the `Plan` type at line 469 is dead code.

### 1.2 `Role` vs `UserRole` Case Mismatch

**File:** `types/index.ts`

- `UserRole` (line 14): `'ADMIN' | 'PLANNER' | 'FINANCE' | 'VIEWER'` — UPPERCASE
- `Role` (line 454): `'admin' | 'planner' | 'finance' | 'viewer'` — lowercase
- **Impact:** `Users.tsx` (line 1) imports `UserRole`, which matches the backend. The lowercase `Role` at line 454 is dead code and would cause silent bugs if anyone used it (role comparisons would always fail).

### 1.3 `TenantSettings` Dual Definitions

- `types/index.ts` (line 50): `TenantSettings` has `fiscalYearStart`, `defaultCurrency`, `timezone`, `dateFormat`, `numberFormat` — 5 fields
- `pages/settings/Settings.tsx` (line 22): Re-defines `TenantSettings` locally with ~20 fields including `primaryColor`, `ssoEnabled`, `slackWebhookUrl`, `dataRetentionDays`, etc.
- **Impact:** The local interface in Settings.tsx shadows the shared type. If Settings.tsx ever imports from `@/types`, there will be a conflict. The shared type is incomplete vs. what the backend returns.

### 1.4 Manufacturing Pages Define Types Locally

All manufacturing pages (`BOM.tsx`, `MRP.tsx`, `Capacity.tsx`, `Inventory.tsx`, `Suppliers.tsx`, `WorkOrders.tsx`, `PurchaseOrders.tsx`, `Promotions.tsx`, `NPI.tsx`, `SOP.tsx`, `Workflow.tsx`, `FiscalCalendar.tsx`) import types from their respective service files (`@services/api`) rather than from `@/types`. This is actually **correct** — service files define their own interfaces. However, `types/index.ts` contains no manufacturing types at all, meaning the central types file is incomplete for the manufacturing domain.

---

## 2. Backend Endpoints with No Frontend Page

### 2.1 Service Methods with No UI Coverage

| Service | Method(s) | Endpoint | Notes |
|---------|-----------|----------|-------|
| `forecast.service.ts` | `getChartData()` | `GET /forecasts/:id/chart-data` | No page calls this |
| `forecast.service.ts` | `getModelExplainability()` | `GET /forecasts/model-explainability` | Called in Forecasts.tsx but results just logged |
| `data.service.ts` | `getSyncStatus()`, `triggerSync()` | `GET/POST /data/sync` | No page provides sync UI |
| `data.service.ts` | `getAccounts()` | `GET /data/accounts` | No accounts page or tab |
| `settings.service.ts` | `getIntegrations()`, `updateIntegration()`, `testIntegration()` | `GET/PATCH/POST /settings/integrations` | Settings.tsx shows integration cards but doesn't wire up enable/disable to these endpoints — static display only |
| `settings.service.ts` | `getApiKeys()`, `revokeApiKey()` | `GET /settings/api-keys`, `DELETE /settings/api-keys/:id` | Settings.tsx can generate API keys but has no list/revoke UI |
| `settings.service.ts` | `exportAuditLogs()` | `GET /settings/audit-logs/export` | AuditLog.tsx has no export button |
| `user.service.ts` | `activate()`, `deactivate()` | `POST /users/:id/activate|deactivate` | Users.tsx has no activate/deactivate buttons |
| `user.service.ts` | `getActivity()` | `GET /users/:id/activity` | No user activity view |
| `user.service.ts` | `uploadAvatar()` | `POST /users/me/avatar` | Profile.tsx shows camera icon but doesn't implement upload |
| `report.service.ts` | `getMonthlyTrend()`, `getTrendComparison()`, `getDemandSupply()`, `getInventoryMetrics()`, `getForecastBias()`, `getABCAnalysis()` | Various `/reports/*` | Dashboard uses some, but Reports.tsx only generates 5 report types and doesn't surface these analytics |
| `report.service.ts` | `scheduleReport()` | `POST /reports/schedule` | useReports hook has `useScheduleReport` but no page calls it |
| `notification.service.ts` | `getUnreadCount()` | `GET /notifications/unread-count` | Hook exists (`useUnreadCount`) but Sidebar doesn't show badge count |
| `inventory.service.ts` | `getSummary()`, `getTurnover()` | `GET /manufacturing/inventory/summary|turnover` | Inventory.tsx shows summary cards from local data, doesn't call these |
| `inventory.service.ts` | `runABCClassification()`, `runXYZClassification()` | `POST /manufacturing/inventory/abc|xyz` | Hooks exist but no page triggers these |
| `capacity.service.ts` | `getCapacityPlan()`, `getAggregateCapacityPlan()`, `simulateLoadBalancing()` | Various | No UI for capacity planning or load balancing simulation |
| `mrp.service.ts` | `getRunRequirements()` | `GET /manufacturing/mrp/runs/:id/requirements` | No UI after an MRP run to view requirements |
| `mrp.service.ts` | `getMRPSummary()` | `GET /manufacturing/mrp/runs/:id/summary` | Hook exists but MRP page doesn't show run summary |
| `workflow.service.ts` | `resubmitWorkflow()`, `requestChanges()` | `POST /manufacturing/workflows/:id/resubmit|request-changes` | No UI buttons |
| `workflow.service.ts` | `getApproverWorkload()` | `GET /manufacturing/workflows/approver-workload` | Hook exists but Workflow.tsx doesn't show it |
| `npi.service.ts` | `compareNPIPerformance()`, `getLaunchCurveTypes()`, `getStatusTransitions()` | Various | No comparison UI, curve types and transitions are hardcoded clientside |
| `promotion.service.ts` | `getAdjustedForecast()`, `getPromotionCalendar()`, `getPromotionTypes()` | Various | No adjusted forecast overlay or calendar view |
| `sop.service.ts` | `copyForecastsFromCycle()`, `bulkUpsertForecasts()`, `deleteForecast()` | Various | SOP detail doesn't provide copy/bulk edit/delete forecast UI |
| `supplier.service.ts` | `getProductSuppliers()`, `compareSuppliers()`, `bulkLinkProducts()`, `linkProduct()`, `unlinkProduct()`, `setPrimarySupplier()`, `getSourcingSummary()` | Various | Supplier detail shows linked products but can't add/remove/compare from UI |
| `fiscal-calendar.service.ts` | `dateToFiscal()`, `datesToFiscal()`, `fiscalToDateRange()`, `getPeriodRange()`, `getFiscalYearSummary()`, `calculateWorkingDays()`, `getCalendarTypes()` | Various utility endpoints | No UI exposes these utility functions |
| `order-execution.service.ts` | `materialIssueService.*`, `mrpAdvancedService.*` (action messages, pegging, scheduled receipts) | Various | No page exists for material issues, MRP advanced features |

### 2.2 Hooks with No Page Consumers

| Hook | File | Notes |
|------|------|-------|
| `useEntityHistory()` | `useAuditNotifications.ts` | Exported but never called from any page |
| `useScheduleReport()` | `useReports.ts` | No page uses report scheduling |
| `useBOMComparison()` | `useBOM.ts` | No page triggers BOM comparison |
| `useCostRollup()` | `useBOM.ts` | No page triggers cost rollup |
| `useCapacityPlan()` | `useCapacity.ts` | If it exists (file truncated) — no usage |
| `useBulkFirmPlannedOrders()`, `useBulkReleasePlannedOrders()` | `useMRP.ts` | MRP page has no bulk action UI |
| `useCreatePlannedOrder()`, `useDeletePlannedOrder()` | `useMRP.ts` | MRP page doesn't allow manual order creation/deletion |
| `useInventoryLevelHistory()`, `useBulkUpsertInventoryLevels()` | `useInventory.ts` | No history chart or bulk import |
| `useCalculateSafetyStock()`, `useCalculateReorderPoint()`, `useCalculateEOQ()` | `useInventory.ts` | No calculation trigger UI |
| `useABCAnalysis()`, `useXYZAnalysis()`, `useTurnoverAnalysis()` | `useInventory.ts` | No analysis tab in Inventory page |

---

## 3. Frontend Pages Calling Non-Existent / Inconsistent Backends

### 3.1 Scenarios.tsx — Uses Raw `api` Instead of `scenarioService`

**File:** `pages/scenarios/Scenarios.tsx` (line 14)

```typescript
import { api, planService } from '@services/api';
```

All mutations use `api.post('/scenarios', ...)`, `api.put('/scenarios/...')`, `api.delete('/scenarios/...')` directly instead of `scenarioService`. This bypasses the service layer and means:
- If endpoint URLs change in `scenarioService`, Scenarios.tsx breaks silently
- Inconsistent error handling vs. other pages

### 3.2 Settings.tsx / Users.tsx / Profile.tsx — Use Raw `apiClient` Instead of Service

- **Settings.tsx** (line 13): `import { apiClient } from '@services/api'` — all 3 queries and mutations use `apiClient.get('/settings')`, `apiClient.patch('/settings')`, etc., bypassing `settingsService`
- **Users.tsx** (line 20): `import { apiClient } from '@services/api'` — bypasses `userService`
- **Profile.tsx** (line 11): `import { apiClient } from '@services/api'` — bypasses `userService` for profile update

### 3.3 ManufacturingDashboard — Calls Non-Standard Endpoint

**File:** `pages/manufacturing/ManufacturingDashboard.tsx` (line 66)

```typescript
const response = await apiClient.get('/manufacturing/dashboard');
```

This is a raw call — no `manufacturingDashboardService` exists. The endpoint `/manufacturing/dashboard` needs to exist on the backend. This is not covered by any service file.

### 3.4 Profile.tsx — Session Revocation Endpoint May Not Exist

**File:** `pages/settings/Profile.tsx` (line 127)

```typescript
await apiClient.delete(`/auth/sessions/${sessionId}`);
```

No `authService` method exists for session management. The sessions shown are locally detected (line 79-93), not fetched from server. The revoke button calls a potentially non-existent endpoint.

### 3.5 Login.tsx — SSO Buttons Are Non-Functional Stubs

**File:** `pages/auth/Login.tsx`

Google and GitHub SSO buttons exist in the UI but have no `onClick` handlers that call any backend endpoint. `authService` has no SSO methods.

---

## 4. Missing Form Validation

### 4.1 Pages Using Zod Validation (Good) ✅

| Page | Schema |
|------|--------|
| Login.tsx | `loginSchema` — email + password min 1 |
| Register.tsx | `registerSchema` — email, password strength, name, tenant |
| ForgotPassword.tsx | `forgotPasswordSchema` — email |
| ResetPassword.tsx | `resetPasswordSchema` — password strength + confirm |
| CreatePlan.tsx | `planSchema` — name, dates, planType, periodType |
| Settings.tsx | `settingsSchema` — comprehensive |
| Users.tsx | `userSchema` — email, name, role |
| Profile.tsx | `profileSchema` + `passwordSchema` |
| Dimensions.tsx | `dimensionSchema` — code, name |
| Reports.tsx | `reportSchema` for create/edit |
| Scenarios.tsx | Basic form but no zod schema |

### 4.2 Pages MISSING Validation ⚠️

| Page | Issue |
|------|-------|
| **BOM.tsx** | Form uses native `<form onSubmit>` with `FormData` — no Zod, no react-hook-form. `productId` validated only by empty check. No validation on dates, revision format |
| **MRP.tsx** | Run config uses local state, no validation. `planningHorizonDays` accepts any number, `frozenPeriodDays` has no min/max |
| **WorkOrders.tsx** | Create form uses raw FormData. No validation on quantity (could be 0 or negative), dates not validated for logical order |
| **PurchaseOrders.tsx** | Create form uses raw FormData. PO lines have no validation — quantity and price could be 0/negative. No supplier selection validation |
| **Capacity.tsx** | Work center form uses local state. `costPerHour` and `efficiencyPercent` have no Zod validation. Efficiency can exceed 100 via API |
| **Inventory.tsx** | Adjust/Transfer modals use raw FormData. Quantity not validated (could transfer negative amounts) |
| **Suppliers.tsx** | Form uses local state. No email format validation, no required field indicators beyond disabled button check |
| **Promotions.tsx** | Form uses local state. No validation that `endDate > startDate`, discount percent could be > 100 |
| **NPI.tsx** | Form uses local state. `peakForecastUnits` could be 0 or negative. Launch date not validated against ramp-up |
| **SOP.tsx** | Form uses local state. No validation on date ordering (demand review < supply review < executive meeting) |
| **Workflow.tsx** | Template/step forms use local state. Step order not validated for uniqueness or sequencing |
| **FiscalCalendar.tsx** | Period form uses local state. No validation that `endDate > startDate` or that periods don't overlap |
| **Scenarios.tsx** | Uses raw `api` calls with form state — no Zod or react-hook-form |

---

## 5. Missing Error / Loading / Empty States

### 5.1 Loading States

Most pages handle loading well via `isLoading` from `useQuery` and show spinners or skeleton UIs.

**Missing loading indicators:**
| Page | Issue |
|------|-------|
| **ManufacturingDashboard.tsx** | No loading state for `dashboardMetrics` query — shows `'—'` values on initial load instead of skeleton |
| **Scenarios.tsx** | Plans dropdown fetches asynchronously but no loading indicator while plans load |
| **Settings.tsx** | Initial settings fetch shows no skeleton — form renders with empty defaults before data arrives |

### 5.2 Error States

**Systemic issue:** Most pages only handle errors in mutations (via `onError` → `toast.error`). Query-level errors (e.g., 500 from server, network failure) are **not handled** — no error boundaries, no retry UI, no error message display.

| Page | Issue |
|------|-------|
| **All manufacturing pages** | No `isError` / `error` destructuring from useQuery. If API fails, page shows empty state instead of error message |
| **Dashboard.tsx** | 7+ queries — no error handling for any. If reportService fails, dashboard shows stale or empty data silently |
| **Forecasts.tsx** | Multiple queries without error handling |
| **PlanDetail.tsx** | Multiple queries without error handling |
| **Reports.tsx** | Multiple queries without error handling |

**Recommendation:** Add a global React Query error boundary or per-page error states.

### 5.3 Empty States

Most pages have `emptyMessage` props on `DataTable` and conditional renders which is good. Gaps:

| Page | Issue |
|------|-------|
| **ManufacturingDashboard.tsx** | Module cards always render even if all data fails — no "unable to load" state |
| **Dashboard.tsx** | Chart components render empty when no data rather than showing "No data available" messages |

---

## 6. Missing Pagination

### 6.1 Pages WITH Proper Pagination ✅

| Page | Implementation |
|------|---------------|
| Plans.tsx | Manual pagination state (page, pageSize), prev/next buttons |
| Actuals.tsx | TanStack Table with `pageSize: 50` and pagination UI |
| AuditLog.tsx | `page` state + pagination controls |
| Notifications.tsx | `page` state + pagination controls |

### 6.2 Pages MISSING Pagination ⚠️

| Page | Issue |
|------|-------|
| **BOM.tsx** | Fetches `pageSize: 100` — no pagination UI. Large BOM lists truncated |
| **MRP.tsx** | Fetches `pageSize: 20` for runs/orders/exceptions — no page controls to see beyond first 20 |
| **Capacity.tsx** | Fetches `pageSize: 100` for work centers — no pagination |
| **Inventory.tsx** | Fetches `pageSize: 50` for policies/levels, `limit: 100` for transactions — no pagination |
| **Suppliers.tsx** | Fetches `pageSize: 100` — no pagination |
| **Promotions.tsx** | Fetches `pageSize: 100` — no pagination |
| **NPI.tsx** | Fetches `pageSize: 100` — no pagination |
| **SOP.tsx** | Fetches `pageSize: 100` — no pagination |
| **Workflow.tsx** | Fetches `pageSize: 100` for templates/instances — no pagination |
| **FiscalCalendar.tsx** | No pageSize in calendar query — loads all |
| **WorkOrders.tsx** | No pageSize — loads all work orders |
| **PurchaseOrders.tsx** | No pageSize — loads all POs |
| **Forecasts.tsx** | No pagination for forecast list or model results |
| **Scenarios.tsx** | No pagination |
| **Dimensions.tsx** | No pagination |
| **ProductMaster.tsx** | Custom DataTable but unclear if paginated |
| **Reports.tsx** (saved reports) | No pagination for saved reports list |
| **Users.tsx** | Fetches all users with search — no pagination |
| **Dashboard.tsx** | N/A (dashboard KPIs) |
| **Settings.tsx** | N/A (single tenant settings) |

---

## 7. Dead / Unreachable Code

### 7.1 Dead Types in `types/index.ts`

| Type | Line | Issue |
|------|------|-------|
| `Plan` | 469 | Duplicate of `PlanVersion` — never imported by any page |
| `Role` | 454 | Lowercase version — backend uses `UserRole` (UPPERCASE). Never imported |
| `Assumption` | ~430 | Defined but never imported by any page (PlanDetail handles assumptions inline) |
| `ImportTemplate`, `ImportColumn` | ~360-380 | Defined but DataImport.tsx doesn't use these types (uses service response directly) |
| `ApiResponse<T>` | ~415 | Generic wrapper — services return unwrapped data, never used |
| `ApiError` | ~425 | Defined but pages extract errors manually from axios responses |

### 7.2 Dead Exports in `pages/index.ts`

`ManufacturingDashboard` is exported from `pages/index.ts` (line 43) but `App.tsx` imports it via `ManufacturingRoutes` → `ManufacturingDashboard.tsx` internal routing, not from the barrel export.

### 7.3 `ProductMaster` NOT in `pages/index.ts`

`App.tsx` (line 129) renders `<ProductMaster />` at `/data/products` but `pages/index.ts` does NOT export `ProductMaster`. The import in App.tsx must come from a direct path import, or this route is broken.

### 7.4 Unused Service Aliases

**File:** `services/api/index.ts`

```typescript
export { forecastService as forecastsService } from './forecast.service';
export { planService as plansService } from './plan.service';
export { reportService as reportsService } from './report.service';
export { scenarioService as scenariosService } from './scenario.service';
export { userService as usersService } from './user.service';
```

These plural aliases (`forecastsService`, `plansService`, etc.) should be verified — if no file imports the plural form, they're dead code.

### 7.5 `settingsService` — Defined But Bypassed

`settings.service.ts` exports `settingsService` with methods like `getSettings()`, `updateSettings()`, `getApiKeys()`, `createApiKey()`, etc. However, **Settings.tsx uses `apiClient` directly**, completely bypassing the service. The service file is dead code.

Similarly:
- `userService` methods like `invite()`, `activate()`, `deactivate()`, `getProfile()`, `updateProfile()`, `changePassword()`, `uploadAvatar()` are **never called** because `Users.tsx` and `Profile.tsx` use `apiClient` directly.

### 7.6 `useSettings` / `useUsers` Hooks — Partially Dead

- `useSettings.ts` exports `useSettings`, `useUpdateSettings`, `useApiKeys`, `useCreateApiKey`, `useRevokeApiKey`, `useAuditLogs`, `useExportAuditLogs`, `useIntegrations`, `useUpdateIntegration`
- **None of these are used** by Settings.tsx (which uses `apiClient` directly) or by any other page
- Similarly `useUsers.ts` exports are unused — Users.tsx bypasses them

---

## 8. Service Layer Issues

### 8.1 Inconsistent HTTP Client Usage

| Pattern | Files |
|---------|-------|
| Uses `api` helper (auto-unwrap `.data`) | `auth.service.ts`, `plan.service.ts`, `scenario.service.ts` |
| Uses `apiClient` (raw axios) | All other services (20+ files) |

The `api` helper (defined in `client.ts` lines 100-138) auto-extracts `.data` from axios responses. Services using `apiClient` must manually access `.data`. This inconsistency means:
- Services using `apiClient` return `AxiosResponse` wrapped data
- Services using `api` return unwrapped data
- Consumers (hooks/pages) must know which pattern each service uses

### 8.2 `order-execution.service.ts` — Monolith

This single 511-line file exports 9 sub-services: `purchaseOrderService`, `goodsReceiptService`, `workOrderService`, `operationService`, `materialIssueService`, `productionCompletionService`, `laborEntryService`, `inventoryTransactionService`, `mrpAdvancedService`. Each should be its own file for maintainability.

---

## 9. Router & Navigation Issues

### 9.1 Sidebar Links vs. Actual Routes

**Sidebar item:** Notifications → `/notifications`  
**App.tsx route:** `<Route path="/notifications" element={<Notifications />} />`  
**Status:** ✅ Matches

**Sidebar Manufacturing sub-items** all route to `/manufacturing/*` which delegates to `ManufacturingRoutes`. All 13 sidebar items have matching routes. ✅

### 9.2 Missing 404 for Manufacturing Sub-Routes

`ManufacturingRoutes.tsx` has a catch-all: `<Route path="*" element={<ManufacturingDashboard />} />` — this means invalid manufacturing URLs (like `/manufacturing/xyz`) render the dashboard instead of 404. This is a design choice but may hide navigation bugs.

### 9.3 `ProductMaster` Route Exists But Not in Barrel Export

`App.tsx` line 129: `/data/products` → `<ProductMaster />`  
`pages/index.ts`: Missing export for `ProductMaster`  
This means `App.tsx` must import `ProductMaster` directly, not via the barrel. Should be added to `pages/index.ts` for consistency.

---

## 10. Hook Issues

### 10.1 Hooks That Don't Use Their Corresponding Service

| Hook | Service Used | Note |
|------|------------|------|
| `useSettings` | `settingsService` | ✅ Correct, but **no page calls it** |
| `useUsers` | `userService` | ✅ Correct, but **no page calls it** |
| `useReports` | `reportService` | ✅ Pages use these hooks |
| `useForecasts` | `forecastService` | ✅ Most hooks used |
| `usePlans` | `planService` | ✅ Most hooks used |

### 10.2 Missing Hooks for Order Execution

No hooks exist for:
- `workOrderService` (pages use `useMutation`/`useQuery` directly)
- `purchaseOrderService` (pages use direct queries)
- `laborEntryService`
- `productionCompletionService`
- `goodsReceiptService`
- `inventoryTransactionService`

Manufacturing dashboard imports from `../../hooks` but WorkOrders.tsx, PurchaseOrders.tsx, and Inventory.tsx make direct service calls inline.

### 10.3 Query Key Inconsistency

Some pages define their own query keys that don't match the hook patterns:

- **BOM.tsx**: `['manufacturing', 'boms', ...]` while `useBOM.ts` uses `['boms', ...]`
- **MRP.tsx**: `['manufacturing', 'mrp', ...]` while `useMRP.ts` uses `['mrp', ...]`
- **Capacity.tsx**: `['manufacturing', 'capacity', ...]` while `useCapacity.ts` uses `['capacity', ...]`

**Impact:** Cache invalidation from hooks won't affect page queries and vice versa. If `useDeleteBOM()` invalidates `['boms', 'list']` but BOM.tsx uses `['manufacturing', 'boms', ...]`, the list won't refresh.

---

## 11. Auth Store Issues

### 11.1 Token Storage in localStorage

`stores/auth.store.ts` uses Zustand `persist` middleware with `localStorage`. Tokens (access + refresh) are stored in plain localStorage — vulnerable to XSS. Consider `httpOnly` cookies for production.

### 11.2 `checkAuth` Race Condition

The store calls `checkAuth()` on initialization if tokens exist. If the token is expired, it calls `refreshToken()`, which calls `authService.refreshToken()`. If this fails (e.g., refresh token also expired), it calls `logout()`. However, during this async flow, the app may render protected routes briefly with stale `isAuthenticated = true`.

---

## 12. Miscellaneous Issues

### 12.1 Scenarios.tsx Uses Types But Calls Raw API

**File:** `pages/scenarios/Scenarios.tsx` (line 1, 14)

```typescript
import type { PlanVersion, Scenario } from '@/types';
import { api, planService } from '@services/api';
```

Imports `Scenario` type but manually constructs API calls with `api.post('/scenarios', data)`. Should use `scenarioService.create(data)` for consistency.

### 12.2 Large Component Files

Several pages exceed 500 lines and should be decomposed:

| File | Lines | Recommendation |
|------|-------|---------------|
| Dashboard.tsx | 1,918 | Extract chart sections, KPI cards into components |
| Forecasts.tsx | 1,275 | Extract model selection, accuracy panel, backtest panel |
| PlanDetail.tsx | 1,083 | Extract scenario list, forecast section, approval actions |
| Reports.tsx | 1,050 | Extract report builder, chart renderers |
| CreatePlan.tsx | 787 | Multi-step wizard is OK but step components could be extracted |
| Dimensions.tsx | 717 | Extract per-dimension-type tabs |
| Settings.tsx | 671 | Extract tab panels (General, Appearance, Notifications, Security, Integrations) |
| Actuals.tsx | 588 | Manageable |
| WorkOrders.tsx | 593 | Extract modals |
| PurchaseOrders.tsx | 558 | Extract modals |
| Users.tsx | 517 | Extract modal form |
| Profile.tsx | 517 | Extract security tab |

### 12.3 `any` Type Usage

Many manufacturing pages use liberal `any` casts:

- `WorkOrders.tsx`: `const users: any[] = usersData?.data || [];`
- `Capacity.tsx`: `accessor: (r: any) => ...` in multiple column definitions  
- `ManufacturingDashboard.tsx`: `(exceptions as any)?.items ?? []`
- All pages with `onError: (err: any) => ...`

### 12.4 `confirm()` / `prompt()` Usage

Multiple manufacturing pages use browser `confirm()` and `prompt()` for delete confirmations and input:

- `BOM.tsx`: `prompt('Enter new revision number:')` for copy
- `WorkOrders.tsx`: `prompt('Enter cancellation reason')` for cancel
- `PurchaseOrders.tsx`: `prompt('Enter cancellation reason')` for cancel
- `Suppliers.tsx`: `confirm('Delete this supplier?')`
- `Promotions.tsx`: `confirm('Delete?')`
- `NPI.tsx`: `confirm('Delete?')`, `confirm('Convert to product?')`
- `SOP.tsx`: `confirm('Delete?')`
- `Workflow.tsx`: `confirm('Delete?')`
- `FiscalCalendar.tsx`: `confirm('Delete this calendar and all its periods?')`

These should be replaced with proper confirmation modals for better UX and accessibility.

### 12.5 Missing `key` Props in Some Lists

Review needed — dynamic lists in manufacturing dashboard module cards and metric renders should verify unique `key` props.

---

## Summary of Severity

| Category | Critical | High | Medium | Low |
|----------|----------|------|--------|-----|
| Type mismatches | 0 | 2 | 2 | 2 |
| Missing backend coverage | 0 | 5 | 15 | 10+ |
| Calling non-existent backends | 1 | 3 | 2 | 0 |
| Missing validation | 0 | 5 | 8 | 0 |
| Missing error states | 0 | 1 (systemic) | 0 | 0 |
| Missing pagination | 0 | 8 | 7 | 0 |
| Dead code | 0 | 3 | 8 | 5+ |
| Service layer issues | 0 | 2 | 1 | 0 |
| Query key mismatch | 0 | 3 | 0 | 0 |

**Top Priority Fixes:**
1. **Query key mismatch** between hooks and pages (BOM, MRP, Capacity, etc.) — causes stale data
2. **Settings/Users/Profile pages bypass service layer** — fragile, inconsistent
3. **Scenarios.tsx raw API usage** — should use service
4. **Missing form validation** in all manufacturing pages
5. **Missing pagination** in 15+ pages
6. **Dead `useSettings`/`useUsers` hooks and `settingsService`/`userService`** — clean up or wire in
7. **Missing error state handling** across all pages
