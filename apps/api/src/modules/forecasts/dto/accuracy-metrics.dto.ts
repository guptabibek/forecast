import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';

/**
 * Individual model accuracy metrics
 */
export class ModelAccuracyDto {
  @ApiProperty({ description: 'Model name' })
  modelName: string;

  @ApiProperty({ description: 'Model display name' })
  displayName: string;

  @ApiPropertyOptional({ description: 'Mean Absolute Percentage Error' })
  mape: number | null;

  @ApiPropertyOptional({ description: 'Root Mean Square Error' })
  rmse: number | null;

  @ApiPropertyOptional({ description: 'Mean Absolute Error' })
  mae: number | null;

  @ApiPropertyOptional({ description: 'Forecast Bias' })
  bias: number | null;

  @ApiPropertyOptional({ description: 'Forecast Accuracy (100 - MAPE)' })
  accuracy: number | null;

  @ApiProperty({ description: 'Number of data points used for calculation' })
  dataPoints: number;
}

/**
 * Enhanced accuracy response with per-model breakdown
 */
export class EnhancedAccuracyResponseDto {
  @ApiProperty({ description: 'Plan version ID' })
  planVersionId: string;

  @ApiProperty({ description: 'Scenario ID' })
  scenarioId: string;

  @ApiProperty({ description: 'Overall aggregated metrics across all models' })
  overall: {
    mape: number | null;
    rmse: number | null;
    mae: number | null;
    bias: number | null;
    accuracy: number | null;
  };

  @ApiProperty({ description: 'Per-model accuracy breakdown', type: [ModelAccuracyDto] })
  byModel: ModelAccuracyDto[];

  @ApiProperty({ description: 'Total forecast data points' })
  totalDataPoints: number;

  @ApiProperty({ description: 'Total actuals available for comparison' })
  actualsAvailable: number;

  @ApiProperty({ description: 'Best performing model by MAPE' })
  bestModel: string | null;

  @ApiProperty({ description: 'Model recommendation based on accuracy' })
  recommendation: string | null;
}

/**
 * Backtesting query parameters
 */
export class BacktestQueryDto {
  @ApiProperty({ description: 'Plan version ID' })
  planVersionId: string;

  @ApiProperty({ description: 'Scenario ID' })
  scenarioId: string;

  @ApiPropertyOptional({ description: 'Number of holdout periods for backtesting', default: 6 })
  holdoutPeriods?: number;

  @ApiPropertyOptional({ description: 'Models to backtest (comma-separated)', type: String })
  models?: string;
}

/**
 * Backtest result for a single model
 */
export class BacktestModelResultDto {
  @ApiProperty({ description: 'Model name' })
  modelName: string;

  @ApiProperty({ description: 'Model display name' })
  displayName: string;

  @ApiProperty({ description: 'Backtest period forecasts with actuals' })
  data: Array<{
    period: string;
    periodLabel: string;
    forecast: number;
    actual: number | null;
    error: number | null;
    percentError: number | null;
  }>;

  @ApiProperty({ description: 'Accuracy metrics for backtest period' })
  metrics: {
    mape: number | null;
    rmse: number | null;
    mae: number | null;
    bias: number | null;
  };
}

/**
 * Complete backtest response
 */
export class BacktestResponseDto {
  @ApiProperty({ description: 'Plan version ID' })
  planVersionId: string;

  @ApiProperty({ description: 'Scenario ID' })
  scenarioId: string;

  @ApiProperty({ description: 'Number of holdout periods used' })
  holdoutPeriods: number;

  @ApiProperty({ description: 'Training period date range' })
  trainingRange: {
    start: string;
    end: string;
  };

  @ApiProperty({ description: 'Holdout period date range' })
  holdoutRange: {
    start: string;
    end: string;
  };

  @ApiProperty({ description: 'Per-model backtest results', type: [BacktestModelResultDto] })
  results: BacktestModelResultDto[];

  @ApiProperty({ description: 'Best performing model in backtest' })
  bestModel: string | null;
}

/**
 * Model explainability information
 */
export class ModelExplainabilityDto {
  @ApiProperty({ description: 'Model name' })
  name: string;

  @ApiProperty({ description: 'Model display name' })
  displayName: string;

  @ApiProperty({ description: 'Model description' })
  description: string;

  @ApiProperty({ description: 'Minimum data points required' })
  minDataPoints: number;

  @ApiProperty({ description: 'Whether the model supports seasonality' })
  supportsSeasonality: boolean;

  @ApiProperty({ description: 'Default parameters' })
  defaultParameters: Record<string, any>;

  @ApiProperty({ description: 'Detailed explanation of how the model works' })
  methodology: string;

  @ApiProperty({ description: 'Best use cases for this model' })
  bestFor: string[];

  @ApiProperty({ description: 'Limitations of this model' })
  limitations: string[];

  @ApiProperty({ description: 'Interpretability level: high, medium, low' })
  interpretability: 'high' | 'medium' | 'low';
}

/**
 * Primary forecast selection DTO
 */
export class SetPrimaryForecastDto {
  @ApiProperty({ description: 'Plan version ID' })
  planVersionId: string;

  @ApiProperty({ description: 'Scenario ID' })
  scenarioId: string;

  @ApiProperty({ description: 'Model to set as primary' })
  modelName: string;
}

/**
 * Auto-select primary forecast model DTO
 */
export class AutoSelectPrimaryForecastDto {
  @ApiProperty({ description: 'Plan version ID' })
  planVersionId: string;

  @ApiProperty({ description: 'Scenario ID' })
  scenarioId: string;

  @ApiProperty({ description: 'Holdout periods for backtest', required: false, default: 6 })
  holdoutPeriods?: number;

  @ApiProperty({ description: 'Comma-separated list of models to evaluate', required: false })
  models?: string;
}
