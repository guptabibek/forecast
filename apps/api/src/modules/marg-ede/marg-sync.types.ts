export const MARG_SYNC_SCOPE = {
  FULL: 'full',
  ACCOUNTING: 'accounting',
} as const;

export type MargSyncScope = (typeof MARG_SYNC_SCOPE)[keyof typeof MARG_SYNC_SCOPE];

export const MARG_SYNC_MODE = {
  FETCH: 'fetch',
  REPROJECT: 'reproject',
  RESUME: 'resume',
} as const;

export type MargSyncMode = (typeof MARG_SYNC_MODE)[keyof typeof MARG_SYNC_MODE];

export interface MargSyncJobData {
  configId: string;
  tenantId: string;
  triggeredBy?: string;
  fromDate?: string;
  endDate?: string;
  scope?: MargSyncScope;
  mode?: MargSyncMode;
  /** When mode=resume, the existing sync log to resume from saved raw pages. */
  resumeSyncLogId?: string;
}

// ===== Resumable pipeline stages =====
//
// Soft enum (string) so we can extend without a Postgres enum migration.
// Stored in marg_sync_logs.current_stage. Status remains the coarse
// MargSyncStatus (RUNNING/COMPLETED/FAILED); these stages refine the
// "where exactly inside RUNNING are we?" question and drive resume logic.
export const MARG_SYNC_STAGE = {
  QUEUED: 'QUEUED',
  FETCHING: 'FETCHING',
  RAW_PAGE_SAVED: 'RAW_PAGE_SAVED',
  STAGING_STARTED: 'STAGING_STARTED',
  STAGING_COMPLETED: 'STAGING_COMPLETED',
  MASTER_TRANSFORM_STARTED: 'MASTER_TRANSFORM_STARTED',
  MASTER_TRANSFORM_COMPLETED: 'MASTER_TRANSFORM_COMPLETED',
  INVENTORY_PROJECTION_STARTED: 'INVENTORY_PROJECTION_STARTED',
  INVENTORY_PROJECTION_COMPLETED: 'INVENTORY_PROJECTION_COMPLETED',
  ACCOUNTING_PROJECTION_STARTED: 'ACCOUNTING_PROJECTION_STARTED',
  ACCOUNTING_PROJECTION_COMPLETED: 'ACCOUNTING_PROJECTION_COMPLETED',
  RECONCILIATION_STARTED: 'RECONCILIATION_STARTED',
  RECONCILIATION_COMPLETED: 'RECONCILIATION_COMPLETED',
  COMPLETED: 'COMPLETED',
  FAILED_RETRYABLE: 'FAILED_RETRYABLE',
  FAILED_FATAL: 'FAILED_FATAL',
} as const;

export type MargSyncStage = (typeof MARG_SYNC_STAGE)[keyof typeof MARG_SYNC_STAGE];

// ===== Raw page status =====
//
// Stored in marg_raw_sync_pages.status. The DB CHECK constraint enforces
// exactly these values.
export const MARG_RAW_PAGE_STATUS = {
  PENDING_STAGE: 'PENDING_STAGE',
  STAGING: 'STAGING',
  STAGED: 'STAGED',
  STAGING_FAILED: 'STAGING_FAILED',
  DISCARDED: 'DISCARDED',
} as const;

export type MargRawPageStatus = (typeof MARG_RAW_PAGE_STATUS)[keyof typeof MARG_RAW_PAGE_STATUS];

// ===== Failure classification =====
//
// Determines whether a sync log can be resumed (RETRYABLE) or requires
// developer intervention (FATAL). Persisted to marg_sync_logs.failure_type
// when status=FAILED.
export const MARG_FAILURE_TYPE = {
  RETRYABLE: 'RETRYABLE',
  FATAL: 'FATAL',
} as const;

export type MargFailureType = (typeof MARG_FAILURE_TYPE)[keyof typeof MARG_FAILURE_TYPE];

export interface MargSyncErrorClassification {
  type: MargFailureType;
  errorCode: string;
  message: string;
  stack?: string;
  retryable: boolean;
}

/**
 * Classify a thrown error into RETRYABLE vs FATAL so the worker / scheduler
 * knows whether to offer resume.
 *
 * Heuristics, in order of precedence:
 *   1. Explicit MargFatalError / MargRetryableError sentinels (highest trust).
 *   2. Common transient failure shapes — network timeout, ECONNRESET, Prisma
 *      P2024 / P1001 / P1002 (connection/timeout codes), Postgres deadlock
 *      40P01, BullMQ worker crash markers — classified RETRYABLE.
 *   3. Decryption failures, "Marg API failure" envelope errors with
 *      credential/CompanyCode messages, Prisma P2002 unique-constraint
 *      violations on a key the application owns — classified FATAL.
 *   4. Anything unrecognized defaults to RETRYABLE so we err on the side
 *      of letting an operator try again. The error is still logged with the
 *      full classifier output so a fatal-but-misclassified case can be
 *      promoted in code without losing data.
 */
export function classifyMargSyncError(err: unknown): MargSyncErrorClassification {
  const message = err instanceof Error ? err.message : String(err);
  const stack = err instanceof Error && typeof err.stack === 'string' ? err.stack : undefined;

  if (err && typeof err === 'object' && (err as { __margClassification?: MargSyncErrorClassification }).__margClassification) {
    return (err as { __margClassification: MargSyncErrorClassification }).__margClassification;
  }

  const code = ((err as { code?: unknown })?.code != null && typeof (err as { code?: unknown }).code === 'string')
    ? ((err as { code: string }).code).toUpperCase()
    : '';
  const lower = message.toLowerCase();

  // ----- Fatal classes -----
  // Bad decryption key: AES decipher.final raises an "OpenSSL" / "wrong final
  // block length" / "bad decrypt" error. None of these are recoverable by
  // retrying without operator intervention.
  if (
    lower.includes('bad decrypt') ||
    lower.includes('wrong final block length') ||
    lower.includes('error:1c800064:digital envelope routines') ||
    lower.includes('unable to authenticate data')
  ) {
    return { type: 'FATAL', errorCode: 'DECRYPT_FAILED', message, stack, retryable: false };
  }

  // Marg envelope-level rejection of credentials / company code.
  if (lower.includes('marg api failure') && (
    lower.includes('credential') ||
    lower.includes('company') ||
    lower.includes('invalid key') ||
    lower.includes('unauthor')
  )) {
    return { type: 'FATAL', errorCode: 'MARG_AUTH', message, stack, retryable: false };
  }

  // Schema/business invariant violation
  if (code === 'P2002' || code === 'P2003' || code === 'P2025') {
    return { type: 'FATAL', errorCode: `PRISMA_${code}`, message, stack, retryable: false };
  }

  // ----- Retryable classes -----
  if (
    code === 'P2024' ||                    // connection pool timeout
    code === 'P1001' ||                    // can't reach DB
    code === 'P1002' ||                    // DB connection timeout
    code === 'P1008' ||                    // operation timed out
    code === 'P1017' ||                    // server closed connection
    code === '40P01' ||                    // Postgres deadlock_detected
    code === 'ECONNRESET' ||
    code === 'ETIMEDOUT' ||
    code === 'ECONNABORTED' ||
    code === 'EAI_AGAIN' ||
    code === 'ECONNREFUSED' ||
    code === 'ENOTFOUND' ||
    code === 'AbortError' ||
    code === 'UND_ERR_HEADERS_TIMEOUT' ||
    code === 'UND_ERR_BODY_TIMEOUT'
  ) {
    return { type: 'RETRYABLE', errorCode: code, message, stack, retryable: true };
  }

  if (
    lower.includes('timeout') ||
    lower.includes('timed out') ||
    lower.includes('econnreset') ||
    lower.includes('socket hang up') ||
    lower.includes('aborted') ||
    lower.includes('temporarily unavailable') ||
    lower.includes('service unavailable') ||
    lower.includes('connection terminated') ||
    lower.includes('deadlock') ||
    lower.includes('worker has crashed') ||
    lower.includes('exceeded max pages')   // bounded backfill hit ceiling — retryable with bigger window
  ) {
    return { type: 'RETRYABLE', errorCode: 'TRANSIENT', message, stack, retryable: true };
  }

  // Default: lean retryable. An operator can re-classify in code if needed.
  return { type: 'RETRYABLE', errorCode: 'UNCLASSIFIED', message, stack, retryable: true };
}

/**
 * Wrap an error so its classification is preserved through error chains and
 * the BullMQ retry layer. Use when the calling code knows the precise
 * classification and does not want it inferred.
 */
export class MargFatalError extends Error {
  readonly __margClassification: MargSyncErrorClassification;
  constructor(message: string, errorCode = 'FATAL', cause?: unknown) {
    super(message);
    this.name = 'MargFatalError';
    if (cause !== undefined) {
      (this as { cause?: unknown }).cause = cause;
    }
    this.__margClassification = {
      type: 'FATAL',
      errorCode,
      message,
      stack: this.stack,
      retryable: false,
    };
  }
}

export class MargRetryableError extends Error {
  readonly __margClassification: MargSyncErrorClassification;
  constructor(message: string, errorCode = 'RETRYABLE', cause?: unknown) {
    super(message);
    this.name = 'MargRetryableError';
    if (cause !== undefined) {
      (this as { cause?: unknown }).cause = cause;
    }
    this.__margClassification = {
      type: 'RETRYABLE',
      errorCode,
      message,
      stack: this.stack,
      retryable: true,
    };
  }
}

// ===== Per-page raw payload metadata used by the storage abstraction =====
export interface MargRawPagePayloadDescriptor {
  /**
   * Logical key the storage backend uses to address the payload. For the
   * filesystem backend this is a relative path under MARG_RAW_PAGE_STORAGE_DIR.
   * For an object-store backend it is the object key.
   */
  storagePath: string;
  /** SHA-256 of the decrypted payload bytes for integrity verification on read. */
  payloadHash: string;
  /** Decrypted payload size in bytes. */
  decryptedSize: number;
}

export interface MargRawPageSavePayload {
  tenantId: string;
  configId: string;
  syncLogId: string;
  apiType: '1' | '2';
  companyId: number;
  requestIndex: number;
  /** Decrypted, parsed payload as a JSON-serializable object. */
  parsedPayload: unknown;
}