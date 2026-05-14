import { Global, Module } from '@nestjs/common';
import { DatabaseModule } from '../database/database.module';
import { WorkflowService } from './workflow.service';

@Global()
@Module({
  imports: [DatabaseModule],
  providers: [WorkflowService],
  exports: [WorkflowService],
})
export class WorkflowModule {}
