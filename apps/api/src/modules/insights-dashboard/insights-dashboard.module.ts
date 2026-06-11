import { Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { DatabaseModule } from '../../core/database/database.module';
import { AiReportingModule } from '../ai-reporting/ai-reporting.module';
import { DashboardController } from './dashboard.controller';
import { DashboardService } from './dashboard.service';
import { InsightGenerationScheduler } from './insight-generation.scheduler';
import { InsightGenerationService } from './insight-generation.service';
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
@Module({
  imports: [ConfigModule, DatabaseModule, AiReportingModule],
  controllers: [DashboardController, InsightsController],
  providers: [
    DashboardService,
    WidgetExecutorService,
    InsightsService,
    InsightGenerationService,
    InsightGenerationScheduler,
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
      ],
    },
  ],
})
export class InsightsDashboardModule {}
