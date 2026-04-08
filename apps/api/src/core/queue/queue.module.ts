import { Global, Module } from '@nestjs/common';
import { BullModule } from '@nestjs/bullmq';
import { ConfigService } from '@nestjs/config';
import { ForecastQueueProcessor } from './processors/forecast.processor';
import { ImportQueueProcessor } from './processors/import.processor';
import { QUEUE_NAMES } from './queue.constants';
import { ForecastEngineModule } from '../../forecast-engine/forecast-engine.module';
import { DatabaseModule } from '../database/database.module';

// Re-export for backward compatibility
export { QUEUE_NAMES } from './queue.constants';

@Global()
@Module({
  imports: [
    DatabaseModule,
    ForecastEngineModule,
    BullModule.forRootAsync({
      inject: [ConfigService],
      useFactory: (configService: ConfigService) => ({
        connection: {
          host: configService.get<string>('REDIS_HOST', 'localhost'),
          port: configService.get<number>('REDIS_PORT', 6379),
          password: configService.get<string>('REDIS_PASSWORD'),
        },
        defaultJobOptions: {
          attempts: 3,
          backoff: {
            type: 'exponential',
            delay: 1000,
          },
          removeOnComplete: {
            age: 3600, // Keep completed jobs for 1 hour
            count: 1000,
          },
          removeOnFail: {
            age: 86400, // Keep failed jobs for 24 hours
          },
        },
      }),
    }),
    BullModule.registerQueue(
      { name: QUEUE_NAMES.FORECAST },
      { name: QUEUE_NAMES.IMPORT },
      { name: QUEUE_NAMES.EXPORT },
      { name: QUEUE_NAMES.NOTIFICATION },
    ),
  ],
  providers: [ForecastQueueProcessor, ImportQueueProcessor],
  exports: [BullModule],
})
export class QueueModule {}
