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
 * Linear Regression Model
 * 
 * Best for: Data with clear linear trend, no seasonality
 * Input: Historical values (time series)
 * Output: Trend-based forecasts
 * 
 * Formula: Y = α + β * t
 * where α is intercept, β is slope, t is time index
 */
@Injectable()
export class LinearRegressionModel implements IForecastModel {
  readonly name = 'LINEAR_REGRESSION';
  readonly displayName = 'Linear Regression (Trend)';
  readonly description =
    'Projects future values based on historical linear trend. Best for data with consistent growth or decline patterns.';
  readonly version = '1.0.0';
  readonly minDataPoints = 6;
  readonly supportsSeasonality = false;
  readonly defaultParameters = {
    includeQuantity: true,
  };

  fit(data: DataPoint[], parameters?: Record<string, any>): ModelState {
    const n = data.length;
    const values = data.map((d) => d.value);
    const quantities = data.map((d) => d.quantity || 0);

    // Calculate linear regression coefficients for values
    const { slope, intercept, r2, stdError } = this.calculateRegression(
      values,
    );

    // Calculate for quantities if present
    const quantityRegression = this.calculateRegression(quantities);

    // Calculate residual standard deviation for confidence intervals
    const residuals = values.map((v, i) => v - (intercept + slope * i));
    const residualStdDev = Math.sqrt(
      residuals.reduce((sum, r) => sum + r * r, 0) / (n - 2),
    );

    return {
      modelName: this.name,
      parameters: {
        slope,
        intercept,
        r2,
        stdError,
        residualStdDev,
        n,
        quantitySlope: quantityRegression.slope,
        quantityIntercept: quantityRegression.intercept,
        lastDate: data[data.length - 1].date,
        lastIndex: n - 1,
      },
      fittedAt: new Date(),
      trainingMetrics: {
        r2,
        mape: this.calculateMAPE(values, slope, intercept),
        rmse: residualStdDev,
        mae: residuals.reduce((sum, r) => sum + Math.abs(r), 0) / n,
      },
    };
  }

  predict(
    state: ModelState,
    periods: number,
    parameters?: ForecastParameters,
  ): Prediction[] {
    const {
      slope,
      intercept,
      quantitySlope,
      quantityIntercept,
      residualStdDev,
      n,
      lastDate,
      lastIndex,
    } = state.parameters;
    const confidenceLevel = parameters?.confidenceLevel || 95;
    const predictions: Prediction[] = [];

    for (let i = 1; i <= periods; i++) {
      const forecastIndex = lastIndex + i;
      const forecastValue = intercept + slope * forecastIndex;
      const forecastQuantity = quantityIntercept + quantitySlope * forecastIndex;

      const forecastDate = new Date(lastDate);
      forecastDate.setMonth(forecastDate.getMonth() + i);

      // Calculate prediction interval (wider than confidence interval)
      const interval = this.getConfidenceInterval(
        { date: forecastDate, value: forecastValue },
        {
          ...state,
          parameters: {
            ...state.parameters,
            forecastIndex,
          },
        },
        confidenceLevel,
      );

      predictions.push({
        date: forecastDate,
        value: Math.max(0, Math.round(forecastValue * 100) / 100),
        quantity:
          forecastQuantity > 0
            ? Math.round(forecastQuantity * 100) / 100
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
    const { residualStdDev, n, forecastIndex } = state.parameters;

    // t-value for confidence level (approximation for large n)
    const tValues: Record<number, number> = {
      80: 1.28,
      90: 1.645,
      95: 1.96,
      99: 2.576,
    };
    const t = tValues[level] || 1.96;

    // Calculate standard error of prediction
    // SE_pred = s * sqrt(1 + 1/n + (x - x_mean)^2 / Σ(x - x_mean)^2)
    const xMean = (n - 1) / 2;
    const ssX = Array.from({ length: n }, (_, i) => i).reduce(
      (sum, x) => sum + Math.pow(x - xMean, 2),
      0,
    );

    const sePred =
      residualStdDev *
      Math.sqrt(1 + 1 / n + Math.pow(forecastIndex - xMean, 2) / ssX);

    const margin = t * sePred;

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
    const { r2 } = this.calculateRegression(values);

    // Warn if R² is too low
    if (r2 < 0.5) {
      warnings.push(
        `Low R² (${(r2 * 100).toFixed(1)}%). Linear trend may not be a good fit for this data.`,
      );
    }

    // Check for non-linearity (residual pattern)
    const { slope, intercept } = this.calculateRegression(values);
    const residuals = values.map((v, i) => v - (intercept + slope * i));
    
    // Simple runs test for randomness
    let runs = 1;
    for (let i = 1; i < residuals.length; i++) {
      if ((residuals[i] > 0) !== (residuals[i - 1] > 0)) {
        runs++;
      }
    }
    const expectedRuns = (2 * residuals.filter((r) => r > 0).length * 
                         residuals.filter((r) => r <= 0).length) / 
                         residuals.length + 1;
    
    if (runs < expectedRuns * 0.5) {
      warnings.push(
        'Residual pattern suggests non-linear relationship. Consider polynomial or other models.',
      );
    }

    return { valid: true, warnings };
  }

  getRecommendedParameters(data: DataPoint[]): Record<string, any> {
    return this.defaultParameters;
  }

  private calculateRegression(values: number[]): {
    slope: number;
    intercept: number;
    r2: number;
    stdError: number;
  } {
    const n = values.length;
    if (n < 2) {
      return { slope: 0, intercept: values[0] || 0, r2: 0, stdError: 0 };
    }

    // Calculate means
    const xMean = (n - 1) / 2;
    const yMean = values.reduce((sum, v) => sum + v, 0) / n;

    // Calculate slope and intercept
    let numerator = 0;
    let denominator = 0;
    for (let i = 0; i < n; i++) {
      numerator += (i - xMean) * (values[i] - yMean);
      denominator += Math.pow(i - xMean, 2);
    }

    const slope = denominator !== 0 ? numerator / denominator : 0;
    const intercept = yMean - slope * xMean;

    // Calculate R²
    let ssTotal = 0;
    let ssResidual = 0;
    for (let i = 0; i < n; i++) {
      const predicted = intercept + slope * i;
      ssTotal += Math.pow(values[i] - yMean, 2);
      ssResidual += Math.pow(values[i] - predicted, 2);
    }

    const r2 = ssTotal !== 0 ? 1 - ssResidual / ssTotal : 0;

    // Standard error of slope
    const stdError =
      denominator !== 0
        ? Math.sqrt(ssResidual / (n - 2)) / Math.sqrt(denominator)
        : 0;

    return { slope, intercept, r2, stdError };
  }

  private calculateMAPE(
    values: number[],
    slope: number,
    intercept: number,
  ): number {
    const n = values.length;
    let mape = 0;
    let count = 0;

    for (let i = 0; i < n; i++) {
      if (values[i] !== 0) {
        const predicted = intercept + slope * i;
        mape += Math.abs((values[i] - predicted) / values[i]) * 100;
        count++;
      }
    }

    return count > 0 ? Math.round((mape / count) * 100) / 100 : 0;
  }
}
