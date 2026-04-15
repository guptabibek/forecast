import { Module } from '@nestjs/common';
import { DatabaseModule } from '../../core/database/database.module';
import { MargEdeController } from './marg-ede.controller';
import { MargEdeService } from './marg-ede.service';
import { MargSyncProcessor } from './marg-sync.processor';
import { MargSyncScheduler } from './marg-sync.scheduler';

@Module({
  imports: [DatabaseModule],
  controllers: [MargEdeController],
  providers: [MargEdeService, MargSyncProcessor, MargSyncScheduler],
  exports: [MargEdeService],
})
export class MargEdeModule {}
