import { OnWorkerEvent, Processor, WorkerHost } from '@nestjs/bullmq';
import { Logger } from '@nestjs/common';
import { Job } from 'bullmq';
import { ForecastEngineService } from '../../../forecast-engine/forecast-engine.service';
import { PrismaService } from '../../database/prisma.service';
import { QUEUE_NAMES } from '../queue.constants';

const SCENARIO_ADJUSTMENTS: Record<string, { multiplier: number; confidenceWidth: number }> = {
  BASE: { multiplier: 1.0, confidenceWidth: 1.0 },
  OPTIMISTIC: { multiplier: 1.15, confidenceWidth: 1.2 },
  PESSIMISTIC: { multiplier: 0.85, confidenceWidth: 1.2 },
  STRETCH: { multiplier: 1.25, confidenceWidth: 1.4 },
  CONSERVATIVE: { multiplier: 0.92, confidenceWidth: 0.8 },
  CUSTOM: { multiplier: 1.0, confidenceWidth: 1.0 },
};

export interface ForecastJobData {
  tenantId: string;
  jobId: string;
  forecastRunId: string;
  planVersionId: string;
  scenarioId: string;
  forecastModel: string;
  isPersistent?: boolean;
  dimensions: string[];
  startPeriod: string;
  endPeriod: string;
  periodType?: string;
  productIds?: string[];
  locationIds?: string[];
  parameters: Record<string, any>;
  userId: string;
}

@Processor(QUEUE_NAMES.FORECAST)
export class ForecastQueueProcessor extends WorkerHost {
  private readonly logger = new Logger(ForecastQueueProcessor.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly forecastEngine: ForecastEngineService,
  ) {
    super();
  }

  async process(job: Job<ForecastJobData>): Promise<any> {
    const { tenantId } = job.data;

    if (!tenantId) {
      throw new Error('Forecast job missing tenantId — cannot process without tenant context');
    }

    // Wrap entire job processing in tenant CLS context so Prisma middleware auto-injects tenantId
    return this.prisma.executeInTenantContext(tenantId, () => this.processInTenantContext(job));
  }

  private async processInTenantContext(job: Job<ForecastJobData>): Promise<any> {
    const { tenantId, jobId, forecastRunId, planVersionId, scenarioId, forecastModel, isPersistent, dimensions, startPeriod, endPeriod, parameters, periodType, productIds, locationIds } = job.data;

    this.logger.log(`Processing forecast job ${jobId} for tenant ${tenantId}`);

    try {
      // Update job status to PROCESSING
      await this.prisma.forecastJob.update({
        where: { id: jobId },
        data: {
          status: 'PROCESSING',
          startedAt: new Date(),
        },
      });

      await this.prisma.forecastRun.update({
        where: { id: forecastRunId },
        data: {
          status: 'PROCESSING',
          startedAt: new Date(),
        },
      });

      // Fetch historical actuals for the forecast
      const historicalData = await this.fetchHistoricalData(
        tenantId,
        dimensions,
        startPeriod,
        productIds,
        locationIds,
      );

      // Generate forecasts using the selected model
      const forecasts = await this.forecastEngine.generateForecasts({
        tenantId,
        planVersionId,
        scenarioId,
        model: forecastModel as any,
        historicalData,
        startPeriod: new Date(startPeriod),
        endPeriod: new Date(endPeriod),
        periodType,
        parameters,
        dimensions,
      });

      const scenario = await this.prisma.scenario.findFirst({
        where: { id: scenarioId, tenantId },
        select: { scenarioType: true },
      });

      const adjustment = SCENARIO_ADJUSTMENTS[scenario?.scenarioType || 'BASE'] || SCENARIO_ADJUSTMENTS.BASE;
      const adjustedForecasts = forecasts.map((forecast) => {
        const adjustedAmount = Number(forecast.amount) * adjustment.multiplier;
        const adjustedQuantity = forecast.quantity != null ? Number(forecast.quantity) * adjustment.multiplier : undefined;
        const baseLower = forecast.confidenceLower ?? adjustedAmount * 0.9;
        const baseUpper = forecast.confidenceUpper ?? adjustedAmount * 1.1;
        const width = (baseUpper - baseLower) * adjustment.confidenceWidth;
        const confidenceLower = adjustedAmount - width / 2;
        const confidenceUpper = adjustedAmount + width / 2;

        return {
          ...forecast,
          amount: adjustedAmount,
          quantity: adjustedQuantity,
          confidenceLower,
          confidenceUpper,
        };
      });

      // Calculate accuracy metrics
      const metrics = this.forecastEngine.calculateMetrics(historicalData, adjustedForecasts);

      // Save forecasts to database
      await this.saveForecastResults(
        tenantId,
        forecastRunId,
        adjustedForecasts,
        job.data.userId,
        isPersistent !== false,
      );

      // Update job status to COMPLETED
      await this.prisma.forecastJob.update({
        where: { id: jobId },
        data: {
          status: 'COMPLETED',
          completedAt: new Date(),
          resultCount: adjustedForecasts.length,
          metrics: metrics as any,
        },
      });

      await this.prisma.forecastRun.update({
        where: { id: forecastRunId },
        data: {
          status: 'COMPLETED',
          completedAt: new Date(),
        },
      });

      this.logger.log(`Completed forecast job ${jobId} with ${adjustedForecasts.length} results`);

      return { success: true, resultCount: adjustedForecasts.length, metrics };
    } catch (error) {
      this.logger.error(`Failed forecast job ${jobId}: ${error.message}`);

      // Update job status to FAILED
      await this.prisma.forecastJob.update({
        where: { id: jobId },
        data: {
          status: 'FAILED',
          completedAt: new Date(),
          errorMessage: error.message,
        },
      });

      await this.prisma.forecastRun.update({
        where: { id: forecastRunId },
        data: {
          status: 'FAILED',
          completedAt: new Date(),
          errorMessage: error.message,
        },
      });

      throw error;
    }
  }

  private async fetchHistoricalData(
    tenantId: string,
    dimensions: string[],
    forecastStartPeriod: string,
    productIds?: string[],
    locationIds?: string[],
  ) {
    // Fetch 24 months of historical data before forecast start
    const historyStart = new Date(forecastStartPeriod);
    historyStart.setMonth(historyStart.getMonth() - 24);

    const actuals = await this.prisma.actual.findMany({
      where: {
        tenantId,
        periodDate: {
          gte: historyStart,
          lt: new Date(forecastStartPeriod),
        },
        ...(productIds?.length ? { productId: { in: productIds } } : {}),
        ...(locationIds?.length ? { locationId: { in: locationIds } } : {}),
      },
      orderBy: { periodDate: 'asc' },
    });

    return actuals;
  }

  private async saveForecastResults(
    tenantId: string,
    forecastRunId: string,
    forecasts: any[],
    userId: string,
    isPersistent: boolean,
  ) {
    if (!forecasts.length || !isPersistent) {
      return;
    }

    const sample = forecasts[0];

    await this.prisma.forecast.deleteMany({
      where: {
        tenantId,
        planVersionId: sample.planVersionId,
        scenarioId: sample.scenarioId,
        forecastModel: sample.model,
      },
    });

    // Batch insert forecasts
    const batchSize = 1000;
    for (let i = 0; i < forecasts.length; i += batchSize) {
      const batch = forecasts.slice(i, i + batchSize);
      await this.prisma.forecastResult.createMany({
        data: batch.map((f) => ({
          tenantId,
          forecastRunId,
          periodDate: f.periodDate,
          productId: f.productId,
          locationId: f.locationId,
          customerId: f.customerId,
          accountId: f.accountId,
          costCenterId: f.costCenterId,
          periodType: f.periodType || 'MONTHLY',
          forecastQuantity: f.quantity,
          forecastAmount: f.amount,
          currency: f.currency || 'USD',
          confidenceLower: f.confidenceLower,
          confidenceUpper: f.confidenceUpper,
          confidenceLevel: f.confidenceLevel || 95,
        })),
      });

      await this.prisma.forecast.createMany({
        data: batch.map((f) => ({
          tenantId,
          planVersionId: f.planVersionId,
          scenarioId: f.scenarioId,
          forecastRunId,
          forecastModel: f.model,
          periodDate: f.periodDate,
          periodType: f.periodType || 'MONTHLY',
          productId: f.productId,
          locationId: f.locationId,
          customerId: f.customerId,
          accountId: f.accountId,
          costCenterId: f.costCenterId,
          forecastQuantity: f.quantity,
          forecastAmount: f.amount,
          currency: f.currency || 'USD',
          confidenceLower: f.confidenceLower,
          confidenceUpper: f.confidenceUpper,
          confidenceLevel: f.confidenceLevel || 95,
          createdById: userId,
        })),
      });
    }
  }

  @OnWorkerEvent('completed')
  onCompleted(job: Job) {
    this.logger.log(`Job ${job.id} completed successfully`);
  }

  @OnWorkerEvent('failed')
  onFailed(job: Job, error: Error) {
    this.logger.error(`Job ${job.id} failed: ${error.message}`);
  }

  @OnWorkerEvent('progress')
  onProgress(job: Job, progress: number) {
    this.logger.log(`Job ${job.id} progress: ${progress}%`);
  }
}
