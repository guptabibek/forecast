import { Processor, WorkerHost } from '@nestjs/bullmq';
import { Logger } from '@nestjs/common';
import { Job } from 'bullmq';
import { QUEUE_NAMES } from '../../core/queue/queue.constants';
import { MargEdeService } from './marg-ede.service';

interface MargSyncJobData {
  configId: string;
  tenantId: string;
  triggeredBy?: string;
}

@Processor(QUEUE_NAMES.MARG_SYNC)
export class MargSyncProcessor extends WorkerHost {
  private readonly logger = new Logger(MargSyncProcessor.name);

  constructor(private readonly margEdeService: MargEdeService) {
    super();
  }

  async process(job: Job<MargSyncJobData>): Promise<any> {
    const { configId, tenantId, triggeredBy } = job.data;
    this.logger.log(`Starting Marg EDE sync: configId=${configId}, tenantId=${tenantId}`);

    try {
      const syncLogId = await this.margEdeService.runSync(configId, tenantId, triggeredBy);
      this.logger.log(`Marg EDE sync completed: syncLogId=${syncLogId}`);
      return { syncLogId, status: 'completed' };
    } catch (err) {
      this.logger.error(`Marg EDE sync failed: ${err}`, (err as Error).stack);
      throw err;
    }
  }
}
