import { InjectQueue } from '@nestjs/bullmq';
import {
  BadRequestException,
  Injectable,
  Logger,
  NotFoundException,
} from '@nestjs/common';
import {
  AuditAction,
  ForecastModel,
  JobStatus,
  OverrideStatus,
  PeriodType,
  PlanStatus,
  Prisma,
  ReconciliationStatus,
  ScenarioType,
  WorkflowEntityType,
  WorkflowStatus,
} from '@prisma/client';
import { Queue } from 'bullmq';
import { AuditService } from '../../core/audit/audit.service';
import { PrismaService } from '../../core/database/prisma.service';
import { FxRateService } from '../../core/finance/fx-rate.service';
import { QUEUE_NAMES } from '../../core/queue/queue.module';
import { TimeBucketService } from '../../core/time/time-bucket.service';
import { WorkflowService } from '../../core/workflow/workflow.service';
import { ForecastEngineService } from '../../forecast-engine/forecast-engine.service';
import { DataPoint } from '../../forecast-engine/interfaces/forecast-model.interface';
import { ForecastModelRegistry } from '../../forecast-engine/model-registry';
import { CreateForecastDto } from './dto/create-forecast.dto';
import { CreateOverrideDto } from './dto/create-override.dto';
import { ForecastQueryDto } from './dto/forecast-query.dto';
import { GenerateForecastDto } from './dto/generate-forecast.dto';
import { RunForecastDto } from './dto/run-forecast.dto';

// Scenario adjustment multipliers - these adjust base forecasts based on scenario type
const SCENARIO_ADJUSTMENTS: Record<ScenarioType, { multiplier: number; confidenceWidth: number }> = {
  BASE: { multiplier: 1.0, confidenceWidth: 1.0 },           // No adjustment
  OPTIMISTIC: { multiplier: 1.15, confidenceWidth: 1.2 },    // +15% with wider confidence
  PESSIMISTIC: { multiplier: 0.85, confidenceWidth: 1.2 },   // -15% with wider confidence  
  STRETCH: { multiplier: 1.25, confidenceWidth: 1.4 },       // +25% aggressive target
  CONSERVATIVE: { multiplier: 0.92, confidenceWidth: 0.8 },  // -8% with tighter confidence
  CUSTOM: { multiplier: 1.0, confidenceWidth: 1.0 },         // No adjustment (manual override expected)
};

@Injectable()
export class ForecastsService {
  private readonly logger = new Logger(ForecastsService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly forecastEngine: ForecastEngineService,
    private readonly modelRegistry: ForecastModelRegistry,
    @InjectQueue(QUEUE_NAMES.FORECAST) private readonly forecastQueue: Queue,
    private readonly workflowService: WorkflowService,
    private readonly timeBucketService: TimeBucketService,
    private readonly fxRateService: FxRateService,
    private readonly auditService: AuditService,
  ) {}

  /**
   * Generate forecasts dynamically from historical data
   * This runs the forecast models on actual historical data in real-time
   */
  async generateForecasts(generateDto: GenerateForecastDto, user: any) {
    const { planVersionId, scenarioId, models, periods = 12 } = generateDto;
    const isPersistent = generateDto.persist !== false;

    const planVersion = await this.prisma.planVersion.findFirst({
      where: { id: planVersionId, tenantId: user.tenantId },
    });

    if (!planVersion) {
      throw new NotFoundException('Plan version not found');
    }

    if (planVersion.status === 'LOCKED') {
      throw new BadRequestException('Plan version is locked');
    }

    const scenario = await this.prisma.scenario.findFirst({
      where: { id: scenarioId, tenantId: user.tenantId },
    });

    if (!scenario) {
      throw new NotFoundException('Scenario not found');
    }

    if (scenario.status === 'LOCKED') {
      throw new BadRequestException('Scenario is locked');
    }

    const periodType = (generateDto.periodType as PeriodType) || planVersion.periodType || PeriodType.MONTHLY;

    let startDate: Date;
    if (generateDto.rolling) {
      startDate = new Date();
      startDate.setHours(0, 0, 0, 0);
    } else if (generateDto.startDate) {
      startDate = new Date(generateDto.startDate);
    } else {
      startDate = planVersion.startDate;
    }

    let endDate: Date;
    if (generateDto.endDate) {
      endDate = new Date(generateDto.endDate);
    } else {
      const tempEnd = new Date(startDate);
      switch (periodType) {
        case PeriodType.DAILY:
          tempEnd.setDate(tempEnd.getDate() + periods - 1);
          break;
        case PeriodType.WEEKLY:
          tempEnd.setDate(tempEnd.getDate() + (periods - 1) * 7);
          break;
        case PeriodType.QUARTERLY:
          tempEnd.setMonth(tempEnd.getMonth() + (periods - 1) * 3);
          break;
        case PeriodType.YEARLY:
          tempEnd.setFullYear(tempEnd.getFullYear() + periods - 1);
          break;
        case PeriodType.MONTHLY:
        default:
          tempEnd.setMonth(tempEnd.getMonth() + periods - 1);
          break;
      }
      endDate = tempEnd;
    }

    if (!startDate || !endDate) {
      throw new BadRequestException('Forecast period range is invalid');
    }

    await this.validateTimeBuckets(user.tenantId, startDate, endDate, periodType);

    const dimensions = generateDto.dimensions?.length
      ? generateDto.dimensions
      : ['productId', 'locationId'];

    const assumptions = await this.prisma.assumption.findMany({
      where: { tenantId: user.tenantId, planVersionId, scenarioId, isActive: true },
      select: { id: true, name: true, assumptionType: true, value: true, valueType: true },
    });

    const historyMonths = generateDto.historyMonths ?? this.computeDefaultHistoryMonths(periodType);
    const historyStart = new Date(startDate);
    if (periodType === PeriodType.DAILY) {
      historyStart.setDate(historyStart.getDate() - historyMonths * 30);
    } else if (periodType === PeriodType.YEARLY) {
      historyStart.setFullYear(historyStart.getFullYear() - Math.max(historyMonths / 12, 5));
    } else {
      historyStart.setMonth(historyStart.getMonth() - historyMonths);
    }

    const historicalData = await this.prisma.actual.findMany({
      where: {
        tenantId: user.tenantId,
        periodDate: { gte: historyStart, lt: startDate },
        ...(generateDto.productIds?.length ? { productId: { in: generateDto.productIds } } : {}),
        ...(generateDto.locationIds?.length ? { locationId: { in: generateDto.locationIds } } : {}),
        ...(generateDto.customerIds?.length ? { customerId: { in: generateDto.customerIds } } : {}),
      },
      orderBy: { periodDate: 'asc' },
      take: 100000,
    });

    if (models.length === 0) {
      throw new BadRequestException('At least one forecast model must be specified');
    }

    if (historicalData.length === 0) {
      this.logger.warn(`No historical data found for tenant ${user.tenantId} in range ${historyStart.toISOString()} to ${startDate.toISOString()}`);
    }

    const adjustment = SCENARIO_ADJUSTMENTS[scenario.scenarioType] || SCENARIO_ADJUSTMENTS.BASE;

    const runs: Array<{ model: string; runId: string; status: string; resultCount: number }> = [];
    const allForecasts: any[] = [];

    for (const modelName of models) {
      const model = this.modelRegistry.get(modelName);
      if (!model) {
        throw new BadRequestException(`Unknown forecast model: ${modelName}`);
      }

      // Create forecast run record
      const run = await this.prisma.forecastRun.create({
        data: {
          tenantId: user.tenantId,
          planVersionId,
          scenarioId,
          forecastModel: modelName,
          modelVersion: model.version,
          isPersistent,
          status: JobStatus.PROCESSING,
          parameters: generateDto.parameters || {},
          inputSnapshot: {
            dimensions,
            filters: {
              productIds: generateDto.productIds || [],
              locationIds: generateDto.locationIds || [],
              customerIds: generateDto.customerIds || [],
            },
            assumptions,
            periodType,
            startDate,
            endDate,
            historyMonths,
            rolling: !!generateDto.rolling,
            snapshotLabel: generateDto.snapshotLabel || null,
            externalSignals: (generateDto.externalSignals || []).map(s => ({ ...s })),
            ensembleWeights: generateDto.ensembleWeights || null,
          },
          startPeriod: startDate,
          endPeriod: endDate,
          requestedById: user.id,
          startedAt: new Date(),
        },
      });

      try {
        const engineParams = { ...(generateDto.parameters || {}) };
        if (modelName === 'AI_HYBRID' && generateDto.ensembleWeights) {
          engineParams.userWeights = generateDto.ensembleWeights;
        }

        const rawForecasts = await this.forecastEngine.generateForecasts({
          tenantId: user.tenantId,
          planVersionId,
          scenarioId,
          model: modelName as any,
          historicalData,
          startPeriod: startDate,
          endPeriod: endDate,
          periodType,
          parameters: engineParams,
          dimensions,
        });

        const adjustedForecasts = rawForecasts.map((f) => {
          let adjustedAmount = Number(f.amount) * adjustment.multiplier;
          let adjustedQuantity = f.quantity != null ? Number(f.quantity) * adjustment.multiplier : undefined;

          if (generateDto.externalSignals?.length) {
            for (const signal of generateDto.externalSignals) {
              const pd = new Date(f.periodDate);
              const inRange = (!signal.startDate || pd >= new Date(signal.startDate))
                && (!signal.endDate || pd <= new Date(signal.endDate));
              if (inRange) {
                adjustedAmount *= signal.factor;
                if (adjustedQuantity != null) adjustedQuantity *= signal.factor;
              }
            }
          }

          const baseLower = f.confidenceLower ?? adjustedAmount * 0.9;
          const baseUpper = f.confidenceUpper ?? adjustedAmount * 1.1;
          const width = (baseUpper - baseLower) * adjustment.confidenceWidth;
          return {
            ...f,
            amount: adjustedAmount,
            quantity: adjustedQuantity,
            confidenceLower: adjustedAmount - width / 2,
            confidenceUpper: adjustedAmount + width / 2,
          };
        });

        // Persist results atomically
        if (isPersistent && adjustedForecasts.length > 0) {
          await this.prisma.$transaction(async (tx) => {
            await tx.forecast.deleteMany({
              where: { tenantId: user.tenantId, planVersionId, scenarioId, forecastModel: modelName },
            });

            const batchSize = 1000;
            for (let i = 0; i < adjustedForecasts.length; i += batchSize) {
              const batch = adjustedForecasts.slice(i, i + batchSize);
              await tx.forecastResult.createMany({
                data: batch.map((f) => ({
                  tenantId: user.tenantId,
                  forecastRunId: run.id,
                  periodDate: f.periodDate,
                  productId: f.productId,
                  locationId: f.locationId,
                  customerId: f.customerId,
                  accountId: f.accountId,
                  costCenterId: f.costCenterId,
                  periodType: (f.periodType || 'MONTHLY') as PeriodType,
                  forecastQuantity: f.quantity,
                  forecastAmount: f.amount,
                  currency: f.currency || 'USD',
                  confidenceLower: f.confidenceLower,
                  confidenceUpper: f.confidenceUpper,
                  confidenceLevel: f.confidenceLevel || 95,
                })),
              });
              await tx.forecast.createMany({
                data: batch.map((f) => ({
                  tenantId: user.tenantId,
                  planVersionId,
                  scenarioId,
                  forecastRunId: run.id,
                  forecastModel: modelName,
                  periodDate: f.periodDate,
                  periodType: (f.periodType || 'MONTHLY') as PeriodType,
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
                  createdById: user.id,
                })),
              });
            }
          });
        }

        // Mark run as completed
        await this.prisma.forecastRun.update({
          where: { id: run.id },
          data: { status: JobStatus.COMPLETED, completedAt: new Date() },
        });

        runs.push({ model: modelName, runId: run.id, status: 'completed', resultCount: adjustedForecasts.length });

        // Collect forecasts for inline response
        allForecasts.push(
          ...adjustedForecasts.map((f) => ({
            forecastModel: modelName,
            periodDate: f.periodDate,
            periodType: f.periodType || 'MONTHLY',
            forecastAmount: f.amount,
            forecastQuantity: f.quantity,
            confidenceLower: f.confidenceLower,
            confidenceUpper: f.confidenceUpper,
            productId: f.productId,
            locationId: f.locationId,
          })),
        );
      } catch (error: any) {
        this.logger.error(`Forecast model ${modelName} failed: ${error.message}`);
        await this.prisma.forecastRun.update({
          where: { id: run.id },
          data: { status: JobStatus.FAILED, completedAt: new Date(), errorMessage: error.message },
        });
        runs.push({ model: modelName, runId: run.id, status: 'failed', resultCount: 0 });
      }
    }

    for (const run of runs) {
      await this.auditService.log(
        user.tenantId,
        user.id,
        AuditAction.CREATE,
        'ForecastRun',
        run.runId,
        null,
        { scenarioId, model: run.model, startDate, endDate },
        ['model', 'startDate', 'endDate'],
      );
    }

    return {
      status: 'completed',
      runs,
      periodType,
      startDate,
      endDate,
      forecasts: allForecasts,
    };
  }

  /**
   * Aggregate actuals by period (month), summing across all dimensions
   * This provides enough data points for models like Holt-Winters that need 24+ points
   */
  private aggregateActualsByPeriod(actuals: any[]): Array<{
    periodDate: Date;
    totalAmount: number;
    totalQuantity: number;
    count: number;
  }> {
    const periodMap = new Map<string, {
      periodDate: Date;
      totalAmount: number;
      totalQuantity: number;
      count: number;
    }>();

    for (const actual of actuals) {
      const periodKey = actual.periodDate.toISOString().slice(0, 7); // YYYY-MM
      
      if (!periodMap.has(periodKey)) {
        periodMap.set(periodKey, {
          periodDate: new Date(actual.periodDate),
          totalAmount: 0,
          totalQuantity: 0,
          count: 0,
        });
      }

      const entry = periodMap.get(periodKey)!;
      entry.totalAmount += Number(actual.amount) || 0;
      entry.totalQuantity += Number(actual.quantity) || 0;
      entry.count++;
    }

    return Array.from(periodMap.values())
      .sort((a, b) => a.periodDate.getTime() - b.periodDate.getTime());
  }

  async create(createDto: CreateForecastDto, user: any) {
    const planVersion = await this.prisma.planVersion.findFirst({
      where: { id: createDto.planVersionId, tenantId: user.tenantId },
    });

    if (!planVersion) {
      throw new NotFoundException('Plan version not found');
    }

    if (planVersion.status === 'LOCKED') {
      throw new BadRequestException('Plan version is locked');
    }

    const scenario = await this.prisma.scenario.findFirst({
      where: { id: createDto.scenarioId, tenantId: user.tenantId },
    });

    if (!scenario) {
      throw new NotFoundException('Scenario not found');
    }

    if (scenario.status === 'LOCKED') {
      throw new BadRequestException('Scenario is locked');
    }

    const periodType = (createDto.periodType as PeriodType) || planVersion.periodType || PeriodType.MONTHLY;
    const periodDate = new Date(createDto.periodDate);
    await this.timeBucketService.getBucketOrThrow(user.tenantId, periodDate, periodType);

    const run = await this.prisma.forecastRun.create({
      data: {
        tenantId: user.tenantId,
        planVersionId: createDto.planVersionId,
        scenarioId: createDto.scenarioId,
        forecastModel: ForecastModel.MANUAL,
        modelVersion: 'manual-1.0.0',
        status: JobStatus.COMPLETED,
        parameters: createDto.parameters || {},
        inputSnapshot: {
          manual: true,
          periodType,
          periodDate,
        },
        startPeriod: periodDate,
        endPeriod: periodDate,
        requestedById: user.id,
        startedAt: new Date(),
        completedAt: new Date(),
      },
    });

    const result = await this.prisma.forecastResult.create({
      data: {
        tenantId: user.tenantId,
        forecastRunId: run.id,
        periodDate,
        periodType,
        forecastAmount: createDto.forecastAmount || 0,
        forecastQuantity: createDto.forecastQuantity || null,
        currency: createDto.currency || 'USD',
        ...(createDto.productId && { productId: createDto.productId }),
        ...(createDto.locationId && { locationId: createDto.locationId }),
        ...(createDto.customerId && { customerId: createDto.customerId }),
        ...(createDto.accountId && { accountId: createDto.accountId }),
        ...(createDto.costCenterId && { costCenterId: createDto.costCenterId }),
      },
    });

    await this.prisma.forecast.create({
      data: {
        tenantId: user.tenantId,
        planVersionId: createDto.planVersionId,
        scenarioId: createDto.scenarioId,
        forecastRunId: run.id,
        forecastModel: ForecastModel.MANUAL,
        periodDate,
        periodType,
        forecastAmount: createDto.forecastAmount || 0,
        forecastQuantity: createDto.forecastQuantity || null,
        currency: createDto.currency || 'USD',
        ...(createDto.productId && { productId: createDto.productId }),
        ...(createDto.locationId && { locationId: createDto.locationId }),
        ...(createDto.customerId && { customerId: createDto.customerId }),
        ...(createDto.accountId && { accountId: createDto.accountId }),
        ...(createDto.costCenterId && { costCenterId: createDto.costCenterId }),
        createdById: user.id,
      },
    });

    await this.auditService.log(
      user.tenantId,
      user.id,
      AuditAction.CREATE,
      'ForecastResult',
      result.id,
      null,
      { forecastRunId: run.id },
      ['forecastAmount', 'forecastQuantity'],
    );

    return result;
  }

  async findAll(query: ForecastQueryDto, user: any) {
    const { page = 1, pageSize = 20, planVersionId, scenarioId, forecastModel, forecastRunId, productId, locationId, startDate, endDate } = query;
    const skip = (page - 1) * pageSize;

    const where: Prisma.ForecastResultWhereInput = {
      tenantId: user.tenantId,
      ...(forecastRunId && { forecastRunId }),
      ...(productId && { productId }),
      ...(locationId && { locationId }),
      ...(startDate && endDate && {
        periodDate: { gte: new Date(startDate), lte: new Date(endDate) },
      }),
      ...(planVersionId || scenarioId || forecastModel
        ? {
            forecastRun: {
              ...(planVersionId && { planVersionId }),
              ...(scenarioId && { scenarioId }),
              ...(forecastModel && { forecastModel: forecastModel as ForecastModel }),
            },
          }
        : {}),
    };

    const [forecasts, total] = await Promise.all([
      this.prisma.forecastResult.findMany({
        where,
        skip,
        take: pageSize,
        orderBy: { createdAt: 'desc' },
        include: {
          forecastRun: {
            select: {
              id: true,
              planVersionId: true,
              scenarioId: true,
              forecastModel: true,
              modelVersion: true,
              status: true,
              startPeriod: true,
              endPeriod: true,
            },
          },
          product: { select: { id: true, name: true, code: true } },
          location: { select: { id: true, name: true, code: true } },
        },
      }),
      this.prisma.forecastResult.count({ where }),
    ]);

    return {
      data: forecasts,
      meta: {
        total,
        page,
        pageSize,
        totalPages: Math.ceil(total / pageSize),
      },
    };
  }

  async findOne(id: string, user: any) {
    const forecast = await this.prisma.forecastResult.findFirst({
      where: { id, tenantId: user.tenantId },
      include: {
        forecastRun: true,
        product: true,
        location: true,
        customer: true,
        account: true,
        costCenter: true,
      },
    });

    if (!forecast) {
      throw new NotFoundException('Forecast not found');
    }

    return forecast;
  }

  async getForecastData(
    planVersionId: string,
    scenarioId: string,
    startDate: string,
    endDate: string,
    user: any,
  ) {
    const run = await this.getLatestCompletedRun(planVersionId, scenarioId, user.tenantId);

    const where: Prisma.ForecastResultWhereInput = {
      tenantId: user.tenantId,
      forecastRunId: run.id,
      ...(startDate && endDate && {
        periodDate: {
          gte: new Date(startDate),
          lte: new Date(endDate),
        },
      }),
    };

    const [results, overrides, tenant] = await Promise.all([
      this.prisma.forecastResult.findMany({
        where,
        orderBy: { periodDate: 'asc' },
        include: {
          forecastRun: {
            select: {
              id: true,
              planVersionId: true,
              scenarioId: true,
              forecastModel: true,
            },
          },
          product: { select: { id: true, name: true, code: true } },
          location: { select: { id: true, name: true, code: true } },
          account: { select: { id: true, name: true, code: true } },
          costCenter: { select: { id: true, name: true, code: true } },
        },
      }),
      this.prisma.forecastOverride.findMany({
        where: {
          tenantId: user.tenantId,
          forecastRunId: run.id,
          status: OverrideStatus.APPROVED,
          ...(startDate && endDate && {
            periodDate: {
              gte: new Date(startDate),
              lte: new Date(endDate),
            },
          }),
        },
        orderBy: { requestedAt: 'desc' },
      }),
      this.prisma.tenant.findUnique({
        where: { id: user.tenantId },
        select: { defaultCurrency: true },
      }),
    ]);

    const adjusted = this.applyOverrides(results, overrides);
    return await this.applyCurrencyConversion(adjusted, tenant?.defaultCurrency || 'USD', user.tenantId);
  }

  async runForecast(id: string, runDto: RunForecastDto, user: any) {
    const run = await this.prisma.forecastRun.findFirst({
      where: { id, tenantId: user.tenantId },
    });

    if (!run) {
      throw new NotFoundException('Forecast run not found');
    }

    const [planVersion, scenario] = await Promise.all([
      this.prisma.planVersion.findFirst({
        where: { id: run.planVersionId, tenantId: user.tenantId },
        select: { status: true },
      }),
      this.prisma.scenario.findFirst({
        where: { id: run.scenarioId, tenantId: user.tenantId },
        select: { status: true },
      }),
    ]);

    if (planVersion?.status === PlanStatus.LOCKED || scenario?.status === PlanStatus.LOCKED) {
      throw new BadRequestException('Cannot re-run forecasts for locked plans or scenarios');
    }

    const newRun = await this.prisma.forecastRun.create({
      data: {
        tenantId: run.tenantId,
        planVersionId: run.planVersionId,
        scenarioId: run.scenarioId,
        forecastModel: run.forecastModel,
        modelVersion: run.modelVersion,
        isPersistent: run.isPersistent,
        status: JobStatus.QUEUED,
        parameters: runDto.parameters || (run.parameters as Prisma.JsonObject),
        inputSnapshot: run.inputSnapshot as Prisma.JsonObject,
        startPeriod: run.startPeriod,
        endPeriod: run.endPeriod,
        requestedById: user.id,
      },
    });

    const jobRecord = await this.prisma.forecastJob.create({
      data: {
        tenantId: run.tenantId,
        planVersionId: run.planVersionId,
        scenarioId: run.scenarioId,
        forecastRunId: newRun.id,
        forecastModel: run.forecastModel,
        isPersistent: run.isPersistent,
        status: JobStatus.QUEUED,
        priority: runDto.priority || 1,
        parameters: (newRun.parameters as Prisma.JsonObject) || {},
        dimensions: (run.inputSnapshot as any)?.dimensions || ['productId', 'locationId'],
        startPeriod: run.startPeriod,
        endPeriod: run.endPeriod,
      },
    });

    const job = await this.forecastQueue.add(
      'run-forecast',
      {
        tenantId: run.tenantId,
        jobId: jobRecord.id,
        forecastRunId: newRun.id,
        planVersionId: run.planVersionId,
        scenarioId: run.scenarioId,
        forecastModel: run.forecastModel,
        isPersistent: run.isPersistent,
        dimensions: (run.inputSnapshot as any)?.dimensions || ['productId', 'locationId'],
        startPeriod: run.startPeriod.toISOString(),
        endPeriod: run.endPeriod.toISOString(),
        periodType: (run.inputSnapshot as any)?.periodType || PeriodType.MONTHLY,
        productIds: (run.inputSnapshot as any)?.filters?.productIds || [],
        locationIds: (run.inputSnapshot as any)?.filters?.locationIds || [],
        parameters: runDto.parameters || (run.parameters as any) || {},
        userId: user.id,
      },
      { priority: runDto.priority || 1 },
    );

    return {
      jobId: job.id,
      status: 'queued',
      forecastRunId: newRun.id,
    };
  }

  async getByPlanVersion(planVersionId: string, user: any) {
    return this.prisma.forecastRun.findMany({
      where: {
        planVersionId,
        tenantId: user.tenantId,
      },
      orderBy: { createdAt: 'desc' },
      include: {
        scenario: { select: { id: true, name: true } },
      },
    });
  }

  async compare(forecastIds: string[], user: any) {
    const runs = await this.prisma.forecastRun.findMany({
      where: {
        id: { in: forecastIds },
        tenantId: user.tenantId,
      },
      include: {
        planVersion: { select: { id: true, name: true } },
        scenario: { select: { id: true, name: true } },
      },
    });

    if (runs.length !== forecastIds.length) {
      throw new NotFoundException('One or more forecast runs not found');
    }

    const results = await this.prisma.forecastResult.findMany({
      where: {
        tenantId: user.tenantId,
        forecastRunId: { in: forecastIds },
      },
      select: {
        forecastRunId: true,
        periodDate: true,
        forecastAmount: true,
        confidenceLower: true,
        confidenceUpper: true,
      },
    });

    const periodMap = new Map<string, any>();
    for (const row of results) {
      const periodKey = row.periodDate.toISOString();
      if (!periodMap.has(periodKey)) {
        periodMap.set(periodKey, { period: row.periodDate });
      }
      const entry = periodMap.get(periodKey);
      entry[row.forecastRunId] = (entry[row.forecastRunId] || 0) + Number(row.forecastAmount);
      entry[`${row.forecastRunId}_lower`] = (entry[`${row.forecastRunId}_lower`] || 0) + Number(row.confidenceLower || 0);
      entry[`${row.forecastRunId}_upper`] = (entry[`${row.forecastRunId}_upper`] || 0) + Number(row.confidenceUpper || 0);
    }

    const comparisonData = Array.from(periodMap.values()).sort(
      (a, b) => new Date(a.period).getTime() - new Date(b.period).getTime(),
    );

    return {
      forecasts: runs.map((run) => ({
        id: run.id,
        model: run.forecastModel,
        planVersion: run.planVersion,
        scenario: run.scenario,
        status: run.status,
      })),
      data: comparisonData,
    };
  }

  async getAccuracyMetrics(planVersionId: string, scenarioId: string, user: any) {
    const run = await this.getLatestCompletedRun(planVersionId, scenarioId, user.tenantId);

    const [results, overrides] = await Promise.all([
      this.prisma.forecastResult.findMany({
        where: { tenantId: user.tenantId, forecastRunId: run.id },
      }),
      this.prisma.forecastOverride.findMany({
        where: { tenantId: user.tenantId, forecastRunId: run.id, status: OverrideStatus.APPROVED },
        orderBy: { requestedAt: 'desc' },
      }),
    ]);

    const adjusted = this.applyOverrides(results, overrides);
    const periods = adjusted.map((f) => f.periodDate);
    const actuals = await this.prisma.actual.findMany({
      where: {
        tenantId: user.tenantId,
        periodDate: { in: periods },
      },
    });

    const metrics = this.calculateAccuracyMetrics(adjusted, actuals);

    return {
      planVersionId,
      scenarioId,
      forecastRunId: run.id,
      metrics,
      dataPoints: adjusted.length,
      actualsAvailable: actuals.length,
    };
  }

  getAvailableModels() {
    return this.modelRegistry.getModelMetadata();
  }

  private calculateAccuracyMetrics(forecasts: any[], actuals: any[]) {
    // Create map of actuals by period + dimensions
    const actualMap = new Map<string, number>();
    for (const a of actuals) {
      const key = `${a.periodDate.toISOString()}-${a.productId || ''}-${a.locationId || ''}`;
      actualMap.set(key, Number(a.amount));
    }

    let sumAbsError = 0;
    let sumSquaredError = 0;
    let sumAbsPercentError = 0;
    let sumError = 0;
    let count = 0;

    forecasts.forEach((fd) => {
      const key = `${fd.periodDate.toISOString()}-${fd.productId || ''}-${fd.locationId || ''}`;
      const actualValue = actualMap.get(key);
      if (actualValue !== undefined && actualValue !== 0) {
        const forecastValue = Number(fd.forecastAmount);
        const error = forecastValue - actualValue;
        const absError = Math.abs(error);
        const percentError = absError / Math.abs(actualValue);

        sumAbsError += absError;
        sumSquaredError += error * error;
        sumAbsPercentError += percentError;
        sumError += error;
        count++;
      }
    });

    if (count === 0) {
      return {
        mape: null,
        rmse: null,
        mae: null,
        bias: null,
        accuracy: null,
      };
    }

    const mape = (sumAbsPercentError / count) * 100;
    const rmse = Math.sqrt(sumSquaredError / count);
    const mae = sumAbsError / count;
    const bias = sumError / count;

    return {
      mape: Math.round(mape * 100) / 100,
      rmse: Math.round(rmse * 100) / 100,
      mae: Math.round(mae * 100) / 100,
      bias: Math.round(bias * 100) / 100,
      accuracy: Math.round((100 - mape) * 100) / 100,
    };
  }

  async update(id: string, updateDto: Partial<CreateForecastDto>, user: any) {
    const result = await this.findOne(id, user);

    if (!updateDto.overrideReason) {
      throw new BadRequestException('Override reason is required');
    }

    await this.timeBucketService.getBucketOrThrow(
      user.tenantId,
      new Date(result.periodDate),
      result.periodType,
    );

    const override = await this.prisma.forecastOverride.create({
      data: {
        tenantId: user.tenantId,
        forecastRunId: result.forecastRunId,
        periodDate: result.periodDate,
        periodType: result.periodType,
        productId: result.productId,
        locationId: result.locationId,
        customerId: result.customerId,
        accountId: result.accountId,
        costCenterId: result.costCenterId,
        originalAmount: result.forecastAmount,
        overrideAmount: updateDto.forecastAmount ?? result.forecastAmount,
        originalQuantity: result.forecastQuantity,
        overrideQuantity: updateDto.forecastQuantity ?? result.forecastQuantity,
        currency: updateDto.currency || result.currency,
        reason: updateDto.overrideReason,
        status: OverrideStatus.PENDING,
        requestedById: user.id,
      },
    });

    await this.workflowService.startWorkflow(
      user.tenantId,
      WorkflowEntityType.FORECAST_OVERRIDE,
      override.id,
      user.id,
      updateDto.overrideReason,
    );

    await this.auditService.log(
      user.tenantId,
      user.id,
      AuditAction.CREATE,
      'ForecastOverride',
      override.id,
      { forecastAmount: result.forecastAmount, forecastQuantity: result.forecastQuantity },
      { forecastAmount: override.overrideAmount, forecastQuantity: override.overrideQuantity },
      ['forecastAmount', 'forecastQuantity'],
    );

    return override;
  }

  async remove(id: string, user: any) {
    await this.findOne(id, user);
    throw new BadRequestException('Forecast results are immutable and cannot be deleted');
  }

  async requestOverride(dto: CreateOverrideDto, user: any) {
    const result = await this.findOne(dto.forecastResultId, user);

    const run = await this.prisma.forecastRun.findFirst({
      where: { id: result.forecastRunId, tenantId: user.tenantId },
      select: { planVersionId: true, scenarioId: true },
    });

    if (!run) {
      throw new NotFoundException('Forecast run not found');
    }

    const [planVersion, scenario] = await Promise.all([
      this.prisma.planVersion.findFirst({
        where: { id: run.planVersionId, tenantId: user.tenantId },
        select: { status: true },
      }),
      this.prisma.scenario.findFirst({
        where: { id: run.scenarioId, tenantId: user.tenantId },
        select: { status: true },
      }),
    ]);

    if (planVersion?.status === PlanStatus.LOCKED || scenario?.status === PlanStatus.LOCKED) {
      throw new BadRequestException('Cannot override forecasts for locked plans or scenarios');
    }

    if (!dto.reason) {
      throw new BadRequestException('Override reason is required');
    }

    await this.timeBucketService.getBucketOrThrow(user.tenantId, new Date(result.periodDate), result.periodType);

    const override = await this.prisma.forecastOverride.create({
      data: {
        tenantId: user.tenantId,
        forecastRunId: result.forecastRunId,
        periodDate: result.periodDate,
        periodType: result.periodType,
        productId: result.productId,
        locationId: result.locationId,
        customerId: result.customerId,
        accountId: result.accountId,
        costCenterId: result.costCenterId,
        originalAmount: result.forecastAmount,
        overrideAmount: dto.overrideAmount,
        originalQuantity: result.forecastQuantity,
        overrideQuantity: dto.overrideQuantity ?? result.forecastQuantity,
        currency: dto.currency || result.currency,
        reason: dto.reason,
        status: OverrideStatus.PENDING,
        requestedById: user.id,
      },
    });

    await this.workflowService.startWorkflow(
      user.tenantId,
      WorkflowEntityType.FORECAST_OVERRIDE,
      override.id,
      user.id,
      dto.reason,
    );

    await this.auditService.log(
      user.tenantId,
      user.id,
      AuditAction.UPDATE,
      'ForecastOverride',
      override.id,
      { forecastAmount: result.forecastAmount, forecastQuantity: result.forecastQuantity },
      { forecastAmount: override.overrideAmount, forecastQuantity: override.overrideQuantity },
      ['forecastAmount', 'forecastQuantity'],
    );

    return override;
  }

  async approveOverride(id: string, notes: string | undefined, user: any) {
    const override = await this.prisma.forecastOverride.findFirst({
      where: { id, tenantId: user.tenantId },
    });

    if (!override) {
      throw new NotFoundException('Override not found');
    }

    const instance = await this.prisma.workflowInstance.findFirst({
      where: {
        tenantId: user.tenantId,
        entityType: WorkflowEntityType.FORECAST_OVERRIDE,
        entityId: override.id,
      },
      orderBy: { submittedAt: 'desc' },
    });

    if (!instance) {
      throw new BadRequestException('No workflow instance for override');
    }

    const workflow = await this.workflowService.approve(instance.id, user.id, notes);

    if (workflow.status !== WorkflowStatus.APPROVED) {
      return { status: workflow.status };
    }

    const approved = await this.prisma.$transaction(async (tx) => {
      const updatedOverride = await tx.forecastOverride.update({
        where: { id: override.id },
        data: {
          status: OverrideStatus.APPROVED,
          approvedById: user.id,
          approvedAt: new Date(),
          approvalNotes: notes,
        },
      });

      await tx.forecast.updateMany({
        where: {
          tenantId: user.tenantId,
          forecastRunId: override.forecastRunId,
          periodDate: override.periodDate,
          productId: override.productId,
          locationId: override.locationId,
          customerId: override.customerId,
          accountId: override.accountId,
          costCenterId: override.costCenterId,
        },
        data: {
          forecastAmount: updatedOverride.overrideAmount,
          forecastQuantity: updatedOverride.overrideQuantity,
          currency: updatedOverride.currency,
        },
      });

      return updatedOverride;
    });

    await this.auditService.log(
      user.tenantId,
      user.id,
      AuditAction.APPROVE,
      'ForecastOverride',
      override.id,
      null,
      { status: 'APPROVED' },
      ['status'],
    );

    return approved;
  }

  async rejectOverride(id: string, notes: string | undefined, user: any) {
    const override = await this.prisma.forecastOverride.findFirst({
      where: { id, tenantId: user.tenantId },
    });

    if (!override) {
      throw new NotFoundException('Override not found');
    }

    const instance = await this.prisma.workflowInstance.findFirst({
      where: {
        tenantId: user.tenantId,
        entityType: WorkflowEntityType.FORECAST_OVERRIDE,
        entityId: override.id,
      },
      orderBy: { submittedAt: 'desc' },
    });

    if (!instance) {
      throw new BadRequestException('No workflow instance for override');
    }

    await this.workflowService.reject(instance.id, user.id, notes);

    const rejected = await this.prisma.forecastOverride.update({
      where: { id: override.id },
      data: {
        status: OverrideStatus.REJECTED,
        approvedById: user.id,
        approvedAt: new Date(),
        approvalNotes: notes,
      },
    });

    await this.auditService.log(
      user.tenantId,
      user.id,
      AuditAction.UPDATE,
      'ForecastOverride',
      override.id,
      null,
      { status: 'REJECTED' },
      ['status'],
    );

    return rejected;
  }

  async reconcileForecastRun(forecastRunId: string, thresholdPct: number, user: any) {
    const run = await this.prisma.forecastRun.findFirst({
      where: { id: forecastRunId, tenantId: user.tenantId },
    });

    if (!run) {
      throw new NotFoundException('Forecast run not found');
    }

    if (run.status !== JobStatus.COMPLETED) {
      throw new BadRequestException('Forecast run must be completed before reconciliation');
    }

    const [results, overrides, actuals, tenant] = await Promise.all([
      this.prisma.forecastResult.findMany({
        where: { tenantId: user.tenantId, forecastRunId },
      }),
      this.prisma.forecastOverride.findMany({
        where: { tenantId: user.tenantId, forecastRunId, status: OverrideStatus.APPROVED },
        orderBy: { requestedAt: 'desc' },
      }),
      this.prisma.actual.findMany({
        where: {
          tenantId: user.tenantId,
          periodDate: { gte: run.startPeriod, lte: run.endPeriod },
        },
      }),
      this.prisma.tenant.findUnique({
        where: { id: user.tenantId },
        select: { defaultCurrency: true },
      }),
    ]);

    const reportingCurrency = tenant?.defaultCurrency || 'USD';
    const adjusted = this.applyOverrides(results, overrides);

    const actualMap = new Map<string, any>();
    for (const actual of actuals) {
      const key = this.buildOverrideKey(actual);
      actualMap.set(key, actual);
    }

    const reconciliationRows: any[] = [];
    const pendingRows: any[] = [];
    for (const forecast of adjusted) {
      const key = this.buildOverrideKey(forecast);
      const actual = actualMap.get(key);
      if (!actual) continue;

      const forecastAmount = await this.convertAmount(
        user.tenantId,
        forecast.forecastAmount,
        forecast.currency,
        reportingCurrency,
        forecast.periodDate,
      );

      const actualAmount = await this.convertAmount(
        user.tenantId,
        actual.amount,
        actual.currency,
        reportingCurrency,
        actual.periodDate,
      );

      const varianceAmount = Number(forecastAmount) - Number(actualAmount);
      const variancePct = actualAmount !== 0 ? (varianceAmount / Number(actualAmount)) * 100 : 0;

      reconciliationRows.push({
        tenantId: user.tenantId,
        forecastRunId,
        actualId: actual.id,
        periodDate: forecast.periodDate,
        periodType: forecast.periodType,
        productId: forecast.productId,
        locationId: forecast.locationId,
        customerId: forecast.customerId,
        accountId: forecast.accountId,
        costCenterId: forecast.costCenterId,
        forecastAmount,
        actualAmount,
        varianceAmount,
        variancePct,
        currency: reportingCurrency,
        thresholdPct,
        status: Math.abs(variancePct) >= thresholdPct ? ReconciliationStatus.PENDING : ReconciliationStatus.APPROVED,
      });
    }

    for (const row of reconciliationRows) {
      if (row.status === ReconciliationStatus.PENDING) {
        pendingRows.push(row);
      }
    }

    const approvedRows = reconciliationRows.filter(
      (row) => row.status === ReconciliationStatus.APPROVED,
    );

    if (approvedRows.length) {
      await this.prisma.forecastReconciliation.createMany({
        data: approvedRows,
        skipDuplicates: true,
      });
    }

    for (const row of pendingRows) {
      const created = await this.prisma.forecastReconciliation.create({
        data: row,
      });

      await this.workflowService.startWorkflow(
        user.tenantId,
        WorkflowEntityType.FORECAST_RECONCILIATION,
        created.id,
        user.id,
        'Variance requires approval',
      );
    }

    await this.auditService.log(
      user.tenantId,
      user.id,
      AuditAction.CREATE,
      'ForecastReconciliation',
      forecastRunId,
      null,
      { count: reconciliationRows.length, thresholdPct },
      ['count', 'thresholdPct'],
    );

    return { forecastRunId, reconciled: reconciliationRows.length };
  }

  async approveReconciliation(id: string, notes: string | undefined, user: any) {
    const reconciliation = await this.prisma.forecastReconciliation.findFirst({
      where: { id, tenantId: user.tenantId },
    });

    if (!reconciliation) {
      throw new NotFoundException('Reconciliation record not found');
    }

    const instance = await this.prisma.workflowInstance.findFirst({
      where: {
        tenantId: user.tenantId,
        entityType: WorkflowEntityType.FORECAST_RECONCILIATION,
        entityId: reconciliation.id,
      },
      orderBy: { submittedAt: 'desc' },
    });

    if (!instance) {
      throw new BadRequestException('No workflow instance for reconciliation');
    }

    const workflow = await this.workflowService.approve(instance.id, user.id, notes);

    if (workflow.status !== WorkflowStatus.APPROVED) {
      return { status: workflow.status };
    }

    const approved = await this.prisma.forecastReconciliation.update({
      where: { id: reconciliation.id },
      data: {
        status: ReconciliationStatus.APPROVED,
        approvedById: user.id,
        approvedAt: new Date(),
        notes,
      },
    });

    await this.auditService.log(
      user.tenantId,
      user.id,
      AuditAction.APPROVE,
      'ForecastReconciliation',
      reconciliation.id,
      null,
      { status: 'APPROVED' },
      ['status'],
    );

    return approved;
  }

  async rejectReconciliation(id: string, notes: string | undefined, user: any) {
    const reconciliation = await this.prisma.forecastReconciliation.findFirst({
      where: { id, tenantId: user.tenantId },
    });

    if (!reconciliation) {
      throw new NotFoundException('Reconciliation record not found');
    }

    const instance = await this.prisma.workflowInstance.findFirst({
      where: {
        tenantId: user.tenantId,
        entityType: WorkflowEntityType.FORECAST_RECONCILIATION,
        entityId: reconciliation.id,
      },
      orderBy: { submittedAt: 'desc' },
    });

    if (!instance) {
      throw new BadRequestException('No workflow instance for reconciliation');
    }

    await this.workflowService.reject(instance.id, user.id, notes);

    const rejected = await this.prisma.forecastReconciliation.update({
      where: { id: reconciliation.id },
      data: {
        status: ReconciliationStatus.REJECTED,
        approvedById: user.id,
        approvedAt: new Date(),
        notes,
      },
    });

    await this.auditService.log(
      user.tenantId,
      user.id,
      AuditAction.UPDATE,
      'ForecastReconciliation',
      reconciliation.id,
      null,
      { status: 'REJECTED' },
      ['status'],
    );

    return rejected;
  }

  // ============================================================================
  // ENHANCED FORECAST ANALYTICS (Additive - does not modify existing methods)
  // ============================================================================

  /**
   * Get aggregated chart data for all models in a plan/scenario
   * Returns data aggregated by period with each model's forecast values
   */
  async getAggregatedChartData(planVersionId: string, scenarioId: string, user: any) {
    // Get all completed forecast runs for this plan/scenario
    const runs = await this.prisma.forecastRun.findMany({
      where: {
        tenantId: user.tenantId,
        planVersionId,
        scenarioId,
        status: JobStatus.COMPLETED,
      },
      orderBy: { completedAt: 'desc' },
    });

    if (runs.length === 0) {
      return { data: [], models: [] };
    }

    // Get only the most recent run per model
    const latestRunByModel = new Map<string, string>();
    for (const run of runs) {
      if (!latestRunByModel.has(run.forecastModel)) {
        latestRunByModel.set(run.forecastModel, run.id);
      }
    }

    const runIds = Array.from(latestRunByModel.values());

    // Fetch all results for these runs
    const results = await this.prisma.forecastResult.findMany({
      where: {
        tenantId: user.tenantId,
        forecastRunId: { in: runIds },
      },
      include: {
        forecastRun: {
          select: { forecastModel: true },
        },
      },
      orderBy: { periodDate: 'asc' },
    });

    // Aggregate by period and model
    const periodMap = new Map<string, Record<string, any>>();

    for (const result of results) {
      const periodKey = result.periodDate.toISOString().slice(0, 7); // YYYY-MM
      const model = result.forecastRun.forecastModel;

      if (!periodMap.has(periodKey)) {
        periodMap.set(periodKey, {
          period: result.periodDate,
          periodLabel: periodKey,
          sortDate: result.periodDate.getTime(),
        });
      }

      const entry = periodMap.get(periodKey)!;

      // Sum amounts by model for this period
      if (!entry[model]) {
        entry[model] = 0;
      }
      entry[model] += Number(result.forecastAmount);

      // Handle confidence bands
      if (result.confidenceLower != null) {
        if (!entry[`${model}_lower`]) entry[`${model}_lower`] = 0;
        if (!entry[`${model}_upper`]) entry[`${model}_upper`] = 0;
        entry[`${model}_lower`] += Number(result.confidenceLower);
        entry[`${model}_upper`] += Number(result.confidenceUpper);
      }
    }

    const chartData = Array.from(periodMap.values())
      .sort((a, b) => a.sortDate - b.sortDate)
      .map(entry => {
        // Format period label for display
        const date = new Date(entry.period);
        entry.period = date.toLocaleDateString('en-US', { month: 'short', year: 'numeric' });
        return entry;
      });

    return {
      data: chartData,
      models: Array.from(latestRunByModel.keys()),
    };
  }

  /**
   * Get enhanced accuracy metrics with per-model breakdown
   * This calculates accuracy using historical data cross-validation since
   * forecast periods (future) don't have actuals yet.
   */
  async getEnhancedAccuracyMetrics(planVersionId: string, scenarioId: string, user: any) {
    const planVersion = await this.prisma.planVersion.findFirst({
      where: { id: planVersionId, tenantId: user.tenantId },
      select: { startDate: true, endDate: true },
    });

    if (!planVersion) {
      throw new NotFoundException('Plan version not found');
    }

    const runs = await this.prisma.forecastRun.findMany({
      where: {
        tenantId: user.tenantId,
        planVersionId,
        scenarioId,
        status: JobStatus.COMPLETED,
      },
      orderBy: { completedAt: 'desc' },
    });

    // Fetch historical actuals (before plan start date) for cross-validation accuracy
    const historicalActuals = await this.prisma.actual.findMany({
      where: {
        tenantId: user.tenantId,
        periodDate: {
          lt: planVersion.startDate,
        },
      },
      orderBy: { periodDate: 'asc' },
    });

    // Aggregate historical actuals by period for accuracy calculation
    const aggregatedActuals = this.aggregateActualsByPeriod(historicalActuals);

    const modelMetrics: Array<{
      modelName: string;
      displayName: string;
      mape: number | null;
      rmse: number | null;
      mae: number | null;
      bias: number | null;
      accuracy: number | null;
      dataPoints: number;
      forecastRunId: string;
    }> = [];

    // Track which models we've already processed (only keep most recent run per model)
    const processedModels = new Set<string>();
    
    for (const run of runs) {
      // Skip if we already have metrics for this model (runs are ordered by completedAt desc)
      if (processedModels.has(run.forecastModel)) {
        continue;
      }
      processedModels.add(run.forecastModel);

      // Get forecast result count for this run
      const resultCount = await this.prisma.forecastResult.count({
        where: { tenantId: user.tenantId, forecastRunId: run.id },
      });

      // Calculate cross-validation accuracy using historical data
      // Use holdout of last 20% of historical data
      const holdoutCount = Math.max(3, Math.floor(aggregatedActuals.length * 0.2));
      const trainingData = aggregatedActuals.slice(0, -holdoutCount);
      const holdoutData = aggregatedActuals.slice(-holdoutCount);

      let metrics = { mape: null as number | null, rmse: null as number | null, mae: null as number | null, bias: null as number | null, accuracy: null as number | null };

      // Calculate cross-validation accuracy if we have enough data
      if (trainingData.length >= 6 && holdoutData.length >= 3) {
        const model = this.modelRegistry.get(run.forecastModel);
        if (model && trainingData.length >= model.minDataPoints) {
          try {
            const trainingPoints: DataPoint[] = trainingData.map(a => ({
              date: new Date(a.periodDate),
              value: a.totalAmount,
              quantity: a.totalQuantity || 0,
            }));

            const state = model.fit(trainingPoints, model.defaultParameters);
            const predictions = model.predict(state, holdoutCount, {
              periods: holdoutCount,
              confidenceLevel: 95,
              ...model.defaultParameters,
            });

            // Calculate metrics against holdout
            let sumAbsError = 0;
            let sumSquaredError = 0;
            let sumAbsPercentError = 0;
            let sumError = 0;
            let count = 0;

            for (let i = 0; i < holdoutCount && i < predictions.length; i++) {
              const actual = holdoutData[i]?.totalAmount;
              const forecast = predictions[i].value;
              if (actual && actual !== 0) {
                const error = forecast - actual;
                const absError = Math.abs(error);
                const percentError = absError / Math.abs(actual);
                sumAbsError += absError;
                sumSquaredError += error * error;
                sumAbsPercentError += percentError;
                sumError += error;
                count++;
              }
            }

            if (count > 0) {
              const mape = (sumAbsPercentError / count) * 100;
              metrics = {
                mape: Math.round(mape * 100) / 100,
                rmse: Math.round(Math.sqrt(sumSquaredError / count) * 100) / 100,
                mae: Math.round((sumAbsError / count) * 100) / 100,
                bias: Math.round((sumError / count) * 100) / 100,
                accuracy: Math.round((100 - mape) * 100) / 100,
              };
            }
          } catch (e) {
            this.logger.warn(`Failed to calculate CV metrics for ${run.forecastModel}: ${e.message}`);
          }
        }
      }

      modelMetrics.push({
        modelName: run.forecastModel,
        displayName: this.formatModelName(run.forecastModel),
        ...metrics,
        dataPoints: resultCount,
        forecastRunId: run.id,
      });
    }

    modelMetrics.sort((a, b) => {
      if (a.mape === null) return 1;
      if (b.mape === null) return -1;
      return a.mape - b.mape;
    });

    const bestModel = modelMetrics.find((m) => m.mape !== null)?.modelName || null;
    const overallRun = modelMetrics[0];
    const overallMetrics = overallRun
      ? {
          mape: overallRun.mape,
          rmse: overallRun.rmse,
          mae: overallRun.mae,
          bias: overallRun.bias,
          accuracy: overallRun.accuracy,
        }
      : { mape: null, rmse: null, mae: null, bias: null, accuracy: null };

    let recommendation: string | null = null;
    if (bestModel) {
      const bestMetrics = modelMetrics.find((m) => m.modelName === bestModel);
      if (bestMetrics && bestMetrics.mape !== null && bestMetrics.mape < 15) {
        recommendation = `${bestMetrics.displayName} shows excellent accuracy (${bestMetrics.mape.toFixed(1)}% MAPE). Consider using it as the primary forecast.`;
      } else if (bestMetrics && bestMetrics.mape !== null && bestMetrics.mape < 25) {
        recommendation = `${bestMetrics.displayName} performs best (${bestMetrics.mape.toFixed(1)}% MAPE), but consider reviewing data quality for improved accuracy.`;
      } else if (bestMetrics) {
        recommendation = 'Forecast accuracy is moderate. Consider adding more historical data or adjusting model parameters.';
      }
    }

    return {
      planVersionId,
      scenarioId,
      overall: overallMetrics,
      byModel: modelMetrics,
      totalDataPoints: modelMetrics.reduce((sum, m) => sum + m.dataPoints, 0),
      actualsAvailable: historicalActuals.length,
      bestModel,
      recommendation,
    };
  }

  /**
   * Run backtesting on historical data
   * Holds out recent periods and validates model predictions against actuals
   */
  async runBacktest(
    planVersionId: string,
    scenarioId: string,
    holdoutPeriods: number = 6,
    modelNames: string[] | null,
    user: any,
  ) {
    // Validate inputs
    const planVersion = await this.prisma.planVersion.findFirst({
      where: { id: planVersionId, tenantId: user.tenantId },
    });

    if (!planVersion) {
      throw new NotFoundException('Plan version not found');
    }

    // Fetch all historical actuals
    const allActuals = await this.prisma.actual.findMany({
      where: {
        tenantId: user.tenantId,
        periodDate: {
          lt: planVersion.startDate || new Date(),
        },
      },
      orderBy: { periodDate: 'asc' },
      take: 5000,
    });

    if (allActuals.length < holdoutPeriods + 12) {
      throw new BadRequestException(
        `Insufficient data for backtesting. Need at least ${holdoutPeriods + 12} periods, have ${allActuals.length}.`,
      );
    }

    // Aggregate by period
    const aggregatedByPeriod = this.aggregateActualsByPeriod(allActuals);
    
    // Split into training and holdout sets
    const trainingData = aggregatedByPeriod.slice(0, -holdoutPeriods);
    const holdoutData = aggregatedByPeriod.slice(-holdoutPeriods);

    const trainingRange = {
      start: trainingData[0]?.periodDate.toISOString().split('T')[0] || '',
      end: trainingData[trainingData.length - 1]?.periodDate.toISOString().split('T')[0] || '',
    };

    const holdoutRange = {
      start: holdoutData[0]?.periodDate.toISOString().split('T')[0] || '',
      end: holdoutData[holdoutData.length - 1]?.periodDate.toISOString().split('T')[0] || '',
    };

    // Determine which models to test
    const modelsToTest = modelNames && modelNames.length > 0
      ? modelNames
      : this.modelRegistry.getModelNames();

    // Prepare training data points
    const trainingPoints: DataPoint[] = trainingData.map(a => ({
      date: new Date(a.periodDate),
      value: a.totalAmount,
      quantity: a.totalQuantity,
    }));

    const results: Array<{
      modelName: string;
      displayName: string;
      data: Array<{
        period: string;
        periodLabel: string;
        forecast: number;
        actual: number | null;
        error: number | null;
        percentError: number | null;
      }>;
      metrics: {
        mape: number | null;
        rmse: number | null;
        mae: number | null;
        bias: number | null;
      };
    }> = [];

    // Run backtest for each model
    for (const modelName of modelsToTest) {
      const model = this.modelRegistry.get(modelName);
      if (!model) continue;

      // Skip if insufficient training data
      if (trainingPoints.length < model.minDataPoints) {
        this.logger.warn(`Skipping ${modelName} for backtest: insufficient training data`);
        continue;
      }

      try {
        // Fit model on training data
        const validation = model.validate(trainingPoints);
        if (!validation.valid) continue;

        const state = model.fit(trainingPoints, model.defaultParameters);
        
        // Predict for holdout period
        const predictions = model.predict(state, holdoutPeriods, {
          periods: holdoutPeriods,
          confidenceLevel: 95,
          ...model.defaultParameters,
        });

        // Compare predictions to actuals
        const backtestData: Array<{
          period: string;
          periodLabel: string;
          forecast: number;
          actual: number | null;
          error: number | null;
          percentError: number | null;
        }> = [];

        let sumAbsError = 0;
        let sumSquaredError = 0;
        let sumAbsPercentError = 0;
        let sumError = 0;
        let count = 0;

        for (let i = 0; i < holdoutPeriods && i < predictions.length; i++) {
          const actualData = holdoutData[i];
          const forecast = predictions[i].value;
          const actual = actualData?.totalAmount || null;
          
          let error: number | null = null;
          let percentError: number | null = null;

          if (actual !== null && actual !== 0) {
            error = forecast - actual;
            percentError = Math.abs(error) / Math.abs(actual) * 100;
            
            sumAbsError += Math.abs(error);
            sumSquaredError += error * error;
            sumAbsPercentError += percentError;
            sumError += error;
            count++;
          }

          backtestData.push({
            period: actualData?.periodDate.toISOString().split('T')[0] || '',
            periodLabel: actualData?.periodDate 
              ? new Date(actualData.periodDate).toLocaleDateString('en-US', { month: 'short', year: '2-digit' })
              : `Period ${i + 1}`,
            forecast: Math.round(forecast * 100) / 100,
            actual: actual !== null ? Math.round(actual * 100) / 100 : null,
            error: error !== null ? Math.round(error * 100) / 100 : null,
            percentError: percentError !== null ? Math.round(percentError * 100) / 100 : null,
          });
        }

        const metrics = count > 0 ? {
          mape: Math.round((sumAbsPercentError / count) * 100) / 100,
          rmse: Math.round(Math.sqrt(sumSquaredError / count) * 100) / 100,
          mae: Math.round((sumAbsError / count) * 100) / 100,
          bias: Math.round((sumError / count) * 100) / 100,
        } : {
          mape: null,
          rmse: null,
          mae: null,
          bias: null,
        };

        results.push({
          modelName,
          displayName: this.formatModelName(modelName),
          data: backtestData,
          metrics,
        });
      } catch (error) {
        this.logger.warn(`Backtest failed for ${modelName}: ${error}`);
        continue;
      }
    }

    // Sort results by MAPE (best first)
    results.sort((a, b) => {
      if (a.metrics.mape === null) return 1;
      if (b.metrics.mape === null) return -1;
      return a.metrics.mape - b.metrics.mape;
    });

    const bestModel = results.find(r => r.metrics.mape !== null)?.modelName || null;

    return {
      planVersionId,
      scenarioId,
      holdoutPeriods,
      trainingRange,
      holdoutRange,
      results,
      bestModel,
    };
  }

  /**
   * Get detailed model explainability information
   */
  getModelExplainability() {
    const models = this.modelRegistry.getModelMetadata();
    
    // Add extended explanations for each model
    const explanations: Record<string, {
      methodology: string;
      bestFor: string[];
      limitations: string[];
      interpretability: 'high' | 'medium' | 'low';
    }> = {
      MOVING_AVERAGE: {
        methodology: 'Calculates the average of the last N periods to predict future values. Simple and robust for stable patterns.',
        bestFor: ['Stable demand patterns', 'Low volatility data', 'Short-term forecasting', 'Quick baseline estimates'],
        limitations: ['Does not capture trends', 'Ignores seasonality', 'Lags behind sudden changes'],
        interpretability: 'high',
      },
      WEIGHTED_AVERAGE: {
        methodology: 'Similar to moving average but assigns higher weights to more recent periods, making forecasts more responsive to recent changes.',
        bestFor: ['Recent trend emphasis', 'Moderate volatility', 'When recent data is more relevant'],
        limitations: ['Weight selection is subjective', 'Still lags trends', 'No seasonality support'],
        interpretability: 'high',
      },
      LINEAR_REGRESSION: {
        methodology: 'Fits a straight line through historical data to capture underlying trends. Projects this trend forward for forecasting.',
        bestFor: ['Clear upward or downward trends', 'Long-term projections', 'Growth or decline patterns'],
        limitations: ['Assumes linear relationship', 'Sensitive to outliers', 'No seasonality handling'],
        interpretability: 'high',
      },
      HOLT_WINTERS: {
        methodology: 'Triple exponential smoothing that captures level, trend, and seasonality components. Updates estimates dynamically.',
        bestFor: ['Seasonal data with trends', 'Complex patterns', 'Medium to long-term forecasting'],
        limitations: ['Requires 24+ data points', 'Parameter tuning complexity', 'Can overfit with limited data'],
        interpretability: 'medium',
      },
      SEASONAL_NAIVE: {
        methodology: 'Uses values from the same period in previous years as the forecast. Simple but effective for strong seasonal patterns.',
        bestFor: ['Strong seasonal patterns', 'Annual cycles', 'Holiday-driven demand'],
        limitations: ['Ignores trends', 'Requires full seasonal cycle history', 'No adaptation to changes'],
        interpretability: 'high',
      },
      YOY_GROWTH: {
        methodology: 'Applies year-over-year growth rates to same-period values from the previous year. Captures both seasonality and growth.',
        bestFor: ['Consistent growth rates', 'Seasonal business', 'Year-over-year comparisons'],
        limitations: ['Requires 12+ months history', 'Assumes consistent growth', 'Sensitive to base period anomalies'],
        interpretability: 'high',
      },
      TREND_PERCENT: {
        methodology: 'Calculates percentage trend from historical data and applies it consistently to future periods.',
        bestFor: ['Percentage-based growth', 'Budget planning', 'Target-based forecasting'],
        limitations: ['Assumes constant percentage change', 'No seasonality', 'Can compound unrealistically'],
        interpretability: 'high',
      },
      AI_HYBRID: {
        methodology: 'Combines multiple forecasting methods using weighted ensemble. Automatically selects weights based on historical accuracy.',
        bestFor: ['Complex patterns', 'When unsure which model fits best', 'Robust general-purpose forecasting'],
        limitations: ['Less interpretable', 'Computationally intensive', 'May average out best predictions'],
        interpretability: 'low',
      },
      ARIMA: {
        methodology: 'Autoregressive model using recent history to project future values with lag-1 dynamics.',
        bestFor: ['Stable time series', 'Short-term forecasting', 'Low seasonality data'],
        limitations: ['Simplified ARIMA', 'Limited seasonality', 'Sensitive to sudden shifts'],
        interpretability: 'medium',
      },
      PROPHET: {
        methodology: 'Additive trend and seasonal components with robust smoothing and season-length tuning.',
        bestFor: ['Seasonal demand', 'Trend-driven growth/decline', 'Medium-term planning'],
        limitations: ['Requires sufficient history', 'Seasonality assumptions', 'Simplified holiday effects'],
        interpretability: 'medium',
      },
    };

    return models.map(model => ({
      ...model,
      methodology: explanations[model.name]?.methodology || 'Standard forecasting methodology.',
      bestFor: explanations[model.name]?.bestFor || ['General forecasting'],
      limitations: explanations[model.name]?.limitations || ['Standard forecasting limitations'],
      interpretability: explanations[model.name]?.interpretability || 'medium',
    }));
  }

  /**
   * Set or update primary forecast model for a plan+scenario combination
   */
  async setPrimaryForecast(planVersionId: string, scenarioId: string, modelName: string, user: any) {
    // Validate inputs
    const planVersion = await this.prisma.planVersion.findFirst({
      where: { id: planVersionId, tenantId: user.tenantId },
    });

    if (!planVersion) {
      throw new NotFoundException('Plan version not found');
    }

    const scenario = await this.prisma.scenario.findFirst({
      where: { id: scenarioId, tenantId: user.tenantId },
    });

    if (!scenario) {
      throw new NotFoundException('Scenario not found');
    }

    // Validate model exists
    if (!this.modelRegistry.has(modelName)) {
      throw new BadRequestException(`Invalid model: ${modelName}`);
    }

    // Store as metadata using assumptions table with CUSTOM type
    // Use a specific naming convention: PRIMARY_FORECAST_MODEL
    const existingAssumption = await this.prisma.assumption.findFirst({
      where: {
        tenantId: user.tenantId,
        planVersionId,
        scenarioId,
        name: 'PRIMARY_FORECAST_MODEL',
        assumptionType: 'CUSTOM',
      },
    });

    // Model name index is stored in description field (schema has required value as Decimal)
    // We'll use value=0 as a placeholder and store model name in description
    if (existingAssumption) {
      // Update existing
      await this.prisma.assumption.update({
        where: { id: existingAssumption.id },
        data: {
          description: modelName,
          updatedAt: new Date(),
        },
      });
    } else {
      // Create new
      await this.prisma.assumption.create({
        data: {
          tenantId: user.tenantId,
          planVersionId,
          scenarioId,
          assumptionType: 'CUSTOM',
          name: 'PRIMARY_FORECAST_MODEL',
          description: modelName,
          value: 0, // Required field - use 0 as placeholder
          valueType: 'PERCENTAGE',
        },
      });
    }

    return {
      planVersionId,
      scenarioId,
      primaryModel: modelName,
      message: `${this.formatModelName(modelName)} set as primary forecast model`,
    };
  }

  /**
   * Auto-select and set primary forecast model using backtest results
   */
  async autoSelectPrimaryForecast(
    planVersionId: string,
    scenarioId: string,
    holdoutPeriods: number,
    models: string | undefined,
    user: any,
  ) {
    const modelList = models
      ? models.split(',').map((m) => m.trim()).filter(Boolean)
      : null;

    const backtest = await this.runBacktest(
      planVersionId,
      scenarioId,
      holdoutPeriods,
      modelList,
      user,
    );

    if (!backtest.bestModel) {
      return {
        ...backtest,
        primarySet: false,
        message: 'No suitable model found for auto-selection',
      };
    }

    await this.setPrimaryForecast(planVersionId, scenarioId, backtest.bestModel, user);

    return {
      ...backtest,
      primarySet: true,
      primaryModel: backtest.bestModel,
    };
  }

  /**
   * Get primary forecast model for a plan+scenario
   */
  async getPrimaryForecast(planVersionId: string, scenarioId: string, user: any) {
    const assumption = await this.prisma.assumption.findFirst({
      where: {
        tenantId: user.tenantId,
        planVersionId,
        scenarioId,
        name: 'PRIMARY_FORECAST_MODEL',
        assumptionType: 'CUSTOM',
      },
    });

    return {
      planVersionId,
      scenarioId,
      primaryModel: assumption?.description || null,
    };
  }

  /**
   * Helper to format model name for display
   */
  private formatModelName(modelName: string): string {
    return modelName
      .split('_')
      .map((w) => w.charAt(0).toUpperCase() + w.slice(1).toLowerCase())
      .join(' ');
  }

  private async getLatestCompletedRun(planVersionId: string, scenarioId: string, tenantId: string) {
    const primaryAssumption = await this.prisma.assumption.findFirst({
      where: {
        tenantId,
        planVersionId,
        scenarioId,
        name: 'PRIMARY_FORECAST_MODEL',
        assumptionType: 'CUSTOM',
      },
    });

    const run = await this.prisma.forecastRun.findFirst({
      where: {
        tenantId,
        planVersionId,
        scenarioId,
        isPersistent: true,
        status: JobStatus.COMPLETED,
        ...(primaryAssumption?.description && { forecastModel: primaryAssumption.description as ForecastModel }),
      },
      orderBy: { completedAt: 'desc' },
    });

    if (!run) {
      throw new NotFoundException('No completed forecast run found');
    }

    return run;
  }

  private applyOverrides(results: any[], overrides: any[]) {
    if (!overrides.length) return results;

    const overrideMap = new Map<string, any>();
    for (const override of overrides) {
      const key = this.buildOverrideKey(override);
      if (!overrideMap.has(key)) {
        overrideMap.set(key, override);
      }
    }

    return results.map((result) => {
      const key = this.buildOverrideKey(result);
      const override = overrideMap.get(key);
      if (!override) return result;

      return {
        ...result,
        forecastAmount: override.overrideAmount,
        forecastQuantity: override.overrideQuantity ?? result.forecastQuantity,
        currency: override.currency || result.currency,
        isOverride: true,
        overrideReason: override.reason,
      };
    });
  }

  private buildOverrideKey(record: any) {
    const period = new Date(record.periodDate).toISOString().split('T')[0];
    return [
      period,
      record.productId || '',
      record.locationId || '',
      record.customerId || '',
      record.accountId || '',
      record.costCenterId || '',
    ].join('|');
  }

  private async applyCurrencyConversion(results: any[], reportingCurrency: string, tenantId: string) {
    const cache = new Map<string, number>();

    const converted = [];
    for (const result of results) {
      const currency = result.currency || reportingCurrency;
      if (currency === reportingCurrency) {
        converted.push({ ...result, reportingCurrency, reportingAmount: Number(result.forecastAmount) });
        continue;
      }

      const key = `${currency}-${reportingCurrency}-${new Date(result.periodDate).toISOString().split('T')[0]}`;
      let rate = cache.get(key);
      if (!rate) {
        rate = await this.fxRateService.getRate(tenantId, currency, reportingCurrency, new Date(result.periodDate));
        cache.set(key, rate);
      }

      converted.push({
        ...result,
        reportingCurrency,
        reportingAmount: Number(result.forecastAmount) * rate,
      });
    }

    return converted;
  }

  private async convertAmount(
    tenantId: string,
    amount: number,
    fromCurrency: string,
    toCurrency: string,
    asOfDate: Date,
  ) {
    const sourceCurrency = fromCurrency || toCurrency;
    if (sourceCurrency === toCurrency) {
      return Number(amount);
    }

    const rate = await this.fxRateService.getRate(tenantId, sourceCurrency, toCurrency, asOfDate);
    return Number(amount) * rate;
  }

  private async validateTimeBuckets(
    tenantId: string,
    startDate: Date,
    endDate: Date,
    periodType: PeriodType,
  ) {
    const periodDates: Date[] = [];
    const cursor = new Date(startDate);

    while (cursor <= endDate) {
      periodDates.push(new Date(cursor));

      switch (periodType) {
        case PeriodType.QUARTERLY:
          cursor.setMonth(cursor.getMonth() + 3);
          break;
        case PeriodType.YEARLY:
          cursor.setFullYear(cursor.getFullYear() + 1);
          break;
        case PeriodType.WEEKLY:
          cursor.setDate(cursor.getDate() + 7);
          break;
        case PeriodType.DAILY:
          cursor.setDate(cursor.getDate() + 1);
          break;
        case PeriodType.MONTHLY:
        default:
          cursor.setMonth(cursor.getMonth() + 1);
          break;
      }
    }

    const periodKeys = periodDates.map((d) => this.timeBucketService.buildPeriodKey(d, periodType));

    const existing = await this.prisma.timeBucket.findMany({
      where: { tenantId, periodType, periodKey: { in: periodKeys } },
      select: { periodKey: true, isFrozen: true },
    });

    const existingMap = new Map(existing.map((b) => [b.periodKey, b]));
    const missingDates = periodDates.filter((d) => {
      const key = this.timeBucketService.buildPeriodKey(d, periodType);
      return !existingMap.has(key);
    });

    if (missingDates.length > 0) {
      await Promise.all(
        missingDates.map((d) =>
          this.timeBucketService.getBucketOrThrow(tenantId, d, periodType, { allowFrozen: true }),
        ),
      );
    }
  }

  private computeDefaultHistoryMonths(periodType: PeriodType): number {
    switch (periodType) {
      case PeriodType.DAILY:
        return 3;
      case PeriodType.WEEKLY:
        return 12;
      case PeriodType.MONTHLY:
        return 24;
      case PeriodType.QUARTERLY:
        return 36;
      case PeriodType.YEARLY:
        return 60;
      default:
        return 24;
    }
  }

  async getActualsForChart(planVersionId: string, scenarioId: string, user: any) {
    const planVersion = await this.prisma.planVersion.findFirst({
      where: { id: planVersionId, tenantId: user.tenantId },
      select: { startDate: true, endDate: true },
    });

    if (!planVersion) {
      throw new NotFoundException('Plan version not found');
    }

    const lookbackStart = new Date(planVersion.startDate);
    lookbackStart.setMonth(lookbackStart.getMonth() - 24);

    const actuals = await this.prisma.actual.findMany({
      where: {
        tenantId: user.tenantId,
        periodDate: { gte: lookbackStart, lt: planVersion.endDate || planVersion.startDate },
      },
      orderBy: { periodDate: 'asc' },
    });

    const periodMap = new Map<string, { period: string; sortDate: number; actual: number }>();

    for (const a of actuals) {
      const key = a.periodDate.toISOString().slice(0, 7);
      const entry = periodMap.get(key);
      const amt = Number(a.amount) || 0;
      if (entry) {
        entry.actual += amt;
      } else {
        periodMap.set(key, {
          period: new Date(a.periodDate).toLocaleDateString('en-US', { month: 'short', year: 'numeric' }),
          sortDate: a.periodDate.getTime(),
          actual: amt,
        });
      }
    }

    return Array.from(periodMap.values()).sort((a, b) => a.sortDate - b.sortDate);
  }

  async exportForecasts(planVersionId: string, scenarioId: string, format: string, user: any) {
    const runs = await this.prisma.forecastRun.findMany({
      where: {
        tenantId: user.tenantId,
        planVersionId,
        scenarioId,
        status: JobStatus.COMPLETED,
      },
      orderBy: { completedAt: 'desc' },
    });

    const latestRunByModel = new Map<string, string>();
    for (const run of runs) {
      if (!latestRunByModel.has(run.forecastModel)) {
        latestRunByModel.set(run.forecastModel, run.id);
      }
    }

    const runIds = Array.from(latestRunByModel.values());

    const results = await this.prisma.forecastResult.findMany({
      where: {
        tenantId: user.tenantId,
        forecastRunId: { in: runIds },
      },
      include: {
        forecastRun: { select: { forecastModel: true, scenarioId: true } },
        product: { select: { id: true, name: true, code: true } },
        location: { select: { id: true, name: true, code: true } },
      },
      orderBy: { periodDate: 'asc' },
    });

    const rows = results.map((r) => ({
      Model: r.forecastRun.forecastModel,
      Period: r.periodDate.toISOString().split('T')[0],
      PeriodType: r.periodType,
      Product: r.product?.name || '',
      ProductCode: r.product?.code || '',
      Location: r.location?.name || '',
      LocationCode: r.location?.code || '',
      ForecastAmount: Number(r.forecastAmount),
      ForecastQuantity: r.forecastQuantity != null ? Number(r.forecastQuantity) : '',
      Currency: r.currency,
      ConfidenceLower: r.confidenceLower != null ? Number(r.confidenceLower) : '',
      ConfidenceUpper: r.confidenceUpper != null ? Number(r.confidenceUpper) : '',
      ConfidenceLevel: r.confidenceLevel || 95,
    }));

    if (format === 'json') {
      return { data: rows, count: rows.length };
    }

    const headers = Object.keys(rows[0] || {});
    const csvLines = [headers.join(',')];
    for (const row of rows) {
      csvLines.push(headers.map((h) => {
        const val = (row as any)[h];
        return typeof val === 'string' && val.includes(',') ? `"${val}"` : val;
      }).join(','));
    }
    return { csv: csvLines.join('\n'), count: rows.length };
  }

  async getForecastVersions(planVersionId: string, scenarioId: string, user: any) {
    const runs = await this.prisma.forecastRun.findMany({
      where: {
        tenantId: user.tenantId,
        planVersionId,
        scenarioId,
        status: JobStatus.COMPLETED,
      },
      orderBy: { completedAt: 'desc' },
      select: {
        id: true,
        forecastModel: true,
        modelVersion: true,
        status: true,
        createdAt: true,
        completedAt: true,
        startPeriod: true,
        endPeriod: true,
        inputSnapshot: true,
        _count: { select: { results: true } },
      },
    });

    return runs.map((r) => ({
      id: r.id,
      model: r.forecastModel,
      modelVersion: r.modelVersion,
      status: r.status,
      createdAt: r.createdAt,
      completedAt: r.completedAt,
      startPeriod: r.startPeriod,
      endPeriod: r.endPeriod,
      snapshotLabel: (r.inputSnapshot as any)?.snapshotLabel || null,
      resultCount: r._count.results,
    }));
  }

  async compareVersions(runIds: string[], user: any) {
    const runs = await this.prisma.forecastRun.findMany({
      where: { id: { in: runIds }, tenantId: user.tenantId },
      select: { id: true, forecastModel: true, completedAt: true, inputSnapshot: true },
    });

    if (runs.length !== runIds.length) {
      throw new NotFoundException('One or more forecast runs not found');
    }

    const results = await this.prisma.forecastResult.findMany({
      where: { tenantId: user.tenantId, forecastRunId: { in: runIds } },
      select: {
        forecastRunId: true,
        periodDate: true,
        forecastAmount: true,
        confidenceLower: true,
        confidenceUpper: true,
      },
    });

    const periodMap = new Map<string, Record<string, any>>();
    for (const row of results) {
      const periodKey = row.periodDate.toISOString().slice(0, 7);
      if (!periodMap.has(periodKey)) {
        periodMap.set(periodKey, {
          period: new Date(row.periodDate).toLocaleDateString('en-US', { month: 'short', year: 'numeric' }),
          sortDate: row.periodDate.getTime(),
        });
      }
      const entry = periodMap.get(periodKey)!;
      const label = row.forecastRunId;
      entry[label] = (entry[label] || 0) + Number(row.forecastAmount);
    }

    return {
      versions: runs.map((r) => ({
        id: r.id,
        model: r.forecastModel,
        completedAt: r.completedAt,
        snapshotLabel: (r.inputSnapshot as any)?.snapshotLabel || null,
      })),
      data: Array.from(periodMap.values()).sort((a, b) => a.sortDate - b.sortDate),
    };
  }

  async getAccuracyAlerts(planVersionId: string, scenarioId: string, threshold: number, user: any) {
    const enhanced = await this.getEnhancedAccuracyMetrics(planVersionId, scenarioId, user);
    const alerts: Array<{
      level: 'critical' | 'warning' | 'info';
      model: string;
      displayName: string;
      mape: number | null;
      message: string;
    }> = [];

    for (const m of enhanced.byModel) {
      if (m.mape === null) {
        alerts.push({
          level: 'info',
          model: m.modelName,
          displayName: m.displayName,
          mape: null,
          message: `${m.displayName}: Insufficient data for accuracy calculation.`,
        });
        continue;
      }
      if (m.mape > threshold) {
        alerts.push({
          level: m.mape > threshold * 1.5 ? 'critical' : 'warning',
          model: m.modelName,
          displayName: m.displayName,
          mape: m.mape,
          message: `${m.displayName} MAPE is ${m.mape.toFixed(1)}% (threshold: ${threshold}%). Consider switching models or adding more historical data.`,
        });
      }
    }

    return {
      planVersionId,
      scenarioId,
      threshold,
      alertCount: alerts.filter((a) => a.level !== 'info').length,
      alerts,
      recommendation: enhanced.recommendation,
    };
  }

  async getDimensionBreakdown(
    planVersionId: string,
    scenarioId: string,
    dimensionType: string,
    user: any,
  ) {
    const runs = await this.prisma.forecastRun.findMany({
      where: {
        tenantId: user.tenantId,
        planVersionId,
        scenarioId,
        status: JobStatus.COMPLETED,
      },
      orderBy: { completedAt: 'desc' },
    });

    const latestRunByModel = new Map<string, string>();
    for (const run of runs) {
      if (!latestRunByModel.has(run.forecastModel)) {
        latestRunByModel.set(run.forecastModel, run.id);
      }
    }

    const runIds = Array.from(latestRunByModel.values());
    const dimField = dimensionType === 'product' ? 'productId'
      : dimensionType === 'location' ? 'locationId'
      : dimensionType === 'customer' ? 'customerId'
      : 'productId';

    const results = await this.prisma.forecastResult.findMany({
      where: {
        tenantId: user.tenantId,
        forecastRunId: { in: runIds },
        [dimField]: { not: null },
      },
      select: {
        forecastRunId: true,
        periodDate: true,
        forecastAmount: true,
        [dimField]: true,
        forecastRun: { select: { forecastModel: true } },
        product: dimField === 'productId' ? { select: { id: true, name: true, code: true } } : undefined,
        location: dimField === 'locationId' ? { select: { id: true, name: true, code: true } } : undefined,
        customer: dimField === 'customerId' ? { select: { id: true, name: true, code: true } } : undefined,
      } as any,
      orderBy: { periodDate: 'asc' },
    });

    const dimGroups = new Map<string, { id: string; name: string; code: string; totalAmount: number; periods: Map<string, number> }>();

    for (const r of results) {
      const dimId = (r as any)[dimField] as string;
      if (!dimId) continue;

      const dimObj = (r as any).product || (r as any).location || (r as any).customer || { id: dimId, name: dimId, code: dimId };

      if (!dimGroups.has(dimId)) {
        dimGroups.set(dimId, {
          id: dimObj.id,
          name: dimObj.name,
          code: dimObj.code,
          totalAmount: 0,
          periods: new Map(),
        });
      }

      const group = dimGroups.get(dimId)!;
      group.totalAmount += Number(r.forecastAmount);
      const pk = new Date(r.periodDate).toISOString().slice(0, 7);
      group.periods.set(pk, (group.periods.get(pk) || 0) + Number(r.forecastAmount));
    }

    const items = Array.from(dimGroups.values())
      .sort((a, b) => b.totalAmount - a.totalAmount)
      .map((g) => ({
        id: g.id,
        name: g.name,
        code: g.code,
        totalAmount: Math.round(g.totalAmount * 100) / 100,
        periodData: Array.from(g.periods.entries())
          .sort(([a], [b]) => a.localeCompare(b))
          .map(([period, amount]) => ({
            period,
            periodLabel: new Date(period + '-01').toLocaleDateString('en-US', { month: 'short', year: 'numeric' }),
            amount: Math.round(amount * 100) / 100,
          })),
      }));

    return { dimensionType, items };
  }

  async snapshotForecast(planVersionId: string, scenarioId: string, label: string, user: any) {
    const runs = await this.prisma.forecastRun.findMany({
      where: {
        tenantId: user.tenantId,
        planVersionId,
        scenarioId,
        status: JobStatus.COMPLETED,
      },
      orderBy: { completedAt: 'desc' },
    });

    const latestRunByModel = new Map<string, string>();
    for (const run of runs) {
      if (!latestRunByModel.has(run.forecastModel)) {
        latestRunByModel.set(run.forecastModel, run.id);
      }
    }

    const runIdsToSnapshot = Array.from(latestRunByModel.values());
    const snapshotAt = new Date().toISOString();

    await this.prisma.$transaction(
      runIdsToSnapshot.map((runId) => {
        const run = runs.find((r) => r.id === runId)!;
        const snapshot = { ...((run.inputSnapshot as Record<string, any>) || {}), snapshotLabel: label, snapshotAt };
        return this.prisma.forecastRun.update({
          where: { id: runId },
          data: { inputSnapshot: snapshot },
        });
      }),
    );

    await this.auditService.log(
      user.tenantId,
      user.id,
      AuditAction.UPDATE,
      'ForecastSnapshot',
      planVersionId,
      null,
      { label, scenarioId, runsSnapshot: runIdsToSnapshot.length },
      ['label'],
    );

    return { planVersionId, scenarioId, label, runsSnapshot: runIdsToSnapshot.length };
  }

  async getForecastDashboardSummary(user: any) {
    const [totalRuns, completedRuns, failedRuns, totalForecasts, recentRuns] = await Promise.all([
      this.prisma.forecastRun.count({ where: { tenantId: user.tenantId } }),
      this.prisma.forecastRun.count({ where: { tenantId: user.tenantId, status: JobStatus.COMPLETED } }),
      this.prisma.forecastRun.count({ where: { tenantId: user.tenantId, status: JobStatus.FAILED } }),
      this.prisma.forecastResult.count({ where: { tenantId: user.tenantId } }),
      this.prisma.forecastRun.findMany({
        where: { tenantId: user.tenantId, status: JobStatus.COMPLETED },
        orderBy: { completedAt: 'desc' },
        take: 10,
        select: {
          id: true,
          forecastModel: true,
          completedAt: true,
          planVersionId: true,
          scenarioId: true,
          inputSnapshot: true,
          _count: { select: { results: true } },
        },
      }),
    ]);

    const modelsUsed = new Set<string>();
    for (const r of recentRuns) {
      modelsUsed.add(r.forecastModel);
    }

    const totalForecastValue = await this.prisma.forecastResult.aggregate({
      where: { tenantId: user.tenantId },
      _sum: { forecastAmount: true },
    });

    return {
      totalRuns,
      completedRuns,
      failedRuns,
      totalForecasts,
      totalForecastValue: Number(totalForecastValue._sum.forecastAmount || 0),
      modelsUsed: Array.from(modelsUsed),
      lastForecastDate: recentRuns[0]?.completedAt || null,
      recentRuns: recentRuns.map((r) => ({
        id: r.id,
        forecastModel: r.forecastModel,
        createdAt: r.completedAt,
        status: 'COMPLETED',
        resultCount: r._count.results,
        snapshotLabel: (r.inputSnapshot as any)?.snapshotLabel || null,
      })),
    };
  }
}
