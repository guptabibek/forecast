import { Injectable } from '@nestjs/common';
import {
    ConfidenceInterval,
    DataPoint,
    ForecastParameters,
    IForecastModel,
    ModelState,
    Prediction,
} from '../interfaces/forecast-model.interface';

@Injectable()
export class ProphetModel implements IForecastModel {
  readonly name = 'PROPHET';
  readonly version = '1.0.0';
  readonly displayName = 'Prophet (Trend + Seasonality)';
  readonly description = 'Additive trend and seasonal components with robust smoothing.';
  readonly minDataPoints = 24;
  readonly supportsSeasonality = true;
  readonly defaultParameters = {
    seasonLength: 12,
    confidenceLevel: 95,
  };

  fit(data: DataPoint[], parameters?: Record<string, any>): ModelState {
    const values = data.map((d) => d.value);
    const n = values.length;
    const seasonLength = Number(parameters?.seasonLength ?? this.defaultParameters.seasonLength);

    const xMean = (n - 1) / 2;
    const yMean = values.reduce((sum, v) => sum + v, 0) / n;
    let numerator = 0;
    let denominator = 0;

    for (let i = 0; i < n; i++) {
      numerator += (i - xMean) * (values[i] - yMean);
      denominator += Math.pow(i - xMean, 2);
    }

    const slope = denominator === 0 ? 0 : numerator / denominator;
    const intercept = yMean - slope * xMean;

    const seasonalSums = new Array(seasonLength).fill(0);
    const seasonalCounts = new Array(seasonLength).fill(0);

    for (let i = 0; i < n; i++) {
      const trend = intercept + slope * i;
      const seasonIndex = i % seasonLength;
      seasonalSums[seasonIndex] += values[i] - trend;
      seasonalCounts[seasonIndex] += 1;
    }

    const seasonal = seasonalSums.map((sum, idx) =>
      seasonalCounts[idx] ? sum / seasonalCounts[idx] : 0,
    );

    const residuals = values.map((v, idx) => v - (intercept + slope * idx + seasonal[idx % seasonLength]));
    const residualVariance = residuals.reduce((sum, r) => sum + r * r, 0) / residuals.length;

    return {
      modelName: this.name,
      parameters: {
        slope,
        intercept,
        seasonal,
        seasonLength,
        residualStd: Math.sqrt(residualVariance),
        lastIndex: n - 1,
      },
      fittedAt: new Date(),
    };
  }

  predict(state: ModelState, periods: number, parameters?: ForecastParameters): Prediction[] {
    const slope = state.parameters.slope as number;
    const intercept = state.parameters.intercept as number;
    const seasonal = state.parameters.seasonal as number[];
    const seasonLength = state.parameters.seasonLength as number;
    const lastIndex = state.parameters.lastIndex as number;
    const confidenceLevel = parameters?.confidenceLevel ?? this.defaultParameters.confidenceLevel;

    const predictions: Prediction[] = [];

    for (let i = 1; i <= periods; i++) {
      const idx = lastIndex + i;
      const trend = intercept + slope * idx;
      const season = seasonal[idx % seasonLength] ?? 0;
      const value = trend + season;

      const basePrediction: Prediction = {
        date: new Date(),
        value,
        confidenceLevel,
      };

      const interval = this.getConfidenceInterval(basePrediction, state, confidenceLevel);
      predictions.push({
        ...basePrediction,
        confidenceLower: interval.lower,
        confidenceUpper: interval.upper,
      });
    }

    return predictions;
  }

  getConfidenceInterval(
    prediction: Prediction,
    state: ModelState,
    level: number,
  ): ConfidenceInterval {
    const residualStd = (state.parameters.residualStd as number) || 0;
    const z = this.getZScore(level);
    const margin = residualStd * z;

    return {
      lower: prediction.value - margin,
      upper: prediction.value + margin,
      level,
    };
  }

  validate(data: DataPoint[]): { valid: boolean; warnings: string[] } {
    const warnings: string[] = [];
    if (data.length < this.minDataPoints) {
      warnings.push(`Prophet requires at least ${this.minDataPoints} data points.`);
    }

    return { valid: warnings.length === 0, warnings };
  }

  getRecommendedParameters(data: DataPoint[]): Record<string, any> {
    const seasonLength = data.length >= 36 ? 12 : 6;
    return {
      seasonLength,
      confidenceLevel: 95,
    };
  }

  private getZScore(level: number): number {
    if (level >= 99) return 2.576;
    if (level >= 95) return 1.96;
    if (level >= 90) return 1.645;
    return 1.28;
  }
}
