# AI Billing, Credit Management & Governance Platform

Financial-grade billing subsystem that replaces per-tenant AI configuration with a
centralized, super-admin-managed platform: providers, models, pricing, prepaid credit
wallets, an append-only financial ledger, reservation-based charging, Stripe + bank
transfer purchase rails, disputes, refunds, access governance, immutable audit, and
financial reporting.

## 1. Architecture

```
apps/api/src/modules/ai-billing/
  billing.errors.ts            machine-coded HTTP errors (402/403 + stable codes)
  secret-crypto.util.ts        AES-256-GCM key envelope (billing-specific derivation)
  billing-audit.service.ts     immutable audit trail writer/reader
  wallet.service.ts            THE financial core: ledger + balances + reservations
  pricing.service.ts           pricing engine (provider cost vs customer price) + simulator
  registry.service.ts          provider/model registry, failover resolution, key custody
  access.service.ts            AI access governance (USER > TENANT > PLAN policies)
  stripe.client.ts             fetch-based Stripe REST client + HMAC webhook verification
  purchase.service.ts          Stripe checkout + bank-transfer review queue
  refund.service.ts            wallet-credit and cash (Stripe) refunds
  dispute.service.ts           dispute workflow, thread, admin resolution actions
  billing-reporting.service.ts ledger/usage-derived financial reports
  charge.service.ts            pipeline facade: prepare (reserve) / settle (charge|release)
  ai-billing-admin.controller  /platform/ai-billing/**   (SUPER_ADMIN only)
  ai-billing.controller        /ai-billing/**            (tenant-scoped customer surface)
  stripe-webhook.controller    /ai-billing/webhooks/stripe (signature-verified, public)
  ai-billing.module.ts         module + 10-min reservation sweep cron

apps/web/src/pages/billing/AiBilling.tsx          customer dashboard (/billing/ai)
apps/web/src/pages/platform/AiBillingAdmin.tsx    Administration → AI Management (/platform/ai-billing)
apps/web/src/services/api/{ai-billing,platform-ai-billing}.service.ts
```

Integration point: `AiProviderService` (ai-reporting) resolves execution targets from
the central registry FIRST (priority-ordered failover, decrypted key never leaves the
backend) and wraps every LLM call in `AiChargeService.prepare()` → call →
`settle()`. **With `AI_BILLING_ENFORCEMENT` on (the default) there is no legacy
fallback** — an empty central registry means AI is unavailable, because a legacy call
would run unmetered and unbilled. The legacy `ai_tenant_provider_configs` row is
honored only with enforcement OFF (transition deployments); its settings UI has been
removed — tenants can no longer manage keys, providers, models, endpoints, or pricing.

Token metering applies to actual LLM calls (semantic parse, summaries, config
tests). Insight generation consumes no tokens but IS metered: a flat
per-provider-run fee (`AI_INSIGHTS_PROVIDER_RUN_FEE`) goes through the same
reserve→settle ledger lifecycle and appears in usage history as
`insights-generation` rows — insufficient credits block the cycle like any
other AI request. NLQ template shortcuts and pinned-widget executions (cached
SQL reads) remain unmetered by design, though they obey AI access governance
and wallet suspension.

## 2. Database (migration `20260612090000_ai_billing_platform`)

13 tables + 16 enums, all additive. Money columns are `DECIMAL(18,6)` (credits ≈ USD).

| Table | Purpose |
| --- | --- |
| ai_billing_providers | central providers; AES-256-GCM encrypted keys; priority = failover order |
| ai_billing_models | models per provider; default flag; capabilities JSON |
| ai_model_pricing | versioned pricing rows: 6 provider-cost + 6 customer-price fields per 1M tokens, GLOBAL/PLAN/TENANT scope, effective windows |
| ai_wallets | one prepaid wallet per tenant; balance/reserved + lifetime aggregates + thresholds + auto-recharge config |
| ai_wallet_transactions | **append-only ledger** (DB trigger rejects UPDATE/DELETE): signed amount, balanceBefore/After, referenceNo, related entity, actor |
| ai_credit_reservations | pre-flight credit holds (ACTIVE/FINALIZED/RELEASED/EXPIRED) |
| ai_credit_purchases | Stripe + bank-transfer purchases with idempotency keys and review fields |
| ai_usage_logs | token-level usage with the money trail: provider cost, customer charge, margin, reservation + ledger links |
| ai_access_policies | ENABLED/DISABLED/SUSPENDED + model allowlist + request/spend limits per USER/TENANT/PLAN |
| ai_disputes / ai_dispute_messages | dispute workflow + conversation thread |
| ai_refunds | wallet-credit and cash refunds with approver + Stripe refund id |
| ai_billing_audit_logs | **immutable** audit trail (DB trigger): who/what/when/why + before/after + IP |

### Accounting invariants

- **No balance ever changes without a ledger row.** `WalletService` is the only
  writer; every mutation runs in a `SELECT … FOR UPDATE` row-locked transaction
  computing exact `balanceBefore`/`balanceAfter` snapshots.
- `wallet.balance == SUM(ledger.amount)` at all times (covered by unit test).
- Ledger rows and audit logs are append-only **at the database level** (triggers).
- Lifetime aggregates mirror by type: PURCHASE→totalPurchased, USAGE_CHARGE→totalConsumed,
  REFUND→totalRefunded, everything else→totalAdjusted (signed).

## 3. Charging lifecycle (race-safe)

```
prepare:  resolve model+pricing → access policy check (status, allowlist,
          per-query cost, daily/monthly request + spend limits)
          → estimate worst-case charge (full completion budget)
          → RESERVE credits (fails 402 when available = balance − reserved < estimate)
execute:  the AI request runs
settle:   success → compute ACTUAL cost from real token usage → finalize
          (release hold + post USAGE_CHARGE) → usage log CHARGED
          failure → release hold, usage log FAILED, charge 0
```

Stale holds (caller died mid-request) are swept every 10 minutes
(`ReservationSweepScheduler`). Actuals may exceed the estimate slightly — finalization
is allowed to dip below zero (the request already ran); the wallet's
`suspendThreshold` then auto-suspends on the next ledger application.

## 4. Pricing engine

- Provider costs and customer prices are independent → configurable margins.
- Resolution precedence: **TENANT override > PLAN (TenantTier) > GLOBAL**, most recent
  `effectiveFrom` wins inside a scope, with effective-date windows and ACTIVE status.
- Components: input / output / cached input / reasoning / embedding (per 1M tokens)
  and image (per unit). All Decimal math — no floats.
- Simulator endpoint (`POST /platform/ai-billing/pricing/simulate`) returns provider
  cost, customer charge, margin, margin %.
- A billable model with **no active pricing refuses to run** (`AI_PRICING_MISSING`,
  503) — unpriced usage can never leak.

## 5. Purchases

**Stripe** (`POST /ai-billing/purchases/stripe-checkout`): PENDING purchase →
hosted Checkout (URL returned; frontend never touches Stripe keys) → webhook
`checkout.session.completed` → signature verification (HMAC-SHA256 over the RAW body,
±300s replay window, constant-time compare) → idempotent completion (status
transition under row lock + unique `stripe_event_id` + Stripe `Idempotency-Key` on
create) → ledger PURCHASE. `checkout.session.expired` → EXPIRED.

**Bank transfer** (`POST /ai-billing/purchases/bank-transfer`): proof URL/note
required → super-admin review queue → approve (ledger PURCHASE) / reject (wallet
untouched). Statuses: PENDING/COMPLETED/REJECTED/CANCELLED/EXPIRED/REFUNDED.

No cap on purchase frequency; amount bounds 1–100,000 per purchase.

## 6. Disputes & refunds

Workflow: OPEN → UNDER_INVESTIGATION → AWAITING_CUSTOMER → RESOLVED/CLOSED (customer
reply flips AWAITING_CUSTOMER back to investigation). Admin actions — approve/partial
refund (wallet credit or Stripe cash), reject, bonus credits, charge reversal (exact
inverse of the original USAGE_CHARGE row), manual adjustment, escalate — every
monetary action posts a ledger entry, a SYSTEM thread message, and an audit row.
Cash refunds may overdraw an already-spent wallet — the negative balance is the
receivable, visible in the ledger.

## 7. Access governance

`Super Admin → AI Management → access policies`: status (ENABLED/DISABLED/SUSPENDED),
allowed models, daily/monthly request limits, max per-query cost, max daily/monthly
spend — at USER, TENANT, or PLAN scope; per-field precedence USER > TENANT > PLAN.
Enforced in `prepare()` before any credits are reserved (402/403 with stable codes).

## 8. Security

- Provider API keys: super-admin only, AES-256-GCM at rest (`AI_CONFIG_ENCRYPTION_KEY`
  or `JWT_SECRET` derived with a billing-specific context), surfaced as last-4 only,
  decrypted exclusively for backend execution. The frontend has no provider surface.
- All AI requests originate from the backend; the customer API is tenant-scoped by JWT.
- Webhook: HMAC signature + replay window + idempotent processing (above).
- RBAC: admin controller `@Roles('SUPER_ADMIN')`; customer mutations require
  `settings:edit`; reads require `report:read`; module-gated by `ai-reporting`.
- Audit logging masks any value whose key looks like a credential.
- Rate limiting: existing `AiReportingUsageGuard` still applies to AI requests, plus
  the new spend/request limits.

## 9. Configuration

| Env | Meaning | Default |
| --- | --- | --- |
| `AI_BILLING_ENFORCEMENT` | bill + block AI requests through wallets (`true/1/yes/on`) | `true` |
| `AI_INSIGHTS_PROVIDER_RUN_FEE` | credits charged per insight-provider run (insights consume no LLM tokens; this prices the platform compute — a full ~12-provider cycle ≈ 12×, a pin-triggered single-provider refresh = 1×; `0` disables insight metering) | `0.01` |
| `STRIPE_SECRET_KEY` | Stripe API key (card purchases disabled when absent) | — |
| `STRIPE_WEBHOOK_SECRET` | endpoint secret for signature verification | — |
| `APP_PUBLIC_URL` / `FRONTEND_URL` | checkout success/cancel redirect base | `http://localhost:3000` |
| `AI_CONFIG_ENCRYPTION_KEY` | key material for provider-key encryption (≥32 chars; falls back to `JWT_SECRET`) | — |

## 10. Rollout

1. Deploy (`prisma migrate deploy` runs the additive migration; entrypoint does this).
2. Super admin: AI Management → add provider (key) → add models (set default) →
   add GLOBAL pricing rows. The customer flag `settings.aiReporting.enabled` now means
   "module enabled by SA **and** central provider configured".
3. Credit wallets (manual ledger credit, or let customers purchase).
4. Webhook: point Stripe at `POST /api/v1/ai-billing/webhooks/stripe`, set
   `STRIPE_WEBHOOK_SECRET`.
5. To run unbilled while wallets are funded, set `AI_BILLING_ENFORCEMENT=false`
   temporarily — usage is still recorded (UNBILLED) for analytics.

**Rollback:** previous build keeps working — tables are additive and the legacy
per-tenant provider fallback still resolves when the central registry is empty.

## 11. Tests

`apps/api/src/modules/ai-billing/*.spec.ts` — 33 tests:
ledger invariants (snapshots, reconciliation `balance == Σ ledger`, overdraft
rejection, auto-suspend), reservation lifecycle (insufficient available balance,
finalize-with-actuals, zero-charge, double-finalize rejection, below-zero actuals),
pricing math (per-1M Decimal precision, scope precedence, worst-case estimates,
simulator), Stripe webhook security (tampered payload, wrong secret, replay window,
malformed headers, key rotation) and purchase idempotency (replayed webhook = no-op,
reject never credits, re-review refused), access governance (scope precedence,
distinct denial codes, allowlist, request/spend limits).

## 12. Production-readiness audit (June 2026)

PM + architect review of every money path after the initial build. Items marked
FIXED shipped with this audit.

### Fixed in this pass

| # | Severity | Issue | Fix |
| --- | --- | --- | --- |
| 1 | **Critical** | Wallets were credited on `checkout.session.completed` without checking `payment_status` — async payment methods complete the session BEFORE funds settle, so credits could be granted for money that never arrives | Credit only when `payment_status === 'paid'`; handle `async_payment_succeeded` (credit) and `async_payment_failed` (reject); session `amount_total` must match the purchase exactly or the wallet is NOT credited and a `PURCHASE_AMOUNT_MISMATCH` fraud audit entry is written |
| 2 | **Critical** | A usage charge could be reversed twice through disputes — double-paying the customer for one transaction | Duplicate-reversal guard: a `CHARGE_REVERSAL` ledger row already referencing the original transaction rejects the second attempt |
| 3 | **High** | Cumulative refunds against one purchase were uncapped (each ≤ amount, but the SUM was unbounded), and any partial cash refund flipped the purchase to REFUNDED | Refunds are capped at the refundable remainder (original − Σ prior PENDING/COMPLETED refunds); only a FULL cumulative refund marks the purchase REFUNDED |
| 4 | **High** | Dispute "approve refund (CASH)" could never succeed — the action never carried a purchaseId, which cash refunds require. Dead feature | `purchaseId` added to the dispute action (API DTO + service + admin UI input shown for CASH kind) |
| 5 | Medium | Invalid webhook signatures returned 502 — Stripe treats 5xx as endpoint failure and retries aggressively; dashboards show the endpoint as down | Signature/timestamp/payload failures now return 400 (caller error); 502 reserved for actual Stripe API failures |
| 6 | Medium | With enforcement ON and an empty central registry, `settings.aiReporting.enabled` still reported true via the legacy row — menus visible while every AI call is blocked by the pipeline gate | The legacy row only counts toward `enabled` when `AI_BILLING_ENFORCEMENT` is off, matching the execution gate exactly |
| 7 | Medium | Abandoned Stripe checkouts stayed PENDING forever when webhooks were down/misconfigured | The 10-minute sweep cron also expires PENDING Stripe purchases older than 25h (bank transfers exempt — they wait for human review) |
| 8 | Medium (PRD gap) | "Remaining Budget" was missing from the customer dashboard | `/ai-billing/summary` now returns the effective access policy budget (max monthly/daily spend, per-query cap, request limits, remaining monthly budget); rendered as a wallet card |
| 9 | Low | Bank-transfer review queue showed tenant UUIDs | Queue rows carry the tenant name |
| 10 | **Critical** | "No active pricing for model X" with correct pricing configured: the platform's tenant-scoping Prisma middleware auto-injects the CLS tenantId into every model with a `tenantId` field — `AiModelPricing`'s GLOBAL/PLAN rows (tenant_id NULL) became invisible to every tenant request, and PLAN-scope access policies were silently ignored. Raw-SQL probes and mocked-Prisma unit tests both missed it | `AiModelPricing` and `AiAccessPolicy` are platform-governance catalogs whose `tenantId` is a scope override, not an isolation key — exempted from auto-scoping in `PrismaService` (regression spec `prisma-tenant-scoping.spec.ts` locks the exemption AND that tenant-owned billing data stays scoped) |
| 11 | Medium | AI Insights surfaces ignored AI governance — a DISABLED/SUSPENDED account or suspended wallet could keep using AI dashboards (insights/widgets consume no LLM tokens, so there is nothing to *meter*, but access control must still apply) | Widget execution checks the effective access policy + wallet status (403/402 with machine codes); insight generation skips tenants whose AI access is not ENABLED |

### Known gaps to address before / shortly after GA (prioritized)

1. **No notifications** — low-balance/critical thresholds are evaluated but nobody is
   emailed/notified; bank-transfer submissions don't alert the reviewing admin.
   Wire to the existing notifications module.
2. **No API-level e2e** — unit coverage is strong (49 billing tests) but no test runs
   purchase → webhook → ledger → usage charge against a seeded database.
3. **Auto-recharge is configuration-only** — executing it requires Stripe off-session
   payments (saved payment methods), not yet implemented.
4. **Webhook endpoint has no dedicated rate limit** — signature verification is cheap,
   but a flood still costs CPU; put it behind the gateway limiter.
5. **Single-currency (USD credits)** — wallet currency exists per row but there is no
   FX; do not mix currencies within a tenant.
6. **Anthropic/Gemini registry entries are not executable** — the pipeline only speaks
   the OpenAI-compatible chat API; native adapters needed before selling those models.
7. **Daily/monthly limit windows are UTC**, not tenant-local (consistent with the rest
   of the platform; revisit together).
8. **Prompt retention** — query text lives in `ai_report_query_audits` under existing
   retention; a billing-specific retention/privacy toggle per tenant is not yet exposed.
9. **Invoice/receipt PDFs** — purchases have no downloadable receipt; CSV export only.
10. **Settle failures leave holds until the sweep** — if the DB hiccups during settle,
    the request ran but the charge is lost (logged loudly). A retry queue would close
    the residual revenue leak.

## 13. Future-ready hooks (designed, not yet wired)

Subscriptions (PLAN-scope pricing + `ai_access_policies` PLAN rows are the substrate),
credit expiry (`CREDIT_EXPIRY` ledger type exists), promotional credits
(`PROMO_CREDIT`), auto-recharge (wallet fields exist; needs Stripe off-session saved
payment methods), provider failover beyond OpenAI-compatible kinds (anthropic/gemini
registry entries are accepted but not yet executable), model routing, BYO-key, and
white-label billing all extend existing tables without schema changes.
