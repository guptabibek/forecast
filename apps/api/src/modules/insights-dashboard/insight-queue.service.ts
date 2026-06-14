import { InjectQueue } from '@nestjs/bullmq';
import { Injectable, Logger, Optional } from '@nestjs/common';
import { Queue } from 'bullmq';
import { QUEUE_NAMES } from '../../core/queue/queue.constants';
import { InsightGenerationJobData } from './insight-generation.processor';
import { InsightGenerationService, TenantGenerationResult } from './insight-generation.service';

export interface InsightGenerationRequestResult {
  /** true → accepted onto the queue (async); false → ran inline (no Redis). */
  queued: boolean;
  jobId?: string;
  result?: TenantGenerationResult;
}

/**
 * Producer facade for insight generation. Centralizes the "enqueue if a queue
 * is available, otherwise run inline" decision so callers (manual trigger,
 * pin refresh, scheduler) don't each duplicate the fallback.
 *
 * The queue is @Optional: when REDIS_URL is not configured BullModule is not
 * registered, the injected queue is undefined, and every path degrades to the
 * previous synchronous in-process behavior.
 */
@Injectable()
export class InsightQueueService {
  private readonly logger = new Logger(InsightQueueService.name);

  constructor(
    private readonly generation: InsightGenerationService,
    @Optional() @InjectQueue(QUEUE_NAMES.INSIGHTS) private readonly queue?: Queue,
  ) {}

  get queueEnabled(): boolean {
    return Boolean(this.queue);
  }

  /**
   * Caller wants a tenant's insights (re)generated and an immediate response.
   * Enqueues and returns the job id when a queue is available; otherwise runs
   * inline and returns the result (preserving the original endpoint behavior).
   */
  async requestTenant(tenantId: string, providerIds?: string[]): Promise<InsightGenerationRequestResult> {
    const data: InsightGenerationJobData = { tenantId, providerIds: providerIds?.length ? providerIds : null };
    if (this.queue) {
      const job = await this.queue.add('generate-tenant', data);
      return { queued: true, jobId: job.id ? String(job.id) : undefined };
    }
    const result = await this.generation.generateForTenant(tenantId, providerIds?.length ? { providerIds } : undefined);
    return { queued: false, result };
  }

  /**
   * Fire-and-forget background refresh (e.g. after a pin/unpin). Enqueues when
   * possible; otherwise runs detached in-process. Never throws into the caller.
   */
  enqueueDetached(tenantId: string, providerIds?: string[]): void {
    const data: InsightGenerationJobData = { tenantId, providerIds: providerIds?.length ? providerIds : null };
    if (this.queue) {
      void this.queue.add('generate-tenant', data).catch((error) =>
        this.logger.warn(`Failed to enqueue insight refresh for tenant ${tenantId}: ${String(error?.message ?? error)}`),
      );
      return;
    }
    void this.generation
      .generateForTenant(tenantId, providerIds?.length ? { providerIds } : undefined)
      .catch(() => undefined);
  }

  /**
   * Scheduler fan-out: enqueue one job per generatable tenant. Returns the
   * number enqueued, or null when no queue is available (caller should fall
   * back to the inline all-tenants cycle).
   */
  async enqueueAllTenants(): Promise<number | null> {
    if (!this.queue) return null;
    const tenantIds = await this.generation.listGeneratableTenantIds();
    let enqueued = 0;
    for (const tenantId of tenantIds) {
      try {
        await this.queue.add('generate-tenant', { tenantId, providerIds: null } satisfies InsightGenerationJobData);
        enqueued += 1;
      } catch (error: any) {
        this.logger.warn(`Failed to enqueue insight job for tenant ${tenantId}: ${String(error?.message ?? error)}`);
      }
    }
    return enqueued;
  }
}
