import { Module } from '@nestjs/common';
import { DatabaseModule } from '../../core/database/database.module';
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

@Module({
  imports: [DatabaseModule, ManufacturingModule],
  controllers: [MargEdeController],
  providers,
  exports: [MargEdeService],
})
export class MargEdeModule {}
