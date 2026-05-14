import { Module } from '@nestjs/common';
import { DatabaseModule } from '../../core/database/database.module';
import { ForecastEngineModule } from '../../forecast-engine/forecast-engine.module';
import { ForecastsController } from './forecasts.controller';
import { ForecastsService } from './forecasts.service';

@Module({
  imports: [
    DatabaseModule,
    ForecastEngineModule,
  ],
  controllers: [ForecastsController],
  providers: [ForecastsService],
  exports: [ForecastsService],
})
export class ForecastsModule {}
