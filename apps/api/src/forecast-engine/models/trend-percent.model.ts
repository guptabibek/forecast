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
 * Trend Percentage Model
 * 
 * Best for: Applying fixed monthly/quarterly growth rates
 * Input: Historical values, monthly trend percentage
 * Output: Compound growth projections
 * 
 * Formula: Forecast[t+k] = LastValue * (1 + trend%)^k
 */
@Injectable()
export class TrendPercentModel implements IForecastModel {
  readonly name = 'TREND_PERCENT';
  readonly displayName = 'Trend Percentage';
  readonly description =
    'Applies a fixed percentage trend (growth or decline) to project future values. Useful for simple growth assumptions.';
  readonly version = '1.0.0';
  readonly minDataPoints = 3;
  readonly supportsSeasonality = false;
  readonly defaultParameters = {
    trendPercent: 0.02, // 2% monthly growth
    trendType: 'compound', // 'compound' or 'linear'
    baseValue: null, // If null, use last actual
  };

  fit(data: DataPoint[], parameters?: Record<string, any>): ModelState {
    const params = { ...this.defaultParameters, ...parameters };
    const values = data.map((d) => d.value);
    const quantities = data.map((d) => d.quantity || 0);

    // Calculate trend from historical data if not specified
    let trendPercent = params.trendPercent;
    if (!parameters?.trendPercent && values.length >= 6) {
      const recentValues = values.slice(-6);
      const growths: number[] = [];
      for (let i = 1; i < recentValues.length; i++) {
        if (recentValues[i - 1] !== 0) {
          growths.push((recentValues[i] - recentValues[i - 1]) / recentValues[i - 1]);
        }
      }
      if (growths.length > 0) {
        trendPercent = growths.reduce((sum, g) => sum + g, 0) / growths.length;
      }
    }

    const baseValue = params.baseValue ?? values[values.length - 1];
    const baseQuantity = quantities[quantities.length - 1];

    // Calculate residual standard deviation
    const residuals: number[] = [];
    for (let i = 1; i < values.length; i++) {
      const expected = values[i - 1] * (1 + trendPercent);
      residuals.push(values[i] - expected);
    }
    const residualStdDev =
      residuals.length > 0
        ? Math.sqrt(residuals.reduce((sum, r) => sum + r * r, 0) / residuals.length)
        : baseValue * 0.1;

    return {
      modelName: this.name,
      parameters: {
        trendPercent,
        trendType: params.trendType,
        baseValue,
        baseQuantity,
        residualStdDev,
        lastDate: data[data.length - 1].date,
      },
      fittedAt: new Date(),
      trainingMetrics: this.calculateTrainingMetrics(values, trendPercent),
    };
  }

  predict(
    state: ModelState,
    periods: number,
    parameters?: ForecastParameters,
  ): Prediction[] {
    const {
      trendPercent,
      trendType,
      baseValue,
      baseQuantity,
      residualStdDev,
      lastDate,
    } = state.parameters;

    // Allow override in parameters
    const effectiveTrend = parameters?.trendPercent ?? trendPercent;
    const confidenceLevel = parameters?.confidenceLevel || 95;
    const predictions: Prediction[] = [];

    for (let k = 1; k <= periods; k++) {
      let forecastValue: number;
      let forecastQuantity: number;

      if (trendType === 'compound') {
        forecastValue = baseValue * Math.pow(1 + effectiveTrend, k);
        forecastQuantity = baseQuantity * Math.pow(1 + effectiveTrend, k);
      } else {
        // Linear trend
        forecastValue = baseValue * (1 + effectiveTrend * k);
        forecastQuantity = baseQuantity * (1 + effectiveTrend * k);
      }

      const forecastDate = new Date(lastDate);
      forecastDate.setMonth(forecastDate.getMonth() + k);

      const interval = this.getConfidenceInterval(
        { date: forecastDate, value: forecastValue },
        { ...state, parameters: { ...state.parameters, horizon: k } },
        confidenceLevel,
      );

      predictions.push({
        date: forecastDate,
        value: Math.max(0, Math.round(forecastValue * 100) / 100),
        quantity:
          forecastQuantity > 0
            ? Math.max(0, Math.round(forecastQuantity * 100) / 100)
            : undefined,
        confidenceLower: Math.max(0, interval.lower),
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
    const { residualStdDev, horizon } = state.parameters;

    const zScores: Record<number, number> = {
      80: 1.28,
      90: 1.645,
      95: 1.96,
      99: 2.576,
    };
    const z = zScores[level] || 1.96;

    // Uncertainty increases with forecast horizon
    const margin = z * residualStdDev * Math.sqrt(horizon);

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

    const values = data.map((d) => d.value);

    // Check for volatility
    const mean = values.reduce((sum, v) => sum + v, 0) / values.length;
    const stdDev = Math.sqrt(
      values.reduce((sum, v) => sum + Math.pow(v - mean, 2), 0) / values.length,
    );
    const cv = mean !== 0 ? stdDev / mean : 0;

    if (cv > 0.3) {
      warnings.push(
        'High data volatility detected. Fixed trend may not capture variability.',
      );
    }

    return { valid: true, warnings };
  }

  getRecommendedParameters(data: DataPoint[]): Record<string, any> {
    const values = data.map((d) => d.value);

    // Calculate average monthly growth
    const growths: number[] = [];
    for (let i = 1; i < values.length; i++) {
      if (values[i - 1] !== 0) {
        growths.push((values[i] - values[i - 1]) / values[i - 1]);
      }
    }

    const avgGrowth =
      growths.length > 0
        ? growths.reduce((sum, g) => sum + g, 0) / growths.length
        : 0.02;

    return {
      trendPercent: Math.round(avgGrowth * 10000) / 10000,
      trendType: 'compound',
    };
  }

  private calculateTrainingMetrics(
    values: number[],
    trendPercent: number,
  ): { mape: number; rmse: number; mae: number } {
    if (values.length < 2) {
      return { mape: 0, rmse: 0, mae: 0 };
    }

    const errors: number[] = [];
    const percentageErrors: number[] = [];

    for (let i = 1; i < values.length; i++) {
      const forecast = values[i - 1] * (1 + trendPercent);
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
}
