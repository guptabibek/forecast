import { InjectQueue } from '@nestjs/bullmq';
import { Injectable, Logger, Optional } from '@nestjs/common';
import { Cron, CronExpression } from '@nestjs/schedule';
import { MargSyncConfig, MargSyncStatus } from '@prisma/client';
import { Queue } from 'bullmq';
import { PrismaService } from '../../core/database/prisma.service';
import { QUEUE_NAMES } from '../../core/queue/queue.constants';
import { MargEdeService } from './marg-ede.service';
import { MARG_SYNC_SCOPE } from './marg-sync.types';
import { SyncLogger } from './sync-logger';

// Threshold for declaring a RUNNING sync stale. Driven by
// MARG_SYNC_STALE_AFTER_MS so it matches the operator-facing
// recoverStaleSyncLog and listLockedConfigs endpoints. Default 30 min.
// Previously hardcoded to 2 hours and based on startedAt — which killed
// healthy long-running syncs whose heartbeats were perfectly fresh.
function parseStaleMs(): number {
  const raw = Number(process.env.MARG_SYNC_STALE_AFTER_MS);
  return Number.isFinite(raw) && raw > 0 ? raw : 30 * 60 * 1000;
}

@Injectable()
export class MargSyncScheduler {
  private readonly logger = new Logger(MargSyncScheduler.name);
  private readonly syncLog = new SyncLogger(MargSyncScheduler.name);
  private readonly staleAfterMs = parseStaleMs();

  constructor(
    private readonly prisma: PrismaService,
    private readonly margEdeService: MargEdeService,
    @Optional() @InjectQueue(QUEUE_NAMES.MARG_SYNC) private readonly margSyncQueue: Queue | null,
  ) {}

  /**
   * Run every hour. Configs are checked against their syncFrequency.
   *
   * EVERY query inside this tick is deliberately cross-tenant — the scheduler
   * is a platform-level housekeeper that scans / heals / dispatches across
   * the whole fleet. We wrap the entire tick in `executeWithoutTenantScopeWarning`
   * so:
   *   - The Prisma tenant-scope middleware does NOT log a `Tenant-scoped
   *     model … accessed without tenant context` warning for each query
   *     (it would fire on every cron tick, polluting logs and masking real
   *     accidental bypasses elsewhere).
   *   - The intent ("yes, this is global by design") is explicit in code.
   *   - Per-config sync execution still happens inside
   *     `executeInTenantContext` further down, so the actual sync work is
   *     tenant-scoped correctly. Only the cross-tenant DISCOVERY /
   *     RECOVERY / ENQUEUE steps run unscoped.
   *
   * Tick cadence: every hour matches the most aggressive `syncFrequency`
   * tenants can configure (HOURLY). DAILY / WEEKLY configs simply skip the
   * `isDue` check on most ticks. If your deployment needs HOURLY syncs to
   * start within <60 min of becoming due, switch the cron expression to
   * `EVERY_30_MINUTES` (or finer) — there's no correctness cost, only
   * marginally more DB chatter per tick.
   */
  @Cron(CronExpression.EVERY_HOUR)
  async scheduleActiveSyncs(): Promise<void> {
    return this.prisma.executeWithoutTenantScopeWarning(async () => {
      await this.recoverStaleConfigsAndLogs();
      await this.dispatchDueConfigs();
    });
  }

  /**
   * Cross-tenant stale-lock recovery.
   *
   * Stale = heartbeat older than threshold. Crucial: a sync that has been
   * RUNNING for hours is NOT stale if its heartbeat is fresh; only the
   * ABSENCE of recent heartbeat indicates a crashed worker. Previously
   * this used `startedAt < 2h ago`, which incorrectly killed healthy
   * long-running syncs the moment they crossed the 2h mark.
   *
   * Intentionally global: a worker death in any tenant's namespace
   * produces a stuck lock that only this sweep can unstick. Iterating
   * tenant-by-tenant would just be slower with no safety benefit.
   */
  private async recoverStaleConfigsAndLogs(): Promise<void> {
    const staleCutoff = new Date(Date.now() - this.staleAfterMs);

    // Reset configs whose updatedAt is older than the threshold. updatedAt
    // ticks on every heartbeat (touchSyncHeartbeat calls .update on the
    // config row), so this catches workers that died without writing the
    // FAILED status back. Healthy syncs touch the row frequently enough
    // that they will never appear here.
    const staleReset = await this.prisma.margSyncConfig.updateMany({
      where: {
        lastSyncStatus: MargSyncStatus.RUNNING,
        updatedAt: { lt: staleCutoff },
      },
      data: {
        lastSyncStatus: MargSyncStatus.FAILED,
        lastAccountingSyncStatus: MargSyncStatus.FAILED,
      },
    });
    if (staleReset.count > 0) {
      this.syncLog.warn(`Reset ${staleReset.count} stale RUNNING Marg sync config(s) to FAILED (cutoff=${staleCutoff.toISOString()})`);
    }

    // Stale sync log = lastHeartbeatAt older than threshold. Fall back to
    // startedAt only when lastHeartbeatAt is NULL (legacy rows from before
    // the heartbeat column existed). Without this fallback, an unfilled
    // heartbeat would be treated as null < cutoff and incorrectly kill
    // fresh syncs that hadn't yet written their first heartbeat.
    const staleLogReset = await this.prisma.margSyncLog.updateMany({
      where: {
        status: MargSyncStatus.RUNNING,
        completedAt: null,
        OR: [
          { lastHeartbeatAt: { lt: staleCutoff } },
          { AND: [{ lastHeartbeatAt: null }, { startedAt: { lt: staleCutoff } }] },
        ],
      },
      data: {
        status: MargSyncStatus.FAILED,
        completedAt: new Date(),
        errors: [{
          step: 'stale_sync_recovery',
          error: `Sync worker heartbeat expired before completion (no heartbeat for >${Math.round(this.staleAfterMs / 60000)} min)`,
        }],
      },
    });
    if (staleLogReset.count > 0) {
      this.syncLog.warn(
        `Marked ${staleLogReset.count} stale RUNNING Marg sync log(s) as FAILED ` +
        `(cutoff=${staleCutoff.toISOString()}, threshold=${Math.round(this.staleAfterMs / 60000)}min)`,
      );
    }
  }

  /**
   * Cross-tenant due-config dispatcher. Pulls every active config across
   * every tenant whose lock is not currently held, asks `isDue` whether
   * the next sync window has elapsed, and either:
   *   - enqueues a BullMQ job (the worker picks it up and runs the actual
   *     sync inside `executeInTenantContext`), or
   *   - falls back to inline execution when Redis is not configured
   *     (development / single-process deployments). Inline execution
   *     wraps the call in `executeInTenantContext` itself, so even the
   *     inline path is tenant-scoped correctly.
   *
   * Intentionally global at the discovery step: we have to enumerate all
   * tenants' configs to know which are due. Tenant-scoped per-config
   * filtering would require either looping over tenants (extra DB
   * round-trips) or registering a per-tenant cron (operationally
   * impossible since tenants are dynamic).
   */
  private async dispatchDueConfigs(): Promise<void> {
    const configs = await this.prisma.margSyncConfig.findMany({
      where: {
        isActive: true,
        lastSyncStatus: { not: MargSyncStatus.RUNNING },
      },
    });

    const now = new Date();
    for (const config of configs) {
      if (!this.isDue(config, now)) continue;
      if (!this.margSyncQueue) {
        this.logger.warn(`Redis not configured — running scheduled Marg sync inline for config=${config.id}`);
        try {
          await this.prisma.executeInTenantContext(
            config.tenantId,
            () => this.margEdeService.runSync(
              config.id,
              config.tenantId,
              'scheduler',
              undefined,
              undefined,
              MARG_SYNC_SCOPE.FULL,
            ),
          );
        } catch (error) {
          this.logger.error(
            `Inline scheduled Marg sync failed for config=${config.id}: ${(error as Error).message}`,
            (error as Error).stack,
          );
        }
        continue;
      }

      this.logger.log(`Scheduling Marg sync: config=${config.id}, tenant=${config.tenantId}`);

      await this.margSyncQueue.add(
        'marg-sync',
        {
          configId: config.id,
          tenantId: config.tenantId,
          triggeredBy: 'scheduler',
          scope: MARG_SYNC_SCOPE.FULL,
        },
        {
          // attempts:1 — a long sync that fails should be reviewed and
          // resumed via /resume, not silently re-attempted (which would
          // hit the config lock anyway and produce a noisy retry storm).
          attempts: 1,
          // Enforce one scheduled job per config/hour window.
          jobId: `marg-sync-${config.id}-${now.toISOString().slice(0, 13).replace(/[:T-]/g, '')}`,
        },
      );
    }
  }

  private isDue(config: Pick<MargSyncConfig, 'lastSyncAt' | 'syncFrequency'>, now: Date): boolean {
    if (!config.lastSyncAt) return true; // never synced

    const elapsed = now.getTime() - new Date(config.lastSyncAt).getTime();
    const hour = 3_600_000;
    const frequency = String(config.syncFrequency || 'DAILY').toUpperCase();

    switch (frequency) {
      case 'HOURLY':
        return elapsed >= hour;
      case 'DAILY':
        return elapsed >= 24 * hour;
      case 'WEEKLY':
        return elapsed >= 7 * 24 * hour;
      default:
        return elapsed >= 24 * hour;
    }
  }
}
