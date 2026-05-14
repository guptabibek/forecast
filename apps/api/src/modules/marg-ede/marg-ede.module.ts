import { BullModule } from '@nestjs/bullmq';
import { Module } from '@nestjs/common';
import { DatabaseModule } from '../../core/database/database.module';
import { QUEUE_NAMES } from '../../core/queue/queue.constants';
import { isRedisConfigured } from '../../core/queue/queue.module';
import { ManufacturingModule } from '../manufacturing/manufacturing.module';
import { MargEdeController } from './marg-ede.controller';
import { MargEdeService } from './marg-ede.service';
import { MargSyncProcessor } from './marg-sync.processor';
import { MargSyncScheduler } from './marg-sync.scheduler';

// MargSyncProcessor extends BullMQ WorkerHost — only register when Redis is available
const providers = isRedisConfigured()
  ? [MargEdeService, MargSyncProcessor, MargSyncScheduler]
  : [MargEdeService, MargSyncScheduler];

const imports = isRedisConfigured()
  ? [DatabaseModule, ManufacturingModule, BullModule.registerQueue({ name: QUEUE_NAMES.MARG_SYNC })]
  : [DatabaseModule, ManufacturingModule];

@Module({
  imports,
  controllers: [MargEdeController],
  providers,
  exports: [MargEdeService],
})
export class MargEdeModule {}
