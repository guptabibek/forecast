import { Module } from '@nestjs/common';
import { PharmaReportsController } from './pharma-reports.controller';
import {
    DashboardKpiService,
    ExpiryReportsService,
    InventoryAlertsService,
    InventoryReportsService,
    ProcurementReportsService,
    ReportExportService,
    StockAnalysisService,
} from './services';

@Module({
  controllers: [PharmaReportsController],
  providers: [
    InventoryReportsService,
    ExpiryReportsService,
    StockAnalysisService,
    ProcurementReportsService,
    DashboardKpiService,
    InventoryAlertsService,
    ReportExportService,
  ],
  exports: [
    InventoryReportsService,
    ExpiryReportsService,
    StockAnalysisService,
    ProcurementReportsService,
    DashboardKpiService,
    InventoryAlertsService,
    ReportExportService,
  ],
})
export class PharmaReportsModule {}
