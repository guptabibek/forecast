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
 * Year-over-Year Growth Model
 * 
 * Best for: Business planning with expected growth rates
 * Input: Historical values, growth rate assumption
 * Output: Last year's value adjusted by growth rate
 * 
 * Formula: Forecast[t] = Actual[t-12] * (1 + growth_rate)
 */
@Injectable()
export class YoYGrowthModel implements IForecastModel {
  readonly name = 'YOY_GROWTH';
  readonly version = '1.0.0';
  readonly displayName = 'Year-over-Year Growth';
  readonly description =
    'Applies a growth rate to the same period from last year. Common in budgeting when a specific growth target is set.';
  readonly minDataPoints = 12;
  readonly supportsSeasonality = true;
  readonly defaultParameters = {
    growthRate: 0.05, // 5% default growth
    seasonalPeriod: 12,
    applySeasonalAdjustment: true,
  };

  fit(data: DataPoint[], parameters?: Record<string, any>): ModelState {
    const params = { ...this.defaultParameters, ...parameters };
    const { seasonalPeriod, growthRate } = params;

    const values = data.map((d) => d.value);
    const quantities = data.map((d) => d.quantity || 0);

    // Calculate historical YoY growth if not specified
    let calculatedGrowth = growthRate;
    if (!parameters?.growthRate && values.length >= seasonalPeriod * 2) {
      const thisYear = values.slice(-seasonalPeriod);
      const lastYear = values.slice(-seasonalPeriod * 2, -seasonalPeriod);
      const thisYearTotal = thisYear.reduce((sum, v) => sum + v, 0);
      const lastYearTotal = lastYear.reduce((sum, v) => sum + v, 0);
      calculatedGrowth =
        lastYearTotal !== 0 ? (thisYearTotal - lastYearTotal) / lastYearTotal : 0;
    }

    // Get last year's values for baseline
    const lastYearValues = values.slice(-seasonalPeriod);
    const lastYearQuantities = quantities.slice(-seasonalPeriod);

    // Calculate seasonal indices
    const seasonalIndices = this.calculateSeasonalIndices(values, seasonalPeriod);

    // Calculate residual standard deviation
    const residuals: number[] = [];
    for (let i = seasonalPeriod; i < values.length; i++) {
      const expected = values[i - seasonalPeriod] * (1 + calculatedGrowth);
      residuals.push(values[i] - expected);
    }
    const residualStdDev =
      residuals.length > 0
        ? Math.sqrt(residuals.reduce((sum, r) => sum + r * r, 0) / residuals.length)
        : 0;

    return {
      modelName: this.name,
      parameters: {
        ...params,
        growthRate: calculatedGrowth,
        lastYearValues,
        lastYearQuantities,
        seasonalIndices,
        residualStdDev,
        lastDate: data[data.length - 1].date,
      },
      fittedAt: new Date(),
      trainingMetrics: this.calculateTrainingMetrics(
        values,
        seasonalPeriod,
        calculatedGrowth,
      ),
    };
  }

  predict(
    state: ModelState,
    periods: number,
    parameters?: ForecastParameters,
  ): Prediction[] {
    const {
      growthRate,
      seasonalPeriod,
      lastYearValues,
      lastYearQuantities,
      seasonalIndices,
      applySeasonalAdjustment,
      residualStdDev,
      lastDate,
    } = state.parameters;

    // Allow override of growth rate in parameters
    const effectiveGrowthRate = parameters?.growthRate ?? growthRate;
    const confidenceLevel = parameters?.confidenceLevel || 95;
    const predictions: Prediction[] = [];

    for (let k = 1; k <= periods; k++) {
      const seasonalIndex = (k - 1) % seasonalPeriod;
      const baseValue = lastYearValues[seasonalIndex];
      const baseQuantity = lastYearQuantities[seasonalIndex];

      let forecastValue = baseValue * (1 + effectiveGrowthRate);
      let forecastQuantity = baseQuantity * (1 + effectiveGrowthRate);

      // Apply seasonal adjustment if enabled
      if (applySeasonalAdjustment && seasonalIndices) {
        forecastValue *= seasonalIndices[seasonalIndex];
        forecastQuantity *= seasonalIndices[seasonalIndex];
      }

      const forecastDate = new Date(lastDate);
      forecastDate.setMonth(forecastDate.getMonth() + k);

      const interval = this.getConfidenceInterval(
        { date: forecastDate, value: forecastValue },
        state,
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
    const { residualStdDev, growthRate } = state.parameters;

    const zScores: Record<number, number> = {
      80: 1.28,
      90: 1.645,
      95: 1.96,
      99: 2.576,
    };
    const z = zScores[level] || 1.96;

    // Add uncertainty for growth rate assumption
    const growthUncertainty = Math.abs(growthRate) * 0.5;
    const margin = z * (residualStdDev + prediction.value * growthUncertainty);

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
        warnings: [`Requires at least ${this.minDataPoints} data points (1 year)`],
      };
    }

    const values = data.map((d) => d.value);

    // Check for volatile historical growth
    if (values.length >= 24) {
      const year1 = values.slice(-24, -12).reduce((sum, v) => sum + v, 0);
      const year2 = values.slice(-12).reduce((sum, v) => sum + v, 0);
      const actualGrowth = year1 !== 0 ? (year2 - year1) / year1 : 0;

      if (Math.abs(actualGrowth) > 0.5) {
        warnings.push(
          `Historical growth is ${(actualGrowth * 100).toFixed(1)}%. Verify growth rate assumption.`,
        );
      }
    }

    return { valid: true, warnings };
  }

  getRecommendedParameters(data: DataPoint[]): Record<string, any> {
    const values = data.map((d) => d.value);

    // Calculate historical growth
    let growthRate = 0.05;
    if (values.length >= 24) {
      const year1 = values.slice(-24, -12).reduce((sum, v) => sum + v, 0);
      const year2 = values.slice(-12).reduce((sum, v) => sum + v, 0);
      growthRate = year1 !== 0 ? (year2 - year1) / year1 : 0;
      // Cap at reasonable values
      growthRate = Math.max(-0.5, Math.min(0.5, growthRate));
    }

    return { growthRate };
  }

  private calculateSeasonalIndices(
    values: number[],
    period: number,
  ): number[] {
    if (values.length < period) {
      return Array(period).fill(1);
    }

    const seasonalSums = Array(period).fill(0);
    const seasonalCounts = Array(period).fill(0);

    for (let i = 0; i < values.length; i++) {
      const seasonIndex = i % period;
      seasonalSums[seasonIndex] += values[i];
      seasonalCounts[seasonIndex]++;
    }

    const seasonalAverages = seasonalSums.map((sum, i) =>
      seasonalCounts[i] > 0 ? sum / seasonalCounts[i] : 0,
    );

    const overallAverage =
      seasonalAverages.reduce((sum, v) => sum + v, 0) / period;

    return seasonalAverages.map((avg) =>
      overallAverage !== 0 ? avg / overallAverage : 1,
    );
  }

  private calculateTrainingMetrics(
    values: number[],
    seasonalPeriod: number,
    growthRate: number,
  ): { mape: number; rmse: number; mae: number } {
    if (values.length < seasonalPeriod * 2) {
      return { mape: 0, rmse: 0, mae: 0 };
    }

    const errors: number[] = [];
    const percentageErrors: number[] = [];

    for (let i = seasonalPeriod; i < values.length; i++) {
      const forecast = values[i - seasonalPeriod] * (1 + growthRate);
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
