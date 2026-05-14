import { Module } from '@nestjs/common';
import { ProcurementReportsService } from '../pharma-reports/services';
import { ReportsController } from './reports.controller';
import { ReportsManagementService } from './reports-management.service';
import { ReportsService } from './reports.service';

@Module({
  controllers: [ReportsController],
  providers: [ReportsService, ReportsManagementService, ProcurementReportsService],
  exports: [ReportsService, ReportsManagementService],
})
export class ReportsModule {}
