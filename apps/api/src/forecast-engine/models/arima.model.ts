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
export class ArimaModel implements IForecastModel {
  readonly name = 'ARIMA';
  readonly version = '1.0.0';
  readonly displayName = 'ARIMA (Simplified)';
  readonly description = 'Autoregressive model with basic lag-1 dynamics for stable series.';
  readonly minDataPoints = 12;
  readonly supportsSeasonality = false;
  readonly defaultParameters = {
    confidenceLevel: 95,
  };

  fit(data: DataPoint[], parameters?: Record<string, any>): ModelState {
    const values = data.map((d) => d.value);
    const mean = values.reduce((sum, v) => sum + v, 0) / values.length;

    let numerator = 0;
    let denominator = 0;
    for (let i = 1; i < values.length; i++) {
      numerator += (values[i] - mean) * (values[i - 1] - mean);
      denominator += Math.pow(values[i - 1] - mean, 2);
    }

    const phi = denominator === 0 ? 0 : numerator / denominator;
    const residuals = values.slice(1).map((v, idx) => v - (mean + phi * (values[idx] - mean)));
    const residualVariance = residuals.length
      ? residuals.reduce((sum, r) => sum + r * r, 0) / residuals.length
      : 0;
    const residualStd = Math.sqrt(residualVariance);

    return {
      modelName: this.name,
      parameters: {
        phi,
        mean,
        residualStd,
        lastValue: values[values.length - 1],
      },
      fittedAt: new Date(),
    };
  }

  predict(state: ModelState, periods: number, parameters?: ForecastParameters): Prediction[] {
    const mean = state.parameters.mean as number;
    const phi = state.parameters.phi as number;
    const residualStd = state.parameters.residualStd as number;
    const confidenceLevel = parameters?.confidenceLevel ?? this.defaultParameters.confidenceLevel;

    const predictions: Prediction[] = [];
    let prev = state.parameters.lastValue as number;

    for (let i = 0; i < periods; i++) {
      const value = mean + phi * (prev - mean);
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

      prev = value;
    }

    if (residualStd === 0) {
      return predictions;
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
      warnings.push(`ARIMA requires at least ${this.minDataPoints} data points.`);
    }

    return { valid: warnings.length === 0, warnings };
  }

  getRecommendedParameters(_data: DataPoint[]): Record<string, any> {
    return {
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
