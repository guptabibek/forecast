import { InjectQueue } from '@nestjs/bullmq';
import { Injectable, Logger } from '@nestjs/common';
import { Cron, CronExpression } from '@nestjs/schedule';
import { MargSyncConfig, MargSyncStatus } from '@prisma/client';
import { Queue } from 'bullmq';
import { PrismaService } from '../../core/database/prisma.service';
import { QUEUE_NAMES } from '../../core/queue/queue.constants';

@Injectable()
export class MargSyncScheduler {
  private readonly logger = new Logger(MargSyncScheduler.name);

  constructor(
    private readonly prisma: PrismaService,
    @InjectQueue(QUEUE_NAMES.MARG_SYNC) private readonly margSyncQueue: Queue,
  ) {}

  /** Run every hour. Configs are checked against their syncFrequency. */
  @Cron(CronExpression.EVERY_HOUR)
  async scheduleActiveSyncs(): Promise<void> {
    const configs = await this.prisma.margSyncConfig.findMany({
      where: {
        isActive: true,
        lastSyncStatus: { not: MargSyncStatus.RUNNING },
      },
    });

    const now = new Date();
    for (const config of configs) {
      if (!this.isDue(config, now)) continue;

      this.logger.log(`Scheduling Marg sync: config=${config.id}, tenant=${config.tenantId}`);

      await this.margSyncQueue.add(
        'marg-sync',
        {
          configId: config.id,
          tenantId: config.tenantId,
          triggeredBy: 'scheduler',
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
