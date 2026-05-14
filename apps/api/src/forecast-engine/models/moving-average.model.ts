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
 * Simple Moving Average Model
 * 
 * Best for: Stable data without trend or seasonality
 * Input: Historical values, window size
 * Output: Forecast based on average of last N periods
 * 
 * Formula: Forecast = (X[t-1] + X[t-2] + ... + X[t-n]) / n
 */
@Injectable()
export class MovingAverageModel implements IForecastModel {
  readonly name = 'MOVING_AVERAGE';
  readonly version = '1.0.0';
  readonly displayName = 'Simple Moving Average';
  readonly description =
    'Calculates forecasts based on the average of the last N periods. Best for stable data without strong trends or seasonality.';
  readonly minDataPoints = 3;
  readonly supportsSeasonality = false;
  readonly defaultParameters = {
    windowSize: 3,
    includeQuantity: true,
  };

  fit(data: DataPoint[], parameters?: Record<string, any>): ModelState {
    const params = { ...this.defaultParameters, ...parameters };
    const windowSize = Math.min(params.windowSize, data.length);

    // Get the last windowSize values
    const recentData = data.slice(-windowSize);
    const values = recentData.map((d) => d.value);
    const quantities = recentData.map((d) => d.quantity || 0);

    // Calculate moving average
    const avgValue = values.reduce((sum, v) => sum + v, 0) / windowSize;
    const avgQuantity = quantities.reduce((sum, q) => sum + q, 0) / windowSize;

    // Calculate standard deviation for confidence intervals
    const variance =
      values.reduce((sum, v) => sum + Math.pow(v - avgValue, 2), 0) / windowSize;
    const stdDev = Math.sqrt(variance);

    // Calculate training metrics
    const trainingMetrics = this.calculateTrainingMetrics(data, windowSize);

    return {
      modelName: this.name,
      parameters: {
        windowSize,
        avgValue,
        avgQuantity,
        stdDev,
        lastDate: data[data.length - 1].date,
      },
      fittedAt: new Date(),
      trainingMetrics,
    };
  }

  predict(
    state: ModelState,
    periods: number,
    parameters?: ForecastParameters,
  ): Prediction[] {
    const { avgValue, avgQuantity, stdDev, lastDate } = state.parameters;
    const confidenceLevel = parameters?.confidenceLevel || 95;
    const predictions: Prediction[] = [];

    for (let i = 1; i <= periods; i++) {
      const forecastDate = new Date(lastDate);
      forecastDate.setMonth(forecastDate.getMonth() + i);

      const interval = this.getConfidenceInterval(
        { date: forecastDate, value: avgValue },
        state,
        confidenceLevel,
      );

      predictions.push({
        date: forecastDate,
        value: Math.round(avgValue * 100) / 100,
        quantity: avgQuantity ? Math.round(avgQuantity * 100) / 100 : undefined,
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
    const { stdDev, windowSize } = state.parameters;

    // Z-score for confidence level
    const zScores: Record<number, number> = {
      80: 1.28,
      90: 1.645,
      95: 1.96,
      99: 2.576,
    };
    const z = zScores[level] || 1.96;

    // Standard error of the mean
    const se = stdDev / Math.sqrt(windowSize);
    const margin = z * se;

    return {
      lower: Math.round((prediction.value - margin) * 100) / 100,
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

    // Check for missing values
    const missingCount = data.filter(
      (d) => d.value === null || d.value === undefined,
    ).length;
    if (missingCount > 0) {
      warnings.push(`${missingCount} missing values detected`);
    }

    // Check for trend
    const values = data.map((d) => d.value);
    const trend = this.detectTrend(values);
    if (Math.abs(trend) > 0.1) {
      warnings.push(
        'Data shows significant trend. Consider using Linear Regression or Holt-Winters instead.',
      );
    }

    return { valid: true, warnings };
  }

  getRecommendedParameters(data: DataPoint[]): Record<string, any> {
    // Recommend window size based on data length
    let windowSize = 3;
    if (data.length >= 12) windowSize = 6;
    if (data.length >= 24) windowSize = 12;

    return { windowSize };
  }

  private calculateTrainingMetrics(
    data: DataPoint[],
    windowSize: number,
  ): { mape: number; rmse: number; mae: number } {
    if (data.length <= windowSize) {
      return { mape: 0, rmse: 0, mae: 0 };
    }

    const errors: number[] = [];
    const percentageErrors: number[] = [];

    for (let i = windowSize; i < data.length; i++) {
      const window = data.slice(i - windowSize, i);
      const forecast =
        window.reduce((sum, d) => sum + d.value, 0) / windowSize;
      const actual = data[i].value;
      const error = forecast - actual;

      errors.push(error);
      if (actual !== 0) {
        percentageErrors.push(Math.abs(error / actual) * 100);
      }
    }

    const mse = errors.reduce((sum, e) => sum + e * e, 0) / errors.length;
    const mae = errors.reduce((sum, e) => sum + Math.abs(e), 0) / errors.length;
    const mape =
      percentageErrors.length > 0
        ? percentageErrors.reduce((sum, e) => sum + e, 0) / percentageErrors.length
        : 0;

    return {
      mape: Math.round(mape * 100) / 100,
      rmse: Math.round(Math.sqrt(mse) * 100) / 100,
      mae: Math.round(mae * 100) / 100,
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
