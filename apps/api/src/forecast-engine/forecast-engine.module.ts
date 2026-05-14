import { Module } from '@nestjs/common';
import { ForecastEngineService } from './forecast-engine.service';
import { ForecastModelRegistry } from './model-registry';

// Import all forecast models
import { MovingAverageModel } from './models/moving-average.model';
import { WeightedAverageModel } from './models/weighted-average.model';
import { LinearRegressionModel } from './models/linear-regression.model';
import { HoltWintersModel } from './models/holt-winters.model';
import { SeasonalNaiveModel } from './models/seasonal-naive.model';
import { YoYGrowthModel } from './models/yoy-growth.model';
import { TrendPercentModel } from './models/trend-percent.model';
import { AIHybridModel } from './models/ai-hybrid.model';

@Module({
  providers: [
    ForecastEngineService,
    ForecastModelRegistry,
    // Register all forecast models
    MovingAverageModel,
    WeightedAverageModel,
    LinearRegressionModel,
    HoltWintersModel,
    SeasonalNaiveModel,
    YoYGrowthModel,
    TrendPercentModel,
    AIHybridModel,
  ],
  exports: [ForecastEngineService, ForecastModelRegistry],
})
export class ForecastEngineModule {}
