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
 * Weighted Moving Average Model
 * 
 * Best for: Data where recent observations are more important
 * Input: Historical values, weights for each period
 * Output: Forecast based on weighted average of last N periods
 * 
 * Formula: Forecast = Σ(wi * Xi) / Σ(wi)
 * where wi are weights (typically increasing for more recent periods)
 */
@Injectable()
export class WeightedAverageModel implements IForecastModel {
  readonly name = 'WEIGHTED_AVERAGE';
  readonly version = '1.0.0';
  readonly displayName = 'Weighted Moving Average';
  readonly description =
    'Calculates forecasts giving more weight to recent periods. Useful when recent data is more relevant than older data.';
  readonly minDataPoints = 3;
  readonly supportsSeasonality = false;
  readonly defaultParameters = {
    windowSize: 6,
    weights: [1, 2, 3, 4, 5, 6], // Linear increasing weights
    weightType: 'linear', // 'linear', 'exponential', 'custom'
    decayFactor: 0.9, // For exponential weights
  };

  fit(data: DataPoint[], parameters?: Record<string, any>): ModelState {
    const params = { ...this.defaultParameters, ...parameters };
    const windowSize = Math.min(params.windowSize, data.length);

    // Generate weights based on type
    const weights = this.generateWeights(
      windowSize,
      params.weightType,
      params.decayFactor,
      params.weights,
    );

    // Get the last windowSize values
    const recentData = data.slice(-windowSize);
    const values = recentData.map((d) => d.value);
    const quantities = recentData.map((d) => d.quantity || 0);

    // Calculate weighted average
    const totalWeight = weights.reduce((sum, w) => sum + w, 0);
    const weightedValue =
      values.reduce((sum, v, i) => sum + v * weights[i], 0) / totalWeight;
    const weightedQuantity =
      quantities.reduce((sum, q, i) => sum + q * weights[i], 0) / totalWeight;

    // Calculate weighted standard deviation
    const weightedVariance =
      values.reduce(
        (sum, v, i) => sum + weights[i] * Math.pow(v - weightedValue, 2),
        0,
      ) / totalWeight;
    const stdDev = Math.sqrt(weightedVariance);

    const trainingMetrics = this.calculateTrainingMetrics(data, windowSize, weights);

    return {
      modelName: this.name,
      parameters: {
        windowSize,
        weights,
        weightedValue,
        weightedQuantity,
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
    const { weightedValue, weightedQuantity, stdDev, lastDate } = state.parameters;
    const confidenceLevel = parameters?.confidenceLevel || 95;
    const predictions: Prediction[] = [];

    for (let i = 1; i <= periods; i++) {
      const forecastDate = new Date(lastDate);
      forecastDate.setMonth(forecastDate.getMonth() + i);

      // Increase uncertainty for further periods
      const periodFactor = 1 + (i - 1) * 0.1;

      const interval = this.getConfidenceInterval(
        { date: forecastDate, value: weightedValue },
        { ...state, parameters: { ...state.parameters, periodFactor } },
        confidenceLevel,
      );

      predictions.push({
        date: forecastDate,
        value: Math.round(weightedValue * 100) / 100,
        quantity: weightedQuantity
          ? Math.round(weightedQuantity * 100) / 100
          : undefined,
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
    const { stdDev, periodFactor = 1 } = state.parameters;

    const zScores: Record<number, number> = {
      80: 1.28,
      90: 1.645,
      95: 1.96,
      99: 2.576,
    };
    const z = zScores[level] || 1.96;
    const margin = z * stdDev * periodFactor;

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

    // Check for extreme outliers
    const values = data.map((d) => d.value);
    const mean = values.reduce((sum, v) => sum + v, 0) / values.length;
    const stdDev = Math.sqrt(
      values.reduce((sum, v) => sum + Math.pow(v - mean, 2), 0) / values.length,
    );

    const outliers = values.filter((v) => Math.abs(v - mean) > 3 * stdDev);
    if (outliers.length > 0) {
      warnings.push(
        `${outliers.length} potential outliers detected. Consider data cleansing.`,
      );
    }

    return { valid: true, warnings };
  }

  getRecommendedParameters(data: DataPoint[]): Record<string, any> {
    const windowSize = Math.min(Math.floor(data.length / 3), 12);
    
    // Detect if recent data has higher variance (suggests exponential weights)
    const recentVariance = this.calculateVariance(data.slice(-6).map((d) => d.value));
    const olderVariance = this.calculateVariance(data.slice(-12, -6).map((d) => d.value));
    
    const weightType = recentVariance > olderVariance * 1.5 ? 'exponential' : 'linear';

    return { windowSize, weightType };
  }

  private generateWeights(
    size: number,
    type: string,
    decayFactor: number,
    customWeights?: number[],
  ): number[] {
    if (type === 'custom' && customWeights?.length === size) {
      return customWeights;
    }

    const weights: number[] = [];
    
    if (type === 'exponential') {
      for (let i = 0; i < size; i++) {
        weights.push(Math.pow(decayFactor, size - 1 - i));
      }
    } else {
      // Linear weights (default)
      for (let i = 1; i <= size; i++) {
        weights.push(i);
      }
    }

    return weights;
  }

  private calculateVariance(values: number[]): number {
    if (values.length === 0) return 0;
    const mean = values.reduce((sum, v) => sum + v, 0) / values.length;
    return values.reduce((sum, v) => sum + Math.pow(v - mean, 2), 0) / values.length;
  }

  private calculateTrainingMetrics(
    data: DataPoint[],
    windowSize: number,
    weights: number[],
  ): { mape: number; rmse: number; mae: number } {
    if (data.length <= windowSize) {
      return { mape: 0, rmse: 0, mae: 0 };
    }

    const totalWeight = weights.reduce((sum, w) => sum + w, 0);
    const errors: number[] = [];
    const percentageErrors: number[] = [];

    for (let i = windowSize; i < data.length; i++) {
      const window = data.slice(i - windowSize, i);
      const forecast =
        window.reduce((sum, d, idx) => sum + d.value * weights[idx], 0) /
        totalWeight;
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
}
