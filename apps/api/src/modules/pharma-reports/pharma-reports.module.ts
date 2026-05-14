import { Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { MargEdeModule } from '../marg-ede/marg-ede.module';
import { PharmaReportsController } from './pharma-reports.controller';
import { SharedPdfController } from './shared-pdf.controller';
import { PdfCleanupScheduler } from './pdf-cleanup.scheduler';
import {
    AccountingReportsService,
    DashboardKpiService,
    ExpiryReportsService,
    InventoryAlertsService,
    InventoryReportsService,
    ProcurementReportsService,
    ReportExportService,
    SalesPurchaseAnalysisService,
    StockAnalysisService,
    ThreeSixtyReportsService,
} from './services';
import { PdfShareService } from './services/pdf-share.service';

@Module({
  imports: [MargEdeModule, ConfigModule],
  controllers: [PharmaReportsController, SharedPdfController],
  providers: [
    AccountingReportsService,
    InventoryReportsService,
    ExpiryReportsService,
    StockAnalysisService,
    ProcurementReportsService,
    DashboardKpiService,
    InventoryAlertsService,
    ReportExportService,
    SalesPurchaseAnalysisService,
    ThreeSixtyReportsService,
    PdfShareService,
    PdfCleanupScheduler,
  ],
  exports: [
    AccountingReportsService,
    InventoryReportsService,
    ExpiryReportsService,
    StockAnalysisService,
    ProcurementReportsService,
    DashboardKpiService,
    InventoryAlertsService,
    ReportExportService,
    SalesPurchaseAnalysisService,
    ThreeSixtyReportsService,
  ],
})
export class PharmaReportsModule {}
