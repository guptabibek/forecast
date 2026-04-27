import { Module } from '@nestjs/common';
import { ProcurementReportsService } from '../pharma-reports/services';
import { ReportsController } from './reports.controller';
import { ReportsService } from './reports.service';

@Module({
  controllers: [ReportsController],
  providers: [ReportsService, ProcurementReportsService],
  exports: [ReportsService],
})
export class ReportsModule {}
