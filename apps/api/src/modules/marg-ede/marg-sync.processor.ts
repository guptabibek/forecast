import { Processor, WorkerHost } from '@nestjs/bullmq';
import { Logger } from '@nestjs/common';
import { Job } from 'bullmq';
import { PrismaService } from '../../core/database/prisma.service';
import { QUEUE_NAMES } from '../../core/queue/queue.constants';
import { MargEdeService } from './marg-ede.service';
import { MARG_SYNC_MODE, MARG_SYNC_SCOPE, MargSyncJobData } from './marg-sync.types';

@Processor(QUEUE_NAMES.MARG_SYNC)
export class MargSyncProcessor extends WorkerHost {
  private readonly logger = new Logger(MargSyncProcessor.name);

  constructor(
    private readonly margEdeService: MargEdeService,
    private readonly prisma: PrismaService,
  ) {
    super();
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
    this.prisma.setTenantContext(tenantId);
    this.logger.log(
      `Starting Marg EDE sync: configId=${configId}, tenantId=${tenantId}` +
      `, mode=${mode}` +
      `, scope=${scope}` +
      `${fromDate ? `, fromDate=${fromDate}` : ''}` +
      `${endDate ? `, endDate=${endDate}` : ''}`,
    );

    try {
      const syncLogId = mode === MARG_SYNC_MODE.REPROJECT
        ? await this.margEdeService.runReprojection(configId, tenantId, triggeredBy, fromDate, endDate, scope)
        : await this.margEdeService.runSync(configId, tenantId, triggeredBy, fromDate, endDate, scope);
      this.logger.log(`Marg EDE ${mode} completed: syncLogId=${syncLogId}`);
      return { syncLogId, status: 'completed', mode };
    } catch (err) {
      this.logger.error(`Marg EDE ${mode} failed: ${err}`, (err as Error).stack);
      throw err;
    }
  }
}
