# Marg EDE Sync — Production Deployment Checklist

Audience: operator deploying the resumable Marg EDE sync pipeline to a
million-record client. Walk these in order; do not skip the verification
steps.

## 1. Required environment variables

Set these in the API service environment before starting the worker.

| Variable | Required | Default | Notes |
|---|---|---|---|
| `MARG_RAW_PAGE_STORAGE_DIR` | **yes** | `./.marg-raw-pages` | Filesystem path the worker writes decrypted Marg page payloads to. Must be on a volume sized per §4 below and writable by the API/worker user. |
| `MARG_STAGING_BATCH_SIZE` | no | `5000` | Rows per bulk INSERT. Raise to 10k for high-throughput Postgres; lower to 2k if you hit lock waits. |
| `MARG_TRANSFORM_BATCH_SIZE` | no | `2000` | Per-batch row count for transform-stage loops. |
| `MARG_PROJECTION_BATCH_SIZE` | no | `1000` | Per-batch row count for projection (journal entries / inventory ledger). |
| `MARG_DB_TX_TIMEOUT_MS` | no | `300000` (5 min) | Per-batch DB transaction timeout. Increase only if you see legitimate timeouts on large batches; lowering is risky. |
| `MARG_ACCOUNTING_PROJECTION_TX_TIMEOUT_MS` | no | `60000` | Accounting projection transaction timeout. |
| `MARG_DATA_HTTP_TIMEOUT_MS` | no | `120000` | HTTP read timeout for the Marg EDE POST. **Raise to 600000 (10 min) for the first-time backfill** — 50MB encrypted payloads on a slow link can take minutes. |
| `MARG_SYNC_MAX_PAGES` | no | `500` | Hard ceiling on pages per sync run, defense against runaway loops. Bump if the first-time backfill legitimately needs more. |
| `MARG_SYNC_STALE_AFTER_MS` | no | `1800000` (30 min) | Threshold for `recoverStaleSyncLog` — a RUNNING sync with no heartbeat for this long is recoverable. |
| `MARG_HTTP_TIMEOUT_MS` | no | `30000` | HTTP timeout for branch list / lightweight calls. |
| `REDIS_URL` | **yes** for queues | — | Without Redis the worker falls back to inline execution which holds the HTTP request — unsuitable for million-record syncs. |

After setting, restart both the API process and the worker. The env is read
once at construction.

## 2. Database migrations (apply in this order)

```bash
npx prisma migrate deploy --schema=apps/api/prisma/schema.prisma
```

This applies all pending migrations including:

- `20260516120000_add_marg_resumable_sync_pipeline` — `marg_raw_sync_pages`
  table, `MargSyncLog` progress columns, RLS policy on the new table.
- `20260516130000_add_marg_sync_log_window_metadata` — `from_date`,
  `end_date`, `sync_scope`, `sync_mode` on `marg_sync_logs`.

Verify after apply:

```sql
-- Table exists and is RLS-enabled
SELECT relname, relrowsecurity FROM pg_class WHERE relname='marg_raw_sync_pages';
-- New MargSyncLog columns exist
\d marg_sync_logs
```

## 3. First-time backfill for a million-record client

**Do not** start an unbounded incremental sync against a million-record
client. The fetch loop will run for hours and a single failure forces a
full restart even with the new resume safety net (resume re-stages saved
pages but cannot recover pages that were never fetched).

Run the backfill in date windows, smallest practical chunks:

```bash
# Pull a month at a time. Use date order chronologically so each chunk
# completes independently. The official cursor does NOT advance for
# bounded windows, so this is safe to interleave with incremental.
curl -X POST "$API/v1/marg-ede/configs/$CFG/sync?fromDate=2024-01-01&endDate=2024-01-31" -H "Authorization: Bearer $T"
curl -X POST "$API/v1/marg-ede/configs/$CFG/sync?fromDate=2024-02-01&endDate=2024-02-29" -H "Authorization: Bearer $T"
# … repeat for each month up to the present.
```

For very large stores split further (weekly or by `companyId`). Track each
job's `syncLogId` in a spreadsheet so you know what's been backfilled.

After the historical windows finish, switch to unbounded incremental:

```bash
curl -X POST "$API/v1/marg-ede/configs/$CFG/sync" -H "Authorization: Bearer $T"
```

This is the run that advances the official `lastSyncIndex` cursor.

## 4. Raw-page storage disk sizing

The filesystem backend stores **gzip-compressed JSON** per page. Real-world
compression on Marg payloads is 10–25× (very repetitive Detail rows).

Rule of thumb:

| Encrypted page size | Decrypted JSON | Compressed on disk | Pages per backfill (typical M-row client) | Total |
|---|---|---|---|---|
| 5 MB | ~25 MB | ~2 MB | ~200 | ~400 MB |
| 50 MB | ~250 MB | ~15 MB | ~200 | ~3 GB |

Provision at least **3× the worst-case backfill size** so a re-backfill can
land alongside the existing snapshot. Use a separate volume from the DB if
possible; an `ENOSPC` on the storage volume will fail staging but not
corrupt the DB.

Run `POST /v1/marg-ede/raw-pages/cleanup?maxAgeDays=30` periodically to
purge old sync directories. The endpoint is ADMIN-only.

## 5. Monitoring sync progress

The new `GET /v1/marg-ede/configs/:id/syncs/:syncLogId/status` returns the
`MargSyncLogStatusDto`:

- `status` — RUNNING / COMPLETED / FAILED
- `currentStage` — FETCHING / STAGING_STARTED / INVENTORY_PROJECTION_STARTED / …
- `currentApiType`, `currentRequestIndex` — which Marg page is being fetched
- `currentEntityType`, `currentBatchNumber` — which entity / batch is in flight
- `rowsProcessed` — total rows touched across all entities (string, BigInt-precise)
- `lastHeartbeatAt`, `heartbeatAgeMs`, `isStale` — liveness
- `retryCount` — number of resume attempts
- `fromDate`, `endDate`, `syncMode`, `syncScope` — what this run is doing

Poll every 10–30 seconds during a large sync. The status endpoint is cheap
(one PK lookup).

## 6. Handling a failed sync

1. Inspect the status: `GET /configs/:id/syncs/:syncLogId/status`.
2. Read `failureType`:
   - **FATAL** — operator intervention required. Common causes:
     `DECRYPT_FAILED` (wrong key), `MARG_AUTH` (invalid credentials),
     `STORAGE_HASH_MISMATCH` (corrupt raw page), `PRISMA_P2002` (data
     contract violation). Fix the root cause, then start a fresh sync.
     Resume will refuse a FATAL log.
   - **RETRYABLE** — try resume (next step).
3. Resume from saved raw pages (no Marg refetch):
   `POST /configs/:id/syncs/:syncLogId/resume`. This re-stages every
   `PENDING_STAGE` / `STAGING_FAILED` page using the original fromDate /
   endDate captured on the log.
4. After resume reports `pagesFailed: 0`, run reprojection to apply
   transforms: `POST /configs/:id/reproject` (with the same fromDate /
   endDate window if the original was bounded).

## 7. Recovering a stale RUNNING sync

If the worker crashes before its outer catch handler can mark the log
FAILED, the sync log stays RUNNING and the config lock stays held. Both
the scheduler (every hour) and the explicit endpoint will recover this:

```bash
# Operator-initiated immediate recovery:
curl -X POST "$API/v1/marg-ede/configs/$CFG/syncs/$LOG/recover-stale" -H "Authorization: Bearer $T"
```

Result codes:

- `recovered` — log was stale, marked FAILED_RETRYABLE, config lock released.
- `not_stale` — heartbeat is current; nothing changed.
- `not_running` — log already terminal (COMPLETED / FAILED).
- `not_found` — bad (tenant, config, syncLogId) combination.

After `recovered`, you can call `/resume` if there are saved raw pages,
or start a fresh sync if there are none.

## 8. Verifying row counts

After a backfill window completes, cross-check three sources:

```sql
-- 1. Staged rows for the window
SELECT COUNT(*) FROM marg_transactions WHERE tenant_id = $1 AND date BETWEEN $2 AND $3;

-- 2. Projected actuals (sales/COGS facts)
SELECT COUNT(*) FROM actuals
 WHERE tenant_id = $1 AND source_system = 'MARG_EDE'
   AND business_date BETWEEN $2 AND $3;

-- 3. Inventory ledger movements
SELECT COUNT(*) FROM inventory_ledger
 WHERE tenant_id = $1 AND reference_type = 'MARG_EDE'
   AND created_at BETWEEN $2 AND $3;
```

Compare against the totals shown in Marg ERP for the same window. Any
gap above 0.01% should be investigated — start with
`/staged/transactions` for the affected dates.

## 9. Accounting-only / inventory-only reprojection

To re-run accounting projection without touching inventory:

```bash
curl -X POST "$API/v1/marg-ede/configs/$CFG/reproject/accounting?fromDate=...&endDate=..." -H "Authorization: Bearer $T"
```

For the full reprojection (transforms + projections + reconciliation):

```bash
curl -X POST "$API/v1/marg-ede/configs/$CFG/reproject?fromDate=...&endDate=..." -H "Authorization: Bearer $T"
```

These read from already-staged data. Use after a `/resume` to apply the
freshly re-staged pages to core tables.

## 10. Pre-flight check (run before going live)

1. `npx prisma migrate status` — confirm both new migrations are applied.
2. `npx tsc --noEmit -p apps/api/tsconfig.json` — typecheck clean.
3. `npx jest apps/api/src/modules/marg-ede` — all 72 marg tests pass.
4. Confirm `MARG_RAW_PAGE_STORAGE_DIR` exists and is writable:
   `touch $MARG_RAW_PAGE_STORAGE_DIR/.healthcheck && rm $MARG_RAW_PAGE_STORAGE_DIR/.healthcheck`.
5. Confirm `REDIS_URL` is reachable from the API/worker pod:
   `redis-cli -u $REDIS_URL ping`.
6. Trigger a smoke sync against a small test config (or a 1-day window on
   the large client) and watch the status endpoint advance through
   FETCHING → STAGING_STARTED → STAGING_COMPLETED → …  → COMPLETED.

## 11. Rollback plan

Both migrations are additive (new tables / nullable columns / new
constraints with `IF NOT EXISTS`). Rolling back the code without rolling
back the DB is safe — the old runSync ignores the new columns. If you
need to roll back the DB:

```sql
-- Reverse order
DROP TABLE IF EXISTS marg_raw_sync_pages;
ALTER TABLE marg_sync_logs
  DROP COLUMN IF EXISTS current_stage,
  DROP COLUMN IF EXISTS current_api_type,
  DROP COLUMN IF EXISTS current_request_index,
  DROP COLUMN IF EXISTS current_response_index,
  DROP COLUMN IF EXISTS current_entity_type,
  DROP COLUMN IF EXISTS current_batch_number,
  DROP COLUMN IF EXISTS rows_processed,
  DROP COLUMN IF EXISTS total_rows_discovered,
  DROP COLUMN IF EXISTS last_heartbeat_at,
  DROP COLUMN IF EXISTS retry_count,
  DROP COLUMN IF EXISTS failure_type,
  DROP COLUMN IF EXISTS resumed_from_sync_log_id,
  DROP COLUMN IF EXISTS from_date,
  DROP COLUMN IF EXISTS end_date,
  DROP COLUMN IF EXISTS sync_scope,
  DROP COLUMN IF EXISTS sync_mode;
```

Do **not** drop columns while the new code is still deployed — the worker
will fail on every sync. Roll back the code first.
