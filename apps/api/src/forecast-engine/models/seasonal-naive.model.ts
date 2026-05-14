import { Injectable } from '@nestjs/common';
import {
    ConfidenceInterval,
    DataPoint,
    ForecastParameters,
    IForecastModel,
    ModelState,
    Prediction,
} from '../interfaces/forecast-model.interface';

/**
 * Seasonal Naive Model
 * 
 * Best for: Strong seasonal patterns with minimal trend
 * Input: Historical values, seasonality period
 * Output: Same value as same period last year
 * 
 * Formula: Forecast[t+k] = Actual[t+k-m] where m is seasonal period
 */
@Injectable()
export class SeasonalNaiveModel implements IForecastModel {
  readonly name = 'SEASONAL_NAIVE';
  readonly version = '1.0.0';
  readonly displayName = 'Seasonal Naive';
  readonly description =
    'Uses the value from the same period in the previous season. Simple but effective for highly seasonal data.';
  readonly minDataPoints = 12;
  readonly supportsSeasonality = true;
  readonly defaultParameters = {
    seasonalPeriod: 12,
  };

  fit(data: DataPoint[], parameters?: Record<string, any>): ModelState {
    const params = { ...this.defaultParameters, ...parameters };
    const { seasonalPeriod } = params;

    const values = data.map((d) => d.value);
    const quantities = data.map((d) => d.quantity || 0);

    // Get the last full season of data
    const lastSeasonValues = values.slice(-seasonalPeriod);
    const lastSeasonQuantities = quantities.slice(-seasonalPeriod);

    // Calculate residuals for confidence intervals
    const residuals: number[] = [];
    for (let i = seasonalPeriod; i < values.length; i++) {
      residuals.push(values[i] - values[i - seasonalPeriod]);
    }

    const residualStdDev =
      residuals.length > 0
        ? Math.sqrt(residuals.reduce((sum, r) => sum + r * r, 0) / residuals.length)
        : 0;

    return {
      modelName: this.name,
      parameters: {
        seasonalPeriod,
        lastSeasonValues,
        lastSeasonQuantities,
        residualStdDev,
        lastDate: data[data.length - 1].date,
      },
      fittedAt: new Date(),
      trainingMetrics: this.calculateTrainingMetrics(values, seasonalPeriod),
    };
  }

  predict(
    state: ModelState,
    periods: number,
    parameters?: ForecastParameters,
  ): Prediction[] {
    const {
      seasonalPeriod,
      lastSeasonValues,
      lastSeasonQuantities,
      residualStdDev,
      lastDate,
    } = state.parameters;
    const confidenceLevel = parameters?.confidenceLevel || 95;
    const predictions: Prediction[] = [];

    for (let k = 1; k <= periods; k++) {
      const seasonalIndex = (k - 1) % seasonalPeriod;
      const forecastValue = lastSeasonValues[seasonalIndex];
      const forecastQuantity = lastSeasonQuantities[seasonalIndex];

      const forecastDate = new Date(lastDate);
      forecastDate.setMonth(forecastDate.getMonth() + k);

      const interval = this.getConfidenceInterval(
        { date: forecastDate, value: forecastValue },
        state,
        confidenceLevel,
      );

      predictions.push({
        date: forecastDate,
        value: Math.round(forecastValue * 100) / 100,
        quantity: forecastQuantity > 0 ? Math.round(forecastQuantity * 100) / 100 : undefined,
        confidenceLower: interval.lower,
        confidenceUpper: interval.upper,
        confidenceLevel,
      });
    }

    return predictions;
  }

  getConfidenceInterval(
    prediction: Prediction,
    state: ModelState,
    level: number,
  ): ConfidenceInterval {
    const { residualStdDev } = state.parameters;

    const zScores: Record<number, number> = {
      80: 1.28,
      90: 1.645,
      95: 1.96,
      99: 2.576,
    };
    const z = zScores[level] || 1.96;
    const margin = z * residualStdDev;

    return {
      lower: Math.max(0, Math.round((prediction.value - margin) * 100) / 100),
      upper: Math.round((prediction.value + margin) * 100) / 100,
      level,
    };
  }

  validate(data: DataPoint[]): { valid: boolean; warnings: string[] } {
    const warnings: string[] = [];

    if (data.length < this.minDataPoints) {
      return {
        valid: false,
        warnings: [`Requires at least ${this.minDataPoints} data points`],
      };
    }

    const values = data.map((d) => d.value);

    // Check for trend
    const trend = this.detectTrend(values);
    if (Math.abs(trend) > 0.1) {
      warnings.push(
        'Data shows significant trend. Consider combining with trend adjustment.',
      );
    }

    return { valid: true, warnings };
  }

  getRecommendedParameters(data: DataPoint[]): Record<string, any> {
    return { seasonalPeriod: 12 };
  }

  private calculateTrainingMetrics(
    values: number[],
    seasonalPeriod: number,
  ): { mape: number; rmse: number; mae: number } {
    if (values.length < seasonalPeriod * 2) {
      return { mape: 0, rmse: 0, mae: 0 };
    }

    const errors: number[] = [];
    const percentageErrors: number[] = [];

    for (let i = seasonalPeriod; i < values.length; i++) {
      const forecast = values[i - seasonalPeriod];
      const actual = values[i];
      const error = forecast - actual;

      errors.push(error);
      if (actual !== 0) {
        percentageErrors.push(Math.abs(error / actual) * 100);
      }
    }

    const mse = errors.reduce((sum, e) => sum + e * e, 0) / errors.length;

    return {
      mape:
        percentageErrors.length > 0
          ? Math.round(
              (percentageErrors.reduce((sum, e) => sum + e, 0) /
                percentageErrors.length) *
                100,
            ) / 100
          : 0,
      rmse: Math.round(Math.sqrt(mse) * 100) / 100,
      mae:
        Math.round(
          (errors.reduce((sum, e) => sum + Math.abs(e), 0) / errors.length) * 100,
        ) / 100,
    };
  }

  private detectTrend(values: number[]): number {
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
    return yMean !== 0 ? slope / yMean : 0;
  }
}
