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
 * Holt-Winters Triple Exponential Smoothing Model
 * 
 * Best for: Data with both trend and seasonality
 * Input: Historical values, seasonality period, smoothing parameters
 * Output: Forecasts accounting for level, trend, and seasonal components
 * 
 * Formulas:
 * Level:    Lt = α(Yt/St-m) + (1-α)(Lt-1 + Tt-1)
 * Trend:    Tt = β(Lt - Lt-1) + (1-β)Tt-1
 * Season:   St = γ(Yt/Lt) + (1-γ)St-m
 * Forecast: Ft+k = (Lt + k*Tt) * St-m+k
 */
@Injectable()
export class HoltWintersModel implements IForecastModel {
  readonly name = 'HOLT_WINTERS';
  readonly version = '1.0.0';
  readonly displayName = 'Holt-Winters (Triple Exponential Smoothing)';
  readonly description =
    'Advanced model that captures level, trend, and seasonal patterns. Best for data with clear seasonal cycles (e.g., monthly sales with yearly seasonality).';
  readonly minDataPoints = 24; // At least 2 full seasonal cycles
  readonly supportsSeasonality = true;
  readonly defaultParameters = {
    seasonalPeriod: 12, // Monthly data with yearly seasonality
    alpha: 0.3, // Level smoothing
    beta: 0.1, // Trend smoothing
    gamma: 0.1, // Seasonal smoothing
    damped: false, // Damped trend
    phi: 0.98, // Damping factor
    multiplicative: true, // Multiplicative vs additive seasonality
  };

  fit(data: DataPoint[], parameters?: Record<string, any>): ModelState {
    const params = { ...this.defaultParameters, ...parameters };
    const { seasonalPeriod, alpha, beta, gamma, damped, phi, multiplicative } =
      params;

    const values = data.map((d) => d.value);
    const n = values.length;

    // Initialize components
    const { level, trend, seasonal } = this.initializeComponents(
      values,
      seasonalPeriod,
      multiplicative,
    );

    // Apply Holt-Winters algorithm
    const levels: number[] = [level];
    const trends: number[] = [trend];
    const seasonals: number[] = [...seasonal];

    for (let t = seasonalPeriod; t < n; t++) {
      const prevLevel = levels[levels.length - 1];
      const prevTrend = trends[trends.length - 1];
      const prevSeasonal = seasonals[t - seasonalPeriod];

      let newLevel: number;
      let newTrend: number;
      let newSeasonal: number;

      if (multiplicative) {
        // Multiplicative seasonality
        newLevel =
          alpha * (values[t] / prevSeasonal) +
          (1 - alpha) * (prevLevel + prevTrend);
        newTrend = beta * (newLevel - prevLevel) + (1 - beta) * prevTrend;
        newSeasonal = gamma * (values[t] / newLevel) + (1 - gamma) * prevSeasonal;
      } else {
        // Additive seasonality
        newLevel =
          alpha * (values[t] - prevSeasonal) +
          (1 - alpha) * (prevLevel + prevTrend);
        newTrend = beta * (newLevel - prevLevel) + (1 - beta) * prevTrend;
        newSeasonal = gamma * (values[t] - newLevel) + (1 - gamma) * prevSeasonal;
      }

      if (damped) {
        newTrend *= phi;
      }

      levels.push(newLevel);
      trends.push(newTrend);
      seasonals.push(newSeasonal);
    }

    // Calculate fitted values and residuals for metrics
    const fitted = this.calculateFittedValues(
      levels,
      trends,
      seasonals,
      seasonalPeriod,
      multiplicative,
    );
    const residuals = values.slice(seasonalPeriod).map(
      (v, i) => v - fitted[i],
    );
    const residualStdDev = Math.sqrt(
      residuals.reduce((sum, r) => sum + r * r, 0) / residuals.length,
    );

    return {
      modelName: this.name,
      parameters: {
        ...params,
        finalLevel: levels[levels.length - 1],
        finalTrend: trends[trends.length - 1],
        seasonalFactors: seasonals.slice(-seasonalPeriod),
        residualStdDev,
        n,
        lastDate: data[data.length - 1].date,
      },
      fittedAt: new Date(),
      trainingMetrics: this.calculateMetrics(values.slice(seasonalPeriod), fitted),
    };
  }

  predict(
    state: ModelState,
    periods: number,
    parameters?: ForecastParameters,
  ): Prediction[] {
    const {
      finalLevel,
      finalTrend,
      seasonalFactors,
      seasonalPeriod,
      multiplicative,
      damped,
      phi,
      residualStdDev,
      lastDate,
    } = state.parameters;
    const confidenceLevel = parameters?.confidenceLevel || 95;
    const predictions: Prediction[] = [];

    let cumulativeTrend = 0;

    for (let k = 1; k <= periods; k++) {
      const seasonalIndex = (k - 1) % seasonalPeriod;
      const seasonalFactor = seasonalFactors[seasonalIndex];

      // Calculate damped trend contribution
      if (damped) {
        cumulativeTrend += finalTrend * Math.pow(phi, k);
      } else {
        cumulativeTrend = finalTrend * k;
      }

      let forecastValue: number;
      if (multiplicative) {
        forecastValue = (finalLevel + cumulativeTrend) * seasonalFactor;
      } else {
        forecastValue = finalLevel + cumulativeTrend + seasonalFactor;
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

    // Prediction interval grows with forecast horizon
    const margin = z * residualStdDev * Math.sqrt(1 + horizon * 0.1);

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
          `Requires at least ${this.minDataPoints} data points (2+ seasonal cycles)`,
        ],
      };
    }

    const values = data.map((d) => d.value);

    // Check for zeros or negatives (problematic for multiplicative)
    const hasZerosOrNegatives = values.some((v) => v <= 0);
    if (hasZerosOrNegatives) {
      warnings.push(
        'Data contains zeros or negative values. Consider using additive seasonality.',
      );
    }

    // Check for seasonality
    const hasSeasonality = this.detectSeasonality(values, 12);
    if (!hasSeasonality) {
      warnings.push(
        'No clear seasonality detected. Consider using simpler models like Linear Regression.',
      );
    }

    return { valid: true, warnings };
  }

  getRecommendedParameters(data: DataPoint[]): Record<string, any> {
    const values = data.map((d) => d.value);
    
    // Detect optimal seasonal period
    let bestPeriod = 12;
    let bestCorr = 0;
    for (const period of [4, 6, 12, 13, 52]) {
      const corr = this.autocorrelation(values, period);
      if (corr > bestCorr) {
        bestCorr = corr;
        bestPeriod = period;
      }
    }

    // Check for multiplicative vs additive
    const hasZeros = values.some((v) => v <= 0);
    const multiplicative = !hasZeros;

    return {
      seasonalPeriod: bestPeriod,
      multiplicative,
    };
  }

  private initializeComponents(
    values: number[],
    period: number,
    multiplicative: boolean,
  ): { level: number; trend: number; seasonal: number[] } {
    // Initial level: average of first season
    const level = values.slice(0, period).reduce((sum, v) => sum + v, 0) / period;

    // Initial trend: average of (season 2 - season 1) / period
    const secondSeasonAvg =
      values.slice(period, 2 * period).reduce((sum, v) => sum + v, 0) / period;
    const trend = (secondSeasonAvg - level) / period;

    // Initial seasonal factors
    const seasonal: number[] = [];
    for (let i = 0; i < period; i++) {
      if (multiplicative) {
        seasonal.push(values[i] / level);
      } else {
        seasonal.push(values[i] - level);
      }
    }

    return { level, trend, seasonal };
  }

  private calculateFittedValues(
    levels: number[],
    trends: number[],
    seasonals: number[],
    period: number,
    multiplicative: boolean,
  ): number[] {
    const fitted: number[] = [];

    for (let i = 0; i < levels.length - 1; i++) {
      const levelTrend = levels[i] + trends[i];
      const seasonalFactor = seasonals[i];

      if (multiplicative) {
        fitted.push(levelTrend * seasonalFactor);
      } else {
        fitted.push(levelTrend + seasonalFactor);
      }
    }

    return fitted;
  }

  private calculateMetrics(
    actual: number[],
    fitted: number[],
  ): { mape: number; rmse: number; mae: number } {
    const n = Math.min(actual.length, fitted.length);
    let sumError = 0;
    let sumSquaredError = 0;
    let sumPercentageError = 0;
    let validCount = 0;

    for (let i = 0; i < n; i++) {
      const error = actual[i] - fitted[i];
      sumError += Math.abs(error);
      sumSquaredError += error * error;

      if (actual[i] !== 0) {
        sumPercentageError += Math.abs(error / actual[i]) * 100;
        validCount++;
      }
    }

    return {
      mae: Math.round((sumError / n) * 100) / 100,
      rmse: Math.round(Math.sqrt(sumSquaredError / n) * 100) / 100,
      mape: validCount > 0 ? Math.round((sumPercentageError / validCount) * 100) / 100 : 0,
    };
  }

  private detectSeasonality(values: number[], period: number): boolean {
    if (values.length < period * 2) return false;
    const corr = this.autocorrelation(values, period);
    return corr > 0.5;
  }

  private autocorrelation(values: number[], lag: number): number {
    const n = values.length;
    if (n <= lag) return 0;

    const mean = values.reduce((sum, v) => sum + v, 0) / n;
    const variance = values.reduce((sum, v) => sum + Math.pow(v - mean, 2), 0) / n;

    if (variance === 0) return 0;

    let covariance = 0;
    for (let i = lag; i < n; i++) {
      covariance += (values[i] - mean) * (values[i - lag] - mean);
    }
    covariance /= n - lag;

    return covariance / variance;
  }
}
