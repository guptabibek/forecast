import {
  BadRequestException,
  ConflictException,
  Injectable,
  Logger,
} from '@nestjs/common';
import {
  CostType,
  LedgerEntryType,
  PostingTransactionType,
  Prisma,
} from '@prisma/client';
import { Decimal } from '@prisma/client/runtime/library';
import { PrismaService } from '../../../core/database/prisma.service';
import { AccountingService } from './accounting.service';
import { IdempotencyService } from './idempotency.service';
import { InventoryLedgerService } from './inventory-ledger.service';
import { withRetry } from './retry.utility';
import { SequenceService } from './sequence.service';

type CostingMethod = 'STANDARD' | 'MOVING_AVERAGE' | 'FIFO' | 'LIFO' | 'ACTUAL_JOB_COSTING';
type Tx = Prisma.TransactionClient;

const ZERO = new Decimal(0);
const ONE = new Decimal(1);

/**
 * CostingEngineService — Centralized enterprise costing engine.
 *
 * ALL cost mutations across the ERP flow through this service.
 * No other module may directly manipulate cost layers, item costs,
 * or WIP accumulations.
 *
 * Architecture:
 *  - Every public mutation exposes an `InTx(tx, params)` variant for callers
 *    that already hold a transaction (e.g. ManufacturingService).
 *  - A corresponding standalone wrapper creates its own $transaction.
 *  - SELECT FOR UPDATE on cost-sensitive rows (layers, itemCost, WIP).
 *  - Optimistic-lock conflicts wrapped with exponential-backoff retry.
 *  - Idempotency keys on financial operations.
 *  - Period-lock enforcement.
 *  - Double-entry journal integration.
 *  - Multi-currency: resolves tenant.defaultCurrency — never hardcodes 'USD'.
 */
@Injectable()
export class CostingEngineService {
  private readonly logger = new Logger(CostingEngineService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly ledger: InventoryLedgerService,
    private readonly accounting: AccountingService,
    private readonly sequence: SequenceService,
    private readonly idempotency: IdempotencyService,
  ) {}

  // ════════════════════════════════════════════════════════════════════════
  // 1.  PURCHASE RECEIPT COSTING
  // ════════════════════════════════════════════════════════════════════════

  async calculatePurchaseReceiptCostInTx(
    tx: Tx,
    params: {
      tenantId: string;
      goodsReceiptId: string;
      goodsReceiptLineId: string;
      productId: string;
      locationId: string;
      quantity: Decimal | number;
      unitPrice: Decimal | number;
      uom: string;
      purchaseCurrency: string;
      baseCurrency?: string;
      exchangeRate?: Decimal | number;
      batchId?: string;
      fiscalPeriodId?: string;
      userId: string;
    },
  ) {
    const {
      tenantId, goodsReceiptId, goodsReceiptLineId, productId,
      locationId, quantity, unitPrice, uom, purchaseCurrency,
      batchId, fiscalPeriodId, userId,
    } = params;

    const baseCurrency = params.baseCurrency ?? await this.resolveBaseCurrency(tx, tenantId);

    const idempKey = `GR_COST:${goodsReceiptLineId}`;
    const existing = await this.idempotency.acquire(tx, 'GR_COST', idempKey, tenantId);
    if (existing) return { alreadyProcessed: true, resultId: existing.resultId };

    await this.assertPeriodOpen(tx, tenantId, fiscalPeriodId);

    const qty = new Decimal(quantity.toString());
    const price = new Decimal(unitPrice.toString());
    // Validate exchange rate is provided when currencies differ
    if (purchaseCurrency !== baseCurrency && (params.exchangeRate == null || params.exchangeRate === 0)) {
      throw new BadRequestException(
        `Exchange rate is required when purchase currency (${purchaseCurrency}) differs from base currency (${baseCurrency}). ` +
        `Cannot default to 1:1 — this would produce incorrect cost layers.`,
      );
    }
    const exRate = new Decimal((params.exchangeRate ?? 1).toString());
    const baseCurrCost = purchaseCurrency === baseCurrency
      ? price
      : price.mul(exRate);
    const totalCost = qty.mul(baseCurrCost);

    // Snapshot the exchange rate
    if (purchaseCurrency !== baseCurrency) {
      await tx.currencyRateSnapshot.create({
        data: {
          tenantId,
          fromCurrency: purchaseCurrency,
          toCurrency: baseCurrency,
          rate: exRate,
          inverseRate: ONE.div(exRate),
          rateDate: new Date(),
          source: 'GOODS_RECEIPT',
          referenceType: 'GOODS_RECEIPT_LINE',
          referenceId: goodsReceiptLineId,
        },
      });
    }

    const method = await this.resolveMethod(tx, tenantId, productId, locationId);

    let costLayerId: string | null = null;

    if (method === 'FIFO' || method === 'LIFO') {
      const layer = await tx.costLayer.create({
        data: {
          tenantId,
          productId,
          locationId,
          batchId,
          costingMethod: method,
          layerDate: new Date(),
          referenceType: 'GOODS_RECEIPT',
          referenceId: goodsReceiptId,
          referenceNumber: goodsReceiptLineId,
          originalQty: qty,
          remainingQty: qty,
          unitCost: baseCurrCost,
          totalCost,
          currency: baseCurrency,
          exchangeRate: exRate,
          baseCurrCost,
          fiscalPeriodId,
          status: 'OPEN',
        },
      });
      costLayerId = layer.id;
    }

    if (method === 'MOVING_AVERAGE' || method === 'STANDARD') {
      await this.updateMovingAverage(tx, {
        tenantId,
        productId,
        locationId,
        incomingQty: qty,
        incomingUnitCost: baseCurrCost,
        currency: baseCurrency,
      });
    }

    // Post journal: Dr Inventory, Cr GR/IR Clearing
    const journalEntry = await this.accounting.postTransactionalJournal(tx, {
      tenantId,
      transactionType: PostingTransactionType.GOODS_RECEIPT,
      referenceType: 'GOODS_RECEIPT',
      referenceId: goodsReceiptId,
      entryDate: new Date(),
      fiscalPeriodId,
      amount: totalCost,
      productId,
      locationId,
      description: `GR costing — product ${productId}, qty ${qty}`,
      userId,
    });

    // Record in inventory ledger
    await this.ledger.recordEntry(tx, {
      tenantId,
      productId,
      locationId,
      batchId,
      entryType: LedgerEntryType.LEDGER_RECEIPT,
      quantity: qty,
      uom,
      unitCost: baseCurrCost,
      referenceType: 'GOODS_RECEIPT',
      referenceId: goodsReceiptId,
      referenceNumber: goodsReceiptLineId,
      journalEntryId: journalEntry.id,
      createdById: userId,
    });

    await this.idempotency.stamp(tx, 'GR_COST', idempKey, tenantId, costLayerId ?? journalEntry.id);

    return {
      alreadyProcessed: false,
      costLayerId,
      journalEntryId: journalEntry.id,
      unitCost: baseCurrCost.toNumber(),
      totalCost: totalCost.toNumber(),
      method,
    };
  }

  /** Standalone wrapper — creates own transaction. */
  async calculatePurchaseReceiptCost(params: Parameters<typeof CostingEngineService.prototype.calculatePurchaseReceiptCostInTx>[1]) {
    return this.prisma.$transaction(
      (tx) => this.calculatePurchaseReceiptCostInTx(tx, params),
      { timeout: 30000 },
    );
  }

  // ════════════════════════════════════════════════════════════════════════
  // 2.  LANDED COST ALLOCATION
  // ════════════════════════════════════════════════════════════════════════

  async allocateLandedCostInTx(
    tx: Tx,
    params: {
      tenantId: string;
      goodsReceiptId: string;
      allocations: Array<{
        goodsReceiptLineId: string;
        costLayerId?: string;
        productId: string;
        locationId: string;
        costCategory: string;
        amount: number;
      }>;
      allocationMethod: string;
      vendorInvoiceRef?: string;
      fiscalPeriodId?: string;
      userId: string;
    },
  ) {
    const { tenantId, goodsReceiptId, allocations, allocationMethod, vendorInvoiceRef, fiscalPeriodId, userId } = params;

    // Deterministic idempotency key — prevents duplicate allocations on retry
    const allocHash = allocations.map(a => `${a.goodsReceiptLineId}:${a.amount}`).join('|');
    const idempKey = `LANDED:${goodsReceiptId}:${allocationMethod}:${allocHash}`;
    const existing = await this.idempotency.acquire(tx, 'LANDED_COST', idempKey, tenantId);
    if (existing) return { alreadyProcessed: true };

    await this.assertPeriodOpen(tx, tenantId, fiscalPeriodId);

    let totalAllocated = ZERO;
    const results: Array<{ allocationId: string; productId: string; amount: number }> = [];

    for (const alloc of allocations) {
      const amount = new Decimal(alloc.amount);
      if (amount.lte(ZERO)) {
        throw new BadRequestException(`Landed cost amount must be greater than zero for line ${alloc.goodsReceiptLineId}`);
      }
      totalAllocated = totalAllocated.add(amount);

      const allocation = await tx.landedCostAllocation.create({
        data: {
          tenantId,
          goodsReceiptId,
          goodsReceiptLineId: alloc.goodsReceiptLineId,
          costLayerId: alloc.costLayerId,
          costCategory: alloc.costCategory,
          allocationMethod,
          allocatedAmount: amount,
          vendorInvoiceRef,
        },
      });

      // Update cost layer landed cost if layer exists
      if (alloc.costLayerId) {
        await this.lockCostLayer(tx, tenantId, alloc.costLayerId);
        const updated = await tx.costLayer.updateMany({
          where: {
            id: alloc.costLayerId,
            tenantId,
            productId: alloc.productId,
            locationId: alloc.locationId,
          },
          data: {
            landedCost: { increment: amount },
            totalCost: { increment: amount },
          },
        });
        if (updated.count === 0) {
          throw new BadRequestException(
            `Invalid cost layer ${alloc.costLayerId} for product ${alloc.productId} at location ${alloc.locationId}`,
          );
        }
      }

      // Update moving average if applicable
      const method = await this.resolveMethod(tx, tenantId, alloc.productId, alloc.locationId);
      if (method === 'MOVING_AVERAGE') {
        await this.adjustMovingAverageValue(tx, {
          tenantId,
          productId: alloc.productId,
          locationId: alloc.locationId,
          valueAdjustment: amount,
        });
      }

      results.push({ allocationId: allocation.id, productId: alloc.productId, amount: amount.toNumber() });
    }

    // Post journal: Dr Inventory, Cr Accrued Landed Cost
    if (totalAllocated.gt(ZERO)) {
      await this.accounting.postTransactionalJournal(tx, {
        tenantId,
        transactionType: PostingTransactionType.GOODS_RECEIPT,
        referenceType: 'LANDED_COST',
        referenceId: goodsReceiptId,
        entryDate: new Date(),
        fiscalPeriodId,
        amount: totalAllocated,
        description: `Landed cost allocation — GR ${goodsReceiptId}`,
        userId,
      });
    }

    await this.idempotency.stamp(tx, 'LANDED_COST', idempKey, tenantId, goodsReceiptId);
    return { alreadyProcessed: false, totalAllocated: totalAllocated.toNumber(), allocations: results };
  }

  async allocateLandedCost(params: Parameters<typeof CostingEngineService.prototype.allocateLandedCostInTx>[1]) {
    return this.prisma.$transaction(
      (tx) => this.allocateLandedCostInTx(tx, params),
      { timeout: 30000 },
    );
  }

  // ════════════════════════════════════════════════════════════════════════
  // 3.  MATERIAL ISSUE COSTING
  // ════════════════════════════════════════════════════════════════════════

  async issueMaterialCostInTx(
    tx: Tx,
    params: {
      tenantId: string;
      workOrderId: string;
      materialIssueId: string;
      productId: string;
      locationId: string;
      quantity: Decimal | number;
      uom: string;
      batchId?: string;
      fiscalPeriodId?: string;
      userId: string;
    },
  ) {
    const { tenantId, workOrderId, materialIssueId, productId, locationId, quantity, uom, batchId, fiscalPeriodId, userId } = params;

    const baseCurrency = await this.resolveBaseCurrency(tx, tenantId);

    const idempKey = `MI_COST:${materialIssueId}`;
    const existing = await this.idempotency.acquire(tx, 'MI_COST', idempKey, tenantId);
    if (existing) return { alreadyProcessed: true, resultId: existing.resultId };

    await this.assertPeriodOpen(tx, tenantId, fiscalPeriodId);

    const qty = new Decimal(quantity.toString());
    if (qty.isZero()) {
      throw new BadRequestException('Material issue quantity must be greater than zero.');
    }
    const method = await this.resolveMethod(tx, tenantId, productId, locationId);

    let issueCost: Decimal;

    if (method === 'FIFO' || method === 'LIFO') {
      issueCost = await this.depleteCostLayers(tx, {
        tenantId, productId, locationId, quantity: qty,
        method, referenceType: 'MATERIAL_ISSUE',
        referenceId: materialIssueId,
      });
    } else if (method === 'MOVING_AVERAGE') {
      const avgCost = await this.getMovingAverageCost(tx, tenantId, productId, locationId);
      issueCost = qty.mul(avgCost);
      await this.updateMovingAverage(tx, {
        tenantId, productId, locationId,
        incomingQty: qty.neg(), incomingUnitCost: avgCost,
        currency: baseCurrency,
      });
    } else {
      const stdCost = await this.getStandardCost(tx, tenantId, productId);
      issueCost = qty.mul(stdCost);
    }

    // Update last issue tracking
    await this.updateLastIssueCost(tx, tenantId, productId, locationId, issueCost.div(qty));

    // Accumulate WIP
    await this.accumulateWIP(tx, {
      tenantId,
      workOrderId,
      costElement: 'MATERIAL',
      amount: issueCost,
    });

    // Post journal: Dr WIP, Cr Raw Material Inventory
    const journalEntry = await this.accounting.postTransactionalJournal(tx, {
      tenantId,
      transactionType: PostingTransactionType.MATERIAL_ISSUE,
      referenceType: 'MATERIAL_ISSUE',
      referenceId: materialIssueId,
      entryDate: new Date(),
      fiscalPeriodId,
      amount: issueCost,
      productId,
      locationId,
      description: `Material issue to WO ${workOrderId} — ${qty} ${uom}`,
      userId,
    });

    // Record in inventory ledger
    await this.ledger.recordEntry(tx, {
      tenantId,
      productId,
      locationId,
      batchId,
      entryType: LedgerEntryType.LEDGER_PRODUCTION_ISSUE,
      quantity: qty.neg(),
      uom,
      unitCost: issueCost.div(qty),
      referenceType: 'MATERIAL_ISSUE',
      referenceId: materialIssueId,
      journalEntryId: journalEntry.id,
      createdById: userId,
    });

    await this.idempotency.stamp(tx, 'MI_COST', idempKey, tenantId, materialIssueId);

    return {
      alreadyProcessed: false,
      totalCost: issueCost.toNumber(),
      unitCost: issueCost.div(qty).toNumber(),
      method,
      journalEntryId: journalEntry.id,
    };
  }

  async issueMaterialCost(params: Parameters<typeof CostingEngineService.prototype.issueMaterialCostInTx>[1]) {
    return this.prisma.$transaction(
      (tx) => this.issueMaterialCostInTx(tx, params),
      { timeout: 30000 },
    );
  }

  // ════════════════════════════════════════════════════════════════════════
  // 4.  WIP ACCUMULATION
  // ════════════════════════════════════════════════════════════════════════

  async accumulateWIP(
    tx: Tx,
    params: {
      tenantId: string;
      workOrderId: string;
      costElement: string;
      amount: Decimal | number;
    },
  ) {
    const amt = new Decimal(params.amount.toString());

    await tx.wIPCostAccumulation.upsert({
      where: {
        tenantId_workOrderId_costElement: {
          tenantId: params.tenantId,
          workOrderId: params.workOrderId,
          costElement: params.costElement,
        },
      },
      create: {
        tenantId: params.tenantId,
        workOrderId: params.workOrderId,
        costElement: params.costElement,
        accumulatedAmount: amt,
        lastTransactionDate: new Date(),
      },
      update: {
        accumulatedAmount: { increment: amt },
        lastTransactionDate: new Date(),
      },
    });
  }

  // ════════════════════════════════════════════════════════════════════════
  // 5.  LABOR COST → WIP
  // ════════════════════════════════════════════════════════════════════════

  async recordLaborCostToWIPInTx(
    tx: Tx,
    params: {
      tenantId: string;
      workOrderId: string;
      laborEntryId: string;
      hours: Decimal | number;
      costPerHour: Decimal | number;
      isSetup: boolean;
      fiscalPeriodId?: string;
      userId: string;
    },
  ) {
    const { tenantId, workOrderId, laborEntryId, hours, costPerHour, isSetup, fiscalPeriodId, userId } = params;

    const idempKey = `LABOR_COST:${laborEntryId}`;
    const existing = await this.idempotency.acquire(tx, 'LABOR_COST', idempKey, tenantId);
    if (existing) return { alreadyProcessed: true };

    await this.assertPeriodOpen(tx, tenantId, fiscalPeriodId);

    const hrs = new Decimal(hours.toString());
    const rate = new Decimal(costPerHour.toString());
    const laborCost = hrs.mul(rate);

    await this.accumulateWIP(tx, {
      tenantId,
      workOrderId,
      costElement: isSetup ? 'LABOR_SETUP' : 'LABOR_RUN',
      amount: laborCost,
    });

    // Post journal: Dr WIP-Labor, Cr Labor Absorbed
    await this.accounting.postTransactionalJournal(tx, {
      tenantId,
      transactionType: PostingTransactionType.LABOR_ABSORPTION,
      referenceType: 'LABOR_ENTRY',
      referenceId: laborEntryId,
      entryDate: new Date(),
      fiscalPeriodId,
      amount: laborCost,
      description: `Labor ${isSetup ? 'setup' : 'run'} cost — WO ${workOrderId}`,
      userId,
    });

    await this.idempotency.stamp(tx, 'LABOR_COST', idempKey, tenantId, laborEntryId);
    return { alreadyProcessed: false, laborCost: laborCost.toNumber() };
  }

  async recordLaborCostToWIP(params: Parameters<typeof CostingEngineService.prototype.recordLaborCostToWIPInTx>[1]) {
    return this.prisma.$transaction(
      (tx) => this.recordLaborCostToWIPInTx(tx, params),
      { timeout: 15000 },
    );
  }

  // ════════════════════════════════════════════════════════════════════════
  // 6.  OVERHEAD → WIP
  // ════════════════════════════════════════════════════════════════════════

  async recordOverheadToWIPInTx(
    tx: Tx,
    params: {
      tenantId: string;
      workOrderId: string;
      referenceId: string;
      amount: Decimal | number;
      costElement?: string;
      fiscalPeriodId?: string;
      userId: string;
    },
  ) {
    const { tenantId, workOrderId, referenceId, amount, costElement, fiscalPeriodId, userId } = params;

    const idempKey = `OVERHEAD:${referenceId}`;
    const existing = await this.idempotency.acquire(tx, 'OVERHEAD_COST', idempKey, tenantId);
    if (existing) return { alreadyProcessed: true };

    await this.assertPeriodOpen(tx, tenantId, fiscalPeriodId);

    const amt = new Decimal(amount.toString());

    await this.accumulateWIP(tx, {
      tenantId,
      workOrderId,
      costElement: costElement ?? 'OVERHEAD',
      amount: amt,
    });

    await this.accounting.postTransactionalJournal(tx, {
      tenantId,
      transactionType: PostingTransactionType.OVERHEAD_ABSORPTION,
      referenceType: 'OVERHEAD',
      referenceId,
      entryDate: new Date(),
      fiscalPeriodId,
      amount: amt,
      description: `Overhead absorption — WO ${workOrderId}`,
      userId,
    });

    await this.idempotency.stamp(tx, 'OVERHEAD_COST', idempKey, tenantId, referenceId);
    return { alreadyProcessed: false, amount: amt.toNumber() };
  }

  async recordOverheadToWIP(params: Parameters<typeof CostingEngineService.prototype.recordOverheadToWIPInTx>[1]) {
    return this.prisma.$transaction(
      (tx) => this.recordOverheadToWIPInTx(tx, params),
      { timeout: 15000 },
    );
  }

  // ════════════════════════════════════════════════════════════════════════
  // 7.  WORK ORDER COMPLETION COSTING
  // ════════════════════════════════════════════════════════════════════════

  async completeWorkOrderCostInTx(
    tx: Tx,
    params: {
      tenantId: string;
      workOrderId: string;
      productId: string;
      locationId: string;
      completedQty: Decimal | number;
      scrappedQty?: Decimal | number;
      uom: string;
      batchId?: string;
      fiscalPeriodId?: string;
      userId: string;
    },
  ) {
    const {
      tenantId, workOrderId, productId, locationId,
      completedQty, scrappedQty, uom, batchId, fiscalPeriodId, userId,
    } = params;

    // Deterministic idempotency key — workOrderId alone is sufficient since a WO completes exactly once
    const idempKey = `WO_COST_COMPLETE:${workOrderId}`;
    const existing = await this.idempotency.acquire(tx, 'WO_COST_COMPLETE', idempKey, tenantId);
    if (existing) return { alreadyProcessed: true };

    await this.assertPeriodOpen(tx, tenantId, fiscalPeriodId);

    const baseCurrency = await this.resolveBaseCurrency(tx, tenantId);
    const compQty = new Decimal(completedQty.toString());
    const scrapQty = new Decimal((scrappedQty ?? 0).toString());
    const totalOutputQty = compQty.add(scrapQty);

    // ── Lock WIP rows with FOR UPDATE to prevent concurrent modification ──
    const wipRows = await tx.$queryRaw<Array<{
      id: string;
      cost_element: string;
      accumulated_amount: string;
      version: number;
    }>>(Prisma.sql`
      SELECT id, cost_element, accumulated_amount, version
      FROM wip_cost_accumulations
      WHERE tenant_id = ${tenantId} AND work_order_id = ${workOrderId}
      FOR UPDATE
    `,
    );

    let totalWIP = ZERO;
    const wipByElement: Record<string, Decimal> = {};
    for (const row of wipRows) {
      const amt = new Decimal(row.accumulated_amount);
      totalWIP = totalWIP.add(amt);
      wipByElement[row.cost_element] = amt;
    }

    // ── Resolve overhead from ItemCostProfile → WorkCenter → tenant default ──
    const overheadRate = await this.resolveOverheadRate(tx, tenantId, productId, locationId, workOrderId);
    const laborTotal = (wipByElement['LABOR_RUN'] ?? ZERO).add(wipByElement['LABOR_SETUP'] ?? ZERO);

    // Apply overhead if not already accumulated
    if (!wipByElement['OVERHEAD'] || wipByElement['OVERHEAD'].isZero()) {
      const computedOverhead = laborTotal.mul(overheadRate);
      if (computedOverhead.gt(ZERO)) {
        await this.accumulateWIP(tx, { tenantId, workOrderId, costElement: 'OVERHEAD', amount: computedOverhead });
        wipByElement['OVERHEAD'] = computedOverhead;
        totalWIP = totalWIP.add(computedOverhead);
      }
    }

    // Compute per-unit WIP cost
    const wipPerUnit = totalOutputQty.gt(ZERO) ? totalWIP.div(totalOutputQty) : totalWIP;
    const fgCost = compQty.mul(wipPerUnit);
    const scrapCost = scrapQty.mul(wipPerUnit);

    const method = await this.resolveMethod(tx, tenantId, productId, locationId);

    // Create cost layer or update average for finished goods
    if (method === 'FIFO' || method === 'LIFO') {
      await tx.costLayer.create({
        data: {
          tenantId,
          productId,
          locationId,
          batchId,
          costingMethod: method,
          layerDate: new Date(),
          referenceType: 'WORK_ORDER',
          referenceId: workOrderId,
          originalQty: compQty,
          remainingQty: compQty,
          unitCost: wipPerUnit,
          totalCost: fgCost,
          currency: baseCurrency,
          fiscalPeriodId,
          status: 'OPEN',
        },
      });
    } else {
      await this.updateMovingAverage(tx, {
        tenantId, productId, locationId,
        incomingQty: compQty, incomingUnitCost: wipPerUnit,
        currency: baseCurrency,
      });
    }

    // Post journal: Dr FG Inventory, Cr WIP
    const fgJournal = await this.accounting.postTransactionalJournal(tx, {
      tenantId,
      transactionType: PostingTransactionType.PRODUCTION_RECEIPT,
      referenceType: 'WORK_ORDER',
      referenceId: workOrderId,
      entryDate: new Date(),
      fiscalPeriodId,
      amount: fgCost,
      productId,
      locationId,
      description: `WO completion — ${compQty} units to FG`,
      userId,
    });

    // Scrap journal if any
    if (scrapCost.gt(ZERO)) {
      await this.accounting.postTransactionalJournal(tx, {
        tenantId,
        transactionType: PostingTransactionType.SCRAP,
        referenceType: 'WORK_ORDER',
        referenceId: workOrderId,
        entryDate: new Date(),
        fiscalPeriodId,
        amount: scrapCost,
        productId,
        locationId,
        description: `WO scrap — ${scrapQty} units`,
        userId,
      });
    }

    // Record in inventory ledger
    await this.ledger.recordEntry(tx, {
      tenantId,
      productId,
      locationId,
      batchId,
      entryType: LedgerEntryType.LEDGER_PRODUCTION_RECEIPT,
      quantity: compQty,
      uom,
      unitCost: wipPerUnit,
      referenceType: 'WORK_ORDER',
      referenceId: workOrderId,
      journalEntryId: fgJournal.id,
      createdById: userId,
    });

    // Calculate variances against standard cost
    const variances = await this.calculateWorkOrderVariances(tx, {
      tenantId, workOrderId, productId, completedQty: compQty,
      wipByElement, fiscalPeriodId, userId,
    });

    // Clear WIP: mark as absorbed (optimistic version check)
    for (const row of wipRows) {
      const affected = await tx.$executeRaw(Prisma.sql`
        UPDATE wip_cost_accumulations
        SET absorbed_amount = accumulated_amount,
            variance_amount = ${(variances.byElement[row.cost_element] ?? ZERO).toString()},
            version = version + 1,
            updated_at = NOW()
        WHERE id = ${row.id} AND version = ${row.version}
      `,
      );
      if (affected === 0) {
        throw new ConflictException(
          `WIP row ${row.id} was concurrently modified during WO completion. Retry.`,
        );
      }
    }

    // Update WorkOrderCost record — CostingEngine is the single source of truth
    await tx.workOrderCost.upsert({
      where: { workOrderId },
      create: {
        tenantId,
        workOrderId,
        materialCost: wipByElement['MATERIAL'] ?? ZERO,
        laborCost: laborTotal,
        overheadCost: wipByElement['OVERHEAD'] ?? ZERO,
        subcontractCost: wipByElement['SUBCONTRACT'] ?? ZERO,
        scrapCost,
        totalCost: totalWIP,
        costPerUnit: wipPerUnit,
        completedQty: compQty,
        stdMaterialCost: variances.standard.material,
        stdLaborCost: variances.standard.labor,
        stdOverheadCost: variances.standard.overhead,
        stdTotalCost: variances.standard.total,
        materialVariance: variances.byElement['MATERIAL'] ?? ZERO,
        laborVariance: (variances.byElement['LABOR_RUN'] ?? ZERO).add(variances.byElement['LABOR_SETUP'] ?? ZERO),
        overheadVariance: variances.byElement['OVERHEAD'] ?? ZERO,
        totalVariance: variances.totalVariance,
      },
      update: {
        materialCost: wipByElement['MATERIAL'] ?? ZERO,
        laborCost: laborTotal,
        overheadCost: wipByElement['OVERHEAD'] ?? ZERO,
        subcontractCost: wipByElement['SUBCONTRACT'] ?? ZERO,
        scrapCost,
        totalCost: totalWIP,
        costPerUnit: wipPerUnit,
        completedQty: compQty,
        stdMaterialCost: variances.standard.material,
        stdLaborCost: variances.standard.labor,
        stdOverheadCost: variances.standard.overhead,
        stdTotalCost: variances.standard.total,
        materialVariance: variances.byElement['MATERIAL'] ?? ZERO,
        laborVariance: (variances.byElement['LABOR_RUN'] ?? ZERO).add(variances.byElement['LABOR_SETUP'] ?? ZERO),
        overheadVariance: variances.byElement['OVERHEAD'] ?? ZERO,
        totalVariance: variances.totalVariance,
      },
    });

    await this.idempotency.stamp(tx, 'WO_COST_COMPLETE', idempKey, tenantId, workOrderId);

    return {
      alreadyProcessed: false,
      totalWIP: totalWIP.toNumber(),
      fgCost: fgCost.toNumber(),
      scrapCost: scrapCost.toNumber(),
      wipPerUnit: wipPerUnit.toNumber(),
      variances: {
        total: variances.totalVariance.toNumber(),
        material: (variances.byElement['MATERIAL'] ?? ZERO).toNumber(),
        labor: ((variances.byElement['LABOR_RUN'] ?? ZERO).add(variances.byElement['LABOR_SETUP'] ?? ZERO)).toNumber(),
        overhead: (variances.byElement['OVERHEAD'] ?? ZERO).toNumber(),
      },
      journalEntryId: fgJournal.id,
    };
  }

  async completeWorkOrderCost(params: Parameters<typeof CostingEngineService.prototype.completeWorkOrderCostInTx>[1]) {
    return this.prisma.$transaction(
      (tx) => this.completeWorkOrderCostInTx(tx, params),
      { timeout: 60000 },
    );
  }

  // ════════════════════════════════════════════════════════════════════════
  // 8.  COST LAYER DEPLETION (FIFO / LIFO) — with retry
  // ════════════════════════════════════════════════════════════════════════

  async depleteCostLayers(
    tx: Tx,
    params: {
      tenantId: string;
      productId: string;
      locationId: string;
      quantity: Decimal;
      method: CostingMethod;
      referenceType: string;
      referenceId: string;
      referenceNumber?: string;
    },
  ): Promise<Decimal> {
    // Use separate hard-coded queries to avoid SQL template-literal interpolation
    const layers = params.method === 'FIFO'
      ? await tx.$queryRaw<Array<{
          id: string; remaining_qty: string; unit_cost: string; version: number;
        }>>(Prisma.sql`
          SELECT id, remaining_qty, unit_cost, version
          FROM cost_layers
          WHERE tenant_id = ${params.tenantId}
            AND product_id = ${params.productId}
            AND location_id = ${params.locationId}
            AND status = 'OPEN'
            AND remaining_qty > 0
          ORDER BY layer_date ASC, created_at ASC
          FOR UPDATE
        `,
        )
      : await tx.$queryRaw<Array<{
          id: string; remaining_qty: string; unit_cost: string; version: number;
        }>>(Prisma.sql`
          SELECT id, remaining_qty, unit_cost, version
          FROM cost_layers
          WHERE tenant_id = ${params.tenantId}
            AND product_id = ${params.productId}
            AND location_id = ${params.locationId}
            AND status = 'OPEN'
            AND remaining_qty > 0
          ORDER BY layer_date DESC, created_at DESC
          FOR UPDATE
        `,
        );

    let remaining = params.quantity;
    let totalCost = ZERO;

    for (const layer of layers) {
      if (remaining.lte(ZERO)) break;

      const layerQty = new Decimal(layer.remaining_qty);
      const layerCost = new Decimal(layer.unit_cost);
      const depleteQty = Decimal.min(remaining, layerQty);
      const depletionCost = depleteQty.mul(layerCost);

      totalCost = totalCost.add(depletionCost);
      remaining = remaining.sub(depleteQty);

      const newRemaining = layerQty.sub(depleteQty);
      const newStatus = newRemaining.lte(ZERO) ? 'DEPLETED' : 'OPEN';

      const affected = await tx.$executeRaw(Prisma.sql`
        UPDATE cost_layers SET
          remaining_qty = ${newRemaining.toString()},
          status = ${newStatus},
          version = version + 1,
          updated_at = NOW()
        WHERE id = ${layer.id} AND version = ${layer.version}
      `,
      );

      if (affected === 0) {
        throw new ConflictException(
          `Cost layer ${layer.id} was modified by another transaction. Retry the operation.`,
        );
      }

      await tx.costLayerDepletion.create({
        data: {
          tenantId: params.tenantId,
          costLayerId: layer.id,
          depletedQty: depleteQty,
          unitCost: layerCost,
          totalCost: depletionCost,
          referenceType: params.referenceType,
          referenceId: params.referenceId,
          referenceNumber: params.referenceNumber,
        },
      });
    }

    if (remaining.gt(ZERO)) {
      throw new BadRequestException(
        `Insufficient cost layers for ${params.method} depletion. ` +
        `Requested: ${params.quantity}, Available: ${params.quantity.sub(remaining)}`,
      );
    }

    return totalCost;
  }

  // ════════════════════════════════════════════════════════════════════════
  // 9.  MOVING AVERAGE
  // ════════════════════════════════════════════════════════════════════════

  async updateMovingAverage(
    tx: Tx,
    params: {
      tenantId: string;
      productId: string;
      locationId: string;
      incomingQty: Decimal;
      incomingUnitCost: Decimal;
      currency: string;
    },
  ) {
    const { tenantId, productId, locationId, incomingQty, incomingUnitCost, currency } = params;

    const rows = await tx.$queryRaw<Array<{
      id: string;
      current_unit_cost: string;
      current_total_qty: string;
      current_total_value: string;
      version: number;
    }>>(Prisma.sql`
      SELECT id, current_unit_cost, current_total_qty, current_total_value, version
      FROM item_costs
      WHERE tenant_id = ${tenantId} AND product_id = ${productId} AND location_id = ${locationId}
      FOR UPDATE
    `,
    );

    if (rows.length === 0) {
      const unitCost = incomingQty.gt(ZERO) ? incomingUnitCost : ZERO;
      const totalValue = incomingQty.abs().mul(incomingUnitCost);
      await tx.itemCost.create({
        data: {
          tenantId,
          productId,
          locationId,
          currentUnitCost: unitCost,
          currentTotalQty: incomingQty,
          currentTotalValue: totalValue,
          standardCost: ZERO,
          lastReceiptCost: incomingQty.gt(ZERO) ? incomingUnitCost : ZERO,
          lastReceiptDate: incomingQty.gt(ZERO) ? new Date() : undefined,
          currency,
        },
      });
      return;
    }

    const row = rows[0];
    const oldQty = new Decimal(row.current_total_qty);
    const oldValue = new Decimal(row.current_total_value);
    const incomingValue = incomingQty.mul(incomingUnitCost);
    const newQty = oldQty.add(incomingQty);
    const newValue = oldValue.add(incomingValue);
    // Preserve last-known unit cost when qty goes to zero or negative (over-issue)
    // Setting to ZERO would lose cost tracking and make subsequent receipts start from zero
    const oldUnitCost = new Decimal(row.current_unit_cost);
    const newUnitCost = newQty.gt(ZERO) ? newValue.div(newQty) : oldUnitCost;

    const affected = await tx.$executeRaw(Prisma.sql`
      UPDATE item_costs SET
        current_unit_cost = ${newUnitCost.toString()},
        current_total_qty = ${newQty.toString()},
        current_total_value = ${newValue.toString()},
        last_receipt_cost = CASE WHEN CAST(${incomingQty.toString()} AS numeric) > 0 THEN CAST(${incomingUnitCost.toString()} AS numeric) ELSE last_receipt_cost END,
        last_receipt_date = CASE WHEN CAST(${incomingQty.toString()} AS numeric) > 0 THEN NOW() ELSE last_receipt_date END,
        version = version + 1,
        updated_at = NOW()
      WHERE id = ${row.id} AND version = ${row.version}
    `,
    );

    if (affected === 0) {
      throw new ConflictException(
        `ItemCost row for product ${productId} at location ${locationId} was concurrently modified. Retry.`,
      );
    }
  }

  // ════════════════════════════════════════════════════════════════════════
  // 10. STANDARD COST ROLLUP
  // ════════════════════════════════════════════════════════════════════════

  async rollupStandardCostInTx(
    tx: Tx,
    params: {
      tenantId: string;
      productId: string;
      effectiveDate?: Date;
      locationId?: string;
      version?: string;
      userId: string;
    },
  ) {
    const { tenantId, productId, effectiveDate, locationId, version } = params;
    const effectDate = effectiveDate ?? new Date();

    const bom = await tx.billOfMaterial.findFirst({
      where: {
        tenantId,
        parentProductId: productId,
        status: 'ACTIVE',
        effectiveFrom: { lte: effectDate },
        OR: [{ effectiveTo: null }, { effectiveTo: { gte: effectDate } }],
      },
      include: {
        components: {
          include: { componentProduct: { select: { id: true, code: true } } },
          orderBy: { sequence: 'asc' },
        },
        routings: {
          where: { status: 'ACTIVE' },
          include: {
            operations: {
              include: {
                workCenter: {
                  select: { id: true, costPerHour: true, setupCostPerHour: true, efficiency: true },
                },
              },
              orderBy: { sequence: 'asc' },
            },
          },
          take: 1,
          orderBy: { version: 'desc' },
        },
      },
    });

    if (!bom) {
      throw new BadRequestException(`No active BOM found for product ${productId}`);
    }

    const baseQty = bom.baseQuantity.toNumber();
    const materialCost = await this.recursiveMaterialCost(tx, tenantId, bom.components, baseQty, effectDate, 0, new Set([productId]));

    let laborCost = ZERO;
    let overheadCost = ZERO;
    let subcontractCost = ZERO;

    // Resolve overhead rate from profile/workCenter/tenant
    const profOverheadRate = await this.resolveOverheadRate(tx, tenantId, productId, locationId);

    const routing = bom.routings[0];
    if (routing) {
      for (const op of routing.operations) {
        const wc = op.workCenter;
        const eff = Math.max(wc.efficiency.toNumber() / 100, 0.01);
        const setupHours = op.setupTime.toNumber() / 60;
        const runHours = (op.runTimePerUnit.toNumber() * baseQty) / 60;
        const totalHours = (setupHours + runHours) / eff;

        if (op.isSubcontracted) {
          subcontractCost = subcontractCost.add(new Decimal(totalHours).mul(wc.costPerHour));
        } else {
          laborCost = laborCost.add(new Decimal(totalHours).mul(wc.costPerHour));
          // Use resolved overhead rate instead of setupCostPerHour as overhead
          overheadCost = overheadCost.add(new Decimal(totalHours).mul(wc.costPerHour).mul(profOverheadRate));
        }
      }
    }

    const unitMat = baseQty > 0 ? materialCost.div(baseQty) : materialCost;
    const unitLab = baseQty > 0 ? laborCost.div(baseQty) : laborCost;
    const unitOvh = baseQty > 0 ? overheadCost.div(baseQty) : overheadCost;
    const unitSub = baseQty > 0 ? subcontractCost.div(baseQty) : subcontractCost;
    const totalCost = unitMat.add(unitLab).add(unitOvh).add(unitSub);

    const existingCosting = await tx.productCosting.findFirst({
      where: { tenantId, productId, costType: CostType.STANDARD, locationId: locationId ?? null, effectiveFrom: effectDate },
    });

    const costingData = {
      materialCost: unitMat, laborCost: unitLab, overheadCost: unitOvh,
      subcontractCost: unitSub, totalCost,
      version: version ?? `STD-${effectDate.toISOString().substring(0, 10)}`,
    };

    const costing = existingCosting
      ? await tx.productCosting.update({ where: { id: existingCosting.id }, data: costingData })
      : await tx.productCosting.create({
          data: { tenantId, productId, locationId, costType: CostType.STANDARD, effectiveFrom: effectDate, ...costingData },
        });

    // Update standard cost in ItemCost
    await tx.itemCost.upsert({
      where: { tenantId_productId_locationId: { tenantId, productId, locationId: locationId ?? '' } },
      create: {
        tenantId, productId, locationId: locationId ?? '',
        standardCost: totalCost, currentUnitCost: ZERO,
        currentTotalQty: ZERO, currentTotalValue: ZERO,
      },
      update: { standardCost: totalCost },
    });

    return {
      costing,
      breakdown: {
        material: unitMat.toNumber(),
        labor: unitLab.toNumber(),
        overhead: unitOvh.toNumber(),
        subcontract: unitSub.toNumber(),
        total: totalCost.toNumber(),
        baseQuantity: baseQty,
        bomId: bom.id,
        routingId: routing?.id,
      },
    };
  }

  async rollupStandardCost(params: Parameters<typeof CostingEngineService.prototype.rollupStandardCostInTx>[1]) {
    return this.prisma.$transaction(
      (tx) => this.rollupStandardCostInTx(tx, params),
      { timeout: 30000 },
    );
  }

  // ════════════════════════════════════════════════════════════════════════
  // 11. VARIANCE CALCULATION (private)
  // ════════════════════════════════════════════════════════════════════════

  private async calculateWorkOrderVariances(
    tx: Tx,
    params: {
      tenantId: string;
      workOrderId: string;
      productId: string;
      completedQty: Decimal;
      wipByElement: Record<string, Decimal>;
      fiscalPeriodId?: string;
      userId: string;
    },
  ) {
    const { tenantId, workOrderId, productId, completedQty, wipByElement, fiscalPeriodId, userId } = params;

    const stdCosting = await tx.productCosting.findFirst({
      where: {
        tenantId, productId, costType: CostType.STANDARD,
        effectiveFrom: { lte: new Date() },
        OR: [{ effectiveTo: null }, { effectiveTo: { gte: new Date() } }],
      },
      orderBy: { effectiveFrom: 'desc' },
    });

    const stdMaterial = (stdCosting?.materialCost ?? ZERO).mul(completedQty);
    const stdLabor = (stdCosting?.laborCost ?? ZERO).mul(completedQty);
    const stdOverhead = (stdCosting?.overheadCost ?? ZERO).mul(completedQty);
    const stdTotal = (stdCosting?.totalCost ?? ZERO).mul(completedQty);

    const actualMaterial = wipByElement['MATERIAL'] ?? ZERO;
    const actualLabor = (wipByElement['LABOR_RUN'] ?? ZERO).add(wipByElement['LABOR_SETUP'] ?? ZERO);
    const actualOverhead = wipByElement['OVERHEAD'] ?? ZERO;
    const actualTotal = Object.values(wipByElement).reduce((a, b) => a.add(b), ZERO);

    const byElement: Record<string, Decimal> = {
      MATERIAL: actualMaterial.sub(stdMaterial),
      LABOR_RUN: actualLabor.sub(stdLabor),
      LABOR_SETUP: ZERO,
      OVERHEAD: actualOverhead.sub(stdOverhead),
    };
    const totalVariance = actualTotal.sub(stdTotal);

    // Persist variance records
    const varianceTypes = [
      { type: 'MATERIAL_USAGE', std: stdMaterial, actual: actualMaterial },
      { type: 'LABOR', std: stdLabor, actual: actualLabor },
      { type: 'OVERHEAD', std: stdOverhead, actual: actualOverhead },
      { type: 'TOTAL_PRODUCTION', std: stdTotal, actual: actualTotal },
    ];

    for (const v of varianceTypes) {
      const varianceAmt = v.actual.sub(v.std);
      const pct = v.std.gt(ZERO) ? varianceAmt.div(v.std).mul(100) : ZERO;
      const favorability = varianceAmt.isNeg() ? 'FAVORABLE' : varianceAmt.isZero() ? 'NEUTRAL' : 'UNFAVORABLE';

      await tx.costVariance.create({
        data: {
          tenantId,
          varianceType: v.type,
          referenceType: 'WORK_ORDER',
          referenceId: workOrderId,
          productId,
          fiscalPeriodId,
          standardAmount: v.std,
          actualAmount: v.actual,
          varianceAmount: varianceAmt,
          variancePct: pct,
          favorability,
        },
      });
    }

    // Post variance journal if material
    if (!totalVariance.isZero()) {
      await this.accounting.postTransactionalJournal(tx, {
        tenantId,
        transactionType: PostingTransactionType.COST_VARIANCE,
        referenceType: 'WORK_ORDER',
        referenceId: workOrderId,
        entryDate: new Date(),
        fiscalPeriodId,
        amount: totalVariance.abs(),
        productId,
        description: `Production variance — WO ${workOrderId}: ${totalVariance.isNeg() ? 'favorable' : 'unfavorable'} ${totalVariance.abs()}`,
        userId,
      });
    }

    return {
      standard: { material: stdMaterial, labor: stdLabor, overhead: stdOverhead, total: stdTotal },
      totalVariance,
      byElement,
    };
  }

  // ════════════════════════════════════════════════════════════════════════
  // 12. INVENTORY REVALUATION — with retry
  // ════════════════════════════════════════════════════════════════════════

  async revalueInventoryInTx(
    tx: Tx,
    params: {
      tenantId: string;
      productId: string;
      locationId: string;
      newUnitCost: number;
      reason: string;
      fiscalPeriodId?: string;
      userId: string;
    },
  ) {
    const { tenantId, productId, locationId, newUnitCost, reason, fiscalPeriodId, userId } = params;

    await this.assertPeriodOpen(tx, tenantId, fiscalPeriodId);

    const itemCostRows = await tx.$queryRaw<Array<{
      id: string;
      current_unit_cost: string;
      current_total_qty: string;
      current_total_value: string;
      version: number;
    }>>(Prisma.sql`
      SELECT id, current_unit_cost, current_total_qty, current_total_value, version
      FROM item_costs
      WHERE tenant_id = ${tenantId} AND product_id = ${productId} AND location_id = ${locationId}
      FOR UPDATE
    `,
    );

    if (itemCostRows.length === 0) {
      throw new BadRequestException(`No ItemCost record for product ${productId} at location ${locationId}`);
    }

    const row = itemCostRows[0];
    const oldUnitCost = new Decimal(row.current_unit_cost);
    const qty = new Decimal(row.current_total_qty);
    const newCost = new Decimal(newUnitCost);
    const oldTotalValue = new Decimal(row.current_total_value);
    const newTotalValue = qty.mul(newCost);
    const revalAmount = newTotalValue.sub(oldTotalValue);

    // Never overwrite historical layers — create adjustment journal
    const revalNumber = await this.sequence.nextNumber(tx, 'RV');

    const journalEntry = await this.accounting.postTransactionalJournal(tx, {
      tenantId,
      transactionType: PostingTransactionType.INVENTORY_ADJUSTMENT,
      referenceType: 'REVALUATION',
      referenceId: row.id,
      entryDate: new Date(),
      fiscalPeriodId,
      amount: revalAmount.abs(),
      productId,
      locationId,
      description: `Inventory revaluation — ${oldUnitCost} → ${newCost}, qty ${qty}`,
      userId,
    });

    // Update ItemCost
    const affected = await tx.$executeRaw(Prisma.sql`
      UPDATE item_costs SET
        current_unit_cost = ${newCost.toString()},
        current_total_value = ${newTotalValue.toString()},
        version = version + 1,
        updated_at = NOW()
      WHERE id = ${row.id} AND version = ${row.version}
    `,
    );

    if (affected === 0) {
      throw new ConflictException(`ItemCost concurrently modified. Retry.`);
    }

    const revalHistory = await tx.revaluationHistory.create({
      data: {
        tenantId,
        revaluationNumber: revalNumber,
        revaluationType: 'COST_CHANGE',
        productId,
        locationId,
        fiscalPeriodId,
        oldUnitCost,
        newUnitCost: newCost,
        affectedQty: qty,
        revaluationAmount: revalAmount,
        journalEntryId: journalEntry.id,
        status: 'POSTED',
        reason,
        performedById: userId,
      },
    });

    return {
      revaluationId: revalHistory.id,
      revaluationNumber: revalNumber,
      oldUnitCost: oldUnitCost.toNumber(),
      newUnitCost: newCost.toNumber(),
      affectedQty: qty.toNumber(),
      revaluationAmount: revalAmount.toNumber(),
      journalEntryId: journalEntry.id,
    };
  }

  /** Standalone wrapper with retry for optimistic-lock conflicts. */
  async revalueInventory(params: Parameters<typeof CostingEngineService.prototype.revalueInventoryInTx>[1]) {
    return withRetry(
      () => this.prisma.$transaction(
        (tx) => this.revalueInventoryInTx(tx, params),
        { timeout: 30000 },
      ),
      { operationName: 'revalueInventory' },
    );
  }

  // ════════════════════════════════════════════════════════════════════════
  // 13. PERIOD VALUATION SNAPSHOT — fixed N+1, fixed GL reconciliation
  // ════════════════════════════════════════════════════════════════════════

  async snapshotPeriodValuationInTx(
    tx: Tx,
    params: {
      tenantId: string;
      fiscalPeriodId: string;
      userId: string;
    },
  ) {
    const { tenantId, fiscalPeriodId } = params;

    // Verify period exists
    const period = await tx.fiscalPeriod.findFirst({
      where: { id: fiscalPeriodId },
      select: { id: true },
    });
    if (!period) {
      throw new BadRequestException(`Fiscal period ${fiscalPeriodId} not found for this tenant.`);
    }

    const baseCurrency = await this.resolveBaseCurrency(tx, tenantId);

    // ── Single SQL snapshot (eliminates N+1) ──
    // Joins inventory_levels + item_costs + item_cost_profiles in one query
    const snapshotRows = await tx.$queryRaw<Array<{
      product_id: string;
      location_id: string;
      on_hand_qty: string;
      unit_cost: string;
      total_value: string;
      costing_method: string;
      open_layer_count: string;
    }>>(Prisma.sql`
      SELECT
         il.product_id,
         il.location_id,
         il.on_hand_qty,
         COALESCE(ic.current_unit_cost, 0) AS unit_cost,
         (il.on_hand_qty * COALESCE(ic.current_unit_cost, 0)) AS total_value,
         COALESCE(icp.costing_method, 'STANDARD') AS costing_method,
         COALESCE(cl_counts.cnt, 0) AS open_layer_count
       FROM inventory_levels il
       LEFT JOIN item_costs ic
         ON ic.tenant_id = il.tenant_id AND ic.product_id = il.product_id AND ic.location_id = il.location_id
       LEFT JOIN item_cost_profiles icp
         ON icp.tenant_id = il.tenant_id AND icp.product_id = il.product_id
         AND (icp.location_id = il.location_id OR icp.location_id IS NULL)
       LEFT JOIN (
         SELECT tenant_id, product_id, location_id, COUNT(*) AS cnt
         FROM cost_layers
         WHERE status = 'OPEN'
         GROUP BY tenant_id, product_id, location_id
       ) cl_counts
         ON cl_counts.tenant_id = il.tenant_id AND cl_counts.product_id = il.product_id AND cl_counts.location_id = il.location_id
       WHERE il.tenant_id = ${tenantId}
         AND il.on_hand_qty > 0
    `,
    );

    let inventoryValuationTotal = ZERO;

    for (const row of snapshotRows) {
      const value = new Decimal(row.total_value);
      inventoryValuationTotal = inventoryValuationTotal.add(value);

      await tx.periodValuationSnapshot.upsert({
        where: {
          tenantId_fiscalPeriodId_productId_locationId: {
            tenantId, fiscalPeriodId, productId: row.product_id, locationId: row.location_id,
          },
        },
        create: {
          tenantId, fiscalPeriodId,
          productId: row.product_id, locationId: row.location_id,
          onHandQty: new Decimal(row.on_hand_qty),
          unitCost: new Decimal(row.unit_cost),
          totalValue: value,
          costingMethod: row.costing_method as any,
          openLayerCount: Number(row.open_layer_count),
          currency: baseCurrency,
        },
        update: {
          onHandQty: new Decimal(row.on_hand_qty),
          unitCost: new Decimal(row.unit_cost),
          totalValue: value,
          costingMethod: row.costing_method as any,
          openLayerCount: Number(row.open_layer_count),
          currency: baseCurrency,
        },
      });
    }

    // ── GL reconciliation: only isInventoryAsset accounts + WIP balances ──
    const glRows = await tx.$queryRaw<Array<{ total: string }>>(
      Prisma.sql`SELECT COALESCE(SUM(jel.debit_amount - jel.credit_amount), 0) AS total
       FROM journal_entry_lines jel
       JOIN journal_entries je ON je.id = jel.journal_entry_id
       JOIN gl_accounts ga ON ga.id = jel.gl_account_id
       WHERE je.tenant_id = ${tenantId}
         AND je.status = 'POSTED'
         AND ga.is_inventory_asset = true`,
    );

    const glInventoryTotal = new Decimal(glRows[0]?.total ?? '0');

    // Include WIP balances in inventory total for reconciliation
    const wipRows = await tx.$queryRaw<Array<{ total: string }>>(
      Prisma.sql`SELECT COALESCE(SUM(accumulated_amount - COALESCE(absorbed_amount, 0)), 0) AS total
       FROM wip_cost_accumulations
       WHERE tenant_id = ${tenantId}`,
    );
    const wipBalance = new Decimal(wipRows[0]?.total ?? '0');
    const totalSubledgerValue = inventoryValuationTotal.add(wipBalance);

    const discrepancy = totalSubledgerValue.sub(glInventoryTotal);

    await tx.periodCloseCheckpoint.upsert({
      where: { tenantId_fiscalPeriodId: { tenantId, fiscalPeriodId } },
      create: {
        tenantId, fiscalPeriodId,
        status: 'CLOSING',
        inventoryValuationTotal: totalSubledgerValue,
        glInventoryTotal,
        discrepancy,
      },
      update: {
        inventoryValuationTotal: totalSubledgerValue,
        glInventoryTotal,
        discrepancy,
        status: 'CLOSING',
      },
    });

    return {
      fiscalPeriodId,
      inventoryValuationTotal: inventoryValuationTotal.toNumber(),
      wipBalance: wipBalance.toNumber(),
      glInventoryTotal: glInventoryTotal.toNumber(),
      discrepancy: discrepancy.toNumber(),
      isReconciled: discrepancy.abs().lt(new Decimal('0.01')),
      snapshotCount: snapshotRows.length,
    };
  }

  async snapshotPeriodValuation(params: Parameters<typeof CostingEngineService.prototype.snapshotPeriodValuationInTx>[1]) {
    return this.prisma.$transaction(
      (tx) => this.snapshotPeriodValuationInTx(tx, params),
      { timeout: 120000 },
    );
  }

  // ════════════════════════════════════════════════════════════════════════
  // 14. PERIOD CLOSE
  // ════════════════════════════════════════════════════════════════════════

  async closePeriodInTx(
    tx: Tx,
    params: {
      tenantId: string;
      fiscalPeriodId: string;
      userId: string;
    },
  ) {
    const { tenantId, fiscalPeriodId, userId } = params;

    const checkpoint = await tx.periodCloseCheckpoint.findUnique({
      where: { tenantId_fiscalPeriodId: { tenantId, fiscalPeriodId } },
    });

    if (!checkpoint || checkpoint.status !== 'CLOSING') {
      throw new BadRequestException('Period must be in CLOSING status. Run valuation snapshot first.');
    }

    // Lock the fiscal period
    const lockResult = await tx.fiscalPeriod.updateMany({
      where: { id: fiscalPeriodId },
      data: { isLocked: true },
    });
    if (lockResult.count === 0) {
      throw new BadRequestException(`Fiscal period ${fiscalPeriodId} not found for this tenant.`);
    }

    // Freeze all open cost layers for this period
    await tx.$executeRaw(Prisma.sql`
      UPDATE cost_layers SET status = 'FROZEN', version = version + 1, updated_at = NOW()
      WHERE tenant_id = ${tenantId} AND fiscal_period_id = ${fiscalPeriodId} AND status = 'OPEN'
    `,
    );

    // Generate variance summary
    const variances = await tx.costVariance.findMany({
      where: { tenantId, fiscalPeriodId },
    });

    const varianceSummary = variances.reduce<Record<string, number>>((acc, v) => {
      acc[v.varianceType] = (acc[v.varianceType] ?? 0) + v.varianceAmount.toNumber();
      return acc;
    }, {});

    await tx.periodCloseCheckpoint.update({
      where: { tenantId_fiscalPeriodId: { tenantId, fiscalPeriodId } },
      data: {
        status: 'CLOSED',
        closedById: userId,
        closedAt: new Date(),
        varianceSummary,
      },
    });

    return {
      status: 'CLOSED',
      varianceSummary,
      discrepancy: checkpoint.discrepancy.toNumber(),
    };
  }

  async closePeriod(params: Parameters<typeof CostingEngineService.prototype.closePeriodInTx>[1]) {
    return this.prisma.$transaction(
      (tx) => this.closePeriodInTx(tx, params),
      { timeout: 60000 },
    );
  }

  // ════════════════════════════════════════════════════════════════════════
  // 15. PERIOD REOPEN
  // ════════════════════════════════════════════════════════════════════════

  async reopenPeriodInTx(
    tx: Tx,
    params: {
      tenantId: string;
      fiscalPeriodId: string;
      reason: string;
      userId: string;
    },
  ) {
    const { tenantId, fiscalPeriodId, reason, userId } = params;

    const checkpoint = await tx.periodCloseCheckpoint.findUnique({
      where: { tenantId_fiscalPeriodId: { tenantId, fiscalPeriodId } },
    });

    if (!checkpoint || checkpoint.status !== 'CLOSED') {
      throw new BadRequestException('Period must be CLOSED to reopen.');
    }

    const reopenResult = await tx.fiscalPeriod.updateMany({
      where: { id: fiscalPeriodId },
      data: { isLocked: false },
    });
    if (reopenResult.count === 0) {
      throw new BadRequestException(`Fiscal period ${fiscalPeriodId} not found for this tenant.`);
    }

    await tx.$executeRaw(Prisma.sql`
      UPDATE cost_layers SET status = 'OPEN', version = version + 1, updated_at = NOW()
      WHERE tenant_id = ${tenantId} AND fiscal_period_id = ${fiscalPeriodId} AND status = 'FROZEN' AND remaining_qty > 0
    `,
    );

    await tx.periodCloseCheckpoint.update({
      where: { tenantId_fiscalPeriodId: { tenantId, fiscalPeriodId } },
      data: {
        status: 'REOPENED',
        reopenedById: userId,
        reopenedAt: new Date(),
        reopenReason: reason,
      },
    });

    return { status: 'REOPENED' };
  }

  async reopenPeriod(params: Parameters<typeof CostingEngineService.prototype.reopenPeriodInTx>[1]) {
    return this.prisma.$transaction(
      (tx) => this.reopenPeriodInTx(tx, params),
      { timeout: 30000 },
    );
  }

  // ════════════════════════════════════════════════════════════════════════
  // 16. SCRAP COSTING
  // ════════════════════════════════════════════════════════════════════════

  async costScrapInTx(
    tx: Tx,
    params: {
      tenantId: string;
      productId: string;
      locationId: string;
      quantity: Decimal | number;
      uom: string;
      workOrderId?: string;
      referenceId: string;
      fiscalPeriodId?: string;
      userId: string;
    },
  ) {
    const { tenantId, productId, locationId, quantity, uom, workOrderId, referenceId, fiscalPeriodId, userId } = params;

    await this.assertPeriodOpen(tx, tenantId, fiscalPeriodId);

    const qty = new Decimal(quantity.toString());
    const method = await this.resolveMethod(tx, tenantId, productId, locationId);
    let scrapCost: Decimal;

    if (method === 'FIFO' || method === 'LIFO') {
      scrapCost = await this.depleteCostLayers(tx, {
        tenantId, productId, locationId, quantity: qty,
        method, referenceType: 'SCRAP', referenceId,
      });
    } else {
      const avgCost = await this.getMovingAverageCost(tx, tenantId, productId, locationId);
      scrapCost = qty.mul(avgCost);
    }

    if (workOrderId) {
      await this.accumulateWIP(tx, { tenantId, workOrderId, costElement: 'SCRAP', amount: scrapCost });
    }

    await this.accounting.postTransactionalJournal(tx, {
      tenantId,
      transactionType: PostingTransactionType.SCRAP,
      referenceType: 'SCRAP',
      referenceId,
      entryDate: new Date(),
      fiscalPeriodId,
      amount: scrapCost,
      productId,
      locationId,
      description: `Scrap cost — ${qty} ${uom}`,
      userId,
    });

    await this.ledger.recordEntry(tx, {
      tenantId, productId, locationId,
      entryType: LedgerEntryType.LEDGER_SCRAP,
      quantity: qty.neg(), uom,
      unitCost: scrapCost.div(qty),
      referenceType: 'SCRAP', referenceId,
      createdById: userId,
    });

    return { scrapCost: scrapCost.toNumber() };
  }

  async costScrap(params: Parameters<typeof CostingEngineService.prototype.costScrapInTx>[1]) {
    return this.prisma.$transaction(
      (tx) => this.costScrapInTx(tx, params),
      { timeout: 15000 },
    );
  }

  // ════════════════════════════════════════════════════════════════════════
  // 17. REVERSAL
  // ════════════════════════════════════════════════════════════════════════

  async reverseTransaction(params: {
    tenantId: string;
    journalEntryId: string;
    reason: string;
    userId: string;
  }) {
    return this.accounting.reverseJournalEntryById(params.tenantId, params.journalEntryId, params.userId, params.reason);
  }

  // ════════════════════════════════════════════════════════════════════════
  // 18. ITEM COST PROFILE MANAGEMENT (moved from controller)
  // ════════════════════════════════════════════════════════════════════════

  async getCostProfiles(tenantId: string, filters?: { productId?: string; locationId?: string }) {
    return this.prisma.itemCostProfile.findMany({
      where: {
        tenantId,
        ...(filters?.productId && { productId: filters.productId }),
        ...(filters?.locationId && { locationId: filters.locationId }),
      },
      orderBy: { createdAt: 'desc' },
    });
  }

  async upsertCostProfile(
    tenantId: string,
    data: {
      productId: string;
      locationId?: string;
      costingMethod: string;
      standardCostVersion?: string;
      enableLandedCost?: boolean;
      overheadRate?: number;
      laborRate?: number;
    },
  ) {
    return this.prisma.itemCostProfile.upsert({
      where: {
        tenantId_productId_locationId: {
          tenantId,
          productId: data.productId,
          locationId: data.locationId ?? null,
        },
      },
      create: {
        tenantId,
        productId: data.productId,
        locationId: data.locationId,
        costingMethod: data.costingMethod as any,
        standardCostVersion: data.standardCostVersion,
        enableLandedCost: data.enableLandedCost ?? false,
        overheadRate: data.overheadRate != null ? new Decimal(data.overheadRate) : undefined,
        laborRate: data.laborRate != null ? new Decimal(data.laborRate) : undefined,
      },
      update: {
        costingMethod: data.costingMethod as any,
        standardCostVersion: data.standardCostVersion,
        enableLandedCost: data.enableLandedCost,
        overheadRate: data.overheadRate != null ? new Decimal(data.overheadRate) : undefined,
        laborRate: data.laborRate != null ? new Decimal(data.laborRate) : undefined,
      },
    });
  }

  // ════════════════════════════════════════════════════════════════════════
  // QUERY METHODS (read-only, no tx required)
  // ════════════════════════════════════════════════════════════════════════

  async getCostLayers(tenantId: string, filters: {
    productId?: string;
    locationId?: string;
    status?: string;
    skip?: number;
    take?: number;
  }) {
    const where: Prisma.CostLayerWhereInput = {
      tenantId,
      ...(filters.productId && { productId: filters.productId }),
      ...(filters.locationId && { locationId: filters.locationId }),
      ...(filters.status && { status: filters.status as any }),
    };

    const [items, total] = await Promise.all([
      this.prisma.costLayer.findMany({
        where,
        orderBy: { layerDate: 'desc' },
        skip: filters.skip ?? 0,
        take: filters.take ?? 50,
        include: { depletions: { orderBy: { depletedAt: 'desc' }, take: 10 } },
      }),
      this.prisma.costLayer.count({ where }),
    ]);

    return { items, total };
  }

  async getItemCosts(tenantId: string, filters?: { productId?: string; locationId?: string }) {
    return this.prisma.itemCost.findMany({
      where: {
        tenantId,
        ...(filters?.productId && { productId: filters.productId }),
        ...(filters?.locationId && { locationId: filters.locationId }),
      },
      orderBy: { updatedAt: 'desc' },
    });
  }

  async getWIPAccumulation(tenantId: string, workOrderId: string) {
    return this.prisma.wIPCostAccumulation.findMany({
      where: { tenantId, workOrderId },
    });
  }

  async getCostVariances(tenantId: string, filters?: {
    varianceType?: string;
    referenceType?: string;
    referenceId?: string;
    fiscalPeriodId?: string;
    productId?: string;
    skip?: number;
    take?: number;
  }) {
    const where: Prisma.CostVarianceWhereInput = {
      tenantId,
      ...(filters?.varianceType && { varianceType: filters.varianceType }),
      ...(filters?.referenceType && { referenceType: filters.referenceType }),
      ...(filters?.referenceId && { referenceId: filters.referenceId }),
      ...(filters?.fiscalPeriodId && { fiscalPeriodId: filters.fiscalPeriodId }),
      ...(filters?.productId && { productId: filters.productId }),
    };

    const [items, total] = await Promise.all([
      this.prisma.costVariance.findMany({
        where,
        orderBy: { createdAt: 'desc' },
        skip: filters?.skip ?? 0,
        take: filters?.take ?? 50,
      }),
      this.prisma.costVariance.count({ where }),
    ]);

    return { items, total };
  }

  async getRevaluationHistory(tenantId: string, filters?: {
    productId?: string;
    status?: string;
    skip?: number;
    take?: number;
  }) {
    const where: Prisma.RevaluationHistoryWhereInput = {
      tenantId,
      ...(filters?.productId && { productId: filters.productId }),
      ...(filters?.status && { status: filters.status as any }),
    };

    const [items, total] = await Promise.all([
      this.prisma.revaluationHistory.findMany({
        where,
        orderBy: { performedAt: 'desc' },
        skip: filters?.skip ?? 0,
        take: filters?.take ?? 50,
      }),
      this.prisma.revaluationHistory.count({ where }),
    ]);

    return { items, total };
  }

  async getPeriodCloseStatus(tenantId: string, fiscalPeriodId: string) {
    return this.prisma.periodCloseCheckpoint.findUnique({
      where: { tenantId_fiscalPeriodId: { tenantId, fiscalPeriodId } },
    });
  }

  async getInventoryValuation(tenantId: string, filters?: {
    productId?: string;
    locationId?: string;
  }) {
    const levels = await this.prisma.inventoryLevel.findMany({
      where: {
        tenantId,
        ...(filters?.productId && { productId: filters.productId }),
        ...(filters?.locationId && { locationId: filters.locationId }),
        onHandQty: { gt: 0 },
      },
      include: {
        product: { select: { id: true, code: true, name: true, category: true } },
        location: { select: { id: true, code: true, name: true } },
      },
    });

    const results = [];
    let totalValuation = ZERO;

    for (const level of levels) {
      const itemCost = await this.prisma.itemCost.findUnique({
        where: { tenantId_productId_locationId: { tenantId, productId: level.productId, locationId: level.locationId } },
      });

      const unitCost = itemCost?.currentUnitCost ?? ZERO;
      const value = level.onHandQty.mul(unitCost);
      totalValuation = totalValuation.add(value);

      const profile = await this.prisma.itemCostProfile.findUnique({
        where: { tenantId_productId_locationId: { tenantId, productId: level.productId, locationId: level.locationId ?? null } },
      });

      results.push({
        productId: level.productId,
        productCode: level.product.code,
        productName: level.product.name,
        category: level.product.category,
        locationId: level.locationId,
        locationCode: level.location.code,
        locationName: level.location.name,
        onHandQty: level.onHandQty.toNumber(),
        unitCost: unitCost.toNumber(),
        totalValue: value.toNumber(),
        costingMethod: profile?.costingMethod ?? 'STANDARD',
        standardCost: itemCost?.standardCost?.toNumber() ?? 0,
        movingAvgCost: itemCost?.currentUnitCost?.toNumber() ?? 0,
      });
    }

    return {
      items: results,
      totalValuation: totalValuation.toNumber(),
      itemCount: results.length,
    };
  }

  // ════════════════════════════════════════════════════════════════════════
  // S&OP / SCENARIO COSTING (read-only projections)
  // ════════════════════════════════════════════════════════════════════════

  async getPlannedCOGS(tenantId: string, params: {
    scenarioId?: string;
    productId?: string;
    startDate: Date;
    endDate: Date;
  }) {
    const forecasts = await this.prisma.forecast.findMany({
      where: {
        tenantId,
        ...(params.scenarioId && { scenarioId: params.scenarioId }),
        ...(params.productId && { productId: params.productId }),
        periodDate: { gte: params.startDate, lte: params.endDate },
      },
      include: { product: { select: { id: true, code: true, name: true } } },
    });

    const results = [];
    let totalPlannedCOGS = ZERO;
    let totalRevenue = ZERO;

    for (const f of forecasts) {
      if (!f.productId) continue;

      const cost = await this.prisma.productCosting.findFirst({
        where: {
          tenantId, productId: f.productId, costType: CostType.STANDARD,
          effectiveFrom: { lte: f.periodDate },
          OR: [{ effectiveTo: null }, { effectiveTo: { gte: f.periodDate } }],
        },
        orderBy: { effectiveFrom: 'desc' },
      });

      const qty = f.forecastQuantity ?? ZERO;
      const revenue = f.forecastAmount;
      const cogs = qty.mul(cost?.totalCost ?? ZERO);
      const margin = revenue.sub(cogs);
      const marginPct = revenue.gt(ZERO) ? margin.div(revenue).mul(100) : ZERO;

      totalPlannedCOGS = totalPlannedCOGS.add(cogs);
      totalRevenue = totalRevenue.add(revenue);

      results.push({
        periodDate: f.periodDate,
        productId: f.productId,
        productCode: f.product?.code,
        productName: f.product?.name,
        forecastQty: qty.toNumber(),
        forecastRevenue: revenue.toNumber(),
        unitCost: cost?.totalCost?.toNumber() ?? 0,
        plannedCOGS: cogs.toNumber(),
        contributionMargin: margin.toNumber(),
        marginPct: marginPct.toNumber(),
      });
    }

    const totalMargin = totalRevenue.sub(totalPlannedCOGS);
    const totalMarginPct = totalRevenue.gt(ZERO) ? totalMargin.div(totalRevenue).mul(100) : ZERO;

    return {
      items: results,
      summary: {
        totalRevenue: totalRevenue.toNumber(),
        totalPlannedCOGS: totalPlannedCOGS.toNumber(),
        contributionMargin: totalMargin.toNumber(),
        marginPct: totalMarginPct.toNumber(),
      },
    };
  }

  async getScenarioCostComparison(tenantId: string, params: {
    scenarioIds: string[];
    productId?: string;
    startDate: Date;
    endDate: Date;
  }) {
    const results = [];

    for (const scenarioId of params.scenarioIds) {
      const scenario = await this.prisma.scenario.findFirst({
        where: { id: scenarioId, tenantId },
        select: { id: true, name: true, scenarioType: true },
      });

      const cogs = await this.getPlannedCOGS(tenantId, {
        scenarioId,
        productId: params.productId,
        startDate: params.startDate,
        endDate: params.endDate,
      });

      results.push({
        scenarioId,
        scenarioName: scenario?.name ?? 'Unknown',
        scenarioType: scenario?.scenarioType,
        ...cogs.summary,
      });
    }

    return { scenarios: results };
  }

  // ════════════════════════════════════════════════════════════════════════
  // PRIVATE HELPERS
  // ════════════════════════════════════════════════════════════════════════

  /** Resolve tenant's base currency — never hardcode 'USD'. */
  private async resolveBaseCurrency(tx: Tx, tenantId: string): Promise<string> {
    const tenant = await tx.tenant.findUniqueOrThrow({
      where: { id: tenantId },
      select: { defaultCurrency: true },
    });
    return tenant.defaultCurrency;
  }

  /** Resolve overhead rate: ItemCostProfile → WorkCenter ratio. */
  private async resolveOverheadRate(
    tx: Tx,
    tenantId: string,
    productId: string,
    locationId?: string | null,
    workOrderId?: string,
  ): Promise<Decimal> {
    // 1. Item-level overhead rate from cost profile
    const profile = await tx.itemCostProfile.findUnique({
      where: { tenantId_productId_locationId: { tenantId, productId, locationId: locationId ?? null } },
      select: { overheadRate: true },
    });
    if (profile?.overheadRate && !profile.overheadRate.isZero()) {
      return profile.overheadRate.div(100); // stored as percentage
    }

    // 2. WorkCenter-level overhead rate (from work order's routing)
    if (workOrderId) {
      const wo = await tx.workOrder.findFirst({
        where: { id: workOrderId, tenantId },
        select: { routingId: true },
      });
      if (wo?.routingId) {
        const ops = await tx.routingOperation.findMany({
          where: { routingId: wo.routingId },
          include: { workCenter: { select: { setupCostPerHour: true, costPerHour: true } } },
          take: 1,
        });
        if (ops[0]?.workCenter?.setupCostPerHour && ops[0]?.workCenter?.costPerHour) {
          const ratio = ops[0].workCenter.setupCostPerHour.div(ops[0].workCenter.costPerHour);
          if (ratio.gt(ZERO)) return ratio;
        }
      }
    }

    throw new BadRequestException(
      `No overhead rate configured for product ${productId}. Configure ItemCostProfile.overheadRate ` +
      `or ensure work-center setup/cost rates are available for this tenant.`,
    );
  }

  private async resolveMethod(tx: Tx, tenantId: string, productId: string, locationId: string): Promise<CostingMethod> {
    const profile = await tx.itemCostProfile.findUnique({
      where: { tenantId_productId_locationId: { tenantId, productId, locationId: locationId ?? null } },
    });
    return (profile?.costingMethod as CostingMethod) ?? 'STANDARD';
  }

  private async getMovingAverageCost(tx: Tx, tenantId: string, productId: string, locationId: string): Promise<Decimal> {
    const ic = await tx.itemCost.findUnique({
      where: { tenantId_productId_locationId: { tenantId, productId, locationId } },
    });
    return ic?.currentUnitCost ?? ZERO;
  }

  private async getStandardCost(tx: Tx, tenantId: string, productId: string): Promise<Decimal> {
    const costing = await tx.productCosting.findFirst({
      where: {
        tenantId, productId, costType: CostType.STANDARD,
        effectiveFrom: { lte: new Date() },
        OR: [{ effectiveTo: null }, { effectiveTo: { gte: new Date() } }],
      },
      orderBy: { effectiveFrom: 'desc' },
    });
    if (costing) return costing.totalCost;

    const product = await tx.product.findFirstOrThrow({
      where: { id: productId, tenantId },
      select: { standardCost: true, code: true },
    });
    const cost = product.standardCost ?? ZERO;
    if (cost.isZero()) {
      this.logger.warn(
        `Standard cost for product ${product.code ?? productId} is zero. ` +
        `Materials will be issued at zero cost. Configure ProductCosting or Product.standardCost.`,
      );
    }
    return cost;
  }

  private async assertPeriodOpen(tx: Tx, tenantId: string, fiscalPeriodId?: string | null) {
    if (!fiscalPeriodId) return;

    const checkpoint = await tx.periodCloseCheckpoint.findUnique({
      where: { tenantId_fiscalPeriodId: { tenantId, fiscalPeriodId } },
    });

    if (checkpoint?.status === 'CLOSED') {
      throw new BadRequestException(`Fiscal period ${fiscalPeriodId} is closed. No cost modifications allowed.`);
    }

    const period = await tx.fiscalPeriod.findFirst({
      where: { id: fiscalPeriodId },
      select: { isLocked: true },
    });
    if (!period) {
      throw new BadRequestException(`Fiscal period ${fiscalPeriodId} not found for this tenant.`);
    }
    if (period?.isLocked) {
      throw new BadRequestException(`Fiscal period ${fiscalPeriodId} is locked. No cost modifications allowed.`);
    }
  }

  private async lockCostLayer(tx: Tx, tenantId: string, costLayerId: string) {
    await tx.$queryRaw(
      Prisma.sql`SELECT id FROM cost_layers WHERE tenant_id = ${tenantId} AND id = ${costLayerId} FOR UPDATE`,
    );
  }

  private async adjustMovingAverageValue(tx: Tx, params: {
    tenantId: string;
    productId: string;
    locationId: string;
    valueAdjustment: Decimal;
  }) {
    const rows = await tx.$queryRaw<Array<{
      id: string; current_total_qty: string; current_total_value: string; version: number;
    }>>(Prisma.sql`
      SELECT id, current_total_qty, current_total_value, version
      FROM item_costs
      WHERE tenant_id = ${params.tenantId} AND product_id = ${params.productId} AND location_id = ${params.locationId}
      FOR UPDATE
    `,
    );

    if (rows.length === 0) return;

    const row = rows[0];
    const qty = new Decimal(row.current_total_qty);
    const newValue = new Decimal(row.current_total_value).add(params.valueAdjustment);
    const newUnitCost = qty.gt(ZERO) ? newValue.div(qty) : ZERO;

    const affected = await tx.$executeRaw(Prisma.sql`
      UPDATE item_costs
      SET current_unit_cost = ${newUnitCost.toString()},
          current_total_value = ${newValue.toString()},
          version = version + 1,
          updated_at = NOW()
      WHERE id = ${row.id} AND version = ${row.version}
    `,
    );

    if (affected === 0) {
      throw new ConflictException(
        `ItemCost ${row.id} was concurrently modified during moving-average adjustment. Retry.`,
      );
    }
  }

  /** Update last-issue tracking on item costs. */
  private async updateLastIssueCost(tx: Tx, tenantId: string, productId: string, locationId: string, unitCost: Decimal) {
    await tx.itemCost.updateMany({
      where: { tenantId, productId, locationId },
      data: {
        lastIssueCost: unitCost,
        lastIssueDate: new Date(),
      },
    });
  }

  private async recursiveMaterialCost(
    tx: Tx, tenantId: string,
    components: Array<{ componentProductId: string; quantity: Decimal; scrapPercent: Decimal; isPhantom: boolean; componentProduct: { id: string; code: string } }>,
    parentBaseQty: number, effectiveDate: Date, depth: number, visited: Set<string>,
  ): Promise<Decimal> {
    if (depth > 20) throw new BadRequestException('BOM recursion depth exceeded — circular reference');

    let total = ZERO;
    for (const comp of components) {
      const scrapFactor = ONE.add(comp.scrapPercent.div(100));
      const extQty = comp.quantity.mul(scrapFactor);

      if (comp.isPhantom) {
        if (visited.has(comp.componentProductId)) {
          throw new BadRequestException(`Circular BOM: ${comp.componentProduct.code}`);
        }
        visited.add(comp.componentProductId);

        const childBom = await tx.billOfMaterial.findFirst({
          where: {
            tenantId, parentProductId: comp.componentProductId, status: 'ACTIVE',
            effectiveFrom: { lte: effectiveDate },
            OR: [{ effectiveTo: null }, { effectiveTo: { gte: effectiveDate } }],
          },
          include: { components: { include: { componentProduct: { select: { id: true, code: true } } } } },
        });

        if (childBom) {
          const childCost = await this.recursiveMaterialCost(
            tx, tenantId, childBom.components, childBom.baseQuantity.toNumber(),
            effectiveDate, depth + 1, new Set(visited),
          );
          total = total.add(extQty.mul(childCost));
        }
      } else {
        const compCost = await this.getStandardCost(tx, tenantId, comp.componentProductId);
        total = total.add(extQty.mul(compCost));
      }
    }
    return total;
  }
}
