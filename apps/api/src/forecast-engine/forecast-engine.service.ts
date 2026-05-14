import { BadRequestException, Injectable, Logger } from '@nestjs/common';
import {
  AccuracyMetrics,
  BatchForecastInput,
  BatchForecastOutput,
  DataPoint
} from './interfaces/forecast-model.interface';
import { ForecastModelRegistry } from './model-registry';

@Injectable()
export class ForecastEngineService {
  private readonly logger = new Logger(ForecastEngineService.name);

  constructor(private readonly modelRegistry: ForecastModelRegistry) {}

  /**
   * Generate forecasts for multiple dimension combinations
   */
  async generateForecasts(input: BatchForecastInput): Promise<BatchForecastOutput[]> {
    const model = this.modelRegistry.get(input.model);

    if (!model) {
      throw new BadRequestException(`Unknown forecast model: ${input.model}`);
    }

    // Group historical data by dimension combinations
    const groupedData = this.groupByDimensions(
      input.historicalData,
      input.dimensions,
    );

    const results: BatchForecastOutput[] = [];
    const periods = this.calculatePeriods(input.startPeriod, input.endPeriod, input.periodType);

    for (const [dimensionKey, timeSeries] of groupedData.entries()) {
      try {
        // Extract data points
        const dataPoints: DataPoint[] = timeSeries.map((d) => ({
          date: new Date(d.periodDate),
          value: Number(d.amount),
          quantity: d.quantity ? Number(d.quantity) : undefined,
        }));

        // Validate data
        const validation = model.validate(dataPoints);
        if (!validation.valid) {
          this.logger.warn(
            `Skipping dimension ${dimensionKey}: ${validation.warnings.join(', ')}`,
          );
          continue;
        }

        // Merge default and custom parameters
        const params = {
          ...model.defaultParameters,
          ...input.parameters,
        };

        // Fit model
        const state = model.fit(dataPoints, params);

        // Generate predictions
        const predictions = model.predict(state, periods.length, {
          periods: periods.length,
          confidenceLevel: input.parameters.confidenceLevel || 95,
          ...params,
        });

        // Map predictions to output format
        const dimensions = this.parseDimensionKey(dimensionKey);
        
        for (let i = 0; i < predictions.length; i++) {
          results.push({
            planVersionId: input.planVersionId,
            scenarioId: input.scenarioId,
            model: input.model,
            periodDate: periods[i],
            periodType: input.periodType || 'MONTHLY',
            ...dimensions,
            quantity: predictions[i].quantity,
            amount: predictions[i].value,
            currency: input.parameters?.currency || 'USD',
            confidenceLower: predictions[i].confidenceLower,
            confidenceUpper: predictions[i].confidenceUpper,
            confidenceLevel: predictions[i].confidenceLevel || 95,
          });
        }
      } catch (error) {
        this.logger.error(
          `Error forecasting dimension ${dimensionKey}: ${error.message}`,
        );
      }
    }

    return results;
  }

  /**
   * Calculate accuracy metrics comparing forecasts to actuals
   */
  calculateMetrics(
    actuals: any[],
    forecasts: BatchForecastOutput[],
  ): AccuracyMetrics {
    if (!actuals.length || !forecasts.length) {
      return { mape: 0, rmse: 0, mae: 0, mse: 0 };
    }

    // Create lookup for actuals
    const actualMap = new Map<string, number>();
    for (const actual of actuals) {
      const key = this.createPeriodKey(actual);
      actualMap.set(key, Number(actual.amount));
    }

    const errors: number[] = [];
    const percentageErrors: number[] = [];

    for (const forecast of forecasts) {
      const key = this.createPeriodKey({
        periodDate: forecast.periodDate,
        productId: forecast.productId,
        locationId: forecast.locationId,
      });

      const actualValue = actualMap.get(key);
      if (actualValue !== undefined && actualValue !== 0) {
        const error = forecast.amount - actualValue;
        errors.push(error);
        percentageErrors.push(Math.abs(error / actualValue) * 100);
      }
    }

    if (errors.length === 0) {
      return { mape: 0, rmse: 0, mae: 0, mse: 0 };
    }

    const mse = errors.reduce((sum, e) => sum + e * e, 0) / errors.length;
    const mae = errors.reduce((sum, e) => sum + Math.abs(e), 0) / errors.length;
    const rmse = Math.sqrt(mse);
    const mape = percentageErrors.reduce((sum, e) => sum + e, 0) / percentageErrors.length;

    // Calculate R-squared
    const actualValues = forecasts
      .map((f) => {
        const key = this.createPeriodKey({
          periodDate: f.periodDate,
          productId: f.productId,
          locationId: f.locationId,
        });
        return actualMap.get(key);
      })
      .filter((v) => v !== undefined) as number[];

    const meanActual = actualValues.reduce((sum, v) => sum + v, 0) / actualValues.length;
    const ssTotal = actualValues.reduce((sum, v) => sum + Math.pow(v - meanActual, 2), 0);
    const ssResidual = errors.reduce((sum, e) => sum + e * e, 0);
    const r2 = ssTotal > 0 ? 1 - ssResidual / ssTotal : 0;

    return {
      mape: Math.round(mape * 100) / 100,
      rmse: Math.round(rmse * 100) / 100,
      mae: Math.round(mae * 100) / 100,
      mse: Math.round(mse * 100) / 100,
      r2: Math.round(r2 * 1000) / 1000,
    };
  }

  /**
   * Get available forecast models
   */
  getAvailableModels() {
    return this.modelRegistry.getModelMetadata();
  }

  /**
   * Analyze data and recommend suitable models
   */
  analyzeAndRecommend(
    data: DataPoint[],
    seasonalityConfig?: {
      minDataPoints?: number;
      correlationThreshold?: number;
      seasonalLag?: number;
    },
  ): {
    characteristics: {
      dataPoints: number;
      hasSeasonality: boolean;
      hasTrend: boolean;
      volatility: 'low' | 'medium' | 'high';
      seasonalityScore: number;
    };
    recommendedModels: string[];
  } {
    const characteristics = this.analyzeDataCharacteristics(data, seasonalityConfig);
    const recommendedModels = this.modelRegistry.recommendModels(characteristics);

    return { characteristics, recommendedModels };
  }

  private analyzeDataCharacteristics(
    data: DataPoint[],
    seasonalityConfig?: {
      minDataPoints?: number;
      correlationThreshold?: number;
      seasonalLag?: number;
    },
  ): {
    dataPoints: number;
    hasSeasonality: boolean;
    hasTrend: boolean;
    volatility: 'low' | 'medium' | 'high';
    seasonalityScore: number;
  } {
    const values = data.map((d) => d.value);
    const n = values.length;

    const xMean = (n - 1) / 2;
    const yMean = values.reduce((sum, v) => sum + v, 0) / n;
    
    let numerator = 0;
    let denominator = 0;
    for (let i = 0; i < n; i++) {
      numerator += (i - xMean) * (values[i] - yMean);
      denominator += Math.pow(i - xMean, 2);
    }
    const slope = denominator !== 0 ? numerator / denominator : 0;
    const hasTrend = Math.abs(slope) > yMean * 0.01;

    const { detected: hasSeasonality, score: seasonalityScore } = this.detectSeasonality(
      values,
      seasonalityConfig?.minDataPoints ?? 24,
      seasonalityConfig?.correlationThreshold ?? 0.5,
      seasonalityConfig?.seasonalLag ?? 12,
    );

    const stdDev = Math.sqrt(
      values.reduce((sum, v) => sum + Math.pow(v - yMean, 2), 0) / n,
    );
    const cv = yMean !== 0 ? stdDev / yMean : 0;
    
    let volatility: 'low' | 'medium' | 'high';
    if (cv < 0.1) volatility = 'low';
    else if (cv < 0.3) volatility = 'medium';
    else volatility = 'high';

    return {
      dataPoints: n,
      hasSeasonality,
      hasTrend,
      volatility,
      seasonalityScore,
    };
  }

  private detectSeasonality(
    values: number[],
    minDataPoints: number,
    correlationThreshold: number,
    seasonalLag: number,
  ): { detected: boolean; score: number } {
    if (values.length < minDataPoints) return { detected: false, score: 0 };

    const n = values.length;
    const mean = values.reduce((sum, v) => sum + v, 0) / n;
    const variance = values.reduce((sum, v) => sum + Math.pow(v - mean, 2), 0) / n;

    if (variance === 0) return { detected: false, score: 0 };

    let autoCorr = 0;
    for (let i = seasonalLag; i < n; i++) {
      autoCorr += (values[i] - mean) * (values[i - seasonalLag] - mean);
    }
    autoCorr /= (n - seasonalLag) * variance;

    return { detected: autoCorr > correlationThreshold, score: Math.round(autoCorr * 1000) / 1000 };
  }

  private groupByDimensions(
    data: any[],
    dimensions: string[],
  ): Map<string, any[]> {
    const grouped = new Map<string, any[]>();

    for (const record of data) {
      const key = dimensions
        .map((dim) => `${dim}:${record[dim] || 'null'}`)
        .join('|');

      if (!grouped.has(key)) {
        grouped.set(key, []);
      }
      grouped.get(key)!.push(record);
    }

    return grouped;
  }

  private parseDimensionKey(key: string): Record<string, string | undefined> {
    const result: Record<string, string | undefined> = {};
    const parts = key.split('|');

    for (const part of parts) {
      const [dim, value] = part.split(':');
      result[dim] = value === 'null' ? undefined : value;
    }

    return result;
  }

  private calculatePeriods(start: Date, end: Date, periodType?: string): Date[] {
    const periods: Date[] = [];
    const current = new Date(start);

    while (current <= end) {
      periods.push(new Date(current));
      switch (periodType) {
        case 'QUARTERLY':
          current.setMonth(current.getMonth() + 3);
          break;
        case 'YEARLY':
          current.setFullYear(current.getFullYear() + 1);
          break;
        case 'WEEKLY':
          current.setDate(current.getDate() + 7);
          break;
        case 'DAILY':
          current.setDate(current.getDate() + 1);
          break;
        case 'MONTHLY':
        default:
          current.setMonth(current.getMonth() + 1);
          break;
      }
    }

    return periods;
  }

  private createPeriodKey(record: any): string {
    const date = new Date(record.periodDate);
    return `${date.getFullYear()}-${date.getMonth() + 1}-${record.productId || ''}-${record.locationId || ''}`;
  }
}
