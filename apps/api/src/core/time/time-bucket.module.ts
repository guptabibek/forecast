import { Global, Module } from '@nestjs/common';
import { DatabaseModule } from '../database/database.module';
import { TimeBucketService } from './time-bucket.service';

@Global()
@Module({
  imports: [DatabaseModule],
  providers: [TimeBucketService],
  exports: [TimeBucketService],
})
export class TimeBucketModule {}
