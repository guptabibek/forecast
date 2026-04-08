import { Module } from '@nestjs/common';
import { BullModule } from '@nestjs/bullmq';
import { ForecastsController } from './forecasts.controller';
import { ForecastsService } from './forecasts.service';
import { DatabaseModule } from '../../core/database/database.module';
import { ForecastEngineModule } from '../../forecast-engine/forecast-engine.module';
import { QUEUE_NAMES } from '../../core/queue/queue.module';

@Module({
  imports: [
    DatabaseModule,
    ForecastEngineModule,
    BullModule.registerQueue({
      name: QUEUE_NAMES.FORECAST,
    }),
  ],
  controllers: [ForecastsController],
  providers: [ForecastsService],
  exports: [ForecastsService],
})
export class ForecastsModule {}
