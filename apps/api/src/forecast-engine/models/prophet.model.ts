import { Injectable } from '@nestjs/common';
import {
    ConfidenceInterval,
    DataPoint,
    ForecastParameters,
    IForecastModel,
    ModelState,
    Prediction,
} from '../interfaces/forecast-model.interface';
import { residualStd as computeResidualStd, ridgeRegression, zScore } from './linear-solver';

/**
 * Prophet-style decomposition model.
 *
 * Implements the core of Facebook Prophet's additive model:
 *   y(t) = g(t) + s(t) + e
 * where g(t) is a piecewise-linear trend with automatic changepoints and s(t)
 * is seasonality represented by a Fourier series. Coefficients are fit jointly
 * by ridge-regularised least squares — the L2 penalty on the changepoint slope
 * deltas plays the same role as Prophet's Laplace prior, keeping the trend from
 * over-bending. This is a faithful re-implementation of Prophet's mechanics
 * (trend + Fourier seasonality + changepoints); it does not include holidays or
 * full Bayesian sampling.
 */
@Injectable()
export class ProphetModel implements IForecastModel {
  readonly name = 'PROPHET';
  readonly version = '2.0.0';
  readonly displayName = 'Prophet (Trend + Fourier Seasonality)';
  readonly description =
    'Piecewise-linear trend with automatic changepoints plus Fourier-series seasonality. Robust for business series with shifting trends and yearly seasonal cycles.';
  readonly minDataPoints = 24;
  readonly supportsSeasonality = true;
  readonly defaultParameters = {
    seasonLength: 12, // yearly seasonality for monthly data
    fourierOrder: 3, // number of seasonal harmonics
    nChangepoints: 25,
    changepointRange: 0.8, // place changepoints over the first 80% of history
    changepointPenalty: 0.5, // ridge λ applied to changepoint slope deltas
    confidenceLevel: 95,
  };

  fit(data: DataPoint[], parameters?: Record<string, any>): ModelState {
    const params = { ...this.defaultParameters, ...parameters };
    const values = data.map((d) => d.value);
    const n = values.length;

    const seasonLength = Math.max(2, Number(params.seasonLength));
    const fourierOrder = Math.max(1, Math.floor(Number(params.fourierOrder)));
    const changepoints = this.buildChangepoints(n, Number(params.nChangepoints), Number(params.changepointRange));

    // Build the design matrix and fit coefficients by ridge regression.
    const X = values.map((_, i) => this.featureRow(i, changepoints, seasonLength, fourierOrder));
    const lambda = Math.max(1e-6, Number(params.changepointPenalty));
    const beta = ridgeRegression(X, values, lambda, /* penalizeIntercept */ false);

    // Residuals for the prediction interval.
    const fitted = X.map((row) => this.dot(row, beta));
    const residuals = values.map((v, i) => v - fitted[i]);
    const resStd = computeResidualStd(residuals);

    const metrics = this.calculateMetrics(values, fitted);

    return {
      modelName: this.name,
      parameters: {
        beta,
        changepoints,
        seasonLength,
        fourierOrder,
        residualStd: resStd,
        lastIndex: n - 1,
        lastDate: data[n - 1].date,
        n,
      },
      fittedAt: new Date(),
      trainingMetrics: metrics,
    };
  }

  predict(state: ModelState, periods: number, parameters?: ForecastParameters): Prediction[] {
    const beta = state.parameters.beta as number[];
    const changepoints = state.parameters.changepoints as number[];
    const seasonLength = state.parameters.seasonLength as number;
    const fourierOrder = state.parameters.fourierOrder as number;
    const lastIndex = state.parameters.lastIndex as number;
    const lastDate = new Date(state.parameters.lastDate);
    const confidenceLevel = parameters?.confidenceLevel ?? this.defaultParameters.confidenceLevel;

    const predictions: Prediction[] = [];

    for (let h = 1; h <= periods; h++) {
      const idx = lastIndex + h;
      const row = this.featureRow(idx, changepoints, seasonLength, fourierOrder);
      const value = this.dot(row, beta);

      const forecastDate = new Date(lastDate);
      forecastDate.setMonth(forecastDate.getMonth() + h);

      const interval = this.getConfidenceInterval(
        { date: forecastDate, value },
        { ...state, parameters: { ...state.parameters, horizon: h } },
        confidenceLevel,
      );

      predictions.push({
        date: forecastDate,
        value: Math.max(0, Math.round(value * 100) / 100),
        confidenceLower: Math.max(0, interval.lower),
        confidenceUpper: interval.upper,
        confidenceLevel,
      });
    }

    return predictions;
  }

  getConfidenceInterval(prediction: Prediction, state: ModelState, level: number): ConfidenceInterval {
    const resStd = (state.parameters.residualStd as number) || 0;
    const horizon = (state.parameters.horizon as number) || 1;
    const seasonLength = (state.parameters.seasonLength as number) || 12;
    const z = zScore(level);

    // Uncertainty grows with horizon as the trend is extrapolated.
    const margin = z * resStd * Math.sqrt(1 + horizon / seasonLength);

    return {
      lower: Math.round((prediction.value - margin) * 100) / 100,
      upper: Math.round((prediction.value + margin) * 100) / 100,
      level,
    };
  }

  validate(data: DataPoint[]): { valid: boolean; warnings: string[] } {
    const warnings: string[] = [];
    if (data.length < this.minDataPoints) {
      return { valid: false, warnings: [`Prophet requires at least ${this.minDataPoints} data points.`] };
    }
    return { valid: true, warnings };
  }

  getRecommendedParameters(data: DataPoint[]): Record<string, any> {
    const n = data.length;
    return {
      seasonLength: n >= 24 ? 12 : 6,
      fourierOrder: n >= 48 ? 4 : 3,
      nChangepoints: Math.min(25, Math.max(0, Math.floor(n / 3))),
      confidenceLevel: 95,
    };
  }

  // ============ internals ============

  /** Changepoint positions (in time-index units) over the first `range` of history. */
  private buildChangepoints(n: number, requested: number, range: number): number[] {
    const usable = Math.max(0, Math.floor(n * range) - 1);
    const count = Math.max(0, Math.min(requested, Math.max(0, Math.floor(n / 3)), usable));
    if (count === 0) return [];
    const points: number[] = [];
    for (let j = 1; j <= count; j++) {
      points.push((usable * j) / (count + 1));
    }
    return points;
  }

  /**
   * Feature row for time index `i`:
   *   [ intercept, linear-trend, changepoint hinges..., fourier sin/cos pairs... ]
   */
  private featureRow(i: number, changepoints: number[], seasonLength: number, fourierOrder: number): number[] {
    const row: number[] = [1, i];
    for (const cp of changepoints) {
      row.push(Math.max(0, i - cp));
    }
    for (let k = 1; k <= fourierOrder; k++) {
      const angle = (2 * Math.PI * k * i) / seasonLength;
      row.push(Math.sin(angle));
      row.push(Math.cos(angle));
    }
    return row;
  }

  private dot(a: number[], b: number[]): number {
    let sum = 0;
    const len = Math.min(a.length, b.length);
    for (let i = 0; i < len; i++) sum += a[i] * b[i];
    return sum;
  }

  private calculateMetrics(actual: number[], fitted: number[]): { mape: number; rmse: number; mae: number } {
    const n = Math.min(actual.length, fitted.length);
    let sumAbs = 0;
    let sumSq = 0;
    let sumPct = 0;
    let validCount = 0;
    for (let i = 0; i < n; i++) {
      const err = actual[i] - fitted[i];
      sumAbs += Math.abs(err);
      sumSq += err * err;
      if (actual[i] !== 0) {
        sumPct += Math.abs(err / actual[i]) * 100;
        validCount++;
      }
    }
    return {
      mae: Math.round((sumAbs / n) * 100) / 100,
      rmse: Math.round(Math.sqrt(sumSq / n) * 100) / 100,
      mape: validCount > 0 ? Math.round((sumPct / validCount) * 100) / 100 : 0,
    };
  }
}
