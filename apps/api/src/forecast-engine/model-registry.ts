import { Injectable, Logger, OnModuleInit } from '@nestjs/common';
import { ModuleRef } from '@nestjs/core';
import { IForecastModel } from './interfaces/forecast-model.interface';

// Import all model classes
import { AIHybridModel } from './models/ai-hybrid.model';
import { ArimaModel } from './models/arima.model';
import { HoltWintersModel } from './models/holt-winters.model';
import { LinearRegressionModel } from './models/linear-regression.model';
import { MovingAverageModel } from './models/moving-average.model';
import { ProphetModel } from './models/prophet.model';
import { SeasonalNaiveModel } from './models/seasonal-naive.model';
import { TrendPercentModel } from './models/trend-percent.model';
import { WeightedAverageModel } from './models/weighted-average.model';
import { YoYGrowthModel } from './models/yoy-growth.model';

/**
 * Registry for all available forecast models
 * Implements a plugin architecture for easy extensibility
 */
@Injectable()
export class ForecastModelRegistry implements OnModuleInit {
  private readonly logger = new Logger(ForecastModelRegistry.name);
  private readonly models = new Map<string, IForecastModel>();

  private readonly modelClasses = [
    MovingAverageModel,
    WeightedAverageModel,
    LinearRegressionModel,
    HoltWintersModel,
    SeasonalNaiveModel,
    YoYGrowthModel,
    TrendPercentModel,
    AIHybridModel,
    ArimaModel,
    ProphetModel,
  ];

  constructor(private readonly moduleRef: ModuleRef) {}

  async onModuleInit() {
    // Register all models on startup
    for (const ModelClass of this.modelClasses) {
      try {
        const model = await this.moduleRef.create(ModelClass as any);
        this.register(model);
      } catch (error: any) {
        this.logger.error(`Failed to register model ${ModelClass.name}: ${error.message}`);
      }
    }

    this.logger.log(`Registered ${this.models.size} forecast models`);
  }

  /**
   * Register a new forecast model
   */
  register(model: IForecastModel): void {
    if (this.models.has(model.name)) {
      this.logger.warn(`Model ${model.name} is being overwritten`);
    }
    this.models.set(model.name, model);
    this.logger.log(`Registered forecast model: ${model.name}`);
  }

  /**
   * Get a model by name
   */
  get(name: string): IForecastModel | undefined {
    return this.models.get(name);
  }

  /**
   * Get all registered models
   */
  getAll(): IForecastModel[] {
    return Array.from(this.models.values());
  }

  /**
   * Get all model names
   */
  getModelNames(): string[] {
    return Array.from(this.models.keys());
  }

  /**
   * Check if a model is registered
   */
  has(name: string): boolean {
    return this.models.has(name);
  }

  /**
   * Get model metadata for UI display
   */
  getModelMetadata(): Array<{
    name: string;
    version: string;
    displayName: string;
    description: string;
    minDataPoints: number;
    supportsSeasonality: boolean;
    defaultParameters: Record<string, any>;
  }> {
    return this.getAll().map((model) => ({
      name: model.name,
      version: model.version,
      displayName: model.displayName,
      description: model.description,
      minDataPoints: model.minDataPoints,
      supportsSeasonality: model.supportsSeasonality,
      defaultParameters: model.defaultParameters,
    }));
  }

  /**
   * Recommend models based on data characteristics
   */
  recommendModels(dataCharacteristics: {
    dataPoints: number;
    hasSeasonality: boolean;
    hasTrend: boolean;
    volatility: 'low' | 'medium' | 'high';
  }): string[] {
    const recommended: string[] = [];

    for (const model of this.models.values()) {
      // Check minimum data points
      if (dataCharacteristics.dataPoints < model.minDataPoints) {
        continue;
      }

      // Recommend based on characteristics
      if (dataCharacteristics.hasSeasonality && model.supportsSeasonality) {
        recommended.push(model.name);
      } else if (!dataCharacteristics.hasSeasonality) {
        if (model.name === 'MOVING_AVERAGE' || model.name === 'LINEAR_REGRESSION') {
          recommended.push(model.name);
        }
      }
    }

    // Always include AI hybrid as an option
    if (this.has('AI_HYBRID')) {
      recommended.push('AI_HYBRID');
    }

    return [...new Set(recommended)];
  }
}
