import { BadRequestException, Injectable } from '@nestjs/common';
import { CostType, Prisma } from '@prisma/client';
import { Decimal } from '@prisma/client/runtime/library';
import { PrismaService } from '../../../core/database/prisma.service';

/**
 * CostingService — Product costing engine.
 *
 * Standard cost rollup → Actual cost aggregation → Variance analysis
 *
 * Key behaviors:
 * - Standard cost rollup: walks BOM tree (incl. phantom), sums routing labor/overhead
 * - Actual cost aggregation from material issues, labor entries, overhead absorptions
 * - Variance calculation: material, labor, overhead, total (actual − standard)
 * - ProductCosting record management with effectivity dating
 */
@Injectable()
export class CostingService {
  constructor(private readonly prisma: PrismaService) {}

  // ────────────────────────────────────────────────────────────────────────
  // Standard Cost Rollup
  // ────────────────────────────────────────────────────────────────────────

  /**
   * Roll up standard cost for a product from its active BOM and routing.
   *
   * Algorithm:
   *   1. Resolve active BOM for product
   *   2. Walk component tree (recursing into phantom BOMs)
   *   3. Sum material costs from component product costs × qty × (1 + scrap%)
   *   4. Sum routing labor cost: ∑(setupTime + runTimePerUnit × baseQty) × workCenter.costPerHour
   *   5. Overhead: apply overhead rate per work center
   *   6. Creates or updates ProductCosting record with STANDARD type
   *
   * Runs inside a transaction for atomicity.
   */
  async rollUpStandardCost(
    tenantId: string,
    productId: string,
    params?: {
      effectiveDate?: Date;
      locationId?: string;
      version?: string;
    },
  ) {
    return this.prisma.$transaction(async (tx) => {
      return this._rollUpStandardCostInTx(tx, tenantId, productId, params);
    });
  }

  private async _rollUpStandardCostInTx(
    tx: Prisma.TransactionClient,
    tenantId: string,
    productId: string,
    params?: {
      effectiveDate?: Date;
      locationId?: string;
      version?: string;
    },
  ) {
    const effectiveDate = params?.effectiveDate ?? new Date();

    // Find active BOM
    const bom = await tx.billOfMaterial.findFirst({
      where: {
        tenantId,
        parentProductId: productId,
        status: 'ACTIVE',
        effectiveFrom: { lte: effectiveDate },
        OR: [
          { effectiveTo: null },
          { effectiveTo: { gte: effectiveDate } },
        ],
      },
      include: {
        components: {
          include: {
            componentProduct: {
              select: { id: true, code: true },
            },
          },
          orderBy: { sequence: 'asc' },
        },
        routings: {
          where: { status: 'ACTIVE' },
          include: {
            operations: {
              include: {
                workCenter: {
                  select: {
                    id: true,
                    costPerHour: true,
                    setupCostPerHour: true,
                    efficiency: true,
                  },
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

    // 1. Material cost — walk component tree (with circular BOM detection)
    const materialCost = await this.calculateMaterialCost(
      tx,
      tenantId,
      bom.components,
      baseQty,
      effectiveDate,
      0,
      new Set([productId]), // track visited products for cycle detection
    );

    // 2. Labor + overhead from routing
    let laborCost = new Decimal(0);
    let overheadCost = new Decimal(0);
    let subcontractCost = new Decimal(0);

    const routing = bom.routings[0];
    if (routing) {
      for (const op of routing.operations) {
        const wc = op.workCenter;
        const efficiency = wc.efficiency.toNumber() / 100;
        const adjustedEfficiency = efficiency > 0 ? efficiency : 1;

        // Setup time is per batch, run time is per unit
        const setupHours = op.setupTime.toNumber() / 60; // convert min to hours
        const runHours = (op.runTimePerUnit.toNumber() * baseQty) / 60;
        const totalHours = (setupHours + runHours) / adjustedEfficiency;

        if (op.isSubcontracted) {
          // Subcontract cost uses the work center's cost rate as proxy
          subcontractCost = subcontractCost.add(new Decimal(totalHours).mul(wc.costPerHour));
        } else {
          laborCost = laborCost.add(new Decimal(totalHours).mul(wc.costPerHour));
          // Overhead: use setup cost rate as overhead proxy
          overheadCost = overheadCost.add(new Decimal(totalHours).mul(wc.setupCostPerHour));
        }
      }
    }

    // Normalize to per-unit cost
    const unitMaterial = baseQty > 0 ? materialCost.div(baseQty) : materialCost;
    const unitLabor = baseQty > 0 ? laborCost.div(baseQty) : laborCost;
    const unitOverhead = baseQty > 0 ? overheadCost.div(baseQty) : overheadCost;
    const unitSubcontract = baseQty > 0 ? subcontractCost.div(baseQty) : subcontractCost;
    const totalCost = unitMaterial.add(unitLabor).add(unitOverhead).add(unitSubcontract);

    // Upsert ProductCosting
    const existing = await tx.productCosting.findFirst({
      where: {
        tenantId,
        productId,
        costType: CostType.STANDARD,
        locationId: params?.locationId ?? null,
        effectiveFrom: effectiveDate,
      },
    });

    const costingData = {
      materialCost: unitMaterial,
      laborCost: unitLabor,
      overheadCost: unitOverhead,
      subcontractCost: unitSubcontract,
      totalCost,
      version: params?.version ?? `STD-${effectiveDate.toISOString().substring(0, 10)}`,
    };

    let costing;
    if (existing) {
      costing = await tx.productCosting.update({
        where: { id: existing.id },
        data: costingData,
      });
    } else {
      costing = await tx.productCosting.create({
        data: {
          tenantId,
          productId,
          locationId: params?.locationId,
          costType: CostType.STANDARD,
          effectiveFrom: effectiveDate,
          ...costingData,
        },
      });
    }

    return {
      costing,
      breakdown: {
        materialCost: unitMaterial.toNumber(),
        laborCost: unitLabor.toNumber(),
        overheadCost: unitOverhead.toNumber(),
        subcontractCost: unitSubcontract.toNumber(),
        totalCost: totalCost.toNumber(),
        baseQuantity: baseQty,
        bomId: bom.id,
        routingId: routing?.id,
        componentCount: bom.components.length,
        operationCount: routing?.operations.length ?? 0,
      },
    };
  }

  /**
   * Recursively calculate material cost from BOM components.
   * Phantom (sub-assembly) components are exploded — their cost comes from
   * walking their own BOM tree, not a costing record.
   *
   * Uses a visited set to detect circular BOM references.
   */
  private async calculateMaterialCost(
    tx: Prisma.TransactionClient,
    tenantId: string,
    components: Array<{
      componentProductId: string;
      quantity: Decimal;
      scrapPercent: Decimal;
      isPhantom: boolean;
      componentProduct: { id: string; code: string };
    }>,
    parentBaseQty: number,
    effectiveDate: Date,
    depth: number = 0,
    visited: Set<string> = new Set(),
  ): Promise<Decimal> {
    if (depth > 20) {
      throw new BadRequestException('BOM recursion depth exceeded — possible circular reference');
    }

    let totalMaterial = new Decimal(0);

    for (const comp of components) {
      const scrapFactor = new Decimal(1).add(comp.scrapPercent.div(100));
      const extendedQty = comp.quantity.mul(scrapFactor);

      if (comp.isPhantom) {
        // Check for circular BOM reference
        if (visited.has(comp.componentProductId)) {
          throw new BadRequestException(
            `Circular BOM detected: product ${comp.componentProduct.code} appears multiple times in the BOM tree`,
          );
        }
        visited.add(comp.componentProductId);

        // Phantom: explode into child BOM
        const childBom = await tx.billOfMaterial.findFirst({
          where: {
            tenantId,
            parentProductId: comp.componentProductId,
            status: 'ACTIVE',
            effectiveFrom: { lte: effectiveDate },
            OR: [
              { effectiveTo: null },
              { effectiveTo: { gte: effectiveDate } },
            ],
          },
          include: {
            components: {
              include: {
                componentProduct: { select: { id: true, code: true } },
              },
            },
          },
        });

        if (childBom) {
          const childCost = await this.calculateMaterialCost(
            tx,
            tenantId,
            childBom.components,
            childBom.baseQuantity.toNumber(),
            effectiveDate,
            depth + 1,
            new Set(visited), // pass a copy to avoid false positives in sibling branches
          );
          totalMaterial = totalMaterial.add(extendedQty.mul(childCost));
        }
      } else {
        // Leaf component: get its standard cost
        const compCost = await this.getEffectiveCostInTx(
          tx,
          tenantId,
          comp.componentProductId,
          effectiveDate,
        );
        totalMaterial = totalMaterial.add(extendedQty.mul(compCost));
      }
    }

    return totalMaterial;
  }

  /**
   * Get effective unit cost for a product. Checks ProductCosting with effectivity,
   * falls back to product.unitCost if no costing record exists.
   */
  async getEffectiveCost(
    tenantId: string,
    productId: string,
    effectiveDate?: Date,
  ): Promise<Decimal> {
    return this.getEffectiveCostInTx(this.prisma, tenantId, productId, effectiveDate);
  }

  /**
   * Transaction-safe version of getEffectiveCost.
   * Must be used when called inside a $transaction to avoid reading outside the tx.
   */
  private async getEffectiveCostInTx(
    tx: Prisma.TransactionClient,
    tenantId: string,
    productId: string,
    effectiveDate?: Date,
  ): Promise<Decimal> {
    const date = effectiveDate ?? new Date();

    const costing = await tx.productCosting.findFirst({
      where: {
        tenantId,
        productId,
        effectiveFrom: { lte: date },
        OR: [
          { effectiveTo: null },
          { effectiveTo: { gte: date } },
        ],
      },
      orderBy: [
        { costType: 'asc' }, // STANDARD first
        { effectiveFrom: 'desc' },
      ],
    });

    if (costing) {
      return costing.totalCost;
    }

    // Fallback: product.standardCost
    const product = await tx.product.findUniqueOrThrow({
      where: { id: productId },
      select: { standardCost: true },
    });

    return product.standardCost ?? new Decimal(0);
  }

  // ────────────────────────────────────────────────────────────────────────
  // Actual Cost Aggregation
  // ────────────────────────────────────────────────────────────────────────

  /**
   * Aggregate actual costs for a work order from material issues,
   * labor entries, and production completions.
   */
  async aggregateWorkOrderActuals(tenantId: string, workOrderId: string) {
    return this.prisma.$transaction(async (tx) => {
      const wo = await tx.workOrder.findUniqueOrThrow({
        where: { id: workOrderId },
      });

      // Tenant isolation: verify work order belongs to caller's tenant
      if (wo.tenantId !== tenantId) {
        throw new BadRequestException('Work order not found');
      }

      const woWithRelations = await tx.workOrder.findUniqueOrThrow({
        where: { id: workOrderId },
        include: {
          product: true,
          operations: {
            include: {
              laborEntries: true,
            },
          },
        },
      });

      // Material cost: sum from inventory transactions linked to material issues
      const materialIssues = await tx.materialIssue.findMany({
        where: { workOrderId },
      });
      let actualMaterial = new Decimal(0);
      for (const mi of materialIssues) {
        // Look up product cost at time of issue — use tx-safe method
        const productCost = await this.getEffectiveCostInTx(tx, woWithRelations.tenantId, mi.productId, mi.issueDate);
        actualMaterial = actualMaterial.add(mi.quantity.mul(productCost));
      }

      // Labor cost: sum of labor entries × work center hourly rate
      let actualLabor = new Decimal(0);
      let actualOverhead = new Decimal(0);
      for (const op of woWithRelations.operations) {
        // Look up work center cost rates
        const wc = await tx.workCenter.findUnique({
          where: { id: op.workCenterId },
          select: { costPerHour: true, setupCostPerHour: true },
        });
        if (!wc) continue;
        for (const le of op.laborEntries) {
          const hours = le.hoursWorked ?? new Decimal(0);
          actualLabor = actualLabor.add(hours.mul(wc.costPerHour));
          actualOverhead = actualOverhead.add(hours.mul(wc.setupCostPerHour));
        }
      }

      // Completed qty
      const completions = await tx.productionCompletion.findMany({
        where: { workOrderId },
      });
      const completedQty = completions.reduce(
        (acc, pc) => acc.add(pc.completedQty),
        new Decimal(0),
      );

      // Subcontract cost — look up the corresponding routing operation
      // to determine if each operation is subcontracted
      let actualSubcontract = new Decimal(0);
      if (woWithRelations.routingId) {
        for (const op of woWithRelations.operations) {
          const routingOp = await tx.routingOperation.findFirst({
            where: {
              routingId: woWithRelations.routingId,
              operationCode: op.operationCode,
            },
            select: { isSubcontracted: true },
          });
          if (!routingOp?.isSubcontracted) continue;
          const wc = await tx.workCenter.findUnique({
            where: { id: op.workCenterId },
            select: { costPerHour: true },
          });
          if (!wc) continue;
          for (const le of op.laborEntries) {
            const hours = le.hoursWorked ?? new Decimal(0);
            actualSubcontract = actualSubcontract.add(hours.mul(wc.costPerHour));
          }
        }
      }

      const actualTotal = actualMaterial.add(actualLabor).add(actualOverhead).add(actualSubcontract);
      const costPerUnit = completedQty.gt(0)
        ? actualTotal.div(completedQty)
        : actualTotal;

      // Upsert WorkOrderCost
      const woC = await tx.workOrderCost.upsert({
        where: { workOrderId },
        create: {
          tenantId: woWithRelations.tenantId,
          workOrderId,
          materialCost: actualMaterial,
          laborCost: actualLabor,
          overheadCost: actualOverhead,
          subcontractCost: actualSubcontract,
          totalCost: actualTotal,
          costPerUnit,
          completedQty,
        },
        update: {
          materialCost: actualMaterial,
          laborCost: actualLabor,
          overheadCost: actualOverhead,
          subcontractCost: actualSubcontract,
          totalCost: actualTotal,
          costPerUnit,
          completedQty,
        },
      });

      return woC;
    });
  }

  // ────────────────────────────────────────────────────────────────────────
  // Variance Analysis
  // ────────────────────────────────────────────────────────────────────────

  /**
   * Calculate and persist standard vs actual variance on a work order.
   * Must be called after both:
   *   1. Standard cost is available (ProductCosting)
   *   2. Actuals are aggregated (WorkOrderCost)
   */
  async calculateVariance(tenantId: string, workOrderId: string) {
    return this.prisma.$transaction(async (tx) => {
      const wo = await tx.workOrder.findUniqueOrThrow({
        where: { id: workOrderId },
        include: { product: true },
      });

      // Tenant isolation: verify work order belongs to caller’s tenant
      if (wo.tenantId !== tenantId) {
        throw new BadRequestException('Work order not found');
      }

      const woCost = await tx.workOrderCost.findUniqueOrThrow({
        where: { workOrderId },
      });

      // Get standard cost — use a single costing record for ALL breakdowns
      // instead of two separate lookups that may diverge
      const stdCosting = await tx.productCosting.findFirst({
        where: {
          tenantId: wo.tenantId,
          productId: wo.productId,
          costType: CostType.STANDARD,
          effectiveFrom: {
            lte: wo.actualStartDate ?? wo.plannedStartDate ?? wo.createdAt,
          },
          OR: [{ effectiveTo: null }, { effectiveTo: { gte: wo.createdAt } }],
        },
        orderBy: { effectiveFrom: 'desc' },
      });

      if (!stdCosting) {
        throw new BadRequestException(
          `No standard cost found for product ${wo.productId}. Run cost rollup first.`,
        );
      }

      const completedQty = woCost.completedQty;
      const stdMaterial = stdCosting.materialCost.mul(completedQty);
      const stdLabor = stdCosting.laborCost.mul(completedQty);
      const stdOverhead = stdCosting.overheadCost.mul(completedQty);
      const stdTotal = stdCosting.totalCost.mul(completedQty);

      const materialVariance = woCost.materialCost.sub(stdMaterial);
      const laborVariance = woCost.laborCost.sub(stdLabor);
      const overheadVariance = woCost.overheadCost.sub(stdOverhead);
      const totalVariance = woCost.totalCost.sub(stdTotal);

      const updated = await tx.workOrderCost.update({
        where: { workOrderId },
        data: {
          stdMaterialCost: stdMaterial,
          stdLaborCost: stdLabor,
          stdOverheadCost: stdOverhead,
          stdTotalCost: stdTotal,
          materialVariance,
          laborVariance,
          overheadVariance,
          totalVariance,
        },
      });

      return {
        workOrderId,
        completedQty: completedQty.toNumber(),
        standard: {
          material: stdMaterial.toNumber(),
          labor: stdLabor.toNumber(),
          overhead: stdOverhead.toNumber(),
          total: stdTotal.toNumber(),
        },
        actual: {
          material: woCost.materialCost.toNumber(),
          labor: woCost.laborCost.toNumber(),
          overhead: woCost.overheadCost.toNumber(),
          total: woCost.totalCost.toNumber(),
        },
        variance: {
          material: materialVariance.toNumber(),
          labor: laborVariance.toNumber(),
          overhead: overheadVariance.toNumber(),
          total: totalVariance.toNumber(),
        },
        favorability: {
          material: materialVariance.isNeg() ? 'FAVORABLE' : 'UNFAVORABLE',
          labor: laborVariance.isNeg() ? 'FAVORABLE' : 'UNFAVORABLE',
          overhead: overheadVariance.isNeg() ? 'FAVORABLE' : 'UNFAVORABLE',
          total: totalVariance.isNeg() ? 'FAVORABLE' : 'UNFAVORABLE',
        },
      };
    });
  }

  // ────────────────────────────────────────────────────────────────────────
  // ProductCosting CRUD
  // ────────────────────────────────────────────────────────────────────────

  async getProductCostings(
    tenantId: string,
    filters?: { productId?: string; costType?: CostType; locationId?: string },
  ) {
    return this.prisma.productCosting.findMany({
      where: {
        tenantId,
        ...(filters?.productId && { productId: filters.productId }),
        ...(filters?.costType && { costType: filters.costType }),
        ...(filters?.locationId && { locationId: filters.locationId }),
      },
      include: {
        product: { select: { id: true, code: true, name: true } },
        location: { select: { id: true, code: true, name: true } },
      },
      orderBy: [{ productId: 'asc' }, { effectiveFrom: 'desc' }],
    });
  }

  async createProductCosting(
    tenantId: string,
    data: {
      productId: string;
      locationId?: string;
      costType?: CostType;
      effectiveFrom: Date;
      effectiveTo?: Date;
      materialCost: number;
      laborCost: number;
      overheadCost: number;
      subcontractCost?: number;
      version?: string;
      notes?: string;
    },
  ) {
    const totalCost =
      data.materialCost + data.laborCost + data.overheadCost + (data.subcontractCost ?? 0);

    return this.prisma.productCosting.create({
      data: {
        tenantId,
        productId: data.productId,
        locationId: data.locationId,
        costType: data.costType ?? CostType.STANDARD,
        effectiveFrom: data.effectiveFrom,
        effectiveTo: data.effectiveTo,
        materialCost: new Decimal(data.materialCost),
        laborCost: new Decimal(data.laborCost),
        overheadCost: new Decimal(data.overheadCost),
        subcontractCost: new Decimal(data.subcontractCost ?? 0),
        totalCost: new Decimal(totalCost),
        version: data.version,
        notes: data.notes,
      },
    });
  }

  // ────────────────────────────────────────────────────────────────────────
  // Batch Cost Rollup
  // ────────────────────────────────────────────────────────────────────────

  /**
   * Roll up standard costs for all active products in a tenant.
   * Returns summary of successes and failures.
   */
  async batchRollUp(tenantId: string, effectiveDate?: Date) {
    const date = effectiveDate ?? new Date();

    // Find all products with active BOMs
    const boms = await this.prisma.billOfMaterial.findMany({
      where: {
        tenantId,
        status: 'ACTIVE',
        effectiveFrom: { lte: date },
        OR: [
          { effectiveTo: null },
          { effectiveTo: { gte: date } },
        ],
      },
      select: { parentProductId: true },
      distinct: ['parentProductId'],
    });

    const results: Array<{ productId: string; success: boolean; error?: string; totalCost?: number }> = [];

    for (const bom of boms) {
      try {
        const result = await this.rollUpStandardCost(tenantId, bom.parentProductId, {
          effectiveDate: date,
        });
        results.push({
          productId: bom.parentProductId,
          success: true,
          totalCost: result.breakdown.totalCost,
        });
      } catch (err: any) {
        results.push({
          productId: bom.parentProductId,
          success: false,
          error: err.message,
        });
      }
    }

    return {
      total: results.length,
      succeeded: results.filter((r) => r.success).length,
      failed: results.filter((r) => !r.success).length,
      details: results,
    };
  }

  // ────────────────────────────────────────────────────────────────────────
  // Cost Comparison Report
  // ────────────────────────────────────────────────────────────────────────

  /**
   * Compare standard vs actual cost across multiple work orders.
   */
  async getCostComparisonReport(
    tenantId: string,
    filters?: { startDate?: Date; endDate?: Date; productId?: string },
  ) {
    const where: Prisma.WorkOrderCostWhereInput = {
      tenantId,
      ...(filters?.startDate && { createdAt: { gte: filters.startDate } }),
      ...(filters?.endDate && { createdAt: { lte: filters.endDate } }),
    };

    if (filters?.productId) {
      where.workOrder = { productId: filters.productId };
    }

    const costs = await this.prisma.workOrderCost.findMany({
      where,
      include: {
        workOrder: {
          select: {
            id: true,
            orderNumber: true,
            productId: true,
            product: { select: { code: true, name: true } },
            status: true,
          },
        },
      },
      orderBy: { createdAt: 'desc' },
    });

    const summary = costs.reduce(
      (acc, c) => ({
        totalStdCost: acc.totalStdCost.add(c.stdTotalCost),
        totalActualCost: acc.totalActualCost.add(c.totalCost),
        totalVariance: acc.totalVariance.add(c.totalVariance),
        totalMaterialVariance: acc.totalMaterialVariance.add(c.materialVariance),
        totalLaborVariance: acc.totalLaborVariance.add(c.laborVariance),
        totalOverheadVariance: acc.totalOverheadVariance.add(c.overheadVariance),
      }),
      {
        totalStdCost: new Decimal(0),
        totalActualCost: new Decimal(0),
        totalVariance: new Decimal(0),
        totalMaterialVariance: new Decimal(0),
        totalLaborVariance: new Decimal(0),
        totalOverheadVariance: new Decimal(0),
      },
    );

    return {
      workOrders: costs.map((c) => ({
        workOrderId: c.workOrderId,
        orderNumber: c.workOrder.orderNumber,
        product: c.workOrder.product,
        completedQty: c.completedQty.toNumber(),
        standardCost: c.stdTotalCost.toNumber(),
        actualCost: c.totalCost.toNumber(),
        totalVariance: c.totalVariance.toNumber(),
        materialVariance: c.materialVariance.toNumber(),
        laborVariance: c.laborVariance.toNumber(),
        overheadVariance: c.overheadVariance.toNumber(),
      })),
      summary: {
        workOrderCount: costs.length,
        totalStdCost: summary.totalStdCost.toNumber(),
        totalActualCost: summary.totalActualCost.toNumber(),
        totalVariance: summary.totalVariance.toNumber(),
        totalMaterialVariance: summary.totalMaterialVariance.toNumber(),
        totalLaborVariance: summary.totalLaborVariance.toNumber(),
        totalOverheadVariance: summary.totalOverheadVariance.toNumber(),
        overallFavorability: summary.totalVariance.isNeg() ? 'FAVORABLE' : 'UNFAVORABLE',
      },
    };
  }
}
