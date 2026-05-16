/**
 * Stable, documented response shape for the Marg sync log / status endpoint.
 *
 * Exists as an explicit DTO (rather than letting Prisma's row scalar set
 * leak directly through the controller) so the wire contract is reviewable
 * and BigInt columns are coerced to safe JSON-friendly types before they
 * leave the service.
 *
 * Backward compatibility: every field that existed on the legacy log
 * response is preserved with the same name and type. The new fields are
 * additive; existing UI consumers that only read the legacy fields are
 * unaffected.
 */
export interface MargSyncLogStatusDto {
  // ===== Legacy fields (preserved verbatim) =====
  id: string;
  tenantId: string;
  configId: string;
  status: string;
  startedAt: Date | string | null;
  completedAt: Date | string | null;
  productsSynced: number;
  partiesSynced: number;
  transactionsSynced: number;
  stockSynced: number;
  branchesSynced: number;
  vouchersSynced: number;
  saleTypesSynced: number;
  accountGroupsSynced: number;
  accountPostingsSynced: number;
  accountGroupBalancesSynced: number;
  partyBalancesSynced: number;
  outstandingsSynced: number;
  journalEntriesSynced: number;
  errors: unknown;
  syncIndex: number | null;
  syncDatetime: string | null;
  createdAt: Date | string | null;

  // ===== Resumable-pipeline progress (additive) =====
  currentStage: string | null;
  currentApiType: string | null;
  currentRequestIndex: number | null;
  currentResponseIndex: number | null;
  currentEntityType: string | null;
  currentBatchNumber: number | null;
  /**
   * Coerced from BigInt in the service to keep precision for >2^53 totals.
   * Always serialized as a string when transported as JSON.
   */
  rowsProcessed: string;
  totalRowsDiscovered: string | null;
  lastHeartbeatAt: Date | string | null;
  retryCount: number;
  failureType: string | null;
  resumedFromSyncLogId: string | null;
  fromDate: string | null;
  endDate: string | null;
  syncMode: string | null;
  syncScope: string | null;

  /** Derived: ms since the last heartbeat, or null if no heartbeat ever. */
  heartbeatAgeMs: number | null;
  /** Derived: true if status=RUNNING but heartbeat exceeds the stale threshold. */
  isStale: boolean;
}

/**
 * Serialize a Prisma MargSyncLog row into the documented DTO. BigInt columns
 * become strings so Express response.json does not need the global BigInt
 * serializer to be loaded (still defense-in-depth — the global serializer
 * is also installed in main.ts).
 */
export function toMargSyncLogStatusDto(
  row: Record<string, unknown>,
  staleAfterMs: number,
): MargSyncLogStatusDto {
  const heartbeatRaw = row.lastHeartbeatAt as Date | string | null | undefined;
  const heartbeatAt = heartbeatRaw ? new Date(heartbeatRaw as string | Date).getTime() : null;
  const heartbeatAgeMs = heartbeatAt !== null ? Date.now() - heartbeatAt : null;
  const isStale = row.status === 'RUNNING'
    && heartbeatAgeMs !== null
    && heartbeatAgeMs > staleAfterMs;

  const bigIntToString = (v: unknown): string | null => {
    if (v == null) return null;
    if (typeof v === 'bigint') return v.toString();
    if (typeof v === 'number') return String(v);
    if (typeof v === 'string') return v;
    return null;
  };

  return {
    id: row.id as string,
    tenantId: row.tenantId as string,
    configId: row.configId as string,
    status: row.status as string,
    startedAt: (row.startedAt as Date | string | null | undefined) ?? null,
    completedAt: (row.completedAt as Date | string | null | undefined) ?? null,
    productsSynced: Number(row.productsSynced ?? 0),
    partiesSynced: Number(row.partiesSynced ?? 0),
    transactionsSynced: Number(row.transactionsSynced ?? 0),
    stockSynced: Number(row.stockSynced ?? 0),
    branchesSynced: Number(row.branchesSynced ?? 0),
    vouchersSynced: Number(row.vouchersSynced ?? 0),
    saleTypesSynced: Number(row.saleTypesSynced ?? 0),
    accountGroupsSynced: Number(row.accountGroupsSynced ?? 0),
    accountPostingsSynced: Number(row.accountPostingsSynced ?? 0),
    accountGroupBalancesSynced: Number(row.accountGroupBalancesSynced ?? 0),
    partyBalancesSynced: Number(row.partyBalancesSynced ?? 0),
    outstandingsSynced: Number(row.outstandingsSynced ?? 0),
    journalEntriesSynced: Number(row.journalEntriesSynced ?? 0),
    errors: row.errors ?? [],
    syncIndex: row.syncIndex == null ? null : Number(row.syncIndex),
    syncDatetime: (row.syncDatetime as string | null | undefined) ?? null,
    createdAt: (row.createdAt as Date | string | null | undefined) ?? null,

    currentStage: (row.currentStage as string | null | undefined) ?? null,
    currentApiType: (row.currentApiType as string | null | undefined) ?? null,
    currentRequestIndex: row.currentRequestIndex == null ? null : Number(row.currentRequestIndex),
    currentResponseIndex: row.currentResponseIndex == null ? null : Number(row.currentResponseIndex),
    currentEntityType: (row.currentEntityType as string | null | undefined) ?? null,
    currentBatchNumber: row.currentBatchNumber == null ? null : Number(row.currentBatchNumber),
    rowsProcessed: bigIntToString(row.rowsProcessed) ?? '0',
    totalRowsDiscovered: bigIntToString(row.totalRowsDiscovered),
    lastHeartbeatAt: heartbeatRaw ?? null,
    retryCount: Number(row.retryCount ?? 0),
    failureType: (row.failureType as string | null | undefined) ?? null,
    resumedFromSyncLogId: (row.resumedFromSyncLogId as string | null | undefined) ?? null,
    fromDate: (row.fromDate as string | null | undefined) ?? null,
    endDate: (row.endDate as string | null | undefined) ?? null,
    syncMode: (row.syncMode as string | null | undefined) ?? null,
    syncScope: (row.syncScope as string | null | undefined) ?? null,

    heartbeatAgeMs,
    isStale,
  };
}
