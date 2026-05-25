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
 * SARIMA — Seasonal AutoRegressive Integrated Moving Average.
 *
 * Implements ARIMA(p,d,q)(P,D,Q)m:
 *   1. Regular differencing (d) and seasonal differencing (D at lag m) make the
 *      series stationary.
 *   2. The ARMA(p,q) parameters — including seasonal AR/MA lags — are estimated
 *      on the stationary series with the two-stage Hannan-Rissanen method:
 *        a. fit a long AR by least squares to recover the innovations (ε),
 *        b. regress the series on its own lags and the estimated ε lags.
 *   3. Forecasts are produced recursively on the stationary series and then
 *      integrated back (un-differenced) to the original scale.
 *
 * This is a genuine SARIMA estimator (least-squares / Hannan-Rissanen rather
 * than full MLE), with differencing, autoregressive and moving-average terms
 * and horizon-widening prediction intervals.
 */
@Injectable()
export class ArimaModel implements IForecastModel {
  readonly name = 'ARIMA';
  readonly version = '2.0.0';
  readonly displayName = 'SARIMA (Seasonal ARIMA)';
  readonly description =
    'Seasonal ARIMA(p,d,q)(P,D,Q) with differencing and autoregressive + moving-average terms. Suited to series with trend and/or seasonal structure.';
  readonly minDataPoints = 16;
  readonly supportsSeasonality = true;
  readonly defaultParameters = {
    p: 2, // non-seasonal AR order
    d: 1, // non-seasonal differencing
    q: 1, // non-seasonal MA order
    P: 0, // seasonal AR order
    D: 0, // seasonal differencing (auto-enabled when seasonality is detected)
    Q: 0, // seasonal MA order
    m: 12, // seasonal period
    confidenceLevel: 95,
  };

  fit(data: DataPoint[], parameters?: Record<string, any>): ModelState {
    const params = { ...this.defaultParameters, ...parameters };
    const values = data.map((d) => d.value);
    const n = values.length;

    const p = Math.max(0, Math.floor(Number(params.p)));
    const d = Math.max(0, Math.floor(Number(params.d)));
    const q = Math.max(0, Math.floor(Number(params.q)));
    const m = Math.max(2, Math.floor(Number(params.m)));
    let P = Math.max(0, Math.floor(Number(params.P)));
    let D = Math.max(0, Math.floor(Number(params.D)));
    const Q = Math.max(0, Math.floor(Number(params.Q)));

    // Auto-enable one seasonal difference when clear seasonality is present and
    // there is enough data, unless the caller specified seasonal terms.
    if (D === 0 && P === 0 && Q === 0 && n >= 3 * m && this.seasonalStrength(values, m) > 0.4) {
      D = 1;
    }

    // 1) Difference to stationarity, recording each pre-diff stage for later integration.
    const stages: Array<{ lag: number; series: number[] }> = [];
    let current = values.slice();
    for (let i = 0; i < d; i++) {
      stages.push({ lag: 1, series: current });
      current = this.differenceOnce(current, 1);
    }
    for (let i = 0; i < D; i++) {
      stages.push({ lag: m, series: current });
      current = this.differenceOnce(current, m);
    }
    const z = current; // stationary series

    const arLags = this.buildLags(p, P, m);
    const maLags = this.buildLags(q, Q, m);
    const maxLag = Math.max(0, ...arLags, ...maLags);

    // Fallback for short / degenerate stationary series: drift on last value.
    if (z.length < maxLag + 5 || (arLags.length === 0 && maLags.length === 0)) {
      const drift = z.length ? z.reduce((s, v) => s + v, 0) / z.length : 0;
      return {
        modelName: this.name,
        parameters: {
          fallback: true,
          drift,
          stages,
          stationaryTail: z.slice(-Math.max(1, m)),
          residualStd: computeResidualStd(z.map((v) => v - drift)),
          lastDate: data[n - 1].date,
        },
        fittedAt: new Date(),
      };
    }

    // 2a) Long AR fit to estimate innovations (ε).
    const longOrder = Math.min(Math.max(maxLag + 2, 8), Math.floor(z.length / 3));
    const epsilon = this.estimateInnovations(z, longOrder);

    // 2b) Regress z_t on its own lags (AR) and the estimated ε lags (MA).
    const start = Math.max(maxLag, longOrder);
    const X: number[][] = [];
    const y: number[] = [];
    for (let t = start; t < z.length; t++) {
      const row = [1];
      for (const l of arLags) row.push(z[t - l]);
      for (const l of maLags) row.push(epsilon[t - l]);
      X.push(row);
      y.push(z[t]);
    }
    const beta = ridgeRegression(X, y, 1e-4, false);
    const c = beta[0];
    const phi = arLags.map((_, i) => beta[1 + i]);
    const theta = maLags.map((_, i) => beta[1 + arLags.length + i]);

    // In-sample residuals from the fitted ARMA model (for the MA forecast feed).
    const fittedResiduals = new Array(z.length).fill(0);
    for (let t = start; t < z.length; t++) {
      let pred = c;
      for (let i = 0; i < arLags.length; i++) pred += phi[i] * z[t - arLags[i]];
      for (let j = 0; j < maLags.length; j++) pred += theta[j] * epsilon[t - maLags[j]];
      fittedResiduals[t] = z[t] - pred;
    }
    const resStd = computeResidualStd(fittedResiduals.slice(start));

    // In-sample fit metrics on the stationary series. MAPE is omitted when the
    // series is differenced — it straddles zero there, making MAPE meaningless.
    const metrics = this.calculateMetrics(
      z.slice(start),
      z.slice(start).map((_, i) => z[start + i] - fittedResiduals[start + i]),
    );
    const trainingMetrics = d + D > 0 ? { mae: metrics.mae, rmse: metrics.rmse } : metrics;

    return {
      modelName: this.name,
      parameters: {
        fallback: false,
        c,
        phi,
        theta,
        arLags,
        maLags,
        z,
        epsilon,
        residualStd: resStd,
        stages,
        d,
        D,
        lastDate: data[n - 1].date,
      },
      fittedAt: new Date(),
      trainingMetrics,
    };
  }

  predict(state: ModelState, periods: number, parameters?: ForecastParameters): Prediction[] {
    const confidenceLevel = parameters?.confidenceLevel ?? this.defaultParameters.confidenceLevel;
    const lastDate = new Date(state.parameters.lastDate);

    let stationaryForecasts: number[];

    if (state.parameters.fallback) {
      const drift = state.parameters.drift as number;
      stationaryForecasts = new Array(periods).fill(drift);
    } else {
      stationaryForecasts = this.forecastStationary(state, periods);
    }

    // Integrate forecasts back to the original scale through the recorded stages.
    const stages = state.parameters.stages as Array<{ lag: number; series: number[] }>;
    let levelForecasts = stationaryForecasts;
    for (let s = stages.length - 1; s >= 0; s--) {
      levelForecasts = this.integrate(stages[s].series, levelForecasts, stages[s].lag);
    }

    const predictions: Prediction[] = [];
    for (let h = 1; h <= periods; h++) {
      const value = levelForecasts[h - 1];
      const forecastDate = new Date(lastDate);
      forecastDate.setMonth(forecastDate.getMonth() + h);

      const interval = this.getConfidenceInterval(
        { date: forecastDate, value },
        { ...state, parameters: { ...state.parameters, horizon: h } },
        confidenceLevel,
      );

      predictions.push({
        date: forecastDate,
        value: Math.round(value * 100) / 100,
        confidenceLower: interval.lower,
        confidenceUpper: interval.upper,
        confidenceLevel,
      });
    }

    return predictions;
  }

  getConfidenceInterval(prediction: Prediction, state: ModelState, level: number): ConfidenceInterval {
    const resStd = (state.parameters.residualStd as number) || 0;
    const horizon = (state.parameters.horizon as number) || 1;
    const integrated = ((state.parameters.d as number) || 0) + ((state.parameters.D as number) || 0) > 0;
    const z = zScore(level);

    // Integrated models accumulate variance ~ σ²·h; stationary ARMA intervals
    // widen more slowly toward a bound.
    const margin = integrated
      ? z * resStd * Math.sqrt(horizon)
      : z * resStd * Math.sqrt(1 + horizon * 0.1);

    return {
      lower: Math.round((prediction.value - margin) * 100) / 100,
      upper: Math.round((prediction.value + margin) * 100) / 100,
      level,
    };
  }

  validate(data: DataPoint[]): { valid: boolean; warnings: string[] } {
    const warnings: string[] = [];
    if (data.length < this.minDataPoints) {
      return { valid: false, warnings: [`SARIMA requires at least ${this.minDataPoints} data points.`] };
    }
    return { valid: true, warnings };
  }

  getRecommendedParameters(data: DataPoint[]): Record<string, any> {
    const values = data.map((d) => d.value);
    const seasonal = data.length >= 36 && this.seasonalStrength(values, 12) > 0.4;
    return {
      p: 2,
      d: 1,
      q: 1,
      D: seasonal ? 1 : 0,
      m: 12,
      confidenceLevel: 95,
    };
  }

  // ============ internals ============

  private buildLags(order: number, seasonalOrder: number, m: number): number[] {
    const lags: number[] = [];
    for (let i = 1; i <= order; i++) lags.push(i);
    for (let s = 1; s <= seasonalOrder; s++) {
      const lag = s * m;
      if (!lags.includes(lag)) lags.push(lag);
    }
    return lags.sort((a, b) => a - b);
  }

  private differenceOnce(series: number[], lag: number): number[] {
    const out: number[] = [];
    for (let t = lag; t < series.length; t++) {
      out.push(series[t] - series[t - lag]);
    }
    return out;
  }

  /** Reconstruct original-scale forecasts from differenced forecasts at `lag`. */
  private integrate(prevSeries: number[], diffForecasts: number[], lag: number): number[] {
    const result = prevSeries.slice();
    for (let h = 0; h < diffForecasts.length; h++) {
      const idx = result.length;
      result.push(diffForecasts[h] + result[idx - lag]);
    }
    return result.slice(prevSeries.length);
  }

  /** Stage-1 Hannan-Rissanen: long AR fit by least squares; returns ε per index. */
  private estimateInnovations(z: number[], order: number): number[] {
    const X: number[][] = [];
    const y: number[] = [];
    for (let t = order; t < z.length; t++) {
      const row = [1];
      for (let l = 1; l <= order; l++) row.push(z[t - l]);
      X.push(row);
      y.push(z[t]);
    }
    const beta = ridgeRegression(X, y, 1e-4, false);

    const epsilon = new Array(z.length).fill(0);
    for (let t = order; t < z.length; t++) {
      let pred = beta[0];
      for (let l = 1; l <= order; l++) pred += beta[l] * z[t - l];
      epsilon[t] = z[t] - pred;
    }
    return epsilon;
  }

  private forecastStationary(state: ModelState, periods: number): number[] {
    const c = state.parameters.c as number;
    const phi = state.parameters.phi as number[];
    const theta = state.parameters.theta as number[];
    const arLags = state.parameters.arLags as number[];
    const maLags = state.parameters.maLags as number[];
    const z = (state.parameters.z as number[]).slice();
    const epsilon = (state.parameters.epsilon as number[]).slice();

    const forecasts: number[] = [];
    const baseLen = z.length;

    for (let h = 1; h <= periods; h++) {
      const t = baseLen + h - 1; // index of the value being produced
      let pred = c;
      for (let i = 0; i < arLags.length; i++) {
        const idx = t - arLags[i];
        pred += phi[i] * (idx < z.length ? z[idx] : forecasts[idx - baseLen]);
      }
      for (let j = 0; j < maLags.length; j++) {
        const idx = t - maLags[j];
        // Future innovations are zero in expectation.
        pred += theta[j] * (idx < epsilon.length ? epsilon[idx] : 0);
      }
      forecasts.push(pred);
      z.push(pred); // feed forward for AR terms
      epsilon.push(0); // forecast residual expectation
    }

    return forecasts;
  }

  /** Strength of seasonality via autocorrelation at the seasonal lag. */
  private seasonalStrength(values: number[], m: number): number {
    const n = values.length;
    if (n <= m) return 0;
    const mean = values.reduce((s, v) => s + v, 0) / n;
    let num = 0;
    let den = 0;
    for (let i = m; i < n; i++) num += (values[i] - mean) * (values[i - m] - mean);
    for (let i = 0; i < n; i++) den += (values[i] - mean) ** 2;
    return den === 0 ? 0 : num / den;
  }

  private calculateMetrics(actual: number[], fitted: number[]): { mape: number; rmse: number; mae: number } {
    const n = Math.min(actual.length, fitted.length);
    if (n === 0) return { mape: 0, rmse: 0, mae: 0 };
    let sumAbs = 0;
    let sumSq = 0;
    let sumPct = 0;
    let valid = 0;
    for (let i = 0; i < n; i++) {
      const err = actual[i] - fitted[i];
      sumAbs += Math.abs(err);
      sumSq += err * err;
      if (actual[i] !== 0) {
        sumPct += Math.abs(err / actual[i]) * 100;
        valid++;
      }
    }
    return {
      mae: Math.round((sumAbs / n) * 100) / 100,
      rmse: Math.round(Math.sqrt(sumSq / n) * 100) / 100,
      mape: valid > 0 ? Math.round((sumPct / valid) * 100) / 100 : 0,
    };
  }
}
