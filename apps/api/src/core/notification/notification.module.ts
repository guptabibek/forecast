import { Global, Module } from '@nestjs/common';
import { DatabaseModule } from '../database/database.module';
import { EmailService } from './email.service';
import { NotificationService } from './notification.service';

@Global()
@Module({
  imports: [DatabaseModule],
  providers: [NotificationService, EmailService],
  exports: [NotificationService, EmailService],
})
export class NotificationModule {}
