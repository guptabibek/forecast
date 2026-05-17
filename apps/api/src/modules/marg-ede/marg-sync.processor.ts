import { InjectQueue, Processor, WorkerHost } from '@nestjs/bullmq';
import { Logger, NotFoundException, Optional } from '@nestjs/common';
import { UnrecoverableError, DelayedError, Job, Queue } from 'bullmq';
import { PrismaService } from '../../core/database/prisma.service';
import { QUEUE_NAMES } from '../../core/queue/queue.constants';
import { MargEdeService } from './marg-ede.service';
import { MARG_SYNC_MODE, MARG_SYNC_SCOPE, MargSyncJobData } from './marg-sync.types';
import { SyncLogger } from './sync-logger';

// How many Marg sync jobs this worker process pulls from the shared BullMQ
// queue at the same time. Default 2 — enough to let two tenants sync in
// parallel while staying within typical container memory limits. Bump
// carefully: each in-flight sync can hold a 200–500 MB decoded Marg page
// plus its transform/projection working set, so concurrency × per-sync
// peak memory must fit under NODE_OPTIONS --max-old-space-size.
const MARG_SYNC_WORKER_CONCURRENCY = Math.max(
  1,
  Number.parseInt(process.env.MARG_SYNC_WORKER_CONCURRENCY ?? '2', 10) || 2,
);

@Processor(QUEUE_NAMES.MARG_SYNC, { concurrency: MARG_SYNC_WORKER_CONCURRENCY })
export class MargSyncProcessor extends WorkerHost {
  private readonly logger = new Logger(MargSyncProcessor.name);
  private readonly syncLog = new SyncLogger(MargSyncProcessor.name);

  /**
   * Cap on how many ACTIVE jobs a single tenant may have across the entire
   * worker fleet (all pods). The count is read live from BullMQ's active
   * set in Redis — see countActiveJobsForTenant — so this limit is honored
   * across horizontally scaled workers without needing a separate counter
   * key, TTL machinery, or stale-counter cleanup. BullMQ's stalled-job
   * recovery already handles workers that die mid-process: stalled jobs
   * are removed from active automatically, so the count is self-healing.
   */
  private readonly perTenantConcurrency = Math.max(
    1,
    Number.parseInt(process.env.MARG_SYNC_PER_TENANT_CONCURRENCY ?? '1', 10) || 1,
  );

  constructor(
    private readonly margEdeService: MargEdeService,
    private readonly prisma: PrismaService,
    // Optional so the processor still constructs in test contexts where
    // BullModule is not registered. When undefined, hasOtherTenantWaiting
    // returns false and fairness deferral is skipped — the worker still
    // processes jobs correctly, just without the cross-tenant peek.
    @Optional() @InjectQueue(QUEUE_NAMES.MARG_SYNC) private readonly margSyncQueue?: Queue,
  ) {
    super();
    this.syncLog.info(
      `Marg sync worker initialized: workerConcurrency=${MARG_SYNC_WORKER_CONCURRENCY}, ` +
      `perTenantConcurrency=${this.perTenantConcurrency}, ` +
      `queuePeek=${this.margSyncQueue ? 'enabled' : 'disabled'}, ` +
      `debug=${this.syncLog.debugEnabled}`,
    );
  }

  async process(job: Job<MargSyncJobData>): Promise<any> {
    const {
      configId,
      tenantId,
      triggeredBy,
      fromDate,
      endDate,
      scope = MARG_SYNC_SCOPE.FULL,
      mode = MARG_SYNC_MODE.FETCH,
    } = job.data;

    if (!tenantId) {
      throw new Error('Marg sync job missing tenantId - cannot process without tenant context');
    }

    // --- Fix 3: cross-pod per-tenant fairness via BullMQ active set ---
    // If this tenant already has perTenantConcurrency jobs active across
    // the entire worker fleet (live count from Redis via BullMQ), defer
    // THIS job so other tenants get the slot. Without this, a tenant with
    // several queued jobs (e.g., monthly backfills triggered in a loop)
    // could grab every worker slot — across every pod — and starve other
    // tenants until their burst drains.
    //
    // Why "active count" instead of an in-process map:
    //   - Works across horizontally scaled worker pods (the original
    //     concern with the in-process Map).
    //   - Crash-safe by BullMQ design: when a worker dies mid-job, the
    //     stalled-job machinery moves that job back to waiting/failed and
    //     removes it from active. No counter to leak, no TTL to manage.
    //   - No extra Redis keys, no schema additions, no cleanup cron.
    //
    // Our own job IS already in the active set by the time process() runs
    // (BullMQ moves waiting → active before invoking the handler), so we
    // exclude self when counting. The check is best-effort: any Redis
    // failure returns 0 and we proceed — fairness degrades gracefully
    // to "no fairness" rather than blocking the sync.
    const otherActiveForTenant = await this.countActiveJobsForTenant(tenantId, job.id ?? null);
    if (otherActiveForTenant >= this.perTenantConcurrency) {
      // Only defer if at least one OTHER tenant has waiting work — no
      // point deferring if we'd just pull this same job back next tick.
      const otherTenantWaiting = await this.hasOtherTenantWaiting(tenantId);
      if (otherTenantWaiting) {
        const delayMs = 5_000;
        this.logger.log(
          `Deferring job ${job.id} (tenant=${tenantId}, otherActive=${otherActiveForTenant}, ` +
          `limit=${this.perTenantConcurrency}) by ${delayMs}ms for cross-pod tenant fairness`,
        );
        // moveToDelayed requires the job token; WorkerHost exposes it via
        // the job object after BullMQ has acquired the lock. If somehow
        // missing, fall through and process — fairness is best-effort.
        const token = (job as Job & { token?: string }).token;
        if (token) {
          await job.moveToDelayed(Date.now() + delayMs, token);
          // Throwing DelayedError tells WorkerHost not to mark the job
          // as failed/completed — it's released back to the delayed
          // bucket and will be picked up again after delayMs.
          throw new DelayedError();
        }
      }
    }

    return await this.prisma.executeInTenantContext(tenantId, () => this.processInTenantContext(job));
  }

  /**
   * Cross-pod count of currently-active jobs for the given tenant, read
   * directly from BullMQ's active set in Redis. This is the shared
   * counter that replaces the previous in-process Map — works across N
   * worker pods without any extra infrastructure because BullMQ already
   * tracks active jobs in Redis with their full job data (which includes
   * tenantId).
   *
   * excludeJobId: our own job, which BullMQ has already moved to active
   * by the time process() fires. Counting "others only" lets the limit
   * be enforced strictly (e.g., limit=1 means at most 1 active per
   * tenant — including this job, total = 1).
   *
   * Failure mode: any Redis error returns 0, which makes fairness a
   * no-op rather than blocking the sync. Sync correctness must not
   * depend on the fairness layer being available.
   */
  private async countActiveJobsForTenant(tenantId: string, excludeJobId: string | null): Promise<number> {
    if (!this.margSyncQueue) return 0;
    try {
      // Active count is bounded by the global worker concurrency × number
      // of pods — typically <10 in our scale. Page-size 49 leaves comfortable
      // headroom; the second-page case is unreachable for our deployment
      // size but we cap to avoid pathological scans if BullMQ ever changes.
      const active = await this.margSyncQueue.getJobs(['active'], 0, 49);
      let count = 0;
      for (const a of active) {
        if (!a) continue;
        const aTenant = (a.data as MargSyncJobData | undefined)?.tenantId;
        if (aTenant !== tenantId) continue;
        if (excludeJobId !== null && a.id === excludeJobId) continue;
        count += 1;
      }
      return count;
    } catch (err) {
      this.logger.warn(`countActiveJobsForTenant(${tenantId}) failed; treating as 0: ${(err as Error).message}`);
      return 0;
    }
  }

  /**
   * Cheap peek at the shared BullMQ queue to see whether any waiting job
   * belongs to a tenant other than the one we're about to defer. If no
   * other tenant is waiting, deferring is pointless — the slot would just
   * re-pull this same job.
   *
   * Best-effort: any failure here returns false (= "no other tenant
   * known, just process this one"). We do not block sync on queue
   * inspection — observability, not load-bearing.
   */
  private async hasOtherTenantWaiting(currentTenantId: string): Promise<boolean> {
    if (!this.margSyncQueue) return false;
    try {
      // Sample the first 20 waiting/delayed jobs rather than the full
      // queue — for our workload there are rarely more than a handful in
      // play, and we only need ONE counter-example from a different
      // tenant to decide to defer.
      const waiting = await this.margSyncQueue.getJobs(['waiting', 'delayed'], 0, 19);
      for (const w of waiting) {
        const wTenant = (w?.data as MargSyncJobData | undefined)?.tenantId;
        if (wTenant && wTenant !== currentTenantId) return true;
      }
      return false;
    } catch {
      return false;
    }
  }

  private async processInTenantContext(job: Job<MargSyncJobData>): Promise<any> {
    const {
      configId,
      tenantId,
      triggeredBy,
      fromDate,
      endDate,
      scope = MARG_SYNC_SCOPE.FULL,
      mode = MARG_SYNC_MODE.FETCH,
      resumeSyncLogId,
    } = job.data;

    this.syncLog.info(
      `Starting Marg EDE sync: configId=${configId}, tenantId=${tenantId}` +
      `, mode=${mode}` +
      `, scope=${scope}` +
      `${fromDate ? `, fromDate=${fromDate}` : ''}` +
      `${endDate ? `, endDate=${endDate}` : ''}` +
      `${resumeSyncLogId ? `, resumeSyncLogId=${resumeSyncLogId}` : ''}` +
      `, jobId=${job.id}`,
    );

    try {
      if (mode === MARG_SYNC_MODE.RESUME) {
        if (!resumeSyncLogId) {
          throw new Error('Marg sync resume mode requires resumeSyncLogId in job data');
        }
        const result = await this.margEdeService.resumeSync(configId, tenantId, resumeSyncLogId, triggeredBy);
        this.syncLog.info(
          `Marg EDE resume completed: syncLogId=${result.syncLogId}, ` +
          `pagesResumed=${result.pagesResumed}, pagesFailed=${result.pagesFailed}`,
        );
        return { ...result, status: result.pagesFailed === 0 ? 'completed' : 'partial', mode };
      }

      const syncLogId = mode === MARG_SYNC_MODE.REPROJECT
        ? await this.margEdeService.runReprojection(configId, tenantId, triggeredBy, fromDate, endDate, scope)
        : await this.margEdeService.runSync(configId, tenantId, triggeredBy, fromDate, endDate, scope);
      this.syncLog.info(`Marg EDE ${mode} completed: syncLogId=${syncLogId}`);
      return { syncLogId, status: 'completed', mode };
    } catch (err) {
      // Config was deleted/disabled between enqueue and run. Retrying will
      // never succeed; surface as terminal so BullMQ stops attempting and
      // the operator gets a single clear failure rather than a retry storm.
      if (err instanceof NotFoundException) {
        this.syncLog.warn(
          `Marg EDE ${mode} aborted: config no longer exists (configId=${configId}, tenantId=${tenantId}). ` +
          `Job will not retry. Recreate or re-enable the config to resume syncing.`,
        );
        throw new UnrecoverableError(`Marg config not found (configId=${configId})`);
      }
      this.syncLog.error(`Marg EDE ${mode} failed: ${err}`, (err as Error).stack);
      throw err;
    }
  }
}
