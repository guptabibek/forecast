import { Global, Module } from '@nestjs/common';
import { DatabaseModule } from '../database/database.module';
import { FxRateService } from './fx-rate.service';

@Global()
@Module({
  imports: [DatabaseModule],
  providers: [FxRateService],
  exports: [FxRateService],
})
export class FxRateModule {}
