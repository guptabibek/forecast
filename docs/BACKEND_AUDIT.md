# Backend API Comprehensive Audit Report

**Date:** 2025-01-XX  
**Scope:** `apps/api/` — NestJS + Prisma backend  
**Schema:** 2,275 lines, ~55 models, ~20 enums  
**Manufacturing Service:** 6,163 lines (largest file)

---

## Table of Contents

1. [Auth Module](#1-auth-module)
2. [Users Module](#2-users-module)
3. [Plans Module](#3-plans-module)
4. [Scenarios Module](#4-scenarios-module)
5. [Forecasts Module](#5-forecasts-module)
6. [Data Module](#6-data-module)
7. [Reports Module](#7-reports-module)
8. [Settings Module](#8-settings-module)
9. [Manufacturing Module](#9-manufacturing-module)
10. [Workflow (Core)](#10-workflow-core-module)
11. [Cross-Cutting Issues](#11-cross-cutting-issues)

---

## 1. Auth Module

### Endpoints
| Method | Path | Description |
|--------|------|-------------|
| POST | `/auth/register` | Register new tenant + admin user |
| POST | `/auth/login` | Login |
| POST | `/auth/refresh` | Refresh JWT tokens |
| POST | `/auth/logout` | Logout |
| GET | `/auth/me` | Get current user |
| POST | `/auth/change-password` | Change password |
| POST | `/auth/forgot-password` | Request password reset |
| POST | `/auth/reset-password` | Reset password with token |

### Service Methods
`register`, `login`, `refreshToken`, `logout`, `changePassword`, `requestPasswordReset`, `resetPassword`, `getCurrentUser`, `generateTokens` (private), `handleFailedLogin` (private)

### Prisma Models Used
`Tenant`, `User`, `RefreshToken`, `PasswordResetToken`

### TODOs / Stubs
| Location | Issue |
|----------|-------|
| `auth.service.ts:290` | `// TODO: Send reset email via email service` — password reset token is created but **no email is actually sent** |
| `auth.controller.ts` | Tenant detection falls back to `'demo'` tenant in non-production — silent security risk |

### Gaps
- **No rate limiting on login/register** — ThrottlerModule is global but auth endpoints at `/auth/*` are not excluded from middleware yet have no per-route throttle override for brute-force protection.
- **`forgot-password` always returns success** — does not reveal whether the email exists (good) but also never sends an email (bad).
- **No email verification flow** — users are created as active immediately.
- **Refresh token rotation** — tokens are stored but old tokens are not invalidated on refresh (potential replay).

---

## 2. Users Module

### Endpoints
| Method | Path | Description |
|--------|------|-------------|
| POST | `/users/invite` | Invite a user |
| GET | `/users` | List users |
| GET | `/users/me` | Get own profile |
| PATCH | `/users/me` | Update own profile |
| GET | `/users/:id` | Get user by ID |
| PATCH | `/users/:id` | Update user |
| DELETE | `/users/:id` | Delete user |
| POST | `/users/:id/deactivate` | Deactivate user |
| POST | `/users/:id/activate` | Activate user |
| POST | `/users/:id/resend-invite` | Resend invitation |
| GET | `/users/:id/activity` | Get user activity |
| POST | `/users/profile/change-password` | Change password |
| POST | `/users/profile/avatar` | Upload avatar |

### Service Methods
`invite`, `findAll`, `findOne`, `update`, `updateProfile`, `remove`, `deactivate`, `activate`, `findByEmail`, `updateLastLogin`, `incrementFailedLogin`, `changePassword`

### Prisma Models Used
`User`

### TODOs / Stubs
| Location | Issue |
|----------|-------|
| `users.service.ts:57` | `// TODO: Send invitation email` — invite creates user but **never sends an email** |
| `users.controller.ts` `resend-invite` | **STUB** — returns `{ message: 'Invitation resent' }` without doing anything |
| `users.controller.ts` `getActivity` | **STUB** — returns `{ data: [], total: 0 }` always |
| `users.controller.ts` `uploadAvatar` | **STUB** — returns placeholder URL, no file handling |

### Gaps
- **No `resendInvite` method in service** — controller handles it inline with a fake response.
- **No `getActivity` method in service** — controller returns empty array.
- **No `uploadAvatar` method in service** — controller returns hardcoded URL.
- **Missing `unlock` endpoint** — users can be deactivated/activated but there's no account lockout unlock (separate from activate).
- **No pagination on `findAll`** — `UserQueryDto` exists but service may not implement limit/offset properly.

---

## 3. Plans Module

### Endpoints
| Method | Path | Description |
|--------|------|-------------|
| POST | `/plans` | Create plan |
| GET | `/plans` | List plans |
| GET | `/plans/:id` | Get plan |
| PATCH | `/plans/:id` | Update plan |
| DELETE | `/plans/:id` | Delete plan |
| POST | `/plans/:id/clone` | Clone plan |
| POST | `/plans/:id/submit` | Submit for approval |
| POST | `/plans/:id/approve` | Approve plan |
| POST | `/plans/:id/reject` | Reject plan |
| POST | `/plans/:id/archive` | Archive plan |
| POST | `/plans/:id/lock` | Lock plan |
| POST | `/plans/:id/unlock` | Unlock plan |
| GET | `/plans/:id/versions` | Get version history |
| GET | `/plans/:id/export` | Export plan |

### Service Methods
`create`, `findAll`, `findOne`, `update`, `remove`, `clone`, `submit`, `approve`, `reject`, `lock`, `unlock`, `archive`, `getVersionHistory`

### Prisma Models Used
`PlanVersion`, `Scenario`, `Forecast`, `AuditLog`

### TODOs / Stubs
| Location | Issue |
|----------|-------|
| `plans.controller.ts` `exportPlan` | **STUB** — returns `{ data: plan, format, exportedAt }` with no actual file generation |

### Gaps
- **No `exportPlan` method in service** — controller calls `findOne` and wraps it. No CSV/Excel/PDF export.
- **`archive`** — service exists but may not check for dependent forecasts/scenarios before archiving.
- Validation is good — uses `CreatePlanDto`, `UpdatePlanDto`, `PlanQueryDto`, `ParseUUIDPipe`.

---

## 4. Scenarios Module

### Endpoints
| Method | Path | Description |
|--------|------|-------------|
| POST | `/scenarios` | Create scenario |
| GET | `/scenarios/compare` | Compare scenarios |
| GET | `/scenarios` | List scenarios |
| GET | `/scenarios/:id` | Get scenario |
| PATCH | `/scenarios/:id` | Update scenario |
| DELETE | `/scenarios/:id` | Delete scenario |
| POST | `/scenarios/:id/clone` | Clone scenario |
| POST | `/scenarios/:id/submit` | Submit for approval |
| POST | `/scenarios/:id/approve` | Approve |
| POST | `/scenarios/:id/reject` | Reject |
| POST | `/scenarios/:id/lock` | Lock |
| POST | `/scenarios/:id/set-baseline` | Set as baseline |

### Service Methods
`create`, `findAll`, `findOne`, `update`, `remove`, `submit`, `approve`, `reject`, `lock`, `clone`, `compare`, `setBaseline`

### Prisma Models Used
`Scenario`, `Forecast`, `ForecastResult`, `AuditLog`

### TODOs / Stubs
None found.

### Gaps
- **No `unlock` endpoint** — plans have lock/unlock, but scenarios only have lock. Inconsistent.
- **No `archive` endpoint** — plans have archive, scenarios do not. Inconsistent workflow.
- Proper DTOs used (`CreateScenarioDto`, `UpdateScenarioDto`). Good.

---

## 5. Forecasts Module

### Endpoints
| Method | Path | Description |
|--------|------|-------------|
| POST | `/forecasts/generate` | Generate forecasts |
| POST | `/forecasts` | Create forecast config |
| GET | `/forecasts` | List forecasts |
| GET | `/forecasts/models` | List available models |
| GET | `/forecasts/:id` | Get forecast |
| PATCH | `/forecasts/:id` | Update forecast |
| DELETE | `/forecasts/:id` | Delete forecast |
| GET | `/forecasts/data/:pvId/:sId` | Get forecast data |
| POST | `/forecasts/:id/run` | Run forecast |
| GET | `/forecasts/plan-version/:pvId` | Get by plan version |
| GET | `/forecasts/compare` | Compare forecasts |
| POST | `/forecasts/overrides` | Request override |
| POST | `/forecasts/overrides/:id/approve` | Approve override |
| POST | `/forecasts/overrides/:id/reject` | Reject override |
| POST | `/forecasts/reconcile` | Reconcile forecast |
| POST | `/forecasts/reconciliations/:id/approve` | Approve reconciliation |
| POST | `/forecasts/reconciliations/:id/reject` | Reject reconciliation |
| GET | `/forecasts/accuracy/:pvId/:sId` | Accuracy metrics |
| GET | `/forecasts/chart-data/:pvId/:sId` | Chart data |
| GET | `/forecasts/accuracy-detailed/:pvId/:sId` | Enhanced accuracy |
| GET | `/forecasts/backtest/:pvId/:sId` | Backtest |
| GET | `/forecasts/models/explainability` | Model explainability |
| GET | `/forecasts/primary/:pvId/:sId` | Get primary forecast |
| POST | `/forecasts/primary` | Set primary forecast |
| POST | `/forecasts/primary/auto` | Auto-select primary |

### Service Methods
`generateForecasts`, `create`, `findAll`, `findOne`, `getForecastData`, `runForecast`, `getByPlanVersion`, `compare`, `getAccuracyMetrics`, `update`, `remove`, `requestOverride`, `approveOverride`, `rejectOverride`, `reconcileForecastRun`, `approveReconciliation`, `rejectReconciliation`, `getAggregatedChartData`, `getEnhancedAccuracyMetrics`, `runBacktest`, `setPrimaryForecast`, `autoSelectPrimaryForecast`, `getPrimaryForecast`, `getAvailableModels`, `getModelExplainability`

### Prisma Models Used
`Forecast`, `ForecastJob`, `ForecastRun`, `ForecastResult`, `ForecastOverride`, `ForecastReconciliation`, `Assumption`, `Actual`, `Product`, `Location`, `TimeBucket`, `FxRate`

### TODOs / Stubs
| Location | Issue |
|----------|-------|
| `forecasts.service.ts:2006` | `value=0 as a placeholder` — primary forecast stored with 0 value and model name in description field (schema abuse) |

### Gaps
- **`getModelExplainability`** is likely hardcoded/static — returns model feature importance without real SHAP/LIME analysis.
- Proper DTOs used throughout. Well-structured module.
- Controller-to-service alignment is clean — all controller methods map to existing service methods.

---

## 6. Data Module

### Endpoints
| Method | Path | Description |
|--------|------|-------------|
| POST | `/data/import` | Import file (CSV upload) |
| GET | `/data/imports` | Import history |
| GET | `/data/imports/:id` | Import status |
| GET | `/data/templates/:type/info` | Template info |
| GET | `/data/templates/:type` | Download template CSV |
| GET | `/data/actuals` | Get actuals |
| GET | `/data/actuals/summary` | Actuals summary |
| DELETE | `/data/actuals` | Delete actuals |
| GET | `/data/dimensions/:type` | List dimensions |
| GET | `/data/dimensions/:type/hierarchy` | Dimension hierarchy |
| POST | `/data/dimensions/:type` | Create dimension |
| GET | `/data/dimensions/:type/:id` | Get dimension |
| PATCH | `/data/dimensions/:type/:id` | Update dimension |
| DELETE | `/data/dimensions/:type/:id` | Delete dimension |
| DELETE | `/data/imports/:id` | Cancel import |
| GET | `/data/sync-status` | Sync status |
| POST | `/data/sync` | Trigger sync |

### Service Methods
`importFile`, `getImportHistory`, `getImportStatus`, `getActuals`, `getActualsSummary`, `deleteActuals`, `getDimensions`, `getDimensionHierarchy`, `createDimension`, `getDimension`, `updateDimension`, `deleteDimension`, `getImportTemplateInfo`, `generateTemplate`

### Prisma Models Used
`DataImport`, `MappingTemplate`, `Actual`, `Product`, `Location`, `Customer`, `Account`, `CostCenter`

### TODOs / Stubs
| Location | Issue |
|----------|-------|
| `data.controller.ts` `cancelImport` | **STUB** — checks if import is PENDING and returns fake cancel message; **does not actually update the status in DB** |
| `data.controller.ts` `triggerSync` | **STUB** — returns `{ jobId: randomUUID(), status: 'queued' }` with no actual sync job created |
| `data.controller.ts` `syncStatus` | **STUB** — returns fake response aggregated from import history |

### Gaps
- **No `cancelImport` method in service** — controller handles it inline with fake logic.
- **No sync infrastructure** — `triggerSync` and `syncStatus` endpoints exist but have zero backend implementation.
- **`deleteImport`** is missing — `DELETE /data/imports/:id` calls `cancelImport` but doesn't actually delete the import record.
- **No validation on file uploads** — file size/type validation may be missing at the controller level.

---

## 7. Reports Module

### Endpoints
| Method | Path | Description |
|--------|------|-------------|
| GET | `/reports/dashboard/stats` | Dashboard stats |
| GET | `/reports/dashboard/forecast-trend` | Forecast trend |
| GET | `/reports/dashboard/model-accuracy` | Model accuracy comparison |
| GET | `/reports/dashboard/activity` | Recent activity |
| GET | `/reports/dashboard/revenue` | Revenue metrics |
| GET | `/reports/dashboard/top-products` | Top products |
| GET | `/reports/dashboard/regional` | Regional breakdown |
| GET | `/reports/dashboard/variance-alerts` | Variance alerts |
| GET | `/reports/dashboard/forecast-health` | Forecast health |
| GET | `/reports/dashboard/monthly-trend` | Monthly trend comparison |
| GET | `/reports/dashboard/demand-supply` | Demand-supply analysis |
| GET | `/reports/dashboard/inventory-metrics` | Inventory metrics |
| GET | `/reports/dashboard/forecast-bias` | Forecast bias |
| GET | `/reports/dashboard/abc-analysis` | ABC analysis |
| GET | `/reports/summary` | Summary report |
| GET | `/reports` | List reports |
| POST | `/reports` | Create report |
| GET | `/reports/:id` | Get report |
| GET | `/reports/:id/data` | Get report data |
| PATCH | `/reports/:id` | Update report |
| DELETE | `/reports/:id` | Delete report |
| POST | `/reports/variance` | Variance report |
| POST | `/reports/trend` | Trend report |
| POST | `/reports/comparison` | Comparison report |
| POST | `/reports/accuracy` | Accuracy report |
| POST | `/reports/dimension` | Dimension report |
| POST | `/reports/save` | Save report |
| POST | `/reports/export` | Export report |
| POST | `/reports/schedule` | Schedule report |

### Service Methods
`getReports`, `createReport`, `getReportById`, `getReportData`, `updateReport`, `deleteReport`, `getDashboardStats`, `getForecastTrend`, `getModelAccuracyComparison`, `getRecentActivity`, `getRevenueMetrics`, `getTopProducts`, `getRegionalBreakdown`, `getVarianceAlerts`, `getForecastHealthMetrics`, `getMonthlyTrendComparison`, `getTrendComparison`, `getDemandSupplyAnalysis`, `getInventoryMetrics`, `getForecastBiasAnalysis`, `getABCAnalysis`, `generateSummaryReport`, `generateVarianceReport`, `generateDimensionReport`, `saveReport`, `exportReport`, `scheduleReport`

### Prisma Models Used
`Report`, `Actual`, `ForecastResult`, `ForecastRun`, `Product`, `Location`, `AuditLog`, `InventoryLevel`, `InventoryPolicy`

### TODOs / Stubs
None explicitly marked, but:

| Location | Issue |
|----------|-------|
| `exportReport` | Likely returns JSON object, **not an actual file download** |
| `scheduleReport` | **No scheduling infrastructure** — no cron/queue integration for scheduled reports |

### Gaps
- **`exportReport`** does not generate actual CSV/PDF files.
- **`scheduleReport`** has no backing scheduler (no BullMQ job, no cron).
- Controller-to-service alignment is clean — all 29 controller calls map to existing service methods.
- Good use of DTOs (`DashboardFilterDto`, `SaveReportDto`, `ExportReportDto`, `GenerateReportDto`, `ScheduleReportDto`, `ABCAnalysisDto`).

---

## 8. Settings Module

### Endpoints
| Method | Path | Description |
|--------|------|-------------|
| GET | `/settings` | Get settings |
| PATCH | `/settings` | Update settings |
| GET | `/settings/domains` | List domain mappings |
| POST | `/settings/domains` | Add domain mapping |
| DELETE | `/settings/domains/:id` | Remove domain mapping |
| POST | `/settings/domains/:id/verify` | Verify domain |
| GET | `/settings/audit-logs` | Get audit logs |
| GET | `/settings/audit-logs/export` | Export audit logs |
| GET | `/settings/api-keys` | List API keys |
| POST | `/settings/api-keys` | Create API key |
| DELETE | `/settings/api-keys/:id` | Revoke API key |
| GET | `/settings/integrations` | List integrations |
| PATCH | `/settings/integrations/:id` | Update integration |
| POST | `/settings/integrations/:id/test` | Test integration |

### Service Methods
`getSettings`, `updateSettings`, `getDomainMappings`, `addDomainMapping`, `removeDomainMapping`, `verifyDomain`, `getAuditLogs`

### Prisma Models Used
`Tenant`, `DomainMapping`, `AuditLog`

### TODOs / Stubs — **MAJOR**
| Location | Issue |
|----------|-------|
| `settings.controller.ts:109` `getApiKeys` | **COMPLETE STUB** — returns `{ data: [], total: 0 }`. No `ApiKey` model exists in schema. |
| `settings.controller.ts:119` `createApiKey` | **COMPLETE STUB** — returns fake `{ id, key: 'fsk_...', name, createdAt, expiresAt }`. No DB write. |
| `settings.controller.ts:137` `revokeApiKey` | **COMPLETE STUB** — returns `{ message: 'API key revoked' }`. No DB operation. |
| `settings.controller.ts:145` `getIntegrations` | **COMPLETE STUB** — returns `{ data: [], total: 0 }`. No `Integration` model exists in schema. |
| `settings.controller.ts:156` `updateIntegration` | **COMPLETE STUB** — returns fake updated object. No DB operation. |
| `settings.controller.ts:163` `testIntegration` | **COMPLETE STUB** — returns `{ success: true }`. No actual connection test. |

### Gaps
- **6 endpoints are complete fakes** — api-keys and integrations have zero backing infrastructure.
- **No `ApiKey` model in Prisma schema** — entire API key management feature is missing.
- **No `Integration` model in Prisma schema** — entire integration management feature is missing.
- **`verifyDomain`** — service method exists but likely does only a DB update, no actual DNS verification.
- **No `exportAuditLogs` method in service** — controller calls `getAuditLogs(user, 1, 10000)` and wraps it. No actual CSV/file export.

---

## 9. Manufacturing Module

### Overview
**This is the largest module**: 1,935-line controller + 6,163-line service. It covers BOM, capacity planning, inventory, MRP, suppliers, promotions, NPI, workflows, S&OP, fiscal calendars, purchase orders, goods receipts, work orders, material tracking, labor, and inventory transactions.

### CRITICAL: Zero Validation DTOs
**Every single `@Body()` parameter in the manufacturing controller is typed as `any`.**

```typescript
// Example from every endpoint:
@Body() dto: any
```

This means:
- **No request validation whatsoever** on ~150 endpoints
- No Swagger/OpenAPI schema generation for request bodies
- Any malformed request passes through to the service layer
- Prisma will throw raw database errors instead of clean validation errors

### Endpoints (150+ total, grouped by domain)

#### BOM Management
| Method | Path | Duplicate? |
|--------|------|-----------|
| GET | `/manufacturing/boms` | |
| POST | `/manufacturing/boms` | |
| GET | `/manufacturing/boms/:id` | |
| GET | `/manufacturing/boms/:id/explode` | |
| PUT | `/manufacturing/boms/:id/status` | |
| GET | `/manufacturing/bom` | **v2 duplicate** |
| POST | `/manufacturing/bom` | **v2 duplicate** |
| PUT | `/manufacturing/bom/:id` | **v2 duplicate** |
| DELETE | `/manufacturing/bom/:id` | **v2 duplicate** |
| POST | `/manufacturing/bom/:id/components` | |
| PUT | `/manufacturing/bom/:id/components/:componentId` | |
| DELETE | `/manufacturing/bom/:id/components/:componentId` | |
| GET | `/manufacturing/bom/:id/cost-rollup` | |
| GET | `/manufacturing/bom/where-used/:productId` | |
| POST | `/manufacturing/bom/:id/copy` | |
| GET | `/manufacturing/bom/compare/:bomId1/:bomId2` | |

**Gap**: Two completely separate endpoint trees for BOMs (`/boms` and `/bom`). The `/boms` v1 endpoints and `/bom` v2 endpoints coexist with no deprecation markers.

#### Capacity Planning
| Method | Path |
|--------|------|
| GET/POST | `/manufacturing/work-centers` |
| GET/PUT/DELETE | `/manufacturing/work-centers/:id` |
| PUT | `/manufacturing/work-centers/:id/toggle-status` |
| GET/POST | `/manufacturing/capacities` |
| GET/PUT/DELETE | `/manufacturing/capacities/:id` |
| GET/POST | `/manufacturing/shifts` |
| PUT/DELETE | `/manufacturing/shifts/:id` |
| GET | `/manufacturing/utilization` |
| GET | `/manufacturing/bottlenecks` |
| POST | `/manufacturing/simulate-load-balancing` |
| GET/POST | `/manufacturing/capacity-plans` |
| GET | `/manufacturing/capacity-plans/aggregate` |

#### Inventory Planning
| Method | Path |
|--------|------|
| GET/POST | `/manufacturing/inventory/policies` |
| GET | `/manufacturing/inventory/policies/v2` |
| GET/PUT/DELETE | `/manufacturing/inventory/policies/:id` |
| GET/POST | `/manufacturing/inventory/levels` |
| GET/PUT | `/manufacturing/inventory/levels/:id` |
| GET | `/manufacturing/inventory/calculate/safety-stock` |
| GET | `/manufacturing/inventory/calculate/reorder-point` |
| GET | `/manufacturing/inventory/calculate/eoq` |
| POST | `/manufacturing/inventory/classification/abc` |
| POST | `/manufacturing/inventory/classification/xyz` |
| GET | `/manufacturing/inventory/summary` |
| GET | `/manufacturing/inventory/turnover` |

#### MRP
| Method | Path |
|--------|------|
| GET/POST | `/manufacturing/mrp/runs` |
| GET | `/manufacturing/mrp/runs/:id` |
| POST | `/manufacturing/mrp/runs/:id/execute` |
| GET | `/manufacturing/mrp/runs/:id/requirements` |
| GET/POST | `/manufacturing/mrp/planned-orders` |
| GET/PUT/DELETE | `/manufacturing/mrp/planned-orders/:id` |
| POST | `/manufacturing/mrp/planned-orders/:id/firm` |
| POST | `/manufacturing/mrp/planned-orders/:id/release` |
| POST | `/manufacturing/mrp/planned-orders/:id/cancel` |
| POST | `/manufacturing/mrp/planned-orders/bulk-update` |
| GET | `/manufacturing/mrp/exceptions` |
| POST | `/manufacturing/mrp/exceptions/:id/acknowledge` |
| POST | `/manufacturing/mrp/exceptions/:id/resolve` |
| POST | `/manufacturing/mrp/exceptions/:id/ignore` |
| GET | `/manufacturing/mrp/summary` |
| GET | `/manufacturing/mrp/action-messages` |
| GET | `/manufacturing/mrp/pegging/:productId` |
| GET | `/manufacturing/mrp/scheduled-receipts` |

#### Suppliers
| Method | Path |
|--------|------|
| GET/POST | `/manufacturing/suppliers` |
| GET/PUT/DELETE | `/manufacturing/suppliers/:id` |
| GET | `/manufacturing/suppliers/:id/products` |
| GET | `/manufacturing/suppliers/product/:productId` |
| GET | `/manufacturing/suppliers/compare` |
| POST | `/manufacturing/suppliers/link-product` |
| POST | `/manufacturing/suppliers/bulk-link-products` |
| PUT | `/manufacturing/suppliers/product-link/:id` |
| DELETE | `/manufacturing/suppliers/product-link/:id` |
| POST | `/manufacturing/suppliers/product-link/:id/set-primary` |
| GET | `/manufacturing/suppliers/:id/performance` |
| GET | `/manufacturing/suppliers/:id/summary` |

#### Promotions
| Method | Path |
|--------|------|
| GET/POST | `/manufacturing/promotions` |
| GET/PUT/DELETE | `/manufacturing/promotions/:id` |
| PATCH | `/manufacturing/promotions/:id/status` |
| GET | `/manufacturing/promotions/active` |
| GET | `/manufacturing/promotions/upcoming` |
| GET | `/manufacturing/promotions/:id/adjusted-forecast` |
| GET | `/manufacturing/promotions/calendar` |
| GET/POST | `/manufacturing/promotions/:id/lift-factors` |
| POST | `/manufacturing/promotions/:id/lift-factors/bulk` |
| DELETE | `/manufacturing/promotions/:id/lift-factors/:factorId` |
| GET | `/manufacturing/promotions/:id/impact` |
| POST | `/manufacturing/promotions/:id/copy` |

#### NPI (New Product Introduction)
| Method | Path |
|--------|------|
| GET/POST | `/manufacturing/npi` |
| GET/PUT/DELETE | `/manufacturing/npi/:id` |
| POST | `/manufacturing/npi/:id/generate-forecast` |
| GET | `/manufacturing/npi/:id/analogs` |
| POST | `/manufacturing/npi/:id/set-analog` |
| GET | `/manufacturing/npi/:id/performance` |
| GET | `/manufacturing/npi/compare-performance` |
| POST | `/manufacturing/npi/:id/convert-to-product` |

#### Workflows
| Method | Path |
|--------|------|
| GET/POST | `/manufacturing/workflows/templates` |
| GET/PUT/DELETE | `/manufacturing/workflows/templates/:id` |
| POST | `/manufacturing/workflows/templates/:id/steps` |
| PUT/DELETE | `/manufacturing/workflows/steps/:id` |
| GET | `/manufacturing/workflows/instances` |
| GET | `/manufacturing/workflows/instances/:id` |
| POST | `/manufacturing/workflows/instances` |
| POST | `/manufacturing/workflows/instances/:id/approve` |
| POST | `/manufacturing/workflows/instances/:id/reject` |
| POST | `/manufacturing/workflows/instances/:id/request-changes` |
| POST | `/manufacturing/workflows/instances/:id/cancel` |
| POST | `/manufacturing/workflows/instances/:id/resubmit` |
| GET | `/manufacturing/workflows/metrics` |
| GET | `/manufacturing/workflows/approver-workload` |

#### S&OP v2
| Method | Path |
|--------|------|
| GET/POST | `/manufacturing/sop/v2/cycles` |
| GET/PUT/DELETE | `/manufacturing/sop/v2/cycles/:id` |
| GET | `/manufacturing/sop/v2/cycles/:id/summary` |
| POST | `/manufacturing/sop/v2/cycles/:id/status` |
| GET/POST | `/manufacturing/sop/v2/cycles/:cycleId/forecasts` |
| PUT/DELETE | `/manufacturing/sop/v2/cycles/:cycleId/forecasts/:id` |
| POST | `/manufacturing/sop/v2/cycles/:cycleId/forecasts/bulk` |
| GET | `/manufacturing/sop/v2/cycles/:cycleId/forecasts/comparison` |
| POST | `/manufacturing/sop/v2/cycles/:cycleId/forecasts/copy` |
| POST | `/manufacturing/sop/v2/cycles/:cycleId/forecasts/import-statistical` |
| GET/POST | `/manufacturing/sop/v2/cycles/:cycleId/assumptions` |
| PUT/DELETE | `/manufacturing/sop/v2/cycles/:cycleId/assumptions/:id` |

#### Fiscal Calendars v2
| Method | Path |
|--------|------|
| GET/POST | `/manufacturing/fiscal-calendars/v2` |
| GET/PUT/DELETE | `/manufacturing/fiscal-calendars/v2/:id` |
| POST | `/manufacturing/fiscal-calendars/v2/:id/activate` |
| GET/POST | `/manufacturing/fiscal-calendars/v2/:id/periods` |
| GET/PUT/DELETE | `/manufacturing/fiscal-calendars/v2/:id/periods/:periodId` |
| POST | `/manufacturing/fiscal-calendars/v2/:id/periods/generate` |
| POST | `/manufacturing/fiscal-calendars/v2/:id/periods/:periodId/toggle-status` |
| POST | `/manufacturing/fiscal-calendars/v2/convert/date-to-fiscal` |
| POST | `/manufacturing/fiscal-calendars/v2/convert/dates-to-fiscal` |
| POST | `/manufacturing/fiscal-calendars/v2/convert/fiscal-to-dates` |
| GET | `/manufacturing/fiscal-calendars/v2/range/:calendarId` |
| GET | `/manufacturing/fiscal-calendars/v2/year-summary/:calendarId/:year` |
| POST | `/manufacturing/fiscal-calendars/v2/working-days` |

#### Purchase Orders
| Method | Path |
|--------|------|
| GET/POST | `/manufacturing/purchase-orders` |
| GET/PUT | `/manufacturing/purchase-orders/:id` |
| POST | `/manufacturing/purchase-orders/:id/release` |
| POST | `/manufacturing/purchase-orders/:id/cancel` |
| POST | `/manufacturing/purchase-orders/convert-from-planned` |

#### Goods Receipts
| Method | Path |
|--------|------|
| POST | `/manufacturing/goods-receipts` |
| POST | `/manufacturing/goods-receipts/:id/confirm` |

#### Work Orders
| Method | Path |
|--------|------|
| GET/POST | `/manufacturing/work-orders` |
| GET/PUT | `/manufacturing/work-orders/:id` |
| POST | `/manufacturing/work-orders/:id/release` |
| POST | `/manufacturing/work-orders/:id/start` |
| POST | `/manufacturing/work-orders/:id/complete` |
| POST | `/manufacturing/work-orders/:id/cancel` |
| POST | `/manufacturing/work-orders/convert-from-planned` |
| POST | `/manufacturing/work-orders/operations/:operationId/start` |
| POST | `/manufacturing/work-orders/operations/:operationId/complete` |
| POST | `/manufacturing/work-orders/:id/material-issues` |
| POST | `/manufacturing/work-orders/:id/backflush` |
| POST | `/manufacturing/work-orders/:id/completions` |

#### Labor & Inventory Transactions
| Method | Path |
|--------|------|
| POST | `/manufacturing/labor` |
| GET | `/manufacturing/labor/work-order/:workOrderId` |
| GET/POST | `/manufacturing/inventory-transactions` |
| POST | `/manufacturing/inventory-transactions/adjustments` |
| POST | `/manufacturing/inventory-transactions/transfers` |

### Service Methods (all present)
Full list of ~120 methods verified in the 6,163-line service file. All controller references point to existing service methods.

### Prisma Models Used
`BillOfMaterial`, `BOMComponent`, `Product`, `WorkCenter`, `WorkCenterCapacity`, `WorkCenterShift`, `Routing`, `RoutingOperation`, `InventoryPolicy`, `InventoryLevel`, `MRPRun`, `MRPRequirement`, `MRPException`, `PlannedOrder`, `Supplier`, `SupplierProduct`, `Promotion`, `PromotionLiftFactor`, `NewProductIntroduction`, `WorkflowTemplate`, `WorkflowStep`, `WorkflowInstance`, `WorkflowAction`, `SOPCycle`, `SOPForecast`, `SOPAssumption`, `FiscalCalendar`, `FiscalPeriod`, `Actual`, `PurchaseOrder`, `PurchaseOrderLine`, `GoodsReceipt`, `GoodsReceiptLine`, `WorkOrder`, `WorkOrderOperation`, `MaterialIssue`, `ProductionCompletion`, `LaborEntry`, `InventoryTransaction`

### TODOs (13 total)
| Line | Issue | Severity |
|------|-------|----------|
| 2089 | `scheduledReceipts = 0; // TODO: Get from existing POs/WOs` | **HIGH** — MRP engine ignores all existing supply, making net requirements always wrong |
| 4691 | `locationId: data.supplierId // TODO: pass actual locationId` | **HIGH** — PO locationId set to supplierId (wrong FK) |
| 4696 | `createdById: tenantId // TODO: pass actual user id` | MEDIUM — PO creator always tenant, not user |
| 4853 | `unitPrice: 0 // TODO: fetch from SupplierProduct` | MEDIUM — POs from planned orders always have $0 pricing |
| 4906 | `receivedById: tenantId // TODO: pass actual user id` | MEDIUM — GR receiver always tenant |
| 5203 | `locationId: data.workCenterId \|\| tenantId // TODO: pass actual locationId` | HIGH — WO location set to work center ID or tenant ID |
| 5205 | `createdById: tenantId // TODO: pass actual user id` | MEDIUM |
| 5483 | `issuedById: tenantId // TODO: pass actual user id` | MEDIUM |
| 5578 | `completedById: tenantId // TODO: pass actual user id` | MEDIUM |
| 5658 | `workerId: data.workerId \|\| tenantId // TODO: pass actual worker id` | MEDIUM |
| 5716 | `locationId: tenantId // TODO: pass actual locationId` | HIGH — inventory transactions at wrong location |
| 5724 | `createdById: tenantId // TODO: pass actual user id` | MEDIUM |
| 5884 | `productSku: '' // TODO: fetch product codes for PO lines` | LOW |

### Stub Methods
| Method | Issue |
|--------|-------|
| `getSupplierPerformance` | Returns hardcoded `{ onTimeDelivery: 0, qualityScore: 0, ... }` — zero calculation |
| `runXYZClassification` | Assigns ALL items to class 'X' without actual variability calculation |
| `calculateSafetyStock` | Returns the policy's existing safetyStockQty — no actual safety stock calculation |
| `calculateReorderPoint` | Returns policy's existing reorderPoint — no actual ROP calculation |
| `convertNPIToProduct` | Returns NPI unchanged — **no actual conversion logic** |
| `getWorkflowMetrics` | Returns only `{ total: count }` — no real metrics (avg time, approval rate, etc.) |
| `getApproverWorkload` | Returns `{ totalApprovers: 0 }` — hardcoded stub |
| `simulateLoadBalancing` | Uses `Math.random()` for all utilization values — **completely fake simulation** |
| `getMyPendingApprovals` | Returns ALL in-progress workflows for tenant — does not filter by user |
| `transferInventory` | Sets quantity to 0 (net zero) — **does not actually deduct from source or add to target** |

### Missing CRUD Operations
| Entity | Missing |
|--------|---------|
| `GoodsReceipt` | No GET (list), no GET by ID, no DELETE |
| `WorkOrder` | No DELETE endpoint |
| `WorkOrderOperation` | No GET list, no DELETE |
| `MaterialIssue` | No GET list (outside WO context), no DELETE/reversal |
| `LaborEntry` | No UPDATE, no DELETE |
| `ProductionCompletion` | No GET list, no GET by ID, no DELETE/reversal |
| `InventoryTransaction` | No DELETE/reversal |
| `Routing` | **No endpoints at all** — Routing/RoutingOperation models exist in schema but no controller endpoints |
| `ExternalDataSource` | **No endpoints** — model exists in schema, no controller |
| `ExternalDataPoint` | **No endpoints** — model exists in schema, no controller |
| `FinancialPlan/Line` | **No endpoints** — models exist in schema, no controller |
| `ProductHierarchy/Node` | **No endpoints** — models exist in schema, no controller |

### Error Handling Gaps
- **All PO/WO/GR methods throw raw `Error()`** instead of NestJS `NotFoundException`/`BadRequestException` — clients get 500 instead of 400/404.
- **No try-catch** in most service methods — Prisma errors bubble up as 500s.
- **`getPurchaseOrder` returns `null`** instead of throwing — controller must handle null but doesn't always.
- **`getWorkOrder` returns `null`** instead of throwing — same issue.

---

## 10. Workflow (Core Module)

### Service Methods
`startWorkflow`, `approve`, `reject`, `ensureApproved`

### Prisma Models Used
`WorkflowTemplate`, `WorkflowStep`, `WorkflowInstance`, `WorkflowAction`

### Gaps
- Core workflow service is separate from manufacturing's workflow endpoints — **two workflow systems coexist**.
- Manufacturing's workflow controller duplicates core workflow functionality with its own implementation.
- `assertApprover` checks role/user/manager/dynamic but **manager type** just checks if user role is ADMIN (not actual org hierarchy).

---

## 11. Cross-Cutting Issues

### A. Validation Gaps Summary

| Module | DTO Usage | Status |
|--------|-----------|--------|
| Auth | Proper DTOs | ✅ Good |
| Users | Proper DTOs | ✅ Good |
| Plans | Proper DTOs + ParseUUIDPipe | ✅ Good |
| Scenarios | Proper DTOs | ✅ Good |
| Forecasts | Proper DTOs | ✅ Good |
| Data | Proper DTOs | ✅ Good |
| Reports | Proper DTOs | ✅ Good |
| Settings | Partial DTOs (service methods use DTOs, but api-key/integration endpoints are stubs) | ⚠️ Partial |
| **Manufacturing** | **`@Body() dto: any` on ALL ~150 endpoints** | ❌ **CRITICAL** |

### B. Authentication & Authorization Gaps

- Manufacturing controller uses `@UseGuards(JwtAuthGuard)` but **no `@Roles()` decorator on any endpoint** — every authenticated user (including VIEWER) can create/delete BOMs, run MRP, approve workflows, etc.
- Plans, Scenarios, Users controllers properly use `@Roles()` decorators.
- **No resource-level authorization** — any user in a tenant can modify any other user's data.

### C. Multi-Tenancy Concerns

- Manufacturing service properly filters by `tenantId` on most queries.
- **BUT**: Several `delete` and `update` operations use `where: { id }` without `tenantId`, potentially allowing cross-tenant data modification:
  - `deleteWorkflowTemplate`: `delete({ where: { id: templateId } })` — no tenant check
  - `deleteWorkflowStep`: `delete({ where: { id: stepId } })` — no tenant check
  - `updateWorkflowStep`: `update({ where: { id: stepId } })` — no tenant check after find
  - Various `updateMany` operations

### D. Missing Prisma Models (referenced in endpoints, not in schema)

| Feature | Status |
|---------|--------|
| `ApiKey` | Not in schema — settings api-key endpoints are stubs |
| `Integration` | Not in schema — settings integration endpoints are stubs |

### E. Schema Models with No API Endpoints

| Model | Status |
|-------|--------|
| `Routing` / `RoutingOperation` | In schema, used internally by WO creation, but **no CRUD endpoints** |
| `ExternalDataSource` / `ExternalDataPoint` | In schema, **completely unused** |
| `FinancialPlan` / `FinancialPlanLine` | In schema, **completely unused** |
| `ProductHierarchy` / `ProductHierarchyNode` | In schema, **completely unused** |
| `Notification` | In schema, has a module registered, but **no controller endpoints found in the audited modules** |

### F. User ID Not Passed to Manufacturing Service

The manufacturing controller extracts `user` from `@CurrentUser()` but only passes `user.tenantId` to the service. **The actual `user.id` is never passed**. This means:
- All `createdById` fields use `tenantId` instead of the actual user.
- Audit trail is broken for the entire manufacturing module.
- Workflow approvals use tenantId instead of the approving user.

### G. Missing Global Error Filter

- No custom exception filter found — raw Prisma errors (unique constraint violations, FK violations) reach the client as 500 errors with internal stack traces.

### H. Duplicate Route Patterns

| Duplicate | v1 Path | v2 Path |
|-----------|---------|---------|
| BOM CRUD | `/manufacturing/boms` | `/manufacturing/bom` |
| Inventory Policies | `/manufacturing/inventory/policies` (POST) | `/manufacturing/inventory/policies/v2` (GET) |
| S&OP | No v1 endpoints visible | `/manufacturing/sop/v2/cycles` |
| Fiscal Calendars | No v1 endpoints visible | `/manufacturing/fiscal-calendars/v2` |

---

## Priority Fix List

### P0 — Security / Data Integrity
1. **Add `@Roles()` guards to all manufacturing endpoints** — currently any authenticated user can do anything
2. **Add tenantId to all delete/update `where` clauses** — cross-tenant data modification possible
3. **Pass `user.id` through to manufacturing service** — audit trail completely broken
4. **Fix locationId assignments** — POs, WOs, inventory transactions use wrong IDs (supplierId, tenantId, workCenterId)

### P1 — Correctness
5. **Fix MRP `scheduledReceipts = 0`** — MRP engine produces wrong results
6. **Create validation DTOs for all manufacturing endpoints** — 150 endpoints with zero validation
7. **Fix `transferInventory`** — currently a no-op (quantity = 0)
8. **Fix `simulateLoadBalancing`** — uses Math.random() instead of real calculations
9. **Replace raw `throw new Error()` with NestJS HTTP exceptions** in PO/WO/GR methods

### P2 — Missing Features
10. **Implement email sending** — password reset, user invitation
11. **Add Routing CRUD endpoints** — schema model exists but no API
12. **Add GoodsReceipt list/get endpoints**
13. **Implement ApiKey model + endpoints** or remove stub endpoints
14. **Implement Integration model + endpoints** or remove stub endpoints
15. **Add endpoints for**: ExternalDataSource, FinancialPlan, ProductHierarchy or remove from schema

### P3 — Code Quality
16. **Remove duplicate BOM routes** — consolidate v1/v2
17. **Implement real `getSupplierPerformance`** calculation
18. **Implement real `runXYZClassification`** algorithm
19. **Implement real `calculateSafetyStock`** and `calculateReorderPoint`**
20. **Add pagination to manufacturing list endpoints** (many just return all records)
