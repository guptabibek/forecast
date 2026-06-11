import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Cron, CronExpression } from '@nestjs/schedule';
import { InsightGenerationService } from './insight-generation.service';

/**
 * Periodically regenerates AI insights for all active tenants.
 *
 * Disabled by default: set AI_INSIGHTS_ENABLED=true to turn it on
 * (safe-rollout switch — the dashboard works without it, insights are
 * simply not refreshed automatically and can be triggered manually by
 * an admin via POST /ai-insights/generate).
 *
 * Generation is idempotent (insights upsert on a stable dedupe key), so a
 * duplicate run from a second app instance is harmless.
 */
@Injectable()
export class InsightGenerationScheduler {
  private readonly logger = new Logger(InsightGenerationScheduler.name);

  constructor(
    private readonly generation: InsightGenerationService,
    private readonly config: ConfigService,
  ) {}

  @Cron(CronExpression.EVERY_6_HOURS)
  async handleScheduledGeneration() {
    // Same truthy values the platform's env validation accepts (true/1/yes/on).
    const raw = String(this.config.get('AI_INSIGHTS_ENABLED') ?? '').trim().toLowerCase();
    if (!['true', '1', 'yes', 'on'].includes(raw)) return;
    this.logger.log('Starting scheduled AI insight generation cycle');
    const started = Date.now();
    const results = await this.generation.generateForAllTenants();
    this.logger.log(
      `Scheduled AI insight generation finished: tenants=${results.length}, durationMs=${Date.now() - started}`,
    );
  }
}
