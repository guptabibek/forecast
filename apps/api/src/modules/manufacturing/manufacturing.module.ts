import { Module } from '@nestjs/common';
import { DatabaseModule } from '../../core/database/database.module';
import { WorkflowModule } from '../../core/workflow/workflow.module';
import { ManufacturingController } from './manufacturing.controller';
import { ManufacturingService } from './manufacturing.service';
import { ProductionBranchController } from './production/production-branch.controller';
import { ProductionBranchService } from './production/production-branch.service';
import { AccountingService } from './services/accounting.service';
import { CostingEngineService } from './services/costing-engine.service';
import { CostingService } from './services/costing.service';
import { IdempotencyService } from './services/idempotency.service';
import { InventoryLedgerService } from './services/inventory-ledger.service';
import { QualityService } from './services/quality.service';
import { SequenceService } from './services/sequence.service';

/**
 * Manufacturing Module
 *
 * Provides enterprise manufacturing capabilities including:
 * - Bill of Materials (BOM) management
 * - MRP (Material Requirements Planning)
 * - Capacity Planning
 * - Inventory Optimization
 * - Work centers and routing
 * - S&OP planning
 * - Inventory Ledger (append-only, concurrency-safe)
 * - General Ledger / Double-entry Accounting
 * - Quality Management (Inspection Plans, NCR, CAPA)
 * - Standard / Actual Costing & Variance Analysis
 * - Enterprise Costing Engine (FIFO/LIFO/MA/Standard/Job)
 * - Document Number Sequences (concurrency-safe)
 */
@Module({
  imports: [DatabaseModule, WorkflowModule],
  controllers: [ManufacturingController, ProductionBranchController],
  providers: [
    ManufacturingService,
    ProductionBranchService,
    SequenceService,
    InventoryLedgerService,
    AccountingService,
    QualityService,
    CostingService,
    CostingEngineService,
    IdempotencyService,
  ],
  exports: [
    ManufacturingService,
    ProductionBranchService,
    SequenceService,
    InventoryLedgerService,
    AccountingService,
    QualityService,
    CostingService,
    CostingEngineService,
    IdempotencyService,
  ],
})
export class ManufacturingModule {}

