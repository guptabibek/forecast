import { BullModule } from '@nestjs/bullmq';
import { DynamicModule, Global, Logger, Module } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { ForecastEngineModule } from '../../forecast-engine/forecast-engine.module';
import { DatabaseModule } from '../database/database.module';
import { isRedisConfigured, resolveRedisOptions } from '../redis/redis-config.util';
import { ForecastQueueProcessor } from './processors/forecast.processor';
import { ImportQueueProcessor } from './processors/import.processor';
import { QUEUE_NAMES } from './queue.constants';

// Re-export for backward compatibility
export { isRedisConfigured } from '../redis/redis-config.util';
export { QUEUE_NAMES } from './queue.constants';

const logger = new Logger('QueueModule');

@Global()
@Module({})
export class QueueModule {
  static register(): DynamicModule {
    if (!isRedisConfigured()) {
      logger.warn(
        'REDIS_URL not set — background queues disabled. ' +
        'Forecast runs, data imports, and Marg sync require Redis.',
      );
      return { module: QueueModule, global: true };
    }

    return {
      module: QueueModule,
      global: true,
      imports: [
        DatabaseModule,
        ForecastEngineModule,
        BullModule.forRootAsync({
          inject: [ConfigService],
          useFactory: (configService: ConfigService) => ({
            connection: resolveRedisOptions(configService),
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
          { name: QUEUE_NAMES.MARG_SYNC },
        ),
      ],
      providers: [ForecastQueueProcessor, ImportQueueProcessor],
      exports: [BullModule],
    };
  }
}
