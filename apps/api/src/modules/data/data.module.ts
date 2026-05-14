import { Module } from '@nestjs/common';
import { MulterModule } from '@nestjs/platform-express';
import { DatabaseModule } from '../../core/database/database.module';
import { DataController } from './data.controller';
import { DataService } from './data.service';

@Module({
  imports: [
    DatabaseModule,
    MulterModule.register({
      limits: {
        fileSize: 50 * 1024 * 1024, // 50MB max
      },
    }),
  ],
  controllers: [DataController],
  providers: [DataService],
  exports: [DataService],
})
export class DataModule {}
