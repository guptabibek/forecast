# AI Insights Dashboard — Architecture & Rollout

Status: implemented, behind safe-rollout switches. No existing reporting behavior changed.

## 1. Existing architecture (as analyzed)

The AI Reporting module (`apps/api/src/modules/ai-reporting/`) does **not** let the LLM write SQL.
The pipeline is:

```
User question
  → NlqParserService            (LLM → semantic query JSON, catalog-constrained)
  → SemanticQueryValidator      (validates ids against semantic-catalog.json, applies security)
  → SqlCompilerService          (semantic query → parameterized SQL on vw_ai_* views,
                                 injects tenant/company/branch security filters)
  → SqlSafetyValidator          (defense-in-depth SQL checks)
  → ReportExecutorService       (executes with timeout)
  → sanitizeResult              (masks sensitive/internal columns per role)
  → buildReportPayload          (canonical grid/chart/KPI payload)
```

Every successful request is audited in `ai_report_query_audits` **including the validated
semantic query JSON**, keyed by `request_id`.

### Extension points used (composition, not modification)

| Extension point | How the new module uses it |
| --- | --- |
| `ai_report_query_audits.semantic_query` | Pin-by-`requestId`: the server copies the already-validated semantic query from its own audit trail. The client never submits query internals, so they cannot be forged. |
| `AiReportingService` (new public method `executeStoredReport`) | Re-validates + recompiles a stored semantic query under the **current** user's security context, with no LLM call and no audit-history spam. Existing methods untouched. |
| `TenantCacheService` (global Redis cache, graceful without Redis) | Widget results and insight summaries. |
| `ScheduleModule` cron | Periodic insight generation. |
| `@RequireModule('ai-reporting')` + `reports.ai.*` permissions | The dashboard inherits the exact same tenant-module gating and permission model. |
| Frontend `AiChartRenderer` / `AiReportTable` / `AiKpiCard` | Reused unchanged to render widget content. |

### Changes to existing files (all additive)

- `ai-reporting.module.ts`: added `exports: [AiReportingService]`.
- `ai-reporting.service.ts`: added `executeStoredReport()` + two exported interfaces. No existing method modified.
- `app.module.ts`: registered `InsightsDashboardModule`.
- Frontend: one route in `App.tsx`, one nav item in `Sidebar.tsx`, the `PinToDashboardButton` rendered above results in `AiReporting.tsx`.

## 2. New module layout

```
apps/api/src/modules/insights-dashboard/
  insights-dashboard.module.ts        wiring; provider registry
  dashboard.controller.ts             /ai-dashboard endpoints
  dashboard.service.ts                dashboards, widgets, pin/unpin/layout/clone
  widget-executor.service.ts          cached widget execution via executeStoredReport
  insights.controller.ts              /ai-insights endpoints
  insights.service.ts                 listing, summary, lifecycle transitions
  insight-generation.service.ts       engine: runs providers, upserts, archives
  insight-generation.scheduler.ts     cron (gated by AI_INSIGHTS_ENABLED)
  insight-provider.interface.ts       IInsightProvider strategy contract
  providers/
    provider-utils.ts                            semantic-query builders + row readers
    revenue-insight.provider.ts                  revenue drop / sales opportunity
    inventory-insight.provider.ts                low stock + expiring stock
    stockout-risk-insight.provider.ts            days-of-cover stock-out prediction + reorder qty
    dead-stock-insight.provider.ts               stocked items with zero sales (90d)
    churn-insight.provider.ts                    regular customers gone quiet (30d)
    outstanding-insight.provider.ts              receivables concentration risk
    purchase-trend-insight.provider.ts           purchase value swings + supplier movers
    salesman-performance-insight.provider.ts     salesmen billing below their own baseline
    fast-movers-insight.provider.ts              products growing 40%+ MoM (opportunity)
    discount-anomaly-insight.provider.ts         discount/gross ratio jump vs 90d baseline
    executive-summary-insight.provider.ts        composite business health score (0–100)
    pinned-report-insight.provider.ts            generic engine: analyses every PINNED report
                                                 (headline total, previous-period delta, top rows)
                                                 so custom pins behave like built-in insights
  rolling-window.util.ts              shared pin-anchored window shifting (executor + provider)

apps/web/src/
  pages/insights/InsightsDashboard.tsx
  components/insights-dashboard/{WidgetCard,InsightCard,PinToDashboardButton}.tsx
  hooks/useInsightsDashboard.ts
  services/api/insights-dashboard.service.ts
```

## 3. Security model

- All endpoints: `JwtAuthGuard` + `RolesGuard` + `@RequireModule('ai-reporting')` + `report:read`,
  plus the same `reports.ai.view` service-level check AI Reporting uses (ADMIN bypass).
- **Pinned widgets execute under the viewer's current security context**: the stored semantic
  query is re-validated against the catalog and recompiled, so tenant/company/branch row scoping
  and sensitive-column masking are applied at execution time, every time. If the user's scope
  shrinks after pinning, the widget output shrinks with it.
- Dashboards and widgets are strictly per-user (`tenantId + userId` on every query).
- If the catalog drops a dataset/metric, stale widgets degrade to a friendly
  "Report no longer supported" state instead of erroring.
- Insight generation runs with a tenant-level system context (no user data access expansion:
  insights are tenant-wide aggregates, visible only to users who can already use AI reporting).

## 4. Data model (additive migration `20260611090000_add_ai_insights_dashboard`)

```
ai_dashboards                 per-user dashboard containers (default flag, unique name/user)
ai_dashboard_widgets          pinned reports: question, semantic_query JSONB, viz override,
                              size, position, refresh_interval_sec; FK → ai_dashboards (CASCADE)
ai_insights                   provider output; UNIQUE(tenant_id, provider_id, dedupe_key);
                              status NEW/ACTIVE/ACKNOWLEDGED/RESOLVED/ARCHIVED; severity,
                              confidence, metrics/evidence/actions JSONB, drill_down_question
ai_insight_events             lifecycle audit (generated/redetected/acknowledged/resolved/…)
ai_insight_provider_configs   per-tenant enable/disable + last-run bookkeeping
```

No FKs to existing tables (matches the `ai_report_usage_events` precedent), no existing table
touched — the migration is purely additive and safe to run online.

Index strategy: every hot path is covered — `(tenant_id, user_id)` for dashboard lookups,
`(tenant_id, dashboard_id, position)` for widget ordering, `(tenant_id, status, severity,
last_evaluated_at)` for the insight feed, the dedupe unique index for upserts.

## 5. API contracts (global prefix applies, e.g. `/api/v1`)

Dashboards & widgets (`/ai-dashboard`):

```
GET    /ai-dashboard                          list (lazily creates "My Dashboard")
POST   /ai-dashboard                          { name, description? }
PATCH  /ai-dashboard/:id                      { name?, description?, isDefault? }
DELETE /ai-dashboard/:id
POST   /ai-dashboard/:id/clone                { name? }
GET    /ai-dashboard/:id/widgets              layout only — widget data loads async
PATCH  /ai-dashboard/:id/layout               { items: [{ widgetId, position, size? }] }
POST   /ai-dashboard/widgets/pin              { requestId, dashboardId?, title?, size?, refreshIntervalSec? }
PATCH  /ai-dashboard/widgets/:id              { title?, size?, vizType?, refreshIntervalSec? }
POST   /ai-dashboard/widgets/:id/duplicate
DELETE /ai-dashboard/widgets/:id              unpin
POST   /ai-dashboard/widgets/:id/execute      { force? } → canonical report payload + cache metadata
```

Insights (`/ai-insights`):

```
GET    /ai-insights?status=&severity=&category=&page=&pageSize=   paginated feed
GET    /ai-insights/summary                                       severity counts (cached 60s)
POST   /ai-insights/:id/acknowledge|resolve|archive|reopen        { note? }
POST   /ai-insights/generate                                      ADMIN: run providers now
GET    /ai-insights/providers                                     ADMIN: provider configs
PATCH  /ai-insights/providers/:providerId                         ADMIN: { enabled }
```

## 6. Pin / execute sequences

```
Pin:      AI Reporting answer (requestId) → POST widgets/pin
          → server loads semantic_query from ai_report_query_audits
            (must be status=success, query_kind=single_report, same tenant+user)
          → widget row created. No SQL or semantic JSON ever crosses the client.

Execute:  GET widgets → for each widget (async, parallel) POST widgets/:id/execute
          → Redis cache hit? return (TTL = refresh interval, default 300s, cap 1h)
          → miss: executeStoredReport(user, semanticQuery)
              validate(catalog, CURRENT security ctx) → compile → safety → execute → sanitize
          → cache + return

Insights: cron (6h, AI_INSIGHTS_ENABLED=true) or admin "Generate now"
          → for each active tenant with ai-reporting module enabled
          → each enabled provider builds semantic queries → same pipeline (system ctx)
          → candidates upserted on (tenantId, providerId, dedupeKey):
              new → NEW (+ 'generated' event)
              re-detected NEW > 24h old → ACTIVE
              re-detected RESOLVED/ARCHIVED → ACTIVE (+ 'redetected' event)
              open but NOT re-detected this cycle → ARCHIVED (condition cleared)
          → provider failures isolated per provider, recorded in provider config
```

## 7. Performance

- The dashboard shell is two cheap queries (dashboards + widget definitions); widget **data**
  loads asynchronously per widget with skeletons, so first paint is well under the 3s budget.
- Widget executions are Redis-cached per widget; refreshes are SQL-only (no LLM cost, no rate-limit
  pressure on the AI provider budget) and are deliberately **not** written to the user's AI history.
- Insight feed is paginated (10–100/page) and the summary is cached 60s; the frontend polls
  every 2 minutes, widgets honor their per-widget refresh interval (floored to 60s server-side).
- Generation is idempotent (dedupe-key upserts), so overlapping runs from multiple app instances
  are harmless.

## 7b. Insight card payload convention

Providers may put four optional display keys inside the insight `metrics` JSON, which the
card UI renders in the mockup-style layout (big number, footer metric):

```
metrics.headline       e.g. "-18.2%"        big headline metric
metrics.headlineLabel  e.g. "Net sales vs previous 30 days"
metrics.impactLabel    e.g. "Sales shortfall (30d)"
metrics.impactValue    e.g. "₹8,50,000"
```

Old insights without these keys render fine (the card falls back to summary + confidence).

## 7c. Mockup feasibility matrix (insights.html)

Verified against the semantic catalog (`vw_ai_*` views) — what each design-mockup card needs
versus what the Marg-synced data actually contains:

| Mockup card | Status | Data source / reason |
| --- | --- | --- |
| Revenue Alert (drop + loss) | ✅ shipped (`revenue`) | `sales_net` 30d windows; shortfall as impact metric |
| Stock-Out Prediction (days, reorder qty) | ✅ shipped (`stockout-risk`) | `stock_summary` stock ÷ `sales_net` velocity |
| Customer Churn Risk | ✅ shipped (`churn`) | `sales_net` customer windows |
| Outstanding Payments | ✅ shipped (`outstanding`) | `party_outstanding` |
| AI Executive Summary / Business Health (score /100) | ✅ shipped (`executive-summary`) | composite of 4 measurable pillars, deterministic deductions |
| Growth Opportunity | ✅ shipped (`revenue` opportunity + `fast-movers`) | `sales_net` product growth |
| Fraud Detection (discount anomaly) | ✅ shipped (`discount-anomaly`) | `sales_items.sales_discount` vs `gross_sales`, 90d baseline |
| Team Productivity | ✅ shipped as **billing** decline (`salesman-performance`) | `sales_net_salesman`; field-visit/MR data does not exist in Marg |
| Dead Stock Alert | ✅ shipped (`dead-stock`) | `stock_summary` × `sales_net` |
| Purchase Trend | ✅ shipped (`purchase-trend`) | `purchase_net` + supplier dimension |
| Expiry Risk | ✅ shipped (`inventory`) | `stock_batches` expiry window |
| AI Forecast Engine card | ⏳ deferred | forecast tables exist but are not catalog-exposed; needs a context extension (documented path: add forecast dataset to semantic catalog) |
| Distributor Health Score | ⏳ deferred | feasible as per-customer composite (billing + outstanding + recency); phase 2 |
| Warehouse Efficiency (picking) | ❌ not possible | no WMS operations data in the system |
| Delivery Delay / SLA | ❌ not possible | no shipment/logistics data |
| Customer Satisfaction | ❌ not possible | no feedback/ratings data |
| Secondary Sales Decline | ❌ not possible | only primary (Marg) sales synced; no retail sell-out feed |
| Prescription Trend | ❌ not possible | no prescription data |
| Retailer Coverage Gap | ❌ not possible | no universe of potential outlets |

## 8. Adding a new insight provider (OCP)

1. Create `providers/<name>-insight.provider.ts` implementing `IInsightProvider`
   (express the analysis as semantic queries via `ctx.runReport`).
2. Register the class in `insights-dashboard.module.ts` providers list and the
   `INSIGHT_PROVIDERS` factory `inject` array.

No engine, schema, API, or existing-provider changes required. Per-tenant enablement is
automatic via `ai_insight_provider_configs`.

## 9. Rollout plan

1. **Deploy migration** (`prisma migrate deploy`) — additive only; zero downtime; old app
   version runs unchanged against the new schema (rollback-safe window).
2. **Deploy API + web.** The dashboard is reachable only by tenants with the `ai-reporting`
   module and AI-reporting-permitted users. The cron stays inert until `AI_INSIGHTS_ENABLED=true`.
3. **Pilot:** enable for one tenant; an admin presses "Generate now" to validate provider output
   against real data; pin a few reports; verify widget caching and scoping with a branch-restricted user.
4. **Enable the scheduler:** set `AI_INSIGHTS_ENABLED=true` (6-hourly cycle).
5. **Scale-out note:** generation cost is a handful of aggregate queries per tenant per cycle on
   the same indexed `vw_ai_*` views the reports already use.

## 10. Rollback strategy

- **Feature level:** unset `AI_INSIGHTS_ENABLED` (stops generation); the dashboard UI keeps
  working read-only on existing data, or hide it by disabling the nav route in a hotfix.
- **Code level:** revert the deploy. The schema is additive, so the previous version runs
  unaffected; the new tables sit idle.
- **Schema level (last resort):** `DROP TABLE ai_insight_events, ai_insight_provider_configs,
  ai_insights, ai_dashboard_widgets, ai_dashboards;` — nothing else references them.

## 10b. Production-readiness audit (June 2026)

Senior-engineer review of the whole AI Reporting + AI Insights surface. Items marked FIXED
shipped with this audit; the rest are prioritized for follow-up.

### Fixed in this pass

| # | Severity | Issue | Fix |
| --- | --- | --- | --- |
| 1 | High | LLM sometimes emits `rangeType: "custom"` with a missing start/end date (e.g. "Expiring stock in next 90 days") → hard 400 "Custom date range requires valid startDate and endDate" surfaced to the user | `SemanticQueryValidator.repairCustomRange`: missing dates are repaired deterministically (both missing → default range; one missing → anchored to today; inverted → swapped). Malformed-but-present dates still fail. Regression tests added. |
| 2 | High | Pinned widgets from relative questions ("last 30 days", "next 90 days") froze in time: the NLQ pipeline compiles them to concrete dates, so the stored window never moved | `WidgetExecutorService.applyRollingWindow`: custom windows anchored to the pin date (end side for past windows, start side for future ones) are shifted forward to today on every execution; genuinely historical ranges stay fixed. Tested. |
| 3 | Medium | Editing a widget (viz type, title) did not invalidate its cached execution → stale rendering for up to 1h | Cache invalidated on widget update and unpin. |
| 4 | Medium | Free-form NLQ pins were titled "AI Report" (the dynamic parser's generic title beat the user's question) | Server now prefers: explicit title → meaningful semantic title → original question. Client no longer forwards the generic title. |
| 5 | Low | Scheduler only accepted `AI_INSIGHTS_ENABLED=true`; `1/yes/on` silently kept it off | Accepts the same truthy set as platform env validation. |
| 6 | High | Pinned custom queries rendered as raw tables with no analysis — they did not "behave like the defaults" | `PinnedReportInsightProvider` (providerId `pinned-reports`): runs every pinned widget's stored semantic query plus an equal-length previous window, emits an insight card (headline, % change, top-row evidence, magnitude-based neutral severity). Refreshed immediately on pin/unpin via a targeted `generateForTenant(tenantId, { providerIds })` run, and on every 6-hourly cycle. Insights are tenant-wide; future-facing windows (expiry) get row-count headlines without comparison. |
| 7 | Medium | "AI Insights" nav entry was buried mid-way in the 19-item Reports group (and the commit adding it was never pushed, so deployed builds lacked it entirely) | Promoted to a top-level sidebar item directly under Dashboard, same gating (module + tenant AI feature + AI permissions), added to forecast-viewer menu allowlist for parity with AI Reporting. |

### Known gaps to address before / shortly after GA (prioritized)

1. **No LLM repair loop** — `NlqParserService` is single-shot; a malformed semantic query fails
   the request instead of one retry with the validation error as feedback. Mitigated by the
   validator repairs above; a bounded retry would cut residual failures further.
2. **Dashboard-answer widgets can't be pinned individually** — the audit row stores the whole
   dashboard query; pinning needs per-widget extraction. Currently rejected with a clear message.
3. **Insight generation lock is per-process** — two app instances can run the same tenant cycle
   concurrently. Harmless (idempotent upserts) but wasteful; a Redis `SET NX` lock is the fix.
4. **Widget execution has no per-user concurrency cap** — a 30-widget dashboard fires 30 parallel
   SQL queries on first load (each bounded by the runtime timeout and row caps, and cached
   afterwards). Add a small server-side semaphore if DB pressure shows in monitoring.
5. **Timezone**: date boundaries use server time (UTC in containers), not tenant time (IST) —
   consistent with the rest of AI reporting, but "today" can differ by 5.5h around midnight.
   Platform-wide fix, not insights-specific.
6. **Insights are tenant-wide** — visible to any user with `reports.ai.view`, computed under a
   system context. Branch-restricted users see tenant-level aggregates (headline numbers only,
   no row data). Per-scope insight generation is the phase-2 path if this becomes a requirement.
7. **Tenant iteration is sequential and unbatched** in the scheduler — fine for tens of tenants;
   needs batching + per-tenant time budget beyond ~hundreds.
8. **`runtime.enabled` gates widgets and insights** — if a tenant disables the AI provider,
   pinned widgets stop executing (they need no LLM). Consider splitting "AI provider enabled"
   from "AI reporting feature enabled" so SQL-only paths keep working.
9. **No metrics/alerting** on provider failures beyond `last_status` in the admin endpoint —
   wire into the platform's notification module for repeated failures.
10. **E2E coverage** — unit coverage is good (validator repair, rolling window, lifecycle,
    pinning); an API-level e2e of pin → execute → unpin against a seeded DB is the missing layer.

## 11. Known risks / limitations

- **Pinning requires the audit row.** Audit writes are best-effort; if one failed, pinning that
  request returns 404 with a "run the report again" message.
- **Catalog evolution** can orphan pinned widgets; they degrade gracefully ("no longer supported")
  and can be unpinned.
- **Insights are tenant-wide aggregates** computed under a system context. Users restricted to a
  branch see tenant-level insight headlines (no row-level data is exposed — only aggregate
  evidence strings). If per-branch insight scoping is required later, providers can run per
  security scope using the same context mechanism.
- **Dead-stock/churn providers join on display labels** (product/customer names) across two
  catalog reports; duplicate names could under-count. Acceptable for directional insights;
  evidence links let users verify via drill-down.
- **Scheduler duplicate runs** across instances are possible (best-effort in-process guard only)
  but harmless due to idempotent upserts.
