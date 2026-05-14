import { Injectable, Logger } from '@nestjs/common';
import { Cron, CronExpression } from '@nestjs/schedule';
import { PdfShareService } from './services/pdf-share.service';

@Injectable()
export class PdfCleanupScheduler {
  private readonly logger = new Logger(PdfCleanupScheduler.name);

  constructor(private readonly pdfShare: PdfShareService) {}

  @Cron(CronExpression.EVERY_6_HOURS)
  handleCleanup() {
    this.logger.log('Running expired PDF cleanup...');
    this.pdfShare.cleanExpiredFiles();
  }
}
