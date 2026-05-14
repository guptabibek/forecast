# Production Live Readiness Audit

## Verdict

Status: Not ready for live enterprise production.

The platform has a solid foundation across forecasting, planning, tenant-aware auth, and a large manufacturing surface area, but there are still structural gaps that will create bad enterprise outcomes in live use:

- tenant bootstrap is incomplete for self-service signup
- several frontend and backend contracts do not match
- master data is only partially normalized even though dedicated master tables already exist
- multiple high-value UI flows still depend on hardcoded catalogs instead of tenant-backed configuration
- some reporting and export endpoints are still stub implementations

This document focuses on issues verified directly in source and groups them into blockers, phase 1 remediation, and later hardening.

## Live Blockers

### 1. New tenants are not provisioned with required master data

Evidence:

- `AuthService.register()` creates only the tenant and initial admin user in `apps/api/src/modules/auth/auth.service.ts`.
- UOMs, product categories, seeded users, and tenant configuration are created only by the seed script in `apps/api/prisma/seed.ts`.
- `UnitOfMeasure` and `ProductCategory` are tenant-scoped models in `apps/api/prisma/schema.prisma`.

Impact:

- a newly registered company starts with no UOM master, no product categories, and no seeded operating baseline
- product and manufacturing flows become inconsistent immediately after signup

Required fix:

- add tenant bootstrap on tenant creation
- move mandatory tenant initialization into an application service, not the environment seed path
- keep demo seed data separate from required enterprise master initialization

### 2. User invitation flow is incomplete

Evidence:

- `apps/api/src/modules/users/users.service.ts` contains `// TODO: Send invitation email`
- `apps/api/src/core/notification/email.service.ts` only implements password-reset delivery, not invitation delivery

Impact:

- admins can create pending users, but invitation onboarding is not operational
- enterprise rollout, access reviews, and delegated user administration are incomplete

Required fix:

- implement invitation email delivery and tokenized acceptance flow
- record invite state, expiry, resend, and acceptance audit trail

### 3. Plan export is contractually broken

Evidence:

- `apps/web/src/services/api/plan.service.ts` expects `export()` to return a `Blob`
- `apps/web/src/pages/plans/PlanDetail.tsx` downloads the result as a file
- `apps/api/src/modules/plans/plans.controller.ts` returns a JSON object containing `{ data, format, exportedAt }`

Impact:

- plan export is not production-safe and can fail at runtime or yield the wrong response shape
- approved plans cannot be reliably distributed as controlled outputs

Required fix:

- make backend export return real file responses with content type and filename
- align frontend and backend on supported formats
- add tests for csv/xlsx export

### 4. Avatar upload flow is contractually broken

Evidence:

- `apps/web/src/services/api/user.service.ts` uploads multipart form data with an `avatar` file
- `apps/api/src/modules/users/users.controller.ts` accepts only `@Body() dto: { avatarUrl?: string }`
- `apps/api/src/modules/users/users.service.ts` stores either the provided URL or a `ui-avatars.com` fallback
- `apps/web/src/pages/settings/Profile.tsx` shows an avatar camera action but no working upload path

Impact:

- profile image upload is not functional as implemented
- the API contract and UI behavior diverge

Required fix:

- choose one contract: file upload or external URL
- if file upload is desired, add interceptor, storage handling, validation, and persisted URL generation

### 5. Actuals import accepts unknown dimensions by nulling them out

Evidence:

- `apps/api/src/core/queue/processors/import.processor.ts` resolves `productCode`, `locationCode`, `customerCode`, and `accountCode` into IDs
- unknown codes are converted to `null`
- `validateRecord()` checks `periodDate` and `amount`, but does not reject unresolved dimensions
- `insertActuals()` persists `productId`, `locationId`, `customerId`, and `accountId` as `r.* || null`
- `Actual` dimension foreign keys are nullable in `apps/api/prisma/schema.prisma`

Impact:

- imports can report success while silently losing dimensional integrity
- downstream reporting, forecast accuracy, and reconciliation become unreliable

Required fix:

- reject rows with unresolved required dimensions
- support strict and tolerant import modes explicitly
- provide row-level error feedback to users before final persistence

## High-Risk Production Gaps

### 6. Product and manufacturing data model still bypass master tables

Evidence in `apps/api/prisma/schema.prisma`:

- `Product.category`, `Product.subcategory`, `Product.brand`, and `Product.unitOfMeasure` are free-text strings
- `CostCenter.manager` is a free-text string
- `SOPCycle.demandManager`, `supplyManager`, `financeManager`, and `executiveSponsor` are UUID-shaped strings without relations
- `PostingProfile.productCategory` is a free-text string even though `ProductCategory` exists as a model
- `Promotion.productIds`, `locationIds`, `customerIds`, and `channelIds` are arrays instead of normalized relation tables

Impact:

- referential integrity is partial
- enterprise auditability and change control are weaker than the schema already suggests they should be
- transactional logic can drift from master data over time

Required fix:

- introduce FK-backed fields for product category, UOM, brand, managers, and posting profile scope
- migrate promotions to junction tables where business relationships must be queryable and auditable

### 7. Product master UI still submits string attributes even though master tables exist

Evidence:

- `apps/web/src/pages/data/ProductMaster.tsx` fetches UOM and product category masters
- the same page still submits `category`, `subcategory`, `brand`, and `unitOfMeasure` as strings
- `apps/api/src/modules/data/dto/create-dimension.dto.ts` accepts those fields as strings

Impact:

- the product master UI looks master-data-driven, but the write path still preserves denormalized strings
- enterprise data stewardship remains weak even where master tables already exist

Required fix:

- add normalized product DTOs and APIs using IDs
- keep descriptive labels on the UI, but persist relations by ID

### 8. Settings page is not master-data-driven for key catalogs

Evidence:

- `apps/web/src/pages/settings/Settings.tsx` hardcodes timezones, currencies, date formats, forecast models, SSO providers, and an `integrationsList`
- the same repo already exposes integration APIs in `apps/web/src/services/api/settings.service.ts`
- `Settings.tsx` renders the hardcoded `integrationsList` instead of loading integrations from the API

Impact:

- tenant configuration is partially cosmetic rather than authoritative
- integration state shown in the UI can diverge from persisted settings
- enterprise rollout across geographies and identity providers requires code changes instead of configuration

Required fix:

- move catalog delivery to backend endpoints or configuration-backed metadata services
- make integrations view consume real tenant integration state

### 9. Static enumerations are still embedded across operational pages

Examples:

- `apps/web/src/pages/settings/Settings.tsx`
- `apps/web/src/pages/data/Dimensions.tsx`
- `apps/web/src/pages/data/ProductMaster.tsx`
- `apps/web/src/pages/manufacturing/Workflow.tsx`
- `apps/web/src/pages/manufacturing/Capacity.tsx`
- `apps/web/src/pages/manufacturing/Promotions.tsx`
- `apps/web/src/pages/manufacturing/SOP.tsx`
- `apps/web/src/pages/manufacturing/Suppliers.tsx`

Impact:

- operational rules and classifications are not tenant-administered
- local enterprise vocabulary, approval models, country coverage, and planning taxonomies cannot be managed safely

Required fix:

- replace hardcoded lists with master data, enums delivered by API, or tenant configuration tables

### 10. Forecast reconciliation exists in the backend but has no UI trigger

Evidence:

- backend approval endpoints exist in `apps/api/src/modules/forecasts/forecasts.controller.ts`
- no frontend match was found for reconciliation approval calls in `apps/web/src`

Impact:

- variance approval workflow is incomplete from the business user's perspective
- finance and planning teams cannot close the loop from the UI

Required fix:

- add reconciliation review, approve, and reject actions in the forecast UI

## Medium-Risk Gaps

### 11. Reports backend still contains stubbed management flows

Evidence:

- `apps/api/src/modules/reports/reports.service.ts` returns synthetic responses for `saveReport()`, `exportReport()`, and `scheduleReport()`

Impact:

- scheduled delivery, saved report lifecycle, and backend-managed export are not production-ready
- enterprise reporting automation is not trustworthy yet

Notes:

- the current reports page can still export local CSV from loaded client-side data, but that is not a substitute for durable server-side reporting workflows

### 12. Tenant settings type has drift between shared types and page-local definition

Evidence:

- `apps/web/src/types/index.ts` defines a compact shared `TenantSettings`
- `apps/web/src/pages/settings/Settings.tsx` defines a much larger page-local `TenantSettings`

Impact:

- frontend contracts can drift silently
- page assumptions can outpace actual persisted fields

Required fix:

- consolidate settings typing into a single shared contract

### 13. Demo tenant fallback can hide multi-tenant issues during pre-live testing

Evidence:

- `apps/api/src/modules/auth/auth.controller.ts` contains `ALLOW_DEMO_TENANT_FALLBACK`
- it is disabled in production mode, but remains available in non-production modes

Impact:

- UAT and staging can mask broken tenant resolution patterns

Required fix:

- remove fallback from UAT and staging
- keep only explicit tenant-resolution behavior in all environments used for acceptance testing

## What Is Already Strong

- tenant-aware auth and domain resolution are in place
- password reset flow exists and can work once SMTP is configured
- actuals import has a real queued processor with parsing and row-level validation scaffolding
- forecasting engine and manufacturing service contain significant real logic, not just placeholder endpoints
- UOM and product category master tables already exist, which makes normalization feasible without redesigning the whole platform

## Phase Plan

### Phase 0: Release Gate

Do not go live until these are complete:

- tenant bootstrap service for required master data
- invitation onboarding flow
- working plan export contract
- working avatar contract or removal of the feature
- strict actuals import validation for unresolved dimensions

### Phase 1: Data Integrity Normalization

- convert product and transaction write paths from strings to FK-backed IDs where master tables already exist
- normalize manager and approval fields to user relations
- migrate promotion targeting from arrays to normalized relations where auditability matters
- add migration scripts and backfill plans for existing seeded data

### Phase 2: UI Master Data Conversion

- replace hardcoded catalogs in settings, dimensions, product master, workflow, supplier, promotions, and SOP pages
- connect the integrations page to real integration state APIs
- ensure all forms submit IDs while rendering human-readable labels

### Phase 3: Workflow Completion

- add forecast reconciliation actions in the UI
- implement durable report save, schedule, and export flows
- add end-to-end tests for invite, export, import validation, and reconciliation approval

### Phase 4: Enterprise Hardening

- remove demo tenant fallback from all acceptance environments
- unify frontend shared contracts and generated types
- add audit-ready export coverage, operational dashboards, and regression suites for major tenant workflows

## Exit Criteria For Live Enterprise Use

- a new tenant can sign up and immediately create products, plans, forecasts, and core manufacturing records using initialized master data
- every visible form that depends on master data persists IDs, not free text, unless the field is intentionally unstructured
- imports reject unresolved required dimensions
- user onboarding, password reset, and profile update flows are all operational end to end
- exports return real files with tested contracts
- no production-facing page relies on placeholder integration state or hardcoded operational catalogs when a backend source exists

## Recommended Execution Order

1. Fix contract bugs and tenant bootstrap first.
2. Normalize product, UOM, category, manager, and promotion relations next.
3. Remove hardcoded operational catalogs from the UI.
4. Complete reconciliation and reporting workflows.
5. Harden pre-live environments so UAT reflects production behavior.