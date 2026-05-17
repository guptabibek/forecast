/**
 * Sync flow logger that bypasses Nest's global log-level filter.
 *
 * Operators rely on the Marg sync log stream for visibility into a job
 * that can run for tens of minutes and stage millions of rows. When the
 * rest of the API is dialed down to LOG_LEVEL=error,warn (the recommended
 * default to cut request-log noise), generic `this.logger.log(...)` calls
 * are suppressed by Nest before they reach any transport. This class
 * writes directly to stdout/stderr instead, so sync visibility is decoupled
 * from the global filter.
 *
 * Output format mirrors Nest's ConsoleLogger so existing log aggregators
 * (Loki, CloudWatch, etc.) keep parsing fields correctly:
 *   [Nest] <pid>  - <ISO>     <LEVEL> [<context>] <message>
 *
 * `info()` and `debug()` carry the [MARG-SYNC] tag so the operator can
 * grep the whole sync trail with one filter even if the context line
 * shifts between callers.
 */
const pid = process.pid;
const SYNC_TAG = '[MARG-SYNC]';

function fmt(level: string, context: string, message: string): string {
  const ts = new Date().toISOString();
  return `[Nest] ${pid}  - ${ts}     ${level.padEnd(7)} [${context}] ${message}\n`;
}

// Debug verbosity is opt-in: per-batch progress at hundred-thousand-row
// scale floods logs without being load-bearing. MARG_SYNC_DEBUG=true (or
// 1) turns it on; everything else (default) keeps info/warn/error only.
const DEBUG_ENABLED = (() => {
  const raw = (process.env.MARG_SYNC_DEBUG ?? '').toLowerCase();
  return raw === 'true' || raw === '1' || raw === 'yes';
})();

export class SyncLogger {
  constructor(private readonly context: string) {}

  /** Always emitted. Use for stage transitions, page counts, totals. */
  info(message: string): void {
    process.stdout.write(fmt('LOG', this.context, `${SYNC_TAG} ${message}`));
  }

  /** Always emitted. Use for non-fatal anomalies (FK self-heal, retries). */
  warn(message: string): void {
    process.stderr.write(fmt('WARN', this.context, `${SYNC_TAG} ${message}`));
  }

  /** Always emitted. Use for fatal pipeline failures. */
  error(message: string, stack?: string): void {
    process.stderr.write(fmt('ERROR', this.context, `${SYNC_TAG} ${message}`));
    if (stack) process.stderr.write(`${stack}\n`);
  }

  /** Gated by MARG_SYNC_DEBUG. Use for per-batch / per-row chatter. */
  debug(message: string): void {
    if (!DEBUG_ENABLED) return;
    process.stdout.write(fmt('DEBUG', this.context, `${SYNC_TAG} ${message}`));
  }

  get debugEnabled(): boolean {
    return DEBUG_ENABLED;
  }
}
