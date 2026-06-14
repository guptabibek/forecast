import { BullModule } from '@nestjs/bullmq';
import { Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { DatabaseModule } from '../../core/database/database.module';
import { QUEUE_NAMES } from '../../core/queue/queue.constants';
import { isRedisConfigured } from '../../core/queue/queue.module';
import { AiBillingModule } from '../ai-billing/ai-billing.module';
import { AiReportingModule } from '../ai-reporting/ai-reporting.module';
import { DashboardController } from './dashboard.controller';
import { DashboardService } from './dashboard.service';
import { InsightGenerationProcessor } from './insight-generation.processor';
import { InsightGenerationScheduler } from './insight-generation.scheduler';
import { InsightGenerationService } from './insight-generation.service';
import { InsightQueueService } from './insight-queue.service';
import { INSIGHT_PROVIDERS } from './insight-provider.interface';
import { InsightsController } from './insights.controller';
import { InsightsService } from './insights.service';
import { ChurnInsightProvider } from './providers/churn-insight.provider';
import { DeadStockInsightProvider } from './providers/dead-stock-insight.provider';
import { DiscountAnomalyInsightProvider } from './providers/discount-anomaly-insight.provider';
import { ExecutiveSummaryInsightProvider } from './providers/executive-summary-insight.provider';
import { FastMoversInsightProvider } from './providers/fast-movers-insight.provider';
import { InventoryInsightProvider } from './providers/inventory-insight.provider';
import { OutstandingInsightProvider } from './providers/outstanding-insight.provider';
import { PinnedReportInsightProvider } from './providers/pinned-report-insight.provider';
import { PurchaseTrendInsightProvider } from './providers/purchase-trend-insight.provider';
import { RevenueInsightProvider } from './providers/revenue-insight.provider';
import { SalesmanPerformanceInsightProvider } from './providers/salesman-performance-insight.provider';
import { StockoutRiskInsightProvider } from './providers/stockout-risk-insight.provider';
import { WidgetExecutorService } from './widget-executor.service';

/**
 * AI Insights Dashboard — additive module composed AROUND the existing
 * AI Reporting pipeline (Open/Closed): widgets store validated semantic
 * queries and re-execute them through AiReportingService under the current
 * user's security context; insight providers express analyses as semantic
 * queries through the same pipeline.
 *
 * To add a new insight provider: implement IInsightProvider, list the class
 * below, and append it to the INSIGHT_PROVIDERS factory — nothing else
 * changes.
 */
// InsightGenerationProcessor extends BullMQ WorkerHost and the producer
// injects @InjectQueue — only register the queue/worker when Redis is
// available. Without it, InsightQueueService runs generation inline.
const queueImports = isRedisConfigured() ? [BullModule.registerQueue({ name: QUEUE_NAMES.INSIGHTS })] : [];
const queueProviders = isRedisConfigured() ? [InsightGenerationProcessor] : [];

@Module({
  // AiBillingModule supplies AI access governance (enabled/suspended, wallet
  // state). AiReportingModule supplies AiProviderService, used to narrate
  // insight summaries via the LLM — billed on real token usage through the
  // same prepare/settle pipeline as AI reporting, and subject to the same
  // access controls and wallet suspension.
  imports: [ConfigModule, DatabaseModule, AiReportingModule, AiBillingModule, ...queueImports],
  controllers: [DashboardController, InsightsController],
  providers: [
    DashboardService,
    WidgetExecutorService,
    InsightsService,
    InsightGenerationService,
    InsightQueueService,
    InsightGenerationScheduler,
    ...queueProviders,
    RevenueInsightProvider,
    InventoryInsightProvider,
    StockoutRiskInsightProvider,
    DeadStockInsightProvider,
    ChurnInsightProvider,
    OutstandingInsightProvider,
    PurchaseTrendInsightProvider,
    SalesmanPerformanceInsightProvider,
    FastMoversInsightProvider,
    DiscountAnomalyInsightProvider,
    ExecutiveSummaryInsightProvider,
    PinnedReportInsightProvider,
    {
      provide: INSIGHT_PROVIDERS,
      useFactory: (...providers) => providers,
      inject: [
        // Order = generation order; the executive summary is independent of
        // the others (it runs its own queries) but reads best when last.
        RevenueInsightProvider,
        InventoryInsightProvider,
        StockoutRiskInsightProvider,
        DeadStockInsightProvider,
        ChurnInsightProvider,
        OutstandingInsightProvider,
        PurchaseTrendInsightProvider,
        SalesmanPerformanceInsightProvider,
        FastMoversInsightProvider,
        DiscountAnomalyInsightProvider,
        ExecutiveSummaryInsightProvider,
        PinnedReportInsightProvider,
      ],
    },
  ],
})
export class InsightsDashboardModule {}
