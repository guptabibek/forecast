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
 * AI Hybrid Model
 * 
 * Best for: Complex patterns requiring ensemble approaches
 * Strategy: Combines multiple statistical models using weighted averaging
 * Features: Model selection, error-based weighting, adaptive blending
 * 
 * Components:
 * - Moving Average (stability)
 * - Linear Regression (trend)
 * - Seasonal Naive (seasonality)
 * - Holt-Winters (trend + seasonality)
 * 
 * Weighting: Inverse of recent forecast error (MAPE)
 */
@Injectable()
export class AIHybridModel implements IForecastModel {
  readonly name = 'AI_HYBRID';
  readonly version = '1.0.0';
  readonly displayName = 'AI Hybrid Ensemble';
  readonly description =
    'Combines multiple forecasting models using intelligent weighting based on historical accuracy. Adapts to data patterns automatically.';
  readonly minDataPoints = 24;
  readonly supportsSeasonality = true;
  readonly defaultParameters = {
    seasonalPeriod: 12,
    validationSplit: 0.2, // Use 20% for validation
    minModelWeight: 0.1, // Minimum weight for any model
    smoothingFactor: 0.3, // For exponential smoothing of weights
  };

  private componentModels = [
    'MOVING_AVERAGE',
    'LINEAR_REGRESSION',
    'SEASONAL_NAIVE',
    'HOLT_WINTERS',
  ];

  fit(data: DataPoint[], parameters?: Record<string, any>): ModelState {
    const params = { ...this.defaultParameters, ...parameters };
    const values = data.map((d) => d.value);
    const dates = data.map((d) => d.date);
    const n = values.length;

    // Split data for validation
    const splitIdx = Math.floor(n * (1 - params.validationSplit));
    const trainData = data.slice(0, splitIdx);
    const valData = data.slice(splitIdx);
    const trainValues = values.slice(0, splitIdx);
    const valValues = values.slice(splitIdx);

    // Fit each component model and calculate validation MAPE
    const modelStates: Record<string, any> = {};
    const modelWeights: Record<string, number> = {};
    const modelMAPE: Record<string, number> = {};

    // 1. Moving Average
    const maState = this.fitMovingAverage(trainValues);
    const maPredictions = this.predictMovingAverage(maState, valValues.length, trainValues);
    modelMAPE['MOVING_AVERAGE'] = this.calculateMAPE(valValues, maPredictions);
    modelStates['MOVING_AVERAGE'] = maState;

    // 2. Linear Regression
    const lrState = this.fitLinearRegression(trainValues);
    const lrPredictions = this.predictLinearRegression(lrState, valValues.length, trainValues.length);
    modelMAPE['LINEAR_REGRESSION'] = this.calculateMAPE(valValues, lrPredictions);
    modelStates['LINEAR_REGRESSION'] = lrState;

    // 3. Seasonal Naive
    const snState = this.fitSeasonalNaive(trainValues, params.seasonalPeriod);
    const snPredictions = this.predictSeasonalNaive(snState, valValues.length);
    modelMAPE['SEASONAL_NAIVE'] = this.calculateMAPE(valValues, snPredictions);
    modelStates['SEASONAL_NAIVE'] = snState;

    // 4. Holt-Winters
    const hwState = this.fitHoltWinters(trainValues, params.seasonalPeriod);
    const hwPredictions = this.predictHoltWinters(hwState, valValues.length);
    modelMAPE['HOLT_WINTERS'] = this.calculateMAPE(valValues, hwPredictions);
    modelStates['HOLT_WINTERS'] = hwState;

    // Calculate weights based on inverse MAPE
    const totalInverseMAPE = Object.values(modelMAPE).reduce(
      (sum, mape) => sum + 1 / Math.max(mape, 0.01),
      0,
    );

    for (const model of this.componentModels) {
      const rawWeight = (1 / Math.max(modelMAPE[model], 0.01)) / totalInverseMAPE;
      modelWeights[model] = Math.max(rawWeight, params.minModelWeight);
    }

    const userWeights = (params as Record<string, unknown>).userWeights as Record<string, number> | undefined;
    if (userWeights && Object.keys(userWeights).length > 0) {
      for (const model of this.componentModels) {
        if (userWeights[model] !== undefined) {
          modelWeights[model] = userWeights[model];
        }
      }
    }

    const totalWeight = Object.values(modelWeights).reduce((sum, w) => sum + w, 0);
    for (const model of this.componentModels) {
      modelWeights[model] = modelWeights[model] / totalWeight;
    }

    // Calculate ensemble residual standard deviation
    const ensemblePredictions = this.combineForecasts(
      {
        'MOVING_AVERAGE': maPredictions,
        'LINEAR_REGRESSION': lrPredictions,
        'SEASONAL_NAIVE': snPredictions,
        'HOLT_WINTERS': hwPredictions,
      },
      modelWeights,
      valValues.length,
    );
    const residuals = valValues.map((v, i) => v - ensemblePredictions[i]);
    const residualStdDev = Math.sqrt(
      residuals.reduce((sum, r) => sum + r * r, 0) / residuals.length,
    );

    // Refit on full data
    const fullMAState = this.fitMovingAverage(values);
    const fullLRState = this.fitLinearRegression(values);
    const fullSNState = this.fitSeasonalNaive(values, params.seasonalPeriod);
    const fullHWState = this.fitHoltWinters(values, params.seasonalPeriod);

    return {
      modelName: this.name,
      parameters: {
        ...params,
        modelWeights,
        modelMAPE,
        residualStdDev,
        lastValues: values.slice(-params.seasonalPeriod * 2),
        lastDate: dates[n - 1],
        componentStates: {
          MOVING_AVERAGE: fullMAState,
          LINEAR_REGRESSION: fullLRState,
          SEASONAL_NAIVE: fullSNState,
          HOLT_WINTERS: fullHWState,
        },
        n,
      },
      fittedAt: new Date(),
      trainingMetrics: {
        mape: this.calculateMAPE(valValues, ensemblePredictions),
        rmse: Math.sqrt(residuals.reduce((sum, r) => sum + r * r, 0) / residuals.length),
        mae: residuals.reduce((sum, r) => sum + Math.abs(r), 0) / residuals.length,
      },
    };
  }

  predict(
    state: ModelState,
    periods: number,
    parameters?: ForecastParameters,
  ): Prediction[] {
    const {
      modelWeights,
      residualStdDev,
      lastDate,
      componentStates,
      lastValues,
      n,
    } = state.parameters;

    const confidenceLevel = parameters?.confidenceLevel || 95;
    const predictions: Prediction[] = [];

    // Generate forecasts from each component model
    const maPredictions = this.predictMovingAverage(componentStates.MOVING_AVERAGE, periods, lastValues);
    const lrPredictions = this.predictLinearRegression(componentStates.LINEAR_REGRESSION, periods, n);
    const snPredictions = this.predictSeasonalNaive(componentStates.SEASONAL_NAIVE, periods);
    const hwPredictions = this.predictHoltWinters(componentStates.HOLT_WINTERS, periods);

    // Combine forecasts
    const combinedForecasts = this.combineForecasts(
      {
        'MOVING_AVERAGE': maPredictions,
        'LINEAR_REGRESSION': lrPredictions,
        'SEASONAL_NAIVE': snPredictions,
        'HOLT_WINTERS': hwPredictions,
      },
      modelWeights,
      periods,
    );

    for (let k = 0; k < periods; k++) {
      const forecastValue = combinedForecasts[k];
      const forecastDate = new Date(lastDate);
      forecastDate.setMonth(forecastDate.getMonth() + k + 1);

      const interval = this.getConfidenceInterval(
        { date: forecastDate, value: forecastValue },
        { ...state, parameters: { ...state.parameters, horizon: k + 1 } },
        confidenceLevel,
      );

      predictions.push({
        date: forecastDate,
        value: Math.max(0, Math.round(forecastValue * 100) / 100),
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

    // Ensemble typically has lower variance, but still grows with horizon
    const margin = z * residualStdDev * Math.sqrt(horizon) * 0.8;

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
        warnings: [
          `AI Hybrid requires at least ${this.minDataPoints} data points for reliable ensemble weighting`,
        ],
      };
    }

    const values = data.map((d) => d.value);

    // Check for zero values
    const zeroCount = values.filter((v) => v === 0).length;
    if (zeroCount > values.length * 0.3) {
      warnings.push('Many zero values detected. May affect model accuracy.');
    }

    // Check for seasonality
    const hasSeasonality = this.detectSeasonality(values, 12);
    if (!hasSeasonality) {
      warnings.push(
        'No strong seasonality detected. Seasonal components will have lower weights.',
      );
    }

    return { valid: true, warnings };
  }

  getRecommendedParameters(data: DataPoint[]): Record<string, any> {
    const values = data.map((d) => d.value);
    const seasonalPeriod = this.detectOptimalSeasonality(values);

    return {
      seasonalPeriod,
      validationSplit: values.length > 48 ? 0.2 : 0.15,
      minModelWeight: 0.1,
    };
  }

  // ============ Component Model Implementations ============

  private fitMovingAverage(values: number[]): any {
    const window = Math.min(6, Math.floor(values.length / 4));
    const recentValues = values.slice(-window);
    return {
      window,
      lastMean: recentValues.reduce((sum, v) => sum + v, 0) / recentValues.length,
      recentValues,
    };
  }

  private predictMovingAverage(state: any, periods: number, values: number[]): number[] {
    const predictions: number[] = [];
    const workingValues = [...state.recentValues];

    for (let k = 0; k < periods; k++) {
      const forecast =
        workingValues.slice(-state.window).reduce((sum, v) => sum + v, 0) /
        state.window;
      predictions.push(forecast);
      workingValues.push(forecast);
    }

    return predictions;
  }

  private fitLinearRegression(values: number[]): any {
    const n = values.length;
    const x = Array.from({ length: n }, (_, i) => i);
    const meanX = (n - 1) / 2;
    const meanY = values.reduce((sum, v) => sum + v, 0) / n;

    let numerator = 0;
    let denominator = 0;
    for (let i = 0; i < n; i++) {
      numerator += (x[i] - meanX) * (values[i] - meanY);
      denominator += Math.pow(x[i] - meanX, 2);
    }

    const slope = denominator !== 0 ? numerator / denominator : 0;
    const intercept = meanY - slope * meanX;

    return { slope, intercept, n };
  }

  private predictLinearRegression(state: any, periods: number, startIdx: number): number[] {
    const predictions: number[] = [];
    for (let k = 0; k < periods; k++) {
      predictions.push(state.intercept + state.slope * (startIdx + k));
    }
    return predictions;
  }

  private fitSeasonalNaive(values: number[], seasonalPeriod: number): any {
    return {
      seasonalValues: values.slice(-seasonalPeriod),
      seasonalPeriod,
    };
  }

  private predictSeasonalNaive(state: any, periods: number): number[] {
    const predictions: number[] = [];
    for (let k = 0; k < periods; k++) {
      const idx = k % state.seasonalPeriod;
      predictions.push(state.seasonalValues[idx]);
    }
    return predictions;
  }

  private fitHoltWinters(values: number[], seasonalPeriod: number): any {
    const alpha = 0.3;
    const beta = 0.1;
    const gamma = 0.3;
    const EPSILON = 1e-10;

    let level = values.slice(0, seasonalPeriod).reduce((sum, v) => sum + v, 0) / seasonalPeriod;
    let trend = 0;
    if (values.length >= 2 * seasonalPeriod) {
      const firstPeriod = values.slice(0, seasonalPeriod).reduce((sum, v) => sum + v, 0) / seasonalPeriod;
      const secondPeriod = values.slice(seasonalPeriod, 2 * seasonalPeriod).reduce((sum, v) => sum + v, 0) / seasonalPeriod;
      trend = (secondPeriod - firstPeriod) / seasonalPeriod;
    }

    if (Math.abs(level) < EPSILON) {
      level = EPSILON;
    }

    const seasonals: number[] = [];
    for (let i = 0; i < seasonalPeriod; i++) {
      const s = Math.abs(level) > EPSILON ? values[i] / level : 1;
      seasonals.push(isFinite(s) ? s : 1);
    }

    for (let t = seasonalPeriod; t < values.length; t++) {
      const seasonIdx = t % seasonalPeriod;
      const seasonal = Math.abs(seasonals[seasonIdx]) > EPSILON ? seasonals[seasonIdx] : EPSILON;
      const y = values[t];

      const prevLevel = level;
      const newLevel = alpha * (y / seasonal) + (1 - alpha) * (level + trend);
      level = isFinite(newLevel) ? newLevel : prevLevel;
      const newTrend = beta * (level - prevLevel) + (1 - beta) * trend;
      trend = isFinite(newTrend) ? newTrend : trend;
      const newSeasonal = Math.abs(level) > EPSILON
        ? gamma * (y / level) + (1 - gamma) * seasonal
        : seasonal;
      seasonals[seasonIdx] = isFinite(newSeasonal) ? newSeasonal : seasonal;
    }

    return { level, trend, seasonals, seasonalPeriod };
  }

  private predictHoltWinters(state: any, periods: number): number[] {
    const predictions: number[] = [];
    for (let k = 1; k <= periods; k++) {
      const seasonIdx = (k - 1) % state.seasonalPeriod;
      const forecast = (state.level + k * state.trend) * state.seasonals[seasonIdx];
      predictions.push(Math.max(0, forecast));
    }
    return predictions;
  }

  // ============ Utility Methods ============

  private combineForecasts(
    forecasts: Record<string, number[]>,
    weights: Record<string, number>,
    periods: number,
  ): number[] {
    const combined: number[] = [];
    for (let k = 0; k < periods; k++) {
      let value = 0;
      for (const model of Object.keys(forecasts)) {
        value += forecasts[model][k] * weights[model];
      }
      combined.push(value);
    }
    return combined;
  }

  private calculateMAPE(actual: number[], forecast: number[]): number {
    let sum = 0;
    let count = 0;
    for (let i = 0; i < actual.length; i++) {
      if (actual[i] !== 0) {
        sum += Math.abs((actual[i] - forecast[i]) / actual[i]);
        count++;
      }
    }
    return count > 0 ? (sum / count) * 100 : 0;
  }

  private detectSeasonality(values: number[], period: number): boolean {
    if (values.length < period * 2) return false;

    // Simple autocorrelation at seasonal lag
    const n = values.length;
    const mean = values.reduce((sum, v) => sum + v, 0) / n;

    let numerator = 0;
    let denominator = 0;
    for (let i = 0; i < n - period; i++) {
      numerator += (values[i] - mean) * (values[i + period] - mean);
    }
    for (let i = 0; i < n; i++) {
      denominator += Math.pow(values[i] - mean, 2);
    }

    const autocorr = denominator !== 0 ? numerator / denominator : 0;
    return autocorr > 0.3;
  }

  private detectOptimalSeasonality(values: number[]): number {
    const candidates = [4, 6, 12];
    let bestPeriod = 12;
    let bestCorr = -1;

    for (const period of candidates) {
      if (values.length >= period * 2) {
        const n = values.length;
        const mean = values.reduce((sum, v) => sum + v, 0) / n;

        let numerator = 0;
        let denominator = 0;
        for (let i = 0; i < n - period; i++) {
          numerator += (values[i] - mean) * (values[i + period] - mean);
        }
        for (let i = 0; i < n; i++) {
          denominator += Math.pow(values[i] - mean, 2);
        }

        const autocorr = denominator !== 0 ? numerator / denominator : 0;
        if (autocorr > bestCorr) {
          bestCorr = autocorr;
          bestPeriod = period;
        }
      }
    }

    return bestPeriod;
  }
}
