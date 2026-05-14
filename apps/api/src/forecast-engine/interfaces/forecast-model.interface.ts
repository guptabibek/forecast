/**
 * Core interfaces for the Pluggable Forecast Engine
 * 
 * This module defines the contract that all forecast models must implement,
 * enabling a plug-and-play architecture for adding new forecasting algorithms.
 */

/**
 * Time series data point
 */
export interface DataPoint {
  date: Date;
  value: number;
  quantity?: number;
}

/**
 * Dimension combination for forecasting
 */
export interface DimensionKey {
  productId?: string;
  locationId?: string;
  customerId?: string;
  accountId?: string;
}

/**
 * Historical time series with dimension context
 */
export interface TimeSeries {
  dimensions: DimensionKey;
  data: DataPoint[];
  metadata?: Record<string, any>;
}

/**
 * Forecast prediction result
 */
export interface Prediction {
  date: Date;
  value: number;
  quantity?: number;
  confidenceLower?: number;
  confidenceUpper?: number;
  confidenceLevel?: number;
}

/**
 * Confidence interval specification
 */
export interface ConfidenceInterval {
  lower: number;
  upper: number;
  level: number; // e.g., 80, 95
}

/**
 * Model state after fitting to historical data
 */
export interface ModelState {
  modelName: string;
  parameters: Record<string, any>;
  fittedAt: Date;
  trainingMetrics?: {
    mape?: number;
    rmse?: number;
    mae?: number;
    r2?: number;
  };
}

/**
 * Accuracy metrics for forecast evaluation
 */
export interface AccuracyMetrics {
  mape: number;  // Mean Absolute Percentage Error
  rmse: number;  // Root Mean Square Error
  mae: number;   // Mean Absolute Error
  mse: number;   // Mean Square Error
  r2?: number;   // R-squared (coefficient of determination)
  bias?: number; // Forecast bias
}

/**
 * Parameters for forecast generation
 */
export interface ForecastParameters {
  // Common parameters
  periods: number;
  confidenceLevel?: number; // Default: 95
  
  // Model-specific parameters
  [key: string]: any;
}

/**
 * Complete forecast result for a dimension combination
 */
export interface ForecastResult {
  dimensions: DimensionKey;
  predictions: Prediction[];
  model: string;
  state: ModelState;
  metrics: AccuracyMetrics;
}

/**
 * Base interface that all forecast models must implement
 */
export interface IForecastModel {
  /**
   * Unique identifier for the model
   */
  readonly name: string;

  /**
   * Semantic version of the model implementation
   */
  readonly version: string;

  /**
   * Human-readable display name
   */
  readonly displayName: string;

  /**
   * Description of when to use this model
   */
  readonly description: string;

  /**
   * Minimum number of historical data points required
   */
  readonly minDataPoints: number;

  /**
   * Whether the model supports seasonality
   */
  readonly supportsSeasonality: boolean;

  /**
   * Default parameters for the model
   */
  readonly defaultParameters: Record<string, any>;

  /**
   * Fit the model to historical data
   * @param data Historical time series data
   * @param parameters Model-specific parameters
   * @returns Fitted model state
   */
  fit(data: DataPoint[], parameters?: Record<string, any>): ModelState;

  /**
   * Generate predictions using fitted model
   * @param state Fitted model state
   * @param periods Number of periods to forecast
   * @param parameters Additional parameters
   * @returns Array of predictions
   */
  predict(
    state: ModelState,
    periods: number,
    parameters?: ForecastParameters,
  ): Prediction[];

  /**
   * Calculate confidence intervals for predictions
   * @param prediction Single prediction
   * @param state Model state
   * @param level Confidence level (e.g., 95)
   * @returns Confidence interval
   */
  getConfidenceInterval(
    prediction: Prediction,
    state: ModelState,
    level: number,
  ): ConfidenceInterval;

  /**
   * Validate if the model can be applied to given data
   * @param data Historical data
   * @returns Validation result with any warnings
   */
  validate(data: DataPoint[]): { valid: boolean; warnings: string[] };

  /**
   * Get recommended parameters based on data characteristics
   * @param data Historical data
   * @returns Recommended parameters
   */
  getRecommendedParameters(data: DataPoint[]): Record<string, any>;
}

/**
 * Input for batch forecast generation
 */
export interface BatchForecastInput {
  tenantId: string;
  planVersionId: string;
  scenarioId: string;
  model: string;
  historicalData: any[];
  startPeriod: Date;
  endPeriod: Date;
  periodType?: string;
  parameters: Record<string, any>;
  dimensions: string[];
}

/**
 * Output from batch forecast generation
 */
export interface BatchForecastOutput {
  planVersionId: string;
  scenarioId: string;
  model: string;
  periodDate: Date;
  periodType?: string;
  productId?: string;
  locationId?: string;
  customerId?: string;
  accountId?: string;
  costCenterId?: string;
  quantity?: number;
  amount: number;
  currency: string;
  confidenceLower?: number;
  confidenceUpper?: number;
  confidenceLevel?: number;
}
