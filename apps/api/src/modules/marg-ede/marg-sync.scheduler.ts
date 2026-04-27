import { InjectQueue } from '@nestjs/bullmq';
import { Injectable, Logger, Optional } from '@nestjs/common';
import { Cron, CronExpression } from '@nestjs/schedule';
import { MargSyncConfig, MargSyncStatus } from '@prisma/client';
import { Queue } from 'bullmq';
import { PrismaService } from '../../core/database/prisma.service';
import { QUEUE_NAMES } from '../../core/queue/queue.constants';
import { MargEdeService } from './marg-ede.service';
import { MARG_SYNC_SCOPE } from './marg-sync.types';

@Injectable()
export class MargSyncScheduler {
  private readonly logger = new Logger(MargSyncScheduler.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly margEdeService: MargEdeService,
    @Optional() @InjectQueue(QUEUE_NAMES.MARG_SYNC) private readonly margSyncQueue: Queue | null,
  ) {}

  /** Run every hour. Configs are checked against their syncFrequency. */
  @Cron(CronExpression.EVERY_HOUR)
  async scheduleActiveSyncs(): Promise<void> {
    // Recover stale locks based on the config heartbeat/update timestamp, not
    // lastSyncAt. lastSyncAt tracks the most recent successful sync and can be
    // hours or days old while a healthy sync is currently running.
    const staleCutoff = new Date(Date.now() - 2 * 60 * 60 * 1000);
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
      this.logger.warn(`Reset ${staleReset.count} stale RUNNING Marg sync config(s) to FAILED`);
    }

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
          this.prisma.setTenantContext(config.tenantId);
          await this.margEdeService.runSync(
            config.id,
            config.tenantId,
            'scheduler',
            undefined,
            undefined,
            MARG_SYNC_SCOPE.FULL,
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
