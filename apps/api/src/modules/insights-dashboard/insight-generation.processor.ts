import { Processor, WorkerHost } from '@nestjs/bullmq';
import { Logger } from '@nestjs/common';
import { Job, UnrecoverableError } from 'bullmq';
import { PrismaService } from '../../core/database/prisma.service';
import { QUEUE_NAMES } from '../../core/queue/queue.constants';
import { InsightGenerationService } from './insight-generation.service';

export interface InsightGenerationJobData {
  tenantId: string;
  /** When set, only these providers run (e.g. a pinned-report refresh). */
  providerIds?: string[] | null;
}

/**
 * Worker that runs one tenant's insight generation off the request/cron path.
 *
 * Why a queue: insight generation runs ~12 providers and an LLM narration call
 * per changed candidate. Doing that inline in the manual-trigger HTTP request
 * blocks the caller for the full duration, and doing every tenant sequentially
 * in the cron process does not scale to thousands of tenants. The queue bounds
 * concurrency, retries transient failures (BullMQ defaults: 3 attempts,
 * exponential backoff), and spreads load across worker pods.
 *
 * Per-tenant generation is idempotent (insights upsert on a stable dedupe key
 * and narration only re-bills changed insights), so a retry or a duplicate
 * job is safe.
 */
const INSIGHTS_WORKER_CONCURRENCY = Math.max(
  1,
  Number.parseInt(process.env.INSIGHTS_WORKER_CONCURRENCY ?? '4', 10) || 4,
);

@Processor(QUEUE_NAMES.INSIGHTS, { concurrency: INSIGHTS_WORKER_CONCURRENCY })
export class InsightGenerationProcessor extends WorkerHost {
  private readonly logger = new Logger(InsightGenerationProcessor.name);

  constructor(
    private readonly generation: InsightGenerationService,
    private readonly prisma: PrismaService,
  ) {
    super();
    this.logger.log(`Insight generation worker initialized: concurrency=${INSIGHTS_WORKER_CONCURRENCY}`);
  }

  async process(job: Job<InsightGenerationJobData>): Promise<unknown> {
    const { tenantId, providerIds } = job.data;
    if (!tenantId) {
      // Bad payload will never succeed on retry — fail terminally.
      throw new UnrecoverableError('Insight generation job missing tenantId');
    }
    // Run inside the tenant's CLS context so Prisma's tenant-scope middleware
    // applies, matching the platform's other background workers.
    return this.prisma.executeInTenantContext(tenantId, () =>
      this.generation.generateForTenant(tenantId, providerIds?.length ? { providerIds } : undefined),
    );
  }
}
