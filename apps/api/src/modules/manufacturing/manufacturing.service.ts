import { BadRequestException, ConflictException, Injectable, Logger, NotFoundException } from '@nestjs/common';
import { ActualType, ApproverType, BOMStatus, BOMType, FiscalCalendarType, LedgerEntryType, PlannedOrderStatus, PlannedOrderType, Prisma, RiskLevel, SOPForecastSource, SOPStatus, SupplyType, UserRole, UserStatus, WorkCenterType, WorkflowActionType, WorkflowStatus } from '@prisma/client';
import { Decimal } from '@prisma/client/runtime/library';
import { PrismaService } from '../../core/database/prisma.service';
import { WorkflowService } from '../../core/workflow/workflow.service';
import { CostingEngineService } from './services/costing-engine.service';
import { IdempotencyService } from './services/idempotency.service';
import { InventoryLedgerService } from './services/inventory-ledger.service';
import { SequenceService } from './services/sequence.service';

/**
 * Represents a component in an exploded BOM
 */
export interface ExplodedComponent {
  level: number;
  productId: string;
  productCode: string;
  productName: string;
  quantity: number;
  extendedQuantity: number;
  uom?: string;
  supplyType: SupplyType;
  totalCost?: number;
}

/**
 * Manufacturing Service
 * 
 * Provides comprehensive manufacturing planning capabilities including:
 * - Bill of Materials (BOM) management with multi-level explosion
 * - MRP (Material Requirements Planning)
 * - Work center and capacity management
 * - Inventory policy management
 * - S&OP cycle management
 */
@Injectable()
export class ManufacturingService {
  private readonly logger = new Logger(ManufacturingService.name);
  constructor(
    private prisma: PrismaService,
    private workflowService: WorkflowService,
    private readonly ledger: InventoryLedgerService,
    private readonly sequence: SequenceService,
    private readonly idempotency: IdempotencyService,
    private readonly costingEngine: CostingEngineService,
  ) {}

  /**
   * Resolve tenant's default currency. Never fall back to hardcoded 'USD'.
   * Throws if tenant has no defaultCurrency configured.
   */
  private async resolveTenantCurrency(tenantId: string): Promise<string> {
    const tenant = await this.prisma.tenant.findUnique({
      where: { id: tenantId },
      select: { defaultCurrency: true },
    });
    if (!tenant?.defaultCurrency) {
      throw new BadRequestException(
        `Tenant ${tenantId} has no default currency configured. Set tenant.defaultCurrency before performing financial operations.`,
      );
    }
    return tenant.defaultCurrency;
  }

  // ============================================================================
  // BOM (Bill of Materials) Operations
  // ============================================================================

  async getBOMs(tenantId: string, params: {
    status?: BOMStatus;
    productId?: string;
    search?: string;
    page?: number;
    pageSize?: number;
  } = {}) {
    const { status, productId, search, page = 1, pageSize = 20 } = params;
    
    const where: any = {
      tenantId,
      ...(status && { status }),
      ...(productId && { parentProductId: productId }),
      ...(search && {
        OR: [
          { name: { contains: search, mode: 'insensitive' } },
        ],
      }),
    };

    const [items, total] = await Promise.all([
      this.prisma.billOfMaterial.findMany({
        where,
        include: {
          components: {
            orderBy: { sequence: 'asc' },
          },
        },
        skip: (page - 1) * pageSize,
        take: pageSize,
        orderBy: { createdAt: 'desc' },
      }),
      this.prisma.billOfMaterial.count({ where }),
    ]);

    // Enrich with product info
    const productIds = new Set<string>();
    items.forEach(bom => {
      productIds.add(bom.parentProductId);
      bom.components.forEach(c => productIds.add(c.componentProductId));
    });

    const products = await this.prisma.product.findMany({
      where: { id: { in: Array.from(productIds) } },
      select: { id: true, code: true, name: true, standardCost: true, unitOfMeasure: true },
    });
    const productMap = new Map(products.map(p => [p.id, p]));

    const enrichedItems = items.map(bom => this.mapBOMResponse(bom, productMap));

    return {
      items: enrichedItems,
      total,
      page,
      pageSize,
      totalPages: Math.ceil(total / pageSize),
    };
  }

  async getBOM(tenantId: string, id: string) {
    const bom = await this.prisma.billOfMaterial.findFirst({
      where: { id, tenantId },
      include: {
        components: {
          orderBy: { sequence: 'asc' },
        },
      },
    });

    if (!bom) {
      throw new NotFoundException(`BOM with ID ${id} not found`);
    }

    const productIds = [bom.parentProductId, ...bom.components.map(c => c.componentProductId)];
    const products = await this.prisma.product.findMany({
      where: { id: { in: productIds } },
      select: { id: true, code: true, name: true, standardCost: true, unitOfMeasure: true },
    });
    const productMap = new Map(products.map(p => [p.id, p]));

    return this.mapBOMResponse(bom, productMap);
  }

  async createBOM(tenantId: string, dto: {
    parentProductId: string;
    name: string;
    version?: string;
    baseQuantity?: number;
    baseUOM?: string;
    effectiveFrom?: Date;
    effectiveTo?: Date;
    notes?: string;
    type?: BOMType;
    components?: Array<{
      componentProductId: string;
      quantity: number;
      uom: string;
      sequence?: number;
      scrapPercent?: number;
      supplyType?: SupplyType;
      leadTimeOffset?: number;
      notes?: string;
    }>;
  }) {
    // Validate product
    const product = await this.prisma.product.findFirst({
      where: { id: dto.parentProductId, tenantId },
    });
    if (!product) {
      throw new NotFoundException(`Product with ID ${dto.parentProductId} not found`);
    }

    const version = dto.version || '1.0';

    // Check for existing version
    const existing = await this.prisma.billOfMaterial.findFirst({
      where: { tenantId, parentProductId: dto.parentProductId, version },
    });
    if (existing) {
      throw new BadRequestException(`BOM version ${version} already exists for this product`);
    }

    // Validate components
    if (dto.components?.length) {
      const componentIds = dto.components.map(c => c.componentProductId);
      if (componentIds.includes(dto.parentProductId)) {
        throw new BadRequestException('A product cannot be a component of itself');
      }
      const components = await this.prisma.product.findMany({
        where: { id: { in: componentIds }, tenantId },
      });
      if (components.length !== componentIds.length) {
        throw new BadRequestException('One or more component products not found');
      }
    }

    return this.prisma.billOfMaterial.create({
      data: {
        tenantId,
        parentProductId: dto.parentProductId,
        name: dto.name,
        version,
        type: dto.type || BOMType.MANUFACTURING,
        status: BOMStatus.DRAFT,
        baseQuantity: dto.baseQuantity ? new Decimal(dto.baseQuantity) : new Decimal(1),
        baseUOM: dto.baseUOM || 'EA',
        effectiveFrom: dto.effectiveFrom || new Date(),
        effectiveTo: dto.effectiveTo,
        notes: dto.notes,
        components: dto.components ? {
          create: dto.components.map((c, idx) => ({
            componentProductId: c.componentProductId,
            quantity: new Decimal(c.quantity),
            uom: c.uom || 'EA',
            sequence: c.sequence ?? (idx + 1) * 10,
            scrapPercent: c.scrapPercent ? new Decimal(c.scrapPercent) : new Decimal(0),
            supplyType: c.supplyType || SupplyType.STOCK,
            leadTimeOffset: c.leadTimeOffset || 0,
            notes: c.notes,
          })),
        } : undefined,
      },
      include: { components: true },
    });
  }

  async createBOMFromApi(tenantId: string, dto: any) {
    const productId = dto.productId || dto.parentProductId;
    if (!productId) {
      throw new BadRequestException('productId is required');
    }

    const product = await this.prisma.product.findFirst({
      where: { id: productId, tenantId },
    });

    if (!product) {
      throw new NotFoundException('Product not found');
    }

    const bom = await this.createBOM(tenantId, {
      parentProductId: productId,
      name: dto.name || `${product.name} BOM`,
      version: dto.revision || dto.version,
      baseQuantity: dto.baseQuantity,
      baseUOM: dto.baseUOM,
      effectiveFrom: dto.effectiveDate ? new Date(dto.effectiveDate) : undefined,
      effectiveTo: dto.expiryDate ? new Date(dto.expiryDate) : undefined,
      notes: dto.notes,
      type: dto.bomType as BOMType,
      components: Array.isArray(dto.components)
        ? dto.components.map((c: any, idx: number) => ({
            componentProductId: c.componentProductId,
            quantity: c.quantityPer ?? c.quantity ?? 1,
            uom: c.uom || 'EA',
            sequence: c.position ?? c.sequence ?? (idx + 1) * 10,
            scrapPercent: c.wastagePercent ?? c.scrapPercent,
            supplyType: c.supplyType as SupplyType,
            leadTimeOffset: c.leadTimeOffset,
            notes: c.notes,
          }))
        : undefined,
    });

    const productMap = new Map<string, any>([[product.id, product]]);
    return this.mapBOMResponse(bom, productMap);
  }

  async updateBOM(tenantId: string, bomId: string, dto: any) {
    const bom = await this.prisma.billOfMaterial.findFirst({
      where: { id: bomId, tenantId },
    });
    if (!bom) {
      throw new NotFoundException('BOM not found');
    }

    const updated = await this.prisma.billOfMaterial.update({
      where: { id: bomId },
      data: {
        ...(dto.name && { name: dto.name }),
        ...(dto.revision && { version: dto.revision }),
        ...(dto.version && { version: dto.version }),
        ...(dto.bomType && { type: dto.bomType as BOMType }),
        ...(dto.status && { status: dto.status as BOMStatus }),
        ...(dto.effectiveDate && { effectiveFrom: new Date(dto.effectiveDate) }),
        ...(dto.expiryDate && { effectiveTo: new Date(dto.expiryDate) }),
        ...(dto.baseQuantity && { baseQuantity: new Decimal(dto.baseQuantity) }),
        ...(dto.baseUOM && { baseUOM: dto.baseUOM }),
        ...(dto.notes !== undefined && { notes: dto.notes }),
      },
      include: { components: true },
    });

    const productIds = [updated.parentProductId, ...updated.components.map(c => c.componentProductId)];
    const products = await this.prisma.product.findMany({
      where: { id: { in: productIds } },
      select: { id: true, code: true, name: true, standardCost: true, unitOfMeasure: true },
    });
    const productMap = new Map(products.map(p => [p.id, p]));
    return this.mapBOMResponse(updated, productMap);
  }

  async deleteBOM(tenantId: string, bomId: string) {
    const bom = await this.prisma.billOfMaterial.findFirst({
      where: { id: bomId, tenantId },
    });
    if (!bom) {
      throw new NotFoundException('BOM not found');
    }

    await this.prisma.billOfMaterial.delete({ where: { id: bomId } });
    return { success: true };
  }

  async addBOMComponent(tenantId: string, bomId: string, dto: any) {
    const bom = await this.prisma.billOfMaterial.findFirst({
      where: { id: bomId, tenantId },
    });
    if (!bom) {
      throw new NotFoundException('BOM not found');
    }
    const product = await this.prisma.product.findFirst({
      where: { id: dto.componentProductId, tenantId },
      select: { id: true, code: true, name: true, standardCost: true, unitOfMeasure: true },
    });
    if (!product) {
      throw new NotFoundException('Component product not found');
    }

    const component = await this.prisma.bOMComponent.create({
      data: {
        bomId,
        componentProductId: dto.componentProductId,
        quantity: new Decimal(dto.quantity),
        uom: dto.uom || product.unitOfMeasure,
        sequence: dto.sequence ?? dto.position ?? 10,
        scrapPercent: dto.scrapPercent !== undefined ? new Decimal(dto.scrapPercent) : new Decimal(0),
        supplyType: dto.supplyType || SupplyType.DIRECT_PURCHASE,
        leadTimeOffset: dto.leadTimeOffset,
        notes: dto.notes,
      },
    });

    return this.mapBOMComponentResponse(component, product);
  }

  async updateBOMComponent(tenantId: string, componentId: string, dto: any) {
    const component = await this.prisma.bOMComponent.findFirst({
      where: { id: componentId, bom: { tenantId } },
    });

    if (!component) {
      throw new NotFoundException('BOM component not found');
    }

    const updated = await this.prisma.bOMComponent.update({
      where: { id: componentId },
      data: {
        ...(dto.componentProductId && { componentProductId: dto.componentProductId }),
        ...(dto.quantity !== undefined && { quantity: new Decimal(dto.quantity) }),
        ...(dto.uom !== undefined && { uom: dto.uom }),
        ...(dto.sequence !== undefined && { sequence: dto.sequence }),
        ...(dto.position !== undefined && { sequence: dto.position }),
        ...(dto.scrapPercent !== undefined && { scrapPercent: new Decimal(dto.scrapPercent) }),
        ...(dto.wastagePercent !== undefined && { scrapPercent: new Decimal(dto.wastagePercent) }),
        ...(dto.supplyType && { supplyType: dto.supplyType }),
        ...(dto.leadTimeOffset !== undefined && { leadTimeOffset: dto.leadTimeOffset }),
        ...(dto.notes !== undefined && { notes: dto.notes }),
      },
    });

    const product = await this.prisma.product.findUnique({
      where: { id: updated.componentProductId },
      select: { id: true, code: true, name: true, standardCost: true, unitOfMeasure: true },
    });

    return this.mapBOMComponentResponse(updated, product);
  }

  async deleteBOMComponent(tenantId: string, componentId: string) {
    const component = await this.prisma.bOMComponent.findFirst({
      where: { id: componentId, bom: { tenantId } },
      select: { id: true },
    });

    if (!component) {
      throw new NotFoundException('BOM component not found');
    }

    await this.prisma.bOMComponent.delete({ where: { id: componentId } });
    return { success: true };
  }

  async updateBOMStatus(tenantId: string, id: string, status: BOMStatus) {
    const bom = await this.prisma.billOfMaterial.findFirst({
      where: { id, tenantId },
      select: { id: true, status: true },
    });

    if (!bom) {
      throw new NotFoundException('BOM not found');
    }

    // Valid transitions: DRAFT -> PENDING_APPROVAL -> ACTIVE -> OBSOLETE
    const validTransitions: Record<BOMStatus, BOMStatus[]> = {
      [BOMStatus.DRAFT]: [BOMStatus.PENDING_APPROVAL, BOMStatus.ACTIVE],
      [BOMStatus.PENDING_APPROVAL]: [BOMStatus.ACTIVE, BOMStatus.DRAFT],
      [BOMStatus.ACTIVE]: [BOMStatus.OBSOLETE],
      [BOMStatus.OBSOLETE]: [],
    };

    if (!validTransitions[bom.status].includes(status)) {
      throw new BadRequestException(`Invalid status transition from ${bom.status} to ${status}`);
    }

    return this.prisma.billOfMaterial.update({
      where: { id },
      data: { status },
    });
  }

  async explodeBOM(tenantId: string, bomId: string, maxLevels: number = 10) {
    const bom = await this.getBOM(tenantId, bomId);

    const exploded: ExplodedComponent[] = [];
    const visited = new Set<string>();

    const explode = async (components: any[], level: number, parentQty: number) => {
      if (level > maxLevels) return;

      for (const comp of components) {
        const product = comp.componentProduct;
        if (!product) continue;

        const extendedQty = Number(comp.quantity) * parentQty;

        exploded.push({
          level,
          productId: comp.componentProductId,
          productCode: product.code,
          productName: product.name,
          quantity: Number(comp.quantity),
          extendedQuantity: extendedQty,
          uom: comp.uom || product.unitOfMeasure,
          supplyType: comp.supplyType,
          totalCost: product.standardCost ? Number(product.standardCost) * extendedQty : undefined,
        });

        if (!visited.has(comp.componentProductId)) {
          visited.add(comp.componentProductId);
          
          // Find child BOM
          const childBom = await this.prisma.billOfMaterial.findFirst({
            where: { tenantId, parentProductId: comp.componentProductId, status: BOMStatus.ACTIVE },
            include: { components: true },
          });

          if (childBom?.components?.length) {
            const childProducts = await this.prisma.product.findMany({
              where: { id: { in: childBom.components.map(c => c.componentProductId) } },
              select: { id: true, code: true, name: true, standardCost: true, unitOfMeasure: true },
            });
            const productMap = new Map(childProducts.map(p => [p.id, p]));
            
            const enriched = childBom.components.map(c => ({
              ...c,
              componentProduct: productMap.get(c.componentProductId),
            }));

            await explode(enriched, level + 1, extendedQty);
          }
        }
      }
    };

    await explode(bom.components, 1, 1);

    return {
      bom,
      components: exploded,
      summary: {
        totalLevels: Math.max(...exploded.map(c => c.level), 0),
        totalComponents: exploded.length,
        uniqueComponents: new Set(exploded.map(c => c.productId)).size,
        totalCost: exploded.reduce((sum, c) => sum + (c.totalCost || 0), 0),
      },
    };
  }

  async rollupCost(tenantId: string, bomId: string, userId: string) {
    const exploded = await this.explodeBOM(tenantId, bomId, 10);
    const totalCost = exploded.summary.totalCost;

    return {
      bomId,
      rolledBy: userId,
      totalCost,
      rolledAt: new Date().toISOString(),
    };
  }

  async getWhereUsed(tenantId: string, productId: string) {
    const components = await this.prisma.bOMComponent.findMany({
      where: {
        componentProductId: productId,
        bom: { tenantId },
      },
      include: {
        bom: {
          select: {
            id: true,
            name: true,
            version: true,
            status: true,
            parentProductId: true,
          },
        },
      },
      orderBy: { createdAt: 'desc' },
    });

    return components.map((component) => ({
      bomId: component.bom.id,
      bomName: component.bom.name,
      revision: component.bom.version,
      status: component.bom.status,
      parentProductId: component.bom.parentProductId,
      quantity: Number(component.quantity),
      uom: component.uom,
      sequence: component.sequence,
    }));
  }

  async copyBOM(tenantId: string, bomId: string, dto: any) {
    const source = await this.prisma.billOfMaterial.findFirst({
      where: { id: bomId, tenantId },
      include: { components: true },
    });

    if (!source) {
      throw new NotFoundException('BOM not found');
    }

    const copy = await this.prisma.billOfMaterial.create({
      data: {
        tenantId,
        parentProduct: { connect: { id: dto.targetProductId || source.parentProductId } },
        name: dto.name || `${source.name} Copy`,
        version: dto.newRevision || `${source.version}-COPY`,
        baseQuantity: source.baseQuantity,
        baseUOM: source.baseUOM,
        effectiveFrom: source.effectiveFrom,
        effectiveTo: source.effectiveTo,
        type: source.type,
        status: BOMStatus.DRAFT,
        notes: source.notes,
      },
    });

    if (dto.copyComponents !== false && source.components.length) {
      await this.prisma.bOMComponent.createMany({
        data: source.components.map((component) => ({
          bomId: copy.id,
          componentProductId: component.componentProductId,
          quantity: component.quantity,
          uom: component.uom,
          sequence: component.sequence,
          scrapPercent: component.scrapPercent,
          supplyType: component.supplyType,
          leadTimeOffset: component.leadTimeOffset,
          notes: component.notes,
        })),
      });
    }

    const copiedBom = await this.prisma.billOfMaterial.findUnique({
      where: { id: copy.id },
      include: { components: true },
    });

    return copiedBom;
  }

  async compareBOMs(tenantId: string, bomId1: string, bomId2: string) {
    const [bom1, bom2] = await Promise.all([
      this.prisma.billOfMaterial.findFirst({ where: { id: bomId1, tenantId }, include: { components: true } }),
      this.prisma.billOfMaterial.findFirst({ where: { id: bomId2, tenantId }, include: { components: true } }),
    ]);

    if (!bom1 || !bom2) {
      throw new NotFoundException('One or both BOMs not found');
    }

    const keyOf = (component: { componentProductId: string; sequence: number | null }) =>
      `${component.componentProductId}:${component.sequence ?? 0}`;

    const bom1Map = new Map(bom1.components.map((component) => [keyOf(component), component]));
    const bom2Map = new Map(bom2.components.map((component) => [keyOf(component), component]));

    const added: string[] = [];
    const removed: string[] = [];
    const changed: string[] = [];

    for (const [key, component] of bom2Map.entries()) {
      if (!bom1Map.has(key)) {
        added.push(component.componentProductId);
      }
    }

    for (const [key, component] of bom1Map.entries()) {
      const matching = bom2Map.get(key);
      if (!matching) {
        removed.push(component.componentProductId);
      } else if (
        Number(component.quantity) !== Number(matching.quantity) ||
        Number(component.scrapPercent ?? 0) !== Number(matching.scrapPercent ?? 0)
      ) {
        changed.push(component.componentProductId);
      }
    }

    return {
      bomId1,
      bomId2,
      summary: {
        added: added.length,
        removed: removed.length,
        changed: changed.length,
      },
      added,
      removed,
      changed,
    };
  }

  // ============================================================================
  // Work Center Operations
  // ============================================================================

  async getWorkCenters(tenantId: string, params: {
    type?: WorkCenterType;
    isActive?: boolean;
    locationId?: string;
    page?: number;
    pageSize?: number;
  } = {}) {
    const { type, isActive, locationId, page = 1, pageSize = 20 } = params;
    
    const where: any = {
      tenantId,
      ...(type && { type }),
      ...(isActive !== undefined && { status: isActive ? 'ACTIVE' : 'INACTIVE' }),
      ...(locationId && { locationId }),
    };

    const [items, total] = await Promise.all([
      this.prisma.workCenter.findMany({
        where,
        skip: (page - 1) * pageSize,
        take: pageSize,
        orderBy: { name: 'asc' },
      }),
      this.prisma.workCenter.count({ where }),
    ]);

    return { items, total, page, pageSize, totalPages: Math.ceil(total / pageSize) };
  }

  async createWorkCenter(tenantId: string, dto: {
    code: string;
    name: string;
    description?: string;
    type: WorkCenterType;
    costPerHour?: number;
    setupCostPerHour?: number;
    efficiency?: number;
    locationId?: string;
  }) {
    if (dto.locationId) {
      const location = await this.prisma.location.findFirst({
        where: { id: dto.locationId, tenantId },
      });
      if (!location) {
        throw new NotFoundException('Location not found');
      }
    }

    return this.prisma.workCenter.create({
      data: {
        tenantId,
        code: dto.code,
        name: dto.name,
        description: dto.description,
        type: dto.type,
        costPerHour: dto.costPerHour ? new Decimal(dto.costPerHour) : new Decimal(0),
        setupCostPerHour: dto.setupCostPerHour ? new Decimal(dto.setupCostPerHour) : new Decimal(0),
        efficiency: dto.efficiency ? new Decimal(dto.efficiency) : new Decimal(100),
        utilization: new Decimal(100),
        locationId: dto.locationId,
        status: 'ACTIVE',
      },
    });
  }

  async getWorkCenter(tenantId: string, workCenterId: string) {
    const workCenter = await this.prisma.workCenter.findFirst({
      where: { id: workCenterId, tenantId },
      include: {
        capacities: true,
        shifts: true,
      },
    });

    if (!workCenter) {
      throw new NotFoundException('Work center not found');
    }

    return workCenter;
  }

  async updateWorkCenter(tenantId: string, workCenterId: string, dto: any) {
    const workCenter = await this.prisma.workCenter.findFirst({
      where: { id: workCenterId, tenantId },
    });
    if (!workCenter) {
      throw new NotFoundException('Work center not found');
    }

    return this.prisma.workCenter.update({
      where: { id: workCenterId },
      data: {
        ...(dto.code && { code: dto.code }),
        ...(dto.name && { name: dto.name }),
        ...(dto.description !== undefined && { description: dto.description }),
        ...(dto.type && { type: dto.type as WorkCenterType }),
        ...(dto.costPerHour !== undefined && { costPerHour: new Decimal(dto.costPerHour) }),
        ...(dto.setupCostPerHour !== undefined && { setupCostPerHour: new Decimal(dto.setupCostPerHour) }),
        ...(dto.efficiencyPercent !== undefined && { efficiency: new Decimal(dto.efficiencyPercent) }),
        ...(dto.efficiency !== undefined && { efficiency: new Decimal(dto.efficiency) }),
        ...(dto.locationId !== undefined && { locationId: dto.locationId }),
      },
    });
  }

  async toggleWorkCenterStatus(tenantId: string, workCenterId: string) {
    const workCenter = await this.prisma.workCenter.findFirst({
      where: { id: workCenterId, tenantId },
    });
    if (!workCenter) {
      throw new NotFoundException('Work center not found');
    }

    const nextStatus = workCenter.status === 'ACTIVE' ? 'INACTIVE' : 'ACTIVE';
    return this.prisma.workCenter.update({
      where: { id: workCenterId },
      data: { status: nextStatus },
    });
  }

  async deleteWorkCenter(tenantId: string, workCenterId: string) {
    const workCenter = await this.prisma.workCenter.findFirst({
      where: { id: workCenterId, tenantId },
    });
    if (!workCenter) {
      throw new NotFoundException('Work center not found');
    }

    await this.prisma.workCenter.delete({ where: { id: workCenterId } });
    return { success: true };
  }

  async getCapacities(tenantId: string, workCenterId: string, params: {
    effectiveDate?: string;
    includeExpired?: boolean;
  } = {}) {
    const { effectiveDate, includeExpired } = params;
    const targetDate = effectiveDate ? new Date(effectiveDate) : undefined;

    const capacities = await this.prisma.workCenterCapacity.findMany({
      where: {
        workCenterId,
        workCenter: { tenantId },
        ...(targetDate && {
          effectiveFrom: { lte: targetDate },
          ...(includeExpired ? {} : { OR: [{ effectiveTo: null }, { effectiveTo: { gte: targetDate } }] }),
        }),
      },
      orderBy: { effectiveFrom: 'desc' },
    });

    return capacities.map(capacity => this.mapCapacityResponse(capacity));
  }

  async getCurrentCapacity(tenantId: string, workCenterId: string) {
    const today = new Date();
    const capacity = await this.prisma.workCenterCapacity.findFirst({
      where: {
        workCenterId,
        workCenter: { tenantId },
        effectiveFrom: { lte: today },
        OR: [{ effectiveTo: null }, { effectiveTo: { gte: today } }],
      },
      orderBy: { effectiveFrom: 'desc' },
    });

    return capacity ? this.mapCapacityResponse(capacity) : null;
  }

  async createCapacity(tenantId: string, workCenterId: string, dto: any) {
    const workCenter = await this.prisma.workCenter.findFirst({
      where: { id: workCenterId, tenantId },
    });
    if (!workCenter) {
      throw new NotFoundException('Work center not found');
    }

    const availableHours = dto.availableHoursPerDay ?? 8;
    const capacityPerDay = (dto.standardCapacityPerHour ?? dto.capacityPerDay ?? 0) * availableHours;

    const created = await this.prisma.workCenterCapacity.create({
      data: {
        workCenterId,
        effectiveFrom: new Date(dto.effectiveDate),
        effectiveTo: dto.endDate ? new Date(dto.endDate) : null,
        capacityPerDay: new Decimal(capacityPerDay),
        capacityUOM: dto.capacityUOM || 'HOURS',
        numberOfMachines: dto.numberOfMachines || 1,
        numberOfShifts: dto.numberOfShifts || 1,
        hoursPerShift: new Decimal(dto.availableHoursPerDay ?? 8),
      },
    });

    return this.mapCapacityResponse(created);
  }

  async updateCapacity(tenantId: string, capacityId: string, dto: any) {
    const capacity = await this.prisma.workCenterCapacity.findFirst({
      where: { id: capacityId, workCenter: { tenantId } },
    });
    if (!capacity) {
      throw new NotFoundException('Capacity not found');
    }

    const availableHours = dto.availableHoursPerDay ?? Number(capacity.hoursPerShift ?? 8);
    const capacityPerDay = dto.standardCapacityPerHour !== undefined
      ? dto.standardCapacityPerHour * availableHours
      : dto.capacityPerDay;

    const updated = await this.prisma.workCenterCapacity.update({
      where: { id: capacityId },
      data: {
        ...(dto.effectiveDate && { effectiveFrom: new Date(dto.effectiveDate) }),
        ...(dto.endDate && { effectiveTo: new Date(dto.endDate) }),
        ...(capacityPerDay !== undefined && { capacityPerDay: new Decimal(capacityPerDay) }),
        ...(dto.capacityUOM && { capacityUOM: dto.capacityUOM }),
        ...(dto.numberOfMachines && { numberOfMachines: dto.numberOfMachines }),
        ...(dto.numberOfShifts && { numberOfShifts: dto.numberOfShifts }),
        ...(dto.availableHoursPerDay && { hoursPerShift: new Decimal(dto.availableHoursPerDay) }),
      },
    });

    return this.mapCapacityResponse(updated);
  }

  async deleteCapacity(tenantId: string, capacityId: string) {
    const capacity = await this.prisma.workCenterCapacity.findFirst({
      where: { id: capacityId, workCenter: { tenantId } },
    });
    if (!capacity) {
      throw new NotFoundException('Capacity not found');
    }
    await this.prisma.workCenterCapacity.delete({ where: { id: capacityId } });
    return { success: true };
  }

  async getShifts(tenantId: string, workCenterId: string, params: {
    effectiveDate?: string;
    includeExpired?: boolean;
  } = {}) {
    const shifts = await this.prisma.workCenterShift.findMany({
      where: { workCenterId, workCenter: { tenantId } },
      orderBy: { shiftName: 'asc' },
    });

    return shifts.map(shift => this.mapShiftResponse(shift));
  }

  async createShift(tenantId: string, workCenterId: string, dto: any) {
    const workCenter = await this.prisma.workCenter.findFirst({
      where: { id: workCenterId, tenantId },
    });
    if (!workCenter) {
      throw new NotFoundException('Work center not found');
    }

    const created = await this.prisma.workCenterShift.create({
      data: {
        workCenterId,
        shiftName: dto.name,
        startTime: dto.startTime,
        endTime: dto.endTime,
        daysOfWeek: dto.daysOfWeek || [1, 2, 3, 4, 5],
        breakMinutes: dto.breakMinutes || 0,
        isActive: true,
      },
    });

    return this.mapShiftResponse(created);
  }

  async updateShift(tenantId: string, shiftId: string, dto: any) {
    const shift = await this.prisma.workCenterShift.findFirst({
      where: { id: shiftId, workCenter: { tenantId } },
    });
    if (!shift) {
      throw new NotFoundException('Shift not found');
    }

    const updated = await this.prisma.workCenterShift.update({
      where: { id: shiftId },
      data: {
        ...(dto.name && { shiftName: dto.name }),
        ...(dto.startTime && { startTime: dto.startTime }),
        ...(dto.endTime && { endTime: dto.endTime }),
        ...(dto.daysOfWeek && { daysOfWeek: dto.daysOfWeek }),
        ...(dto.breakMinutes !== undefined && { breakMinutes: dto.breakMinutes }),
        ...(dto.isActive !== undefined && { isActive: dto.isActive }),
      },
    });

    return this.mapShiftResponse(updated);
  }

  async deleteShift(tenantId: string, shiftId: string) {
    const shift = await this.prisma.workCenterShift.findFirst({
      where: { id: shiftId, workCenter: { tenantId } },
    });
    if (!shift) {
      throw new NotFoundException('Shift not found');
    }
    await this.prisma.workCenterShift.delete({ where: { id: shiftId } });
    return { success: true };
  }

  async getCapacityUtilization(tenantId: string, params: {
    workCenterIds?: string[];
    startDate: string;
    endDate: string;
    granularity?: string;
  }) {
    const { workCenterIds, startDate, endDate, granularity } = params;
    const start = new Date(startDate);
    const end = new Date(endDate);

    const workCenters = await this.prisma.workCenter.findMany({
      where: {
        tenantId,
        ...(workCenterIds?.length ? { id: { in: workCenterIds } } : {}),
      },
      orderBy: { name: 'asc' },
    });

    const wcIds = workCenters.map(wc => wc.id);

    const [capacities, operations] = await Promise.all([
      this.prisma.workCenterCapacity.findMany({
        where: { workCenterId: { in: wcIds } },
        orderBy: { effectiveFrom: 'desc' },
      }),
      // Get actual load from work order operations whose parent WO overlaps the date range
      this.prisma.workOrderOperation.findMany({
        where: {
          workCenterId: { in: wcIds },
          workOrder: {
            tenantId,
            status: { in: ['PLANNED', 'RELEASED', 'IN_PROGRESS'] },
            plannedStartDate: { lte: end },
            plannedEndDate: { gte: start },
          },
        },
        include: { workOrder: { select: { id: true, plannedQty: true, orderNumber: true } } },
      }),
    ]);

    const capacityMap = new Map(capacities.map(c => [c.workCenterId, c]));

    // Aggregate actual load per work center: sum of (setupTime + runTime * qty) in hours
    const loadMap = new Map<string, { totalHours: number; orderCount: number }>();
    for (const op of operations) {
      const setupHrs = Number(op.plannedSetupTime) || 0;
      const runHrs = Number(op.plannedRunTime) || 0;
      const qty = Number(op.workOrder.plannedQty) || 1;
      const totalHrs = setupHrs + (runHrs * qty);
      const existing = loadMap.get(op.workCenterId) || { totalHours: 0, orderCount: 0 };
      existing.totalHours += totalHrs;
      existing.orderCount += 1;
      loadMap.set(op.workCenterId, existing);
    }

    return workCenters.map(workCenter => {
      const capacity = capacityMap.get(workCenter.id);
      const days = Math.max(1, Math.ceil((end.getTime() - start.getTime()) / (1000 * 60 * 60 * 24)) + 1);
      const availableCapacity = capacity ? Number(capacity.capacityPerDay) * days : 0;
      const load = loadMap.get(workCenter.id) || { totalHours: 0, orderCount: 0 };
      const plannedCapacity = load.totalHours;
      const utilizationPercent = availableCapacity > 0 ? (plannedCapacity / availableCapacity) * 100 : 0;

      return {
        workCenterId: workCenter.id,
        workCenterCode: workCenter.code,
        workCenterName: workCenter.name,
        period: `${startDate} - ${endDate}`,
        availableCapacity,
        plannedCapacity,
        utilizationPercent: Math.round(utilizationPercent * 10) / 10,
        remainingCapacity: availableCapacity - plannedCapacity,
        isOverloaded: utilizationPercent > 100,
        orderCount: load.orderCount,
        granularity: granularity || 'MONTH',
      };
    });
  }

  async getCapacityBottlenecks(tenantId: string, params: {
    startDate: string;
    endDate: string;
    threshold?: number;
  }) {
    const utilization = await this.getCapacityUtilization(tenantId, {
      startDate: params.startDate,
      endDate: params.endDate,
    });

    const threshold = params.threshold ?? 90;
    return utilization
      .filter(item => item.utilizationPercent >= threshold)
      .map(item => ({
        workCenterId: item.workCenterId,
        workCenterCode: item.workCenterCode,
        workCenterName: item.workCenterName,
        period: item.period,
        utilizationPercent: item.utilizationPercent,
        overloadHours: Math.max(0, item.plannedCapacity - item.availableCapacity),
        impactedOrders: item.orderCount || 0,
        severity: item.utilizationPercent >= 110 ? 'CRITICAL' : item.utilizationPercent >= 100 ? 'HIGH' : 'MEDIUM',
        recommendations: item.utilizationPercent >= 110
          ? ['Immediately rebalance load', 'Add overtime or extra shifts', 'Consider subcontracting']
          : item.utilizationPercent >= 100
            ? ['Review load balancing', 'Add overtime or extra shifts']
            : ['Monitor closely', 'Plan proactive rebalancing'],
      }));
  }

  async getCapacityPlan(tenantId: string, workCenterId: string, params: {
    startDate: string;
    endDate: string;
    granularity?: string;
  }) {
    const workCenter = await this.prisma.workCenter.findFirst({
      where: { id: workCenterId, tenantId },
    });
    if (!workCenter) {
      throw new NotFoundException('Work center not found');
    }

    const capacity = await this.prisma.workCenterCapacity.findFirst({
      where: { workCenterId },
      orderBy: { effectiveFrom: 'desc' },
    });

    // Get actual work order operations for this work center in the date range
    const operations = await this.prisma.workOrderOperation.findMany({
      where: {
        workCenterId,
        workOrder: {
          tenantId,
          status: { in: ['PLANNED', 'RELEASED', 'IN_PROGRESS'] },
          plannedStartDate: { lte: new Date(params.endDate) },
          plannedEndDate: { gte: new Date(params.startDate) },
        },
      },
      include: { workOrder: { select: { plannedQty: true, plannedStartDate: true, plannedEndDate: true } } },
    });

    const periods = this.buildPeriods(params.startDate, params.endDate, params.granularity || 'MONTH');
    const periodData = periods.map(period => {
      const days = period.days;
      const availableCapacity = capacity ? Number(capacity.capacityPerDay) * days : 0;
      const periodStart = period.start;
      const periodEnd = period.end;

      // Sum load from operations whose parent WO overlaps this period
      let plannedLoad = 0;
      for (const op of operations) {
        const woStart = new Date(op.workOrder.plannedStartDate);
        const woEnd = new Date(op.workOrder.plannedEndDate);
        if (woStart <= periodEnd && woEnd >= periodStart) {
          const setupHrs = Number(op.plannedSetupTime) || 0;
          const runHrs = Number(op.plannedRunTime) || 0;
          const qty = Number(op.workOrder.plannedQty) || 1;
          plannedLoad += setupHrs + (runHrs * qty);
        }
      }

      return {
        period: period.label,
        availableCapacity,
        plannedLoad,
        utilizationPercent: availableCapacity > 0 ? Math.round((plannedLoad / availableCapacity) * 1000) / 10 : 0,
      };
    });

    const totalAvailableCapacity = periodData.reduce((sum, p) => sum + p.availableCapacity, 0);
    const totalPlannedLoad = periodData.reduce((sum, p) => sum + p.plannedLoad, 0);
    const peak = periodData.reduce((max, p) => (p.utilizationPercent > max.utilizationPercent ? p : max), periodData[0] || null);

    return {
      workCenterId,
      periods: periodData,
      summary: {
        totalAvailableCapacity,
        totalPlannedLoad,
        averageUtilization: totalAvailableCapacity > 0 ? (totalPlannedLoad / totalAvailableCapacity) * 100 : 0,
        peakUtilization: peak?.utilizationPercent || 0,
        peakPeriod: peak?.period || '',
      },
    };
  }

  async getAggregateCapacityPlan(tenantId: string, params: {
    workCenterIds?: string[];
    locationId?: string;
    startDate?: string;
    endDate?: string;
    granularity?: string;
  }) {
    const workCenters = await this.prisma.workCenter.findMany({
      where: {
        tenantId,
        ...(params.workCenterIds?.length ? { id: { in: params.workCenterIds } } : {}),
        ...(params.locationId ? { locationId: params.locationId } : {}),
      },
    });

    const startDate = params.startDate || new Date().toISOString().slice(0, 10);
    const endDate = params.endDate || new Date().toISOString().slice(0, 10);
    const periods = this.buildPeriods(startDate, endDate, params.granularity || 'MONTH');

    const capacities = await this.prisma.workCenterCapacity.findMany({
      where: { workCenterId: { in: workCenters.map(wc => wc.id) } },
      orderBy: { effectiveFrom: 'desc' },
    });
    const capacityMap = new Map(capacities.map(c => [c.workCenterId, c]));

    const periodData = periods.map(period => {
      const days = period.days;
      let availableCapacity = 0;
      let plannedLoad = 0;
      workCenters.forEach(wc => {
        const capacity = capacityMap.get(wc.id);
        if (!capacity) return;
        const available = Number(capacity.capacityPerDay) * days;
        availableCapacity += available;
        plannedLoad += available * (Number(wc.utilization) / 100);
      });
      return {
        period: period.label,
        availableCapacity,
        plannedLoad,
        utilizationPercent: availableCapacity > 0 ? (plannedLoad / availableCapacity) * 100 : 0,
      };
    });

    return { periods: periodData };
  }

  // ============================================================================
  // Inventory Policy Operations
  // ============================================================================

  async getInventoryPolicies(tenantId: string, params: {
    productId?: string;
    locationId?: string;
    page?: number;
    pageSize?: number;
  } = {}) {
    const { productId, locationId, page = 1, pageSize = 20 } = params;
    
    const where: any = {
      tenantId,
      ...(productId && { productId }),
      ...(locationId && { locationId }),
    };

    const [items, total] = await Promise.all([
      this.prisma.inventoryPolicy.findMany({
        where,
        skip: (page - 1) * pageSize,
        take: pageSize,
        orderBy: { createdAt: 'desc' },
      }),
      this.prisma.inventoryPolicy.count({ where }),
    ]);

    // Get product and location info separately
    const productIds = [...new Set(items.map(i => i.productId))];
    const locationIds = [...new Set(items.map(i => i.locationId))];

    const [products, locations] = await Promise.all([
      this.prisma.product.findMany({
        where: { id: { in: productIds } },
        select: { id: true, code: true, name: true },
      }),
      this.prisma.location.findMany({
        where: { id: { in: locationIds } },
        select: { id: true, code: true, name: true },
      }),
    ]);

    const productMap = new Map(products.map(p => [p.id, p]));
    const locationMap = new Map(locations.map(l => [l.id, l]));

    const enrichedItems = items.map(item => ({
      ...item,
      product: productMap.get(item.productId),
      location: locationMap.get(item.locationId),
    }));

    return { items: enrichedItems, total, page, pageSize, totalPages: Math.ceil(total / pageSize) };
  }

  async createInventoryPolicy(tenantId: string, dto: {
    productId: string;
    locationId: string;
    planningMethod: string;
    lotSizingRule: string;
    safetyStockMethod: string;
    safetyStockQty?: number;
    safetyStockDays?: number;
    serviceLevel?: number;
    reorderPoint?: number;
    reorderQty?: number;
    minOrderQty?: number;
    maxOrderQty?: number;
    leadTimeDays?: number;
    effectiveFrom?: Date;
  }) {
    // Validate product
    const product = await this.prisma.product.findFirst({
      where: { id: dto.productId, tenantId },
    });
    if (!product) {
      throw new NotFoundException('Product not found');
    }

    // Validate location
    const location = await this.prisma.location.findFirst({
      where: { id: dto.locationId, tenantId },
    });
    if (!location) {
      throw new NotFoundException('Location not found');
    }

    // Check for existing policy
    const existing = await this.prisma.inventoryPolicy.findFirst({
      where: { tenantId, productId: dto.productId, locationId: dto.locationId },
    });
    if (existing) {
      throw new BadRequestException('Inventory policy already exists for this product-location');
    }

    return this.prisma.inventoryPolicy.create({
      data: {
        tenantId,
        productId: dto.productId,
        locationId: dto.locationId,
        planningMethod: dto.planningMethod as any,
        lotSizingRule: dto.lotSizingRule as any,
        safetyStockMethod: dto.safetyStockMethod as any,
        safetyStockQty: dto.safetyStockQty ? new Decimal(dto.safetyStockQty) : null,
        safetyStockDays: dto.safetyStockDays,
        serviceLevel: dto.serviceLevel ? new Decimal(dto.serviceLevel) : new Decimal(95),
        reorderPoint: dto.reorderPoint ? new Decimal(dto.reorderPoint) : null,
        reorderQty: dto.reorderQty ? new Decimal(dto.reorderQty) : null,
        minOrderQty: dto.minOrderQty ? new Decimal(dto.minOrderQty) : null,
        maxOrderQty: dto.maxOrderQty ? new Decimal(dto.maxOrderQty) : null,
        leadTimeDays: dto.leadTimeDays || 0,
        effectiveFrom: dto.effectiveFrom || new Date(),
      },
    });
  }

  async getInventoryPoliciesV2(tenantId: string, params: {
    productId?: string;
    locationId?: string;
    abcClass?: string;
    page?: number;
    pageSize?: number;
  } = {}) {
    const { productId, locationId, abcClass, page = 1, pageSize = 20 } = params;
    const where: any = {
      tenantId,
      ...(productId && { productId }),
      ...(locationId && { locationId }),
      ...(abcClass && { abcClass }),
    };

    const [items, total] = await Promise.all([
      this.prisma.inventoryPolicy.findMany({
        where,
        skip: (page - 1) * pageSize,
        take: pageSize,
        orderBy: { updatedAt: 'desc' },
      }),
      this.prisma.inventoryPolicy.count({ where }),
    ]);

    const productIds = [...new Set(items.map(i => i.productId))];
    const locationIds = [...new Set(items.map(i => i.locationId))];

    const [products, locations] = await Promise.all([
      this.prisma.product.findMany({
        where: { id: { in: productIds } },
        select: { id: true, code: true, name: true },
      }),
      this.prisma.location.findMany({
        where: { id: { in: locationIds } },
        select: { id: true, code: true, name: true },
      }),
    ]);

    const productMap = new Map(products.map(p => [p.id, p]));
    const locationMap = new Map(locations.map(l => [l.id, l]));

    return {
      items: items.map(item => ({
        ...item,
        product: productMap.get(item.productId),
        location: locationMap.get(item.locationId),
      })),
      total,
      page,
      pageSize,
      totalPages: Math.ceil(total / pageSize),
    };
  }

  async getInventoryPolicy(tenantId: string, productId: string, locationId: string) {
    const policy = await this.prisma.inventoryPolicy.findFirst({
      where: { tenantId, productId, locationId },
    });
    if (!policy) {
      throw new NotFoundException('Inventory policy not found');
    }

    return policy;
  }

  async upsertInventoryPolicy(tenantId: string, dto: any) {
    const existing = await this.prisma.inventoryPolicy.findFirst({
      where: { tenantId, productId: dto.productId, locationId: dto.locationId },
    });

    if (existing) {
      return this.prisma.inventoryPolicy.update({
        where: { id: existing.id },
        data: {
          ...(dto.planningMethod && { planningMethod: dto.planningMethod }),
          ...(dto.lotSizingRule && { lotSizingRule: dto.lotSizingRule }),
          ...(dto.safetyStockMethod && { safetyStockMethod: dto.safetyStockMethod }),
          ...(dto.safetyStockQty !== undefined && { safetyStockQty: new Decimal(dto.safetyStockQty) }),
          ...(dto.safetyStockDays !== undefined && { safetyStockDays: dto.safetyStockDays }),
          ...(dto.serviceLevel !== undefined && { serviceLevel: new Decimal(dto.serviceLevel) }),
          ...(dto.reorderPoint !== undefined && { reorderPoint: new Decimal(dto.reorderPoint) }),
          ...(dto.reorderQty !== undefined && { reorderQty: new Decimal(dto.reorderQty) }),
          ...(dto.minOrderQty !== undefined && { minOrderQty: new Decimal(dto.minOrderQty) }),
          ...(dto.maxOrderQty !== undefined && { maxOrderQty: new Decimal(dto.maxOrderQty) }),
          ...(dto.leadTimeDays !== undefined && { leadTimeDays: dto.leadTimeDays }),
          ...(dto.abcClass !== undefined && { abcClass: dto.abcClass }),
          ...(dto.xyzClass !== undefined && { xyzClass: dto.xyzClass }),
          ...(dto.effectiveFrom && { effectiveFrom: new Date(dto.effectiveFrom) }),
          ...(dto.effectiveTo && { effectiveTo: new Date(dto.effectiveTo) }),
        },
      });
    }

    return this.createInventoryPolicy(tenantId, {
      productId: dto.productId,
      locationId: dto.locationId,
      planningMethod: dto.planningMethod || 'MRP',
      lotSizingRule: dto.lotSizingRule || 'LFL',
      safetyStockMethod: dto.safetyStockMethod || 'FIXED',
      safetyStockQty: dto.safetyStockQty,
      safetyStockDays: dto.safetyStockDays,
      serviceLevel: dto.serviceLevel,
      reorderPoint: dto.reorderPoint,
      reorderQty: dto.reorderQty,
      minOrderQty: dto.minOrderQty,
      maxOrderQty: dto.maxOrderQty,
      leadTimeDays: dto.leadTimeDays,
      effectiveFrom: dto.effectiveFrom ? new Date(dto.effectiveFrom) : undefined,
    });
  }

  async deleteInventoryPolicy(tenantId: string, productId: string, locationId: string) {
    const policy = await this.prisma.inventoryPolicy.findFirst({
      where: { tenantId, productId, locationId },
    });
    if (!policy) {
      throw new NotFoundException('Inventory policy not found');
    }

    await this.prisma.inventoryPolicy.delete({ where: { id: policy.id } });
    return { success: true };
  }

  async getInventoryLevels(tenantId: string, params: {
    productId?: string;
    locationId?: string;
    belowSafetyStock?: boolean;
    page?: number;
    pageSize?: number;
  } = {}) {
    const { productId, locationId, page = 1, pageSize = 20 } = params;
    const where: any = {
      tenantId,
      ...(productId && { productId }),
      ...(locationId && { locationId }),
    };

    const [items, total] = await Promise.all([
      this.prisma.inventoryLevel.findMany({
        where,
        skip: (page - 1) * pageSize,
        take: pageSize,
        orderBy: { updatedAt: 'desc' },
      }),
      this.prisma.inventoryLevel.count({ where }),
    ]);

    const productIds = [...new Set(items.map(i => i.productId))];
    const locationIds = [...new Set(items.map(i => i.locationId))];
    const [products, locations] = await Promise.all([
      this.prisma.product.findMany({
        where: { id: { in: productIds } },
        select: { id: true, code: true, name: true },
      }),
      this.prisma.location.findMany({
        where: { id: { in: locationIds } },
        select: { id: true, code: true, name: true },
      }),
    ]);

    const productMap = new Map(products.map(p => [p.id, p]));
    const locationMap = new Map(locations.map(l => [l.id, l]));

    return {
      items: items.map(item => ({
        ...item,
        product: productMap.get(item.productId),
        location: locationMap.get(item.locationId),
      })),
      total,
      page,
      pageSize,
      totalPages: Math.ceil(total / pageSize),
    };
  }

  async getInventoryLevel(tenantId: string, productId: string, locationId: string) {
    const level = await this.prisma.inventoryLevel.findFirst({
      where: { tenantId, productId, locationId },
    });
    if (!level) {
      throw new NotFoundException('Inventory level not found');
    }
    return level;
  }

  async upsertInventoryLevel(tenantId: string, dto: any) {
    // WARNING: This directly mutates InventoryLevel without going through the append-only ledger.
    // Use only for administrative adjustments or initial data setup.
    // For production operations, use ledger.recordEntry() which maintains the audit trail.
    this.logger.warn(
      `Direct InventoryLevel upsert for product=${dto.productId}, location=${dto.locationId}. ` +
      `This bypasses the append-only ledger. Use only for admin adjustments.`,
    );

    const existing = await this.prisma.inventoryLevel.findFirst({
      where: { tenantId, productId: dto.productId, locationId: dto.locationId },
    });

    const onHandQty = dto.onHandQty ?? 0;
    const allocatedQty = dto.allocatedQty ?? 0;
    const reservedQty = dto.reservedQty ?? 0;
    const availableQty = dto.availableQty ?? onHandQty - allocatedQty - reservedQty;

    if (existing) {
      return this.prisma.inventoryLevel.update({
        where: { id: existing.id },
        data: {
          ...(dto.onHandQty !== undefined && { onHandQty: new Decimal(dto.onHandQty) }),
          ...(dto.allocatedQty !== undefined && { allocatedQty: new Decimal(dto.allocatedQty) }),
          ...(dto.inTransitQty !== undefined && { inTransitQty: new Decimal(dto.inTransitQty) }),
          ...(dto.onOrderQty !== undefined && { onOrderQty: new Decimal(dto.onOrderQty) }),
          ...(dto.availableQty !== undefined && { availableQty: new Decimal(dto.availableQty) }),
          ...(dto.standardCost !== undefined && { standardCost: new Decimal(dto.standardCost) }),
          ...(dto.averageCost !== undefined && { averageCost: new Decimal(dto.averageCost) }),
        },
      });
    }

    return this.prisma.inventoryLevel.create({
      data: {
        tenantId,
        productId: dto.productId,
        locationId: dto.locationId,
        onHandQty: new Decimal(onHandQty),
        allocatedQty: new Decimal(allocatedQty),
        availableQty: new Decimal(availableQty),
        inTransitQty: new Decimal(dto.inTransitQty ?? 0),
        onOrderQty: new Decimal(dto.onOrderQty ?? 0),
        standardCost: dto.standardCost ? new Decimal(dto.standardCost) : null,
        averageCost: dto.averageCost ? new Decimal(dto.averageCost) : null,
      },
    });
  }

  async calculateSafetyStock(tenantId: string, productId: string, locationId: string) {
    const policy = await this.getInventoryPolicy(tenantId, productId, locationId);
    const safetyStockQty = policy.safetyStockQty ? Number(policy.safetyStockQty) : 0;
    return { productId, locationId, safetyStockQty };
  }

  async calculateReorderPoint(tenantId: string, productId: string, locationId: string) {
    const policy = await this.getInventoryPolicy(tenantId, productId, locationId);
    const reorderPoint = policy.reorderPoint ? Number(policy.reorderPoint) : 0;
    return { productId, locationId, reorderPoint };
  }

  async calculateEOQ(tenantId: string, productId: string, locationId: string, params: any) {
    const annualDemand = params?.annualDemand || 0;
    const orderCost = params?.orderCost || 0;
    const holdingCostPercent = params?.holdingCostPercent || 0;
    const holdingCost = annualDemand * (holdingCostPercent / 100);
    const eoq = holdingCost > 0 ? Math.sqrt((2 * annualDemand * orderCost) / holdingCost) : 0;
    return { productId, locationId, eoq };
  }

  async runABCClassification(tenantId: string, params: any) {
    const levels = await this.prisma.inventoryLevel.findMany({
      where: { tenantId, ...(params?.locationId ? { locationId: params.locationId } : {}) },
    });

    const values = levels.map(level => ({
      id: level.id,
      productId: level.productId,
      value: Number(level.inventoryValue || 0) || Number(level.onHandQty) * Number(level.standardCost || 0),
    }));

    values.sort((a, b) => b.value - a.value);
    const totalValue = values.reduce((sum, v) => sum + v.value, 0) || 1;

    let cumulative = 0;
    const results = values.map(item => {
      cumulative += item.value;
      const percent = (cumulative / totalValue) * 100;
      const abcClass = percent <= (params?.aThreshold ?? 70) ? 'A' : percent <= (params?.bThreshold ?? 90) ? 'B' : 'C';
      return { ...item, abcClass };
    });

    await Promise.all(results.map(item =>
      this.prisma.inventoryPolicy.updateMany({
        where: { tenantId, productId: item.productId },
        data: { abcClass: item.abcClass },
      })
    ));

    return { updated: results.length, results };
  }

  async runXYZClassification(tenantId: string, params: any) {
    const levels = await this.prisma.inventoryLevel.findMany({
      where: { tenantId, ...(params?.locationId ? { locationId: params.locationId } : {}) },
    });

    // Compute demand-variability-based XYZ using coefficient of variation (CV)
    // X: CV < 0.5 (steady demand), Y: 0.5 <= CV < 1.0 (variable), Z: CV >= 1.0 (erratic)
    const xThreshold = params?.xThreshold ?? 0.5;
    const yThreshold = params?.yThreshold ?? 1.0;

    const results: Array<{ productId: string; xyzClass: string; cv: number }> = [];

    for (const level of levels) {
      // Get recent demand history (inventory transactions of type ISSUE/PRODUCTION_ISSUE)
      const transactions = await this.prisma.inventoryTransaction.findMany({
        where: {
          tenantId,
          productId: level.productId,
          transactionType: { in: ['ISSUE', 'PRODUCTION_ISSUE'] },
          transactionDate: {
            gte: new Date(Date.now() - 365 * 24 * 60 * 60 * 1000), // last 12 months
          },
        },
        select: { quantity: true, transactionDate: true },
      });

      if (transactions.length < 2) {
        // Insufficient data → classify as Z (erratic/unpredictable)
        results.push({ productId: level.productId, xyzClass: 'Z', cv: 999 });
        continue;
      }

      // Group by month and compute monthly demand
      const monthlyDemand: Record<string, number> = {};
      for (const txn of transactions) {
        const key = `${txn.transactionDate.getFullYear()}-${String(txn.transactionDate.getMonth() + 1).padStart(2, '0')}`;
        monthlyDemand[key] = (monthlyDemand[key] || 0) + Math.abs(Number(txn.quantity));
      }

      const demands = Object.values(monthlyDemand);
      const mean = demands.reduce((s, v) => s + v, 0) / demands.length;
      const variance = demands.reduce((s, v) => s + Math.pow(v - mean, 2), 0) / demands.length;
      const stdDev = Math.sqrt(variance);
      const cv = mean > 0 ? stdDev / mean : 999;

      let xyzClass = 'Z';
      if (cv < xThreshold) xyzClass = 'X';
      else if (cv < yThreshold) xyzClass = 'Y';

      results.push({ productId: level.productId, xyzClass, cv: Math.round(cv * 100) / 100 });
    }

    await Promise.all(results.map(item =>
      this.prisma.inventoryPolicy.updateMany({
        where: { tenantId, productId: item.productId },
        data: { xyzClass: item.xyzClass },
      })
    ));

    return { updated: results.length, results };
  }

  async getInventorySummary(tenantId: string, locationId?: string) {
    const levels = await this.prisma.inventoryLevel.findMany({
      where: { tenantId, ...(locationId ? { locationId } : {}) },
    });

    const totalValue = levels.reduce((sum, level) => sum + Number(level.inventoryValue || 0), 0);
    const totalOnHand = levels.reduce((sum, level) => sum + Number(level.onHandQty), 0);

    return {
      totalItems: levels.length,
      totalValue,
      totalOnHand,
    };
  }

  async getInventoryTurnover(tenantId: string, params: {
    productId?: string;
    locationId?: string;
    startDate?: string;
    endDate?: string;
  }) {
    const startDate = params.startDate ? new Date(params.startDate) : undefined;
    const endDate = params.endDate ? new Date(params.endDate) : undefined;

    const actuals = await this.prisma.actual.findMany({
      where: {
        tenantId,
        ...(params.productId ? { productId: params.productId } : {}),
        ...(params.locationId ? { locationId: params.locationId } : {}),
        ...(startDate || endDate ? {
          periodDate: {
            ...(startDate && { gte: startDate }),
            ...(endDate && { lte: endDate }),
          },
        } : {}),
        actualType: ActualType.PURCHASES,
      },
    });

    const cogs = actuals.reduce((sum, item) => sum + Number(item.amount), 0);
    const salesFallback = cogs === 0
      ? await this.prisma.actual.findMany({
          where: {
            tenantId,
            ...(params.productId ? { productId: params.productId } : {}),
            ...(params.locationId ? { locationId: params.locationId } : {}),
            ...(startDate || endDate ? {
              periodDate: {
                ...(startDate && { gte: startDate }),
                ...(endDate && { lte: endDate }),
              },
            } : {}),
            actualType: ActualType.SALES,
          },
        })
      : [];

    const cogsValue = cogs || salesFallback.reduce((sum, item) => sum + Number(item.amount), 0);

    const levels = await this.prisma.inventoryLevel.findMany({
      where: {
        tenantId,
        ...(params.productId ? { productId: params.productId } : {}),
        ...(params.locationId ? { locationId: params.locationId } : {}),
      },
    });

    const totalInventoryValue = levels.reduce((sum, level) => {
      const value = level.inventoryValue ? Number(level.inventoryValue) : Number(level.onHandQty) * Number(level.standardCost || 0);
      return sum + value;
    }, 0);

    const averageInventoryValue = levels.length ? totalInventoryValue / levels.length : 0;
    const turnover = averageInventoryValue > 0 ? cogsValue / averageInventoryValue : 0;

    return {
      productId: params.productId,
      locationId: params.locationId,
      turnover: Number(turnover.toFixed(4)),
      cogs: Number(cogsValue.toFixed(2)),
      averageInventoryValue: Number(averageInventoryValue.toFixed(2)),
      startDate: params.startDate,
      endDate: params.endDate,
    };
  }

  // ============================================================================
  // Planned Orders (MRP Results)
  // ============================================================================

  async getPlannedOrders(tenantId: string, params: {
    status?: PlannedOrderStatus;
    orderType?: PlannedOrderType;
    productId?: string;
    locationId?: string;
    startDate?: Date;
    endDate?: Date;
    page?: number;
    pageSize?: number;
  } = {}) {
    const { status, orderType, productId, locationId, startDate, endDate, page = 1, pageSize = 20 } = params;
    
    const where: any = {
      tenantId,
      ...(status && { status }),
      ...(orderType && { orderType }),
      ...(productId && { productId }),
      ...(locationId && { locationId }),
      ...(startDate || endDate ? {
        dueDate: {
          ...(startDate && { gte: startDate }),
          ...(endDate && { lte: endDate }),
        },
      } : {}),
    };

    const [items, total] = await Promise.all([
      this.prisma.plannedOrder.findMany({
        where,
        skip: (page - 1) * pageSize,
        take: pageSize,
        orderBy: { dueDate: 'asc' },
      }),
      this.prisma.plannedOrder.count({ where }),
    ]);

    // Enrich with product and location info
    const productIds = [...new Set(items.map(i => i.productId))];
    const locationIds = [...new Set(items.map(i => i.locationId))];

    const [products, locations] = await Promise.all([
      this.prisma.product.findMany({
        where: { id: { in: productIds } },
        select: { id: true, code: true, name: true },
      }),
      this.prisma.location.findMany({
        where: { id: { in: locationIds } },
        select: { id: true, code: true, name: true },
      }),
    ]);

    const productMap = new Map(products.map(p => [p.id, p]));
    const locationMap = new Map(locations.map(l => [l.id, l]));

    const enrichedItems = items.map(item => ({
      ...item,
      product: productMap.get(item.productId),
      location: locationMap.get(item.locationId),
    }));

    return { items: enrichedItems, total, page, pageSize, totalPages: Math.ceil(total / pageSize) };
  }

  async firmPlannedOrder(tenantId: string, orderId: string) {
    const order = await this.prisma.plannedOrder.findFirst({
      where: { id: orderId, tenantId },
    });
    if (!order) {
      throw new NotFoundException('Planned order not found');
    }

    if (order.status !== PlannedOrderStatus.PLANNED) {
      throw new BadRequestException('Only planned orders can be firmed');
    }

    return this.prisma.plannedOrder.update({
      where: { id: orderId },
      data: { status: PlannedOrderStatus.FIRMED, isFirmed: true, firmedAt: new Date() },
    });
  }

  async releasePlannedOrder(tenantId: string, orderId: string) {
    const order = await this.prisma.plannedOrder.findFirst({
      where: { id: orderId, tenantId },
    });
    if (!order) {
      throw new NotFoundException('Planned order not found');
    }

    if (order.status !== PlannedOrderStatus.FIRMED) {
      throw new BadRequestException('Only firmed orders can be released');
    }

    return this.prisma.plannedOrder.update({
      where: { id: orderId },
      data: { status: PlannedOrderStatus.RELEASED, releaseDate: new Date() },
    });
  }

  async getPlannedOrder(tenantId: string, orderId: string) {
    const order = await this.prisma.plannedOrder.findFirst({
      where: { id: orderId, tenantId },
    });
    if (!order) {
      throw new NotFoundException('Planned order not found');
    }
    return order;
  }

  async updatePlannedOrder(tenantId: string, orderId: string, dto: any) {
    const order = await this.prisma.plannedOrder.findFirst({
      where: { id: orderId, tenantId },
    });
    if (!order) {
      throw new NotFoundException('Planned order not found');
    }

    return this.prisma.plannedOrder.update({
      where: { id: orderId },
      data: {
        ...(dto.quantity !== undefined && { quantity: new Decimal(dto.quantity) }),
        ...(dto.dueDate && { dueDate: new Date(dto.dueDate) }),
        ...(dto.startDate && { startDate: new Date(dto.startDate) }),
        ...(dto.supplierId !== undefined && { supplierId: dto.supplierId }),
        ...(dto.notes !== undefined && { notes: dto.notes }),
      },
    });
  }

  async cancelPlannedOrder(tenantId: string, orderId: string, reason?: string) {
    const order = await this.prisma.plannedOrder.findFirst({
      where: { id: orderId, tenantId },
    });
    if (!order) {
      throw new NotFoundException('Planned order not found');
    }

    return this.prisma.plannedOrder.update({
      where: { id: orderId },
      data: { status: PlannedOrderStatus.CANCELLED, notes: reason || order.notes },
    });
  }

  async bulkUpdatePlannedOrders(tenantId: string, dto: any) {
    const { orderIds, action } = dto;
    if (!Array.isArray(orderIds) || !action) {
      throw new BadRequestException('orderIds and action are required');
    }

    const statusMap: Record<string, PlannedOrderStatus> = {
      firm: PlannedOrderStatus.FIRMED,
      release: PlannedOrderStatus.RELEASED,
      cancel: PlannedOrderStatus.CANCELLED,
    };

    const nextStatus = statusMap[action];
    if (!nextStatus) {
      throw new BadRequestException('Invalid action');
    }

    const updated = await this.prisma.plannedOrder.updateMany({
      where: { id: { in: orderIds }, tenantId },
      data: { status: nextStatus },
    });

    return { updated: updated.count };
  }

  async getMRPRuns(tenantId: string, params: {
    runType?: string;
    status?: string;
    page?: number;
    pageSize?: number;
  } = {}) {
    const { runType, status, page = 1, pageSize = 20 } = params;
    const where: any = {
      tenantId,
      ...(runType && { runType }),
      ...(status && { status }),
    };

    const [items, total] = await Promise.all([
      this.prisma.mRPRun.findMany({
        where,
        skip: (page - 1) * pageSize,
        take: pageSize,
        orderBy: { createdAt: 'desc' },
      }),
      this.prisma.mRPRun.count({ where }),
    ]);

    return { items, total, page, pageSize, totalPages: Math.ceil(total / pageSize) };
  }

  async getMRPRun(tenantId: string, runId: string) {
    const run = await this.prisma.mRPRun.findFirst({
      where: { id: runId, tenantId },
    });
    if (!run) {
      throw new NotFoundException('MRP run not found');
    }
    return run;
  }

  async createMRPRun(tenantId: string, dto: any) {
    return this.prisma.mRPRun.create({
      data: {
        tenantId,
        name: dto.name,
        runType: dto.runType || 'REGENERATIVE',
        status: 'PENDING',
        planningHorizonDays: dto.planningHorizonDays || 90,
        frozenPeriodDays: dto.frozenPeriodDays || 0,
        locationIds: dto.locationIds || [],
        productIds: dto.productIds || [],
        respectLeadTimes: dto.respectLeadTime !== undefined ? dto.respectLeadTime : true,
        considerSafetyStock: dto.considerSafetyStock !== undefined ? dto.considerSafetyStock : true,
        netChange: dto.runType === 'NET_CHANGE',
      },
    });
  }

  async executeMRPRun(tenantId: string, runId: string, userId: string) {
    // Acquire a pessimistic lock to prevent concurrent execution of the same run
    // and enforce single-processing-at-a-time via partial unique index
    return this.prisma.$transaction(async (tx) => {
      // Idempotency: prevent re-execution of a completed run
      const duplicate = await this.idempotency.acquire(tx, 'MRP_RUN', runId, tenantId);
      if (duplicate) {
        return tx.mRPRun.findFirst({ where: { id: runId, tenantId } });
      }

      // Lock the row for update to prevent race conditions
      const lockedRun = await tx.$queryRaw<Array<{ id: string; status: string }>>(
        Prisma.sql`SELECT id, status FROM mrp_runs WHERE id = ${runId} AND tenant_id = ${tenantId} FOR UPDATE`,
      );
      if (!lockedRun.length) throw new NotFoundException('MRP run not found');
      if (lockedRun[0].status !== 'PENDING') {
        throw new BadRequestException(`MRP run is ${lockedRun[0].status}, only PENDING runs can be executed`);
      }

      // Mark as processing
      await tx.mRPRun.update({
        where: { id: runId },
        data: { status: 'PROCESSING', startedAt: new Date() },
      });

      // Clean up old planned orders from this run (regenerative mode)
      await tx.plannedOrder.deleteMany({
        where: { mrpRunId: runId, tenantId, status: 'PLANNED' },
      });

      // Clean up old exceptions and requirements
      await tx.mRPException.deleteMany({ where: { mrpRunId: runId } });
      await tx.mRPRequirement.deleteMany({ where: { mrpRunId: runId } });

      try {
        const run = await tx.mRPRun.findFirst({ where: { id: runId, tenantId } });
        if (!run) throw new NotFoundException('MRP run not found');

        // Execute calculation (reads are safe within tx)
        const result = await this.calculateMRP(tenantId, run);

        // Update run with results
        const updated = await tx.mRPRun.update({
          where: { id: runId },
          data: {
            status: 'COMPLETED',
            completedAt: new Date(),
            plannedOrderCount: result.plannedOrderCount,
            exceptionCount: result.exceptionCount,
          },
        });

        await this.idempotency.stamp(tx, 'MRP_RUN', runId, tenantId, runId);
        return updated;
      } catch (error) {
        // Mark as failed within the same tx
        await tx.mRPRun.update({
          where: { id: runId },
          data: { status: 'FAILED', completedAt: new Date() },
        });
        throw error;
      }
    }, {
      timeout: 120000, // MRP can be long-running; 2 minute tx timeout
    });
  }

  /**
   * Core MRP Calculation Engine
   * 
   * Implements standard MRP logic:
   * 1. Get demand from forecasts (and/or actual orders)
   * 2. Explode BOMs to calculate component requirements
   * 3. Calculate: Gross Requirements, Scheduled Receipts, Projected Available, Net Requirements
   * 4. Generate planned orders based on lot sizing rules
   * 5. Generate exceptions for issues (shortages, lead time violations, etc.)
   */
  private async calculateMRP(
    tenantId: string,
    run: {
      id: string;
      planningHorizonDays: number;
      frozenPeriodDays: number;
      locationIds: string[];
      productIds: string[];
      respectLeadTimes: boolean;
      considerSafetyStock: boolean;
    },
  ): Promise<{ plannedOrderCount: number; exceptionCount: number }> {
    const today = new Date();
    today.setHours(0, 0, 0, 0);
    const horizonEnd = new Date(today);
    horizonEnd.setDate(horizonEnd.getDate() + run.planningHorizonDays);
    const frozenEnd = new Date(today);
    frozenEnd.setDate(frozenEnd.getDate() + run.frozenPeriodDays);

    // 1. Get all finished goods products (those with BOMs as parent)
    const boms = await this.prisma.billOfMaterial.findMany({
      where: {
        tenantId,
        status: BOMStatus.ACTIVE,
        ...(run.productIds.length > 0 && { parentProductId: { in: run.productIds } }),
      },
      include: {
        components: true,
      },
    });

    const finishedGoodIds = boms.map(b => b.parentProductId);
    
    // 2. Get locations to plan for
    const locations = run.locationIds.length > 0
      ? await this.prisma.location.findMany({ where: { id: { in: run.locationIds }, tenantId } })
      : await this.prisma.location.findMany({ where: { tenantId, type: 'WAREHOUSE', status: 'ACTIVE' } });

    // 3. Get forecast demand for the planning horizon
    // Look for the most recent approved plan or any active forecasts
    const forecasts = await this.prisma.forecast.findMany({
      where: {
        tenantId,
        productId: { in: finishedGoodIds },
        locationId: { in: locations.map(l => l.id) },
        periodDate: { gte: today, lte: horizonEnd },
      },
      orderBy: { periodDate: 'asc' },
    });

    // Aggregate demand by product, location, period
    const demandMap = new Map<string, { productId: string; locationId: string; periodDate: Date; quantity: number }>();
    for (const f of forecasts) {
      const key = `${f.productId}-${f.locationId}-${f.periodDate.toISOString().split('T')[0]}`;
      const existing = demandMap.get(key);
      if (existing) {
        // Take average if multiple forecasts for same product/location/period
        existing.quantity = (existing.quantity + (f.forecastQuantity?.toNumber() || 0)) / 2;
      } else {
        demandMap.set(key, {
          productId: f.productId,
          locationId: f.locationId,
          periodDate: f.periodDate,
          quantity: f.forecastQuantity?.toNumber() || 0,
        });
      }
    }

    // 4. Get inventory levels
    const inventoryLevels = await this.prisma.inventoryLevel.findMany({
      where: {
        tenantId,
        locationId: { in: locations.map(l => l.id) },
      },
    });
    const inventoryMap = new Map<string, { onHand: number; allocated: number; available: number; onOrder: number }>();
    for (const inv of inventoryLevels) {
      inventoryMap.set(`${inv.productId}-${inv.locationId}`, {
        onHand: inv.onHandQty?.toNumber() || 0,
        allocated: inv.allocatedQty?.toNumber() || 0,
        available: inv.availableQty?.toNumber() || 0,
        onOrder: inv.onOrderQty?.toNumber() || 0,
      });
    }

    // 5. Get inventory policies
    const policies = await this.prisma.inventoryPolicy.findMany({
      where: {
        tenantId,
        locationId: { in: locations.map(l => l.id) },
      },
    });
    const policyMap = new Map<string, typeof policies[0]>();
    for (const p of policies) {
      policyMap.set(`${p.productId}-${p.locationId}`, p);
    }

    // 6. Get supplier info for purchased items
    const supplierProducts = await this.prisma.supplierProduct.findMany({
      where: {
        isPrimary: true,
        supplier: { tenantId, status: 'ACTIVE' },
      },
    });
    const supplierMap = new Map<string, typeof supplierProducts[0]>();
    for (const sp of supplierProducts) {
      supplierMap.set(sp.productId, sp);
    }

    // 7. Build BOM explosion map
    const bomMap = new Map<string, typeof boms[0]>();
    for (const bom of boms) {
      bomMap.set(bom.parentProductId, bom);
    }

    // 8. Get routings and work center capacity for capacity planning
    const routings = await this.prisma.routing.findMany({
      where: {
        tenantId,
        status: BOMStatus.ACTIVE,
        bomId: { in: boms.map(b => b.id) },
      },
      include: {
        operations: {
          include: {
            workCenter: true,
          },
          orderBy: { sequence: 'asc' },
        },
      },
    });
    const routingMap = new Map<string, typeof routings[0]>();
    for (const routing of routings) {
      routingMap.set(routing.bomId, routing);
    }

    // Get work center capacities
    const workCenterCapacities = await this.prisma.workCenterCapacity.findMany({
      where: {
        workCenter: { tenantId, status: 'ACTIVE' },
        effectiveFrom: { lte: horizonEnd },
        OR: [
          { effectiveTo: null },
          { effectiveTo: { gte: today } },
        ],
      },
      include: {
        workCenter: true,
      },
    });
    const capacityMap = new Map<string, { capacityPerDay: number; hoursPerShift: number; numberOfShifts: number }>();
    for (const cap of workCenterCapacities) {
      capacityMap.set(cap.workCenterId, {
        capacityPerDay: cap.capacityPerDay?.toNumber() || 480, // Default 8 hours
        hoursPerShift: cap.hoursPerShift?.toNumber() || 8,
        numberOfShifts: cap.numberOfShifts || 1,
      });
    }

    // Track capacity usage per work center per week
    const capacityUsage = new Map<string, number>(); // key: workCenterId-weekStart

    // 9. Get scheduled receipts from existing POs and WOs
    const existingPOs = await this.prisma.purchaseOrder.findMany({
      where: {
        tenantId,
        status: { in: ['APPROVED', 'SENT', 'PARTIALLY_RECEIVED'] },
        expectedDate: { gte: today, lte: horizonEnd },
      },
      include: { lines: true },
    });
    const existingWOs = await this.prisma.workOrder.findMany({
      where: {
        tenantId,
        status: { in: ['PLANNED', 'RELEASED', 'IN_PROGRESS'] },
        plannedEndDate: { gte: today, lte: horizonEnd },
      },
    });

    // Build scheduled receipts map: productId-locationId-weekStart -> quantity
    const scheduledReceiptsMap = new Map<string, number>();
    const getWeekStart = (d: Date) => {
      const ws = new Date(d); ws.setHours(0,0,0,0);
      ws.setDate(ws.getDate() - ws.getDay());
      return ws.toISOString().split('T')[0];
    };
    for (const po of existingPOs) {
      for (const line of po.lines) {
        const remaining = Number(line.quantity) - Number(line.receivedQty || 0);
        if (remaining > 0) {
          const key = `${line.productId}-${po.locationId}-${getWeekStart(po.expectedDate)}`;
          scheduledReceiptsMap.set(key, (scheduledReceiptsMap.get(key) || 0) + remaining);
        }
      }
    }
    for (const wo of existingWOs) {
      const remaining = Number(wo.plannedQty) - Number(wo.completedQty || 0);
      if (remaining > 0 && wo.plannedEndDate) {
        const key = `${wo.productId}-${wo.locationId}-${getWeekStart(wo.plannedEndDate)}`;
        scheduledReceiptsMap.set(key, (scheduledReceiptsMap.get(key) || 0) + remaining);
      }
    }

    const plannedOrders: Array<{
      productId: string;
      locationId: string;
      orderType: PlannedOrderType;
      startDate: Date;
      dueDate: Date;
      quantity: number;
      supplierId?: string;
    }> = [];

    const exceptions: Array<{
      productId: string;
      locationId: string;
      exceptionType: string;
      severity: string;
      message: string;
      affectedDate: Date;
      currentValue?: number;
      requiredValue?: number;
    }> = [];

    const requirements: Array<{
      productId: string;
      locationId: string;
      periodDate: Date;
      grossRequirement: number;
      scheduledReceipts: number;
      projectedOnHand: number;
      netRequirement: number;
      plannedOrderReceipt: number;
      plannedOrderRelease: number;
    }> = [];

    // 8. Process each location
    for (const location of locations) {
      // Track projected inventory for each product
      const projectedInventory = new Map<string, number>();

      // Initialize with available inventory
      for (const [key, inv] of inventoryMap.entries()) {
        if (key.endsWith(`-${location.id}`)) {
          const productId = key.split('-')[0];
          projectedInventory.set(productId, inv.available);
        }
      }

      // Generate weekly buckets for the planning horizon
      const buckets: Date[] = [];
      let bucketDate = new Date(today);
      while (bucketDate <= horizonEnd) {
        buckets.push(new Date(bucketDate));
        bucketDate.setDate(bucketDate.getDate() + 7); // Weekly buckets
      }

      // Process each finished good
      for (const finishedGoodId of finishedGoodIds) {
        const bom = bomMap.get(finishedGoodId);
        if (!bom) continue;

        const policy = policyMap.get(`${finishedGoodId}-${location.id}`);
        const safetyStock = run.considerSafetyStock && policy
          ? (policy.safetyStockQty?.toNumber() || 0)
          : 0;
        const leadTime = run.respectLeadTimes && policy ? (policy.leadTimeDays || 0) : 0;
        const minOrderQty = policy?.minOrderQty?.toNumber() || 1;
        const multipleOrderQty = policy?.multipleOrderQty?.toNumber() || 1;

        let projectedOnHand = projectedInventory.get(finishedGoodId) || 0;

        // Process each time bucket
        for (const bucket of buckets) {
          // Get demand for this bucket (aggregate daily demand into weekly)
          const bucketEnd = new Date(bucket);
          bucketEnd.setDate(bucketEnd.getDate() + 7);

          let grossRequirement = 0;
          for (const [, demand] of demandMap.entries()) {
            if (
              demand.productId === finishedGoodId &&
              demand.locationId === location.id &&
              demand.periodDate >= bucket &&
              demand.periodDate < bucketEnd
            ) {
              grossRequirement += demand.quantity;
            }
          }

          // Calculate net requirement — look up real scheduled receipts from existing POs/WOs
          const bucketWeekKey = `${finishedGoodId}-${location.id}-${getWeekStart(bucket)}`;
          const scheduledReceipts = scheduledReceiptsMap.get(bucketWeekKey) || 0;
          const available = projectedOnHand + scheduledReceipts - grossRequirement;
          const netRequirement = Math.max(0, safetyStock - available);

          // Calculate planned order quantity using lot sizing
          let plannedOrderQty = 0;
          if (netRequirement > 0) {
            // Apply lot sizing rules
            plannedOrderQty = Math.max(netRequirement, minOrderQty);
            if (multipleOrderQty > 1) {
              plannedOrderQty = Math.ceil(plannedOrderQty / multipleOrderQty) * multipleOrderQty;
            }
          }

          // Check if in frozen period
          const isFrozen = bucket <= frozenEnd;
          if (isFrozen && netRequirement > 0) {
            // Generate exception for demand in frozen period
            exceptions.push({
              productId: finishedGoodId,
              locationId: location.id,
              exceptionType: 'PAST_DUE_ORDER',
              severity: 'HIGH',
              message: `Net requirement of ${netRequirement.toFixed(0)} units in frozen period`,
              affectedDate: bucket,
              currentValue: projectedOnHand,
              requiredValue: grossRequirement,
            });
          }

          // Calculate release date based on lead time
          const releaseDate = new Date(bucket);
          releaseDate.setDate(releaseDate.getDate() - leadTime);

          // Create planned production order for finished good
          if (plannedOrderQty > 0 && !isFrozen) {
            plannedOrders.push({
              productId: finishedGoodId,
              locationId: location.id,
              orderType: PlannedOrderType.PRODUCTION,
              startDate: releaseDate,
              dueDate: bucket,
              quantity: plannedOrderQty,
            });

            // Check capacity constraints for this production order
            const routing = routingMap.get(bom.id);
            if (routing && routing.operations.length > 0) {
              const weekKey = `${releaseDate.toISOString().split('T')[0]}`;
              
              for (const operation of routing.operations) {
                // Calculate required capacity in minutes
                const setupTime = operation.setupTime?.toNumber() || 0;
                const runTimePerUnit = operation.runTimePerUnit?.toNumber() || 0;
                const requiredCapacity = setupTime + (runTimePerUnit * plannedOrderQty);

                const wcCapacity = capacityMap.get(operation.workCenterId);
                const availableCapacity = wcCapacity?.capacityPerDay || 480; // 8 hours default

                // Track cumulative usage for this work center
                const usageKey = `${operation.workCenterId}-${weekKey}`;
                const currentUsage = capacityUsage.get(usageKey) || 0;
                const newUsage = currentUsage + requiredCapacity;
                capacityUsage.set(usageKey, newUsage);

                // Check if capacity is exceeded (considering 7 days in the week bucket)
                const weeklyCapacity = availableCapacity * 5; // 5 working days
                const utilizationPct = (newUsage / weeklyCapacity) * 100;

                if (newUsage > weeklyCapacity) {
                  exceptions.push({
                    productId: finishedGoodId,
                    locationId: location.id,
                    exceptionType: 'CAPACITY_OVERLOAD',
                    severity: utilizationPct > 150 ? 'CRITICAL' : 'HIGH',
                    message: `Work center ${operation.workCenter?.name || operation.workCenterId} capacity exceeded: ${utilizationPct.toFixed(0)}% utilization (${Math.round(newUsage)} min required vs ${weeklyCapacity} min available)`,
                    affectedDate: bucket,
                    currentValue: weeklyCapacity,
                    requiredValue: newUsage,
                  });
                } else if (utilizationPct > 85) {
                  // Warn about high utilization
                  exceptions.push({
                    productId: finishedGoodId,
                    locationId: location.id,
                    exceptionType: 'CAPACITY_OVERLOAD',
                    severity: 'MEDIUM',
                    message: `Work center ${operation.workCenter?.name || operation.workCenterId} high utilization: ${utilizationPct.toFixed(0)}%`,
                    affectedDate: bucket,
                    currentValue: weeklyCapacity,
                    requiredValue: newUsage,
                  });
                }
              }
            }

            // Explode BOM to create dependent demand for components
            for (const component of bom.components) {
              const componentQty = plannedOrderQty * (component.quantity?.toNumber() || 1);
              const scrapFactor = 1 + ((component.scrapPercent?.toNumber() || 0) / 100);
              const requiredQty = Math.ceil(componentQty * scrapFactor);

              // Get component inventory and policy
              const componentInv = inventoryMap.get(`${component.componentProductId}-${location.id}`);
              const componentPolicy = policyMap.get(`${component.componentProductId}-${location.id}`);
              const componentLeadTime = componentPolicy?.leadTimeDays || 14;
              const componentSupplier = supplierMap.get(component.componentProductId);

              const componentAvailable = componentInv?.available || 0;
              const componentNetReq = Math.max(0, requiredQty - componentAvailable);

              if (componentNetReq > 0) {
                // Create purchase order for the component
                const componentReleaseDate = new Date(releaseDate);
                componentReleaseDate.setDate(componentReleaseDate.getDate() - componentLeadTime);

                // Check for lead time violation
                if (componentReleaseDate < today) {
                  exceptions.push({
                    productId: component.componentProductId,
                    locationId: location.id,
                    exceptionType: 'LEAD_TIME_VIOLATION',
                    severity: 'CRITICAL',
                    message: `Component needs to be ordered ${Math.abs(Math.ceil((componentReleaseDate.getTime() - today.getTime()) / (1000 * 60 * 60 * 24)))} days in the past`,
                    affectedDate: bucket,
                    currentValue: componentAvailable,
                    requiredValue: requiredQty,
                  });
                }

                // Apply component lot sizing
                const compMinQty = componentPolicy?.minOrderQty?.toNumber() || 1;
                const compMultQty = componentPolicy?.multipleOrderQty?.toNumber() || 1;
                let componentOrderQty = Math.max(componentNetReq, compMinQty);
                if (compMultQty > 1) {
                  componentOrderQty = Math.ceil(componentOrderQty / compMultQty) * compMultQty;
                }

                plannedOrders.push({
                  productId: component.componentProductId,
                  locationId: location.id,
                  orderType: PlannedOrderType.PURCHASE,
                  startDate: componentReleaseDate < today ? today : componentReleaseDate,
                  dueDate: releaseDate,
                  quantity: componentOrderQty,
                  supplierId: componentSupplier?.supplierId,
                });

                // Check for shortage
                if (componentAvailable < requiredQty * 0.5) {
                  exceptions.push({
                    productId: component.componentProductId,
                    locationId: location.id,
                    exceptionType: 'SHORTAGE',
                    severity: componentAvailable === 0 ? 'CRITICAL' : 'HIGH',
                    message: `Insufficient inventory: ${componentAvailable.toFixed(0)} available, ${requiredQty.toFixed(0)} required`,
                    affectedDate: bucket,
                    currentValue: componentAvailable,
                    requiredValue: requiredQty,
                  });
                }
              }

              // Store requirement record
              requirements.push({
                productId: component.componentProductId,
                locationId: location.id,
                periodDate: bucket,
                grossRequirement: requiredQty,
                scheduledReceipts: 0,
                projectedOnHand: componentAvailable,
                netRequirement: componentNetReq,
                plannedOrderReceipt: componentNetReq > 0 ? componentNetReq : 0,
                plannedOrderRelease: componentNetReq > 0 ? componentNetReq : 0,
              });
            }
          }

          // Store requirement record for finished good
          requirements.push({
            productId: finishedGoodId,
            locationId: location.id,
            periodDate: bucket,
            grossRequirement,
            scheduledReceipts,
            projectedOnHand,
            netRequirement,
            plannedOrderReceipt: plannedOrderQty,
            plannedOrderRelease: plannedOrderQty,
          });

          // Update projected inventory
          projectedOnHand = available + plannedOrderQty;
          projectedInventory.set(finishedGoodId, projectedOnHand);
        }
      }
    }

    // 9. Clear previous MRP data for this run
    await this.prisma.mRPRequirement.deleteMany({ where: { mrpRunId: run.id } });
    await this.prisma.mRPException.deleteMany({ where: { mrpRunId: run.id } });
    await this.prisma.plannedOrder.deleteMany({ where: { mrpRunId: run.id } });

    // 10. Save requirements
    if (requirements.length > 0) {
      await this.prisma.mRPRequirement.createMany({
        data: requirements.map(r => ({
          mrpRunId: run.id,
          ...r,
        })),
      });
    }

    // 11. Save planned orders
    if (plannedOrders.length > 0) {
      await this.prisma.plannedOrder.createMany({
        data: plannedOrders.map(po => ({
          tenantId,
          mrpRunId: run.id,
          productId: po.productId,
          locationId: po.locationId,
          orderType: po.orderType,
          status: PlannedOrderStatus.PLANNED,
          startDate: po.startDate,
          dueDate: po.dueDate,
          quantity: po.quantity,
          supplierId: po.supplierId,
        })),
      });
    }

    // 12. Save exceptions
    if (exceptions.length > 0) {
      await this.prisma.mRPException.createMany({
        data: exceptions.map(e => ({
          mrpRunId: run.id,
          productId: e.productId,
          locationId: e.locationId,
          exceptionType: e.exceptionType as any,
          severity: e.severity as any,
          message: e.message,
          affectedDate: e.affectedDate,
          currentValue: e.currentValue,
          requiredValue: e.requiredValue,
          status: 'OPEN',
        })),
      });
    }

    return {
      plannedOrderCount: plannedOrders.length,
      exceptionCount: exceptions.length,
    };
  }

  async getMRPRequirements(tenantId: string, runId: string, params: {
    productId?: string;
    locationId?: string;
    startDate?: string;
    endDate?: string;
  } = {}) {
    const { productId, locationId, startDate, endDate } = params;
    return this.prisma.mRPRequirement.findMany({
      where: {
        mrpRunId: runId,
        ...(productId && { productId }),
        ...(locationId && { locationId }),
        ...(startDate || endDate ? {
          periodDate: {
            ...(startDate && { gte: new Date(startDate) }),
            ...(endDate && { lte: new Date(endDate) }),
          },
        } : {}),
        mrpRun: { tenantId },
      },
      orderBy: { periodDate: 'asc' },
    });
  }

  async getMRPExceptions(tenantId: string, params: {
    status?: string;
    exceptionType?: string;
    severity?: string;
    productId?: string;
    page?: number;
    pageSize?: number;
  } = {}) {
    const { status, exceptionType, severity, productId, page = 1, pageSize = 20 } = params;
    const where: any = {
      mrpRun: { tenantId },
      ...(status && { status }),
      ...(exceptionType && { exceptionType }),
      ...(severity && { severity }),
      ...(productId && { productId }),
    };

    const [items, total] = await Promise.all([
      this.prisma.mRPException.findMany({
        where,
        skip: (page - 1) * pageSize,
        take: pageSize,
        orderBy: { createdAt: 'desc' },
      }),
      this.prisma.mRPException.count({ where }),
    ]);

    return { items, total, page, pageSize, totalPages: Math.ceil(total / pageSize) };
  }

  async acknowledgeMRPException(tenantId: string, exceptionId: string, userId: string) {
    const exception = await this.prisma.mRPException.findFirst({
      where: { id: exceptionId, mrpRun: { tenantId } },
    });
    if (!exception) {
      throw new NotFoundException('MRP exception not found');
    }

    return this.prisma.mRPException.update({
      where: { id: exceptionId },
      data: { status: 'IN_PROGRESS', resolvedBy: userId, resolvedAt: new Date() },
    });
  }

  async resolveMRPException(tenantId: string, exceptionId: string, userId: string, resolution?: string) {
    const exception = await this.prisma.mRPException.findFirst({
      where: { id: exceptionId, mrpRun: { tenantId } },
    });
    if (!exception) {
      throw new NotFoundException('MRP exception not found');
    }

    return this.prisma.mRPException.update({
      where: { id: exceptionId },
      data: { status: 'RESOLVED', resolution, resolvedBy: userId, resolvedAt: new Date() },
    });
  }

  async ignoreMRPException(tenantId: string, exceptionId: string, userId: string, reason?: string) {
    const exception = await this.prisma.mRPException.findFirst({
      where: { id: exceptionId, mrpRun: { tenantId } },
    });
    if (!exception) {
      throw new NotFoundException('MRP exception not found');
    }

    return this.prisma.mRPException.update({
      where: { id: exceptionId },
      data: { status: 'IGNORED', resolution: reason, resolvedBy: userId, resolvedAt: new Date() },
    });
  }

  async getMRPSummary(tenantId: string) {
    const [runCount, plannedOrderCount, exceptionCount] = await Promise.all([
      this.prisma.mRPRun.count({ where: { tenantId } }),
      this.prisma.plannedOrder.count({ where: { tenantId } }),
      this.prisma.mRPException.count({ where: { mrpRun: { tenantId } } }),
    ]);

    return { runCount, plannedOrderCount, exceptionCount };
  }

  // ============================================================================
  // Fiscal Calendar Operations
  // ============================================================================

  async getFiscalCalendars(tenantId: string) {
    return this.prisma.fiscalCalendar.findMany({
      where: { tenantId },
      include: {
        periods: {
          orderBy: { startDate: 'asc' },
          take: 12,
        },
      },
      orderBy: { isDefault: 'desc' },
    });
  }

  async getFiscalCalendar(tenantId: string, calendarId: string) {
    const calendar = await this.prisma.fiscalCalendar.findFirst({
      where: { id: calendarId, tenantId },
      include: { periods: { orderBy: { startDate: 'asc' } } },
    });
    if (!calendar) {
      throw new NotFoundException('Fiscal calendar not found');
    }
    return calendar;
  }

  async getActiveFiscalCalendar(tenantId: string) {
    const calendar = await this.prisma.fiscalCalendar.findFirst({
      where: { tenantId, isDefault: true },
      include: { periods: { orderBy: { startDate: 'asc' }, take: 12 } },
    });
    if (!calendar) {
      throw new NotFoundException('Active fiscal calendar not found');
    }
    return calendar;
  }

  async createFiscalCalendar(tenantId: string, dto: {
    name: string;
    type: FiscalCalendarType;
    startMonth: number;
    weekStartDay?: number;
    patternType?: string;
    isDefault?: boolean;
  }) {
    if (dto.isDefault) {
      await this.prisma.fiscalCalendar.updateMany({
        where: { tenantId, isDefault: true },
        data: { isDefault: false },
      });
    }

    return this.prisma.fiscalCalendar.create({
      data: {
        tenantId,
        name: dto.name,
        type: dto.type,
        startMonth: dto.startMonth,
        weekStartDay: dto.weekStartDay || 1,
        patternType: dto.patternType || '445',
        isDefault: dto.isDefault || false,
      },
    });
  }

  async updateFiscalCalendar(tenantId: string, calendarId: string, dto: any) {
    const calendar = await this.prisma.fiscalCalendar.findFirst({
      where: { id: calendarId, tenantId },
    });
    if (!calendar) {
      throw new NotFoundException('Fiscal calendar not found');
    }

    return this.prisma.fiscalCalendar.update({
      where: { id: calendarId },
      data: {
        ...(dto.name && { name: dto.name }),
        ...(dto.code && { name: dto.code }),
        ...(dto.type && { type: dto.type }),
        ...(dto.yearStartMonth && { startMonth: dto.yearStartMonth }),
        ...(dto.yearStartDay && { weekStartDay: dto.yearStartDay }),
        ...(dto.weekStartDay && { weekStartDay: dto.weekStartDay }),
        ...(dto.patternType && { patternType: dto.patternType }),
        ...(dto.isDefault !== undefined && { isDefault: dto.isDefault }),
      },
    });
  }

  async activateFiscalCalendar(tenantId: string, calendarId: string) {
    const calendar = await this.prisma.fiscalCalendar.findFirst({
      where: { id: calendarId, tenantId },
    });
    if (!calendar) {
      throw new NotFoundException('Fiscal calendar not found');
    }

    await this.prisma.fiscalCalendar.updateMany({
      where: { tenantId, isDefault: true },
      data: { isDefault: false },
    });

    return this.prisma.fiscalCalendar.update({
      where: { id: calendarId },
      data: { isDefault: true },
    });
  }

  async deleteFiscalCalendar(tenantId: string, calendarId: string) {
    const calendar = await this.prisma.fiscalCalendar.findFirst({
      where: { id: calendarId, tenantId },
    });
    if (!calendar) {
      throw new NotFoundException('Fiscal calendar not found');
    }
    await this.prisma.fiscalCalendar.delete({ where: { id: calendarId } });
    return { success: true };
  }

  async generateFiscalPeriods(tenantId: string, calendarId: string, year: number) {
    const calendar = await this.prisma.fiscalCalendar.findFirst({
      where: { id: calendarId, tenantId },
    });
    if (!calendar) {
      throw new NotFoundException('Fiscal calendar not found');
    }

    const periods: any[] = [];
    const startMonth = calendar.startMonth;

    for (let month = 0; month < 12; month++) {
      const periodMonth = ((startMonth - 1 + month) % 12) + 1;
      const periodYear = startMonth + month > 12 ? year + 1 : year;
      
      const startDate = new Date(periodYear, periodMonth - 1, 1);
      const endDate = new Date(periodYear, periodMonth, 0);

      periods.push({
        calendarId,
        fiscalYear: year,
        fiscalQuarter: Math.floor(month / 3) + 1,
        fiscalMonth: month + 1,
        fiscalWeek: null,
        periodName: `P${(month + 1).toString().padStart(2, '0')} FY${year}`,
        startDate,
        endDate,
        workingDays: this.calculateWorkingDays(startDate, endDate),
        isClosed: false,
        isFrozen: false,
      });
    }

    return this.prisma.fiscalPeriod.createMany({
      data: periods,
      skipDuplicates: true,
    });
  }

  async getFiscalPeriods(tenantId: string, calendarId: string, params: {
    fiscalYear?: number;
    fiscalQuarter?: number;
    fiscalMonth?: number;
    isOpen?: boolean;
    startDateFrom?: string;
    startDateTo?: string;
  }) {
    const where: any = {
      calendarId,
      calendar: { tenantId },
      ...(params.fiscalYear && { fiscalYear: params.fiscalYear }),
      ...(params.fiscalQuarter && { fiscalQuarter: params.fiscalQuarter }),
      ...(params.fiscalMonth && { fiscalMonth: params.fiscalMonth }),
      ...(params.startDateFrom || params.startDateTo
        ? {
            startDate: {
              ...(params.startDateFrom && { gte: new Date(params.startDateFrom) }),
              ...(params.startDateTo && { lte: new Date(params.startDateTo) }),
            },
          }
        : {}),
    };

    return this.prisma.fiscalPeriod.findMany({
      where,
      orderBy: { startDate: 'asc' },
    });
  }

  async getFiscalPeriod(tenantId: string, periodId: string) {
    const period = await this.prisma.fiscalPeriod.findFirst({
      where: { id: periodId, calendar: { tenantId } },
    });
    if (!period) {
      throw new NotFoundException('Fiscal period not found');
    }
    return period;
  }

  async getCurrentFiscalPeriod(tenantId: string, calendarId: string) {
    const today = new Date();
    const period = await this.prisma.fiscalPeriod.findFirst({
      where: {
        calendarId,
        calendar: { tenantId },
        startDate: { lte: today },
        endDate: { gte: today },
      },
    });
    if (!period) {
      throw new NotFoundException('Current fiscal period not found');
    }
    return period;
  }

  async createFiscalPeriod(tenantId: string, calendarId: string, dto: any) {
    return this.prisma.fiscalPeriod.create({
      data: {
        calendarId,
        fiscalYear: dto.fiscalYear,
        fiscalQuarter: dto.fiscalQuarter,
        fiscalMonth: dto.fiscalMonth,
        fiscalWeek: dto.fiscalWeek,
        periodName: dto.periodName,
        startDate: new Date(dto.startDate),
        endDate: new Date(dto.endDate),
        workingDays: dto.workingDays ?? 0,
        isClosed: dto.isOpen === false,
        isFrozen: false,
      },
    });
  }

  async updateFiscalPeriod(tenantId: string, periodId: string, dto: any) {
    const period = await this.prisma.fiscalPeriod.findFirst({
      where: { id: periodId, calendar: { tenantId } },
    });
    if (!period) {
      throw new NotFoundException('Fiscal period not found');
    }

    return this.prisma.fiscalPeriod.update({
      where: { id: periodId },
      data: {
        ...(dto.periodName && { periodName: dto.periodName }),
        ...(dto.startDate && { startDate: new Date(dto.startDate) }),
        ...(dto.endDate && { endDate: new Date(dto.endDate) }),
        ...(dto.workingDays !== undefined && { workingDays: dto.workingDays }),
        ...(dto.isOpen !== undefined && { isClosed: !dto.isOpen }),
      },
    });
  }

  async toggleFiscalPeriodStatus(tenantId: string, periodId: string) {
    const period = await this.prisma.fiscalPeriod.findFirst({
      where: { id: periodId, calendar: { tenantId } },
    });
    if (!period) {
      throw new NotFoundException('Fiscal period not found');
    }

    return this.prisma.fiscalPeriod.update({
      where: { id: periodId },
      data: { isClosed: !period.isClosed },
    });
  }

  async deleteFiscalPeriod(tenantId: string, periodId: string) {
    const period = await this.prisma.fiscalPeriod.findFirst({
      where: { id: periodId, calendar: { tenantId } },
    });
    if (!period) {
      throw new NotFoundException('Fiscal period not found');
    }
    await this.prisma.fiscalPeriod.delete({ where: { id: periodId } });
    return { success: true };
  }

  async generateFiscalPeriodsV2(tenantId: string, calendarId: string, dto: any) {
    return this.generateFiscalPeriods(tenantId, calendarId, dto.fiscalYear || dto.year);
  }

  async dateToFiscal(tenantId: string, calendarId: string, date: string) {
    const target = new Date(date);
    const period = await this.prisma.fiscalPeriod.findFirst({
      where: {
        calendarId,
        calendar: { tenantId },
        startDate: { lte: target },
        endDate: { gte: target },
      },
    });
    if (!period) {
      throw new NotFoundException('Fiscal period not found');
    }
    return {
      date,
      fiscalYear: period.fiscalYear,
      fiscalQuarter: period.fiscalQuarter,
      fiscalMonth: period.fiscalMonth,
      fiscalWeek: period.fiscalWeek,
      periodName: period.periodName,
      periodId: period.id,
    };
  }

  async datesToFiscal(tenantId: string, calendarId: string, dates: string[]) {
    const results = [] as any[];
    for (const date of dates) {
      results.push(await this.dateToFiscal(tenantId, calendarId, date));
    }
    return results;
  }

  async fiscalToDateRange(tenantId: string, calendarId: string, params: {
    fiscalYear?: number;
    fiscalQuarter?: number;
    fiscalMonth?: number;
    fiscalWeek?: number;
  }) {
    const period = await this.prisma.fiscalPeriod.findFirst({
      where: {
        calendarId,
        calendar: { tenantId },
        ...(params.fiscalYear && { fiscalYear: params.fiscalYear }),
        ...(params.fiscalQuarter && { fiscalQuarter: params.fiscalQuarter }),
        ...(params.fiscalMonth && { fiscalMonth: params.fiscalMonth }),
        ...(params.fiscalWeek && { fiscalWeek: params.fiscalWeek }),
      },
      orderBy: { startDate: 'asc' },
    });
    if (!period) {
      throw new NotFoundException('Fiscal period not found');
    }
    return { startDate: period.startDate, endDate: period.endDate };
  }

  async getFiscalPeriodRange(tenantId: string, calendarId: string, params: {
    startDate: string;
    endDate: string;
  }) {
    return this.prisma.fiscalPeriod.findMany({
      where: {
        calendarId,
        calendar: { tenantId },
        startDate: { gte: new Date(params.startDate) },
        endDate: { lte: new Date(params.endDate) },
      },
      orderBy: { startDate: 'asc' },
    });
  }

  async getFiscalYearSummary(tenantId: string, calendarId: string, fiscalYear: number) {
    const periods = await this.prisma.fiscalPeriod.findMany({
      where: { calendarId, calendar: { tenantId }, fiscalYear },
      orderBy: { startDate: 'asc' },
    });

    if (periods.length === 0) {
      throw new NotFoundException('Fiscal year not found');
    }

    return {
      fiscalYear,
      quarters: new Set(periods.map(p => p.fiscalQuarter)).size,
      periods: periods.length,
      startDate: periods[0].startDate,
      endDate: periods[periods.length - 1].endDate,
      totalWorkingDays: periods.reduce((sum, p) => sum + (p.workingDays || 0), 0),
    };
  }

  async calculateWorkingDaysBetween(tenantId: string, calendarId: string, dto: any) {
    const start = new Date(dto.startDate);
    const end = new Date(dto.endDate);
    return { workingDays: this.calculateWorkingDays(start, end) };
  }

  private calculateWorkingDays(start: Date, end: Date): number {
    let count = 0;
    const current = new Date(start);
    while (current <= end) {
      const day = current.getDay();
      if (day !== 0 && day !== 6) count++;
      current.setDate(current.getDate() + 1);
    }
    return count;
  }

  // ============================================================================
  // S&OP Cycle Operations
  // ============================================================================

  async getSOPCycles(tenantId: string, params: {
    year?: number;
    status?: SOPStatus;
    page?: number;
    pageSize?: number;
  } = {}) {
    const { year, status, page = 1, pageSize = 20 } = params;
    
    const where: any = {
      tenantId,
      ...(year && { fiscalYear: year }),
      ...(status && { status }),
    };

    const [items, total] = await Promise.all([
      this.prisma.sOPCycle.findMany({
        where,
        include: {
          _count: {
            select: { forecasts: true, assumptions: true },
          },
        },
        skip: (page - 1) * pageSize,
        take: pageSize,
        orderBy: [{ fiscalYear: 'desc' }, { fiscalPeriod: 'desc' }],
      }),
      this.prisma.sOPCycle.count({ where }),
    ]);

    return { items, total, page, pageSize, totalPages: Math.ceil(total / pageSize) };
  }

  async getSOPCycle(tenantId: string, cycleId: string) {
    const cycle = await this.prisma.sOPCycle.findFirst({
      where: { id: cycleId, tenantId },
      include: {
        forecasts: true,
        assumptions: true,
      },
    });
    if (!cycle) {
      throw new NotFoundException('S&OP cycle not found');
    }
    return cycle;
  }

  async getSOPCycleSummary(tenantId: string, cycleId: string) {
    const cycle = await this.getSOPCycle(tenantId, cycleId);
    return {
      id: cycle.id,
      name: cycle.name,
      status: cycle.status,
      forecastCount: cycle.forecasts.length,
      assumptionCount: cycle.assumptions.length,
    };
  }

  async createSOPCycle(tenantId: string, userId: string, dto: {
    name: string;
    fiscalYear: number;
    fiscalPeriod: number;
    planningStart: Date;
    demandReviewDate: Date;
    supplyReviewDate: Date;
    preSopDate: Date;
    executiveSopDate: Date;
    planningEnd: Date;
    notes?: string;
  }) {
    // Check for existing cycle
    const existing = await this.prisma.sOPCycle.findFirst({
      where: { tenantId, fiscalYear: dto.fiscalYear, fiscalPeriod: dto.fiscalPeriod },
    });
    if (existing) {
      throw new BadRequestException(`S&OP cycle for ${dto.fiscalYear}-${dto.fiscalPeriod} already exists`);
    }

    return this.prisma.sOPCycle.create({
      data: {
        tenantId,
        name: dto.name,
        fiscalYear: dto.fiscalYear,
        fiscalPeriod: dto.fiscalPeriod,
        status: SOPStatus.PLANNING,
        planningStart: dto.planningStart,
        demandReviewDate: dto.demandReviewDate,
        supplyReviewDate: dto.supplyReviewDate,
        preSopDate: dto.preSopDate,
        executiveSopDate: dto.executiveSopDate,
        planningEnd: dto.planningEnd,
        notes: dto.notes,
      },
    });
  }

  async createSOPCycleV2(tenantId: string, userId: string, dto: any) {
    const fiscalYear = dto.year || dto.fiscalYear;
    const fiscalPeriod = dto.month || dto.fiscalPeriod || 1;
    const name = dto.name || `S&OP ${fiscalYear}-${String(fiscalPeriod).padStart(2, '0')}`;
    const start = dto.planningStart ? new Date(dto.planningStart) : new Date();
    const end = dto.planningEnd ? new Date(dto.planningEnd) : new Date();

    return this.createSOPCycle(tenantId, userId, {
      name,
      fiscalYear,
      fiscalPeriod,
      planningStart: start,
      demandReviewDate: dto.demandReviewDate ? new Date(dto.demandReviewDate) : start,
      supplyReviewDate: dto.supplyReviewDate ? new Date(dto.supplyReviewDate) : start,
      preSopDate: dto.preSopDate ? new Date(dto.preSopDate) : start,
      executiveSopDate: dto.executiveMeetingDate ? new Date(dto.executiveMeetingDate) : start,
      planningEnd: end,
      notes: dto.description,
    });
  }

  async updateSOPCycle(tenantId: string, cycleId: string, dto: any) {
    const cycle = await this.prisma.sOPCycle.findFirst({
      where: { id: cycleId, tenantId },
    });
    if (!cycle) {
      throw new NotFoundException('S&OP cycle not found');
    }

    return this.prisma.sOPCycle.update({
      where: { id: cycleId },
      data: {
        ...(dto.name && { name: dto.name }),
        ...(dto.description && { notes: dto.description }),
        ...(dto.demandReviewDate && { demandReviewDate: new Date(dto.demandReviewDate) }),
        ...(dto.supplyReviewDate && { supplyReviewDate: new Date(dto.supplyReviewDate) }),
        ...(dto.executiveMeetingDate && { executiveSopDate: new Date(dto.executiveMeetingDate) }),
        ...(dto.horizonMonths && { planningEnd: new Date(dto.planningEnd ?? cycle.planningEnd) }),
      },
    });
  }

  async deleteSOPCycle(tenantId: string, cycleId: string) {
    const cycle = await this.prisma.sOPCycle.findFirst({
      where: { id: cycleId, tenantId },
    });
    if (!cycle) {
      throw new NotFoundException('S&OP cycle not found');
    }

    await this.prisma.sOPCycle.delete({ where: { id: cycleId } });
    return { success: true };
  }

  async getSOPForecasts(tenantId: string, cycleId: string, params: {
    productId?: string;
    locationId?: string;
    source?: SOPForecastSource;
  } = {}) {
    return this.prisma.sOPForecast.findMany({
      where: {
        cycleId,
        cycle: { tenantId },
        ...(params.source && { source: params.source as SOPForecastSource }),
      },
    });
  }

  async getSOPForecastComparison(tenantId: string, cycleId: string) {
    const forecasts = await this.prisma.sOPForecast.findMany({
      where: { cycleId, cycle: { tenantId } },
    });

    return {
      cycleId,
      sources: forecasts.map(f => ({ source: f.source, totalUnits: Number(f.totalUnits), totalRevenue: Number(f.totalRevenue) })),
    };
  }

  async upsertSOPForecast(tenantId: string, cycleId: string, userId: string, dto: any) {
    const existing = await this.prisma.sOPForecast.findFirst({
      where: { cycleId, source: dto.source, cycle: { tenantId } },
    });

    if (existing) {
      return this.prisma.sOPForecast.update({
        where: { id: existing.id },
        data: {
          totalUnits: dto.quantityUnits ? new Decimal(dto.quantityUnits) : existing.totalUnits,
          totalRevenue: dto.quantityRevenue ? new Decimal(dto.quantityRevenue) : existing.totalRevenue,
          periodForecasts: dto.periodForecasts || existing.periodForecasts,
          comments: dto.notes ?? existing.comments,
        },
      });
    }

    return this.prisma.sOPForecast.create({
      data: {
        cycleId,
        source: dto.source,
        totalUnits: new Decimal(dto.quantityUnits || 0),
        totalRevenue: new Decimal(dto.quantityRevenue || 0),
        periodForecasts: dto.periodForecasts || [],
        submittedBy: userId,
        comments: dto.notes,
      },
    });
  }

  async bulkUpsertSOPForecasts(tenantId: string, cycleId: string, userId: string, dto: any) {
    const forecasts = dto.forecasts || [];
    const results = [] as any[];
    for (const forecast of forecasts) {
      results.push(await this.upsertSOPForecast(tenantId, cycleId, userId, forecast));
    }
    return results;
  }

  async deleteSOPForecast(tenantId: string, forecastId: string) {
    const forecast = await this.prisma.sOPForecast.findFirst({
      where: { id: forecastId, cycle: { tenantId } },
    });
    if (!forecast) {
      throw new NotFoundException('S&OP forecast not found');
    }

    await this.prisma.sOPForecast.delete({ where: { id: forecastId } });
    return { success: true };
  }

  async copySOPForecasts(tenantId: string, sourceCycleId: string, targetCycleId: string, dto: any) {
    const forecasts = await this.prisma.sOPForecast.findMany({
      where: { cycleId: sourceCycleId, cycle: { tenantId } },
    });

    await this.prisma.sOPForecast.deleteMany({
      where: { cycleId: targetCycleId, cycle: { tenantId } },
    });

    const created = await Promise.all(
      forecasts.map(forecast =>
        this.prisma.sOPForecast.create({
          data: {
            cycleId: targetCycleId,
            source: forecast.source,
            totalUnits: forecast.totalUnits,
            totalRevenue: forecast.totalRevenue,
            periodForecasts: forecast.periodForecasts,
            submittedBy: forecast.submittedBy,
          },
        })
      )
    );

    return created;
  }

  async importSOPStatistical(tenantId: string, cycleId: string, userId: string, dto: any) {
    // 1) Load the SOP cycle to get the planning period
    const cycle = await this.prisma.sOPCycle.findFirst({
      where: { id: cycleId, tenantId },
    });
    if (!cycle) throw new NotFoundException('SOP Cycle not found');

    // Determine planning horizon from the cycle (default 18 months from cycle start)
    const startDate = dto?.startDate
      ? new Date(dto.startDate)
      : new Date(cycle.planningStart);
    const horizonMonths = 18;
    const endDate = dto?.endDate
      ? new Date(dto.endDate)
      : new Date(startDate.getFullYear(), startDate.getMonth() + horizonMonths, 1);

    // 2) Get the latest COMPLETED forecast run for this tenant
    const latestRun = await this.prisma.forecastRun.findFirst({
      where: {
        tenantId,
        status: 'COMPLETED',
      },
      orderBy: { completedAt: 'desc' },
    });

    if (!latestRun) {
      // No completed forecast runs — create an empty statistical record
      return this.upsertSOPForecast(tenantId, cycleId, userId, {
        source: 'STATISTICAL',
        quantityUnits: 0,
        quantityRevenue: 0,
        periodForecasts: [],
        notes: 'No completed forecast runs found to import from.',
      });
    }

    // 3) Query forecast results from that run, optionally filtered by products/locations
    const where: any = {
      tenantId,
      forecastRunId: latestRun.id,
      periodDate: { gte: startDate, lt: endDate },
    };
    if (dto?.productIds?.length) where.productId = { in: dto.productIds };
    if (dto?.locationIds?.length) where.locationId = { in: dto.locationIds };

    const results = await this.prisma.forecastResult.findMany({
      where,
      include: { product: { select: { id: true, code: true, name: true } }, location: { select: { id: true, code: true, name: true } } },
      orderBy: { periodDate: 'asc' },
    });

    // 4) Aggregate into period-level breakdowns
    const periodMap = new Map<string, { periodDate: string; totalUnits: number; totalRevenue: number; products: any[] }>();
    let grandTotalUnits = 0;
    let grandTotalRevenue = 0;

    for (const r of results) {
      const periodKey = r.periodDate.toISOString().slice(0, 7); // YYYY-MM
      if (!periodMap.has(periodKey)) {
        periodMap.set(periodKey, { periodDate: periodKey, totalUnits: 0, totalRevenue: 0, products: [] });
      }
      const period = periodMap.get(periodKey)!;
      const qty = Number(r.forecastQuantity ?? 0);
      const amt = Number(r.forecastAmount ?? 0);
      period.totalUnits += qty;
      period.totalRevenue += amt;
      grandTotalUnits += qty;
      grandTotalRevenue += amt;
      period.products.push({
        productId: r.productId,
        productCode: r.product?.code,
        productName: r.product?.name,
        locationId: r.locationId,
        locationCode: r.location?.code,
        quantity: qty,
        revenue: amt,
      });
    }

    const periodForecasts = Array.from(periodMap.values()).sort((a, b) => a.periodDate.localeCompare(b.periodDate));

    // 5) Upsert the statistical forecast entry
    return this.upsertSOPForecast(tenantId, cycleId, userId, {
      source: 'STATISTICAL',
      quantityUnits: grandTotalUnits,
      quantityRevenue: grandTotalRevenue,
      periodForecasts,
      notes: `Imported from forecast run ${latestRun.id.slice(0, 8)}... (${results.length} results, ${periodForecasts.length} periods)`,
    });
  }

  async getSOPAssumptions(tenantId: string, cycleId: string, params: {
    category?: string;
    riskLevel?: RiskLevel;
    status?: string;
  } = {}) {
    return this.prisma.sOPAssumption.findMany({
      where: {
        cycleId,
        cycle: { tenantId },
        ...(params.category && { category: params.category }),
        ...(params.riskLevel && { risk: params.riskLevel as RiskLevel }),
        ...(params.status && { status: params.status as any }),
      },
      orderBy: { createdAt: 'desc' },
    });
  }

  async createSOPAssumption(tenantId: string, cycleId: string, userId: string, dto: any) {
    return this.prisma.sOPAssumption.create({
      data: {
        cycleId,
        category: dto.category,
        assumption: dto.assumption,
        impact: dto.impactDescription,
        quantifiedImpact: dto.quantitativeImpact ? new Decimal(dto.quantitativeImpact) : null,
        risk: (dto.riskLevel as RiskLevel) || RiskLevel.MEDIUM,
        owner: dto.owner,
      },
    });
  }

  async updateSOPAssumption(tenantId: string, assumptionId: string, dto: any) {
    const assumption = await this.prisma.sOPAssumption.findFirst({
      where: { id: assumptionId, cycle: { tenantId } },
    });
    if (!assumption) {
      throw new NotFoundException('S&OP assumption not found');
    }

    return this.prisma.sOPAssumption.update({
      where: { id: assumptionId },
      data: {
        ...(dto.category && { category: dto.category }),
        ...(dto.assumption && { assumption: dto.assumption }),
        ...(dto.impactDescription && { impact: dto.impactDescription }),
        ...(dto.quantitativeImpact !== undefined && { quantifiedImpact: new Decimal(dto.quantitativeImpact) }),
        ...(dto.riskLevel && { risk: dto.riskLevel }),
        ...(dto.owner && { owner: dto.owner }),
        ...(dto.status && { status: dto.status }),
      },
    });
  }

  async deleteSOPAssumption(tenantId: string, assumptionId: string) {
    const assumption = await this.prisma.sOPAssumption.findFirst({
      where: { id: assumptionId, cycle: { tenantId } },
    });
    if (!assumption) {
      throw new NotFoundException('S&OP assumption not found');
    }

    await this.prisma.sOPAssumption.delete({ where: { id: assumptionId } });
    return { success: true };
  }

  async updateSOPCycleStatus(tenantId: string, cycleId: string, status: SOPStatus) {
    const cycle = await this.prisma.sOPCycle.findFirst({
      where: { id: cycleId, tenantId },
    });
    if (!cycle) {
      throw new NotFoundException('S&OP cycle not found');
    }

    return this.prisma.sOPCycle.update({
      where: { id: cycleId },
      data: { status },
    });
  }

  // ============================================================================
  // Dashboard / Analytics
  // ============================================================================

  async getDashboardMetrics(tenantId: string) {
    const [
      bomCount,
      pendingBomApproval,
      workCenterCount,
      inventoryPolicyCount,
      plannedOrderCount,
      sopCycleCount,
      supplierCount,
      activeWorkflows,
      npiInDev,
      npiPreLaunch,
      activePromos,
      upcomingPromos,
    ] = await Promise.all([
      this.prisma.billOfMaterial.count({ where: { tenantId, status: 'ACTIVE' } }),
      this.prisma.billOfMaterial.count({ where: { tenantId, status: 'PENDING_APPROVAL' } }),
      this.prisma.workCenter.count({ where: { tenantId, status: 'ACTIVE' } }),
      this.prisma.inventoryPolicy.count({ where: { tenantId } }),
      this.prisma.plannedOrder.count({ where: { tenantId, status: PlannedOrderStatus.PLANNED } }),
      this.prisma.sOPCycle.count({ where: { tenantId, status: { not: SOPStatus.CLOSED } } }),
      this.prisma.supplier.count({ where: { tenantId, status: 'ACTIVE' } }),
      this.prisma.workflowInstance.count({ where: { tenantId, status: 'IN_PROGRESS' } }),
      this.prisma.newProductIntroduction.count({ where: { tenantId, status: { in: ['CONCEPT', 'DEVELOPMENT', 'PILOT'] } } }),
      this.prisma.newProductIntroduction.count({ where: { tenantId, status: 'LAUNCH' } }),
      this.prisma.promotion.count({ where: { tenantId, status: 'ACTIVE' } }),
      this.prisma.promotion.count({ where: { tenantId, status: 'PLANNED' } }),
    ]);

    const pendingApprovals = await this.prisma.workflowInstance.count({
      where: { tenantId, status: 'IN_PROGRESS' },
    });

    // Get below safety stock count using mapped table/column names
    const belowSafetyStock = await this.prisma.$queryRaw<{ count: bigint }[]>`
      SELECT COUNT(*) as count FROM inventory_levels il
      JOIN inventory_policies ip ON il.product_id = ip.product_id AND il.location_id = ip.location_id
      WHERE il.tenant_id = ${tenantId}::uuid
      AND il.on_hand_qty < ip.safety_stock_qty
    `.then(r => Number(r[0]?.count ?? 0)).catch(() => 0);

    // Get current S&OP cycle info
    const currentSopCycle = await this.prisma.sOPCycle.findFirst({
      where: { tenantId, status: { not: SOPStatus.CLOSED } },
      orderBy: { planningStart: 'desc' },
      select: { name: true, status: true },
    });

    // Get avg supplier lead time
    const avgLeadTime = await this.prisma.supplierProduct.aggregate({
      where: { supplier: { tenantId } },
      _avg: { leadTimeDays: true },
    }).then(r => r._avg?.leadTimeDays ?? 0).catch(() => 0);

    // Get fiscal calendar info
    const fiscalCalendar = await this.prisma.fiscalCalendar.findFirst({
      where: { tenantId, isDefault: true },
      select: { type: true },
    });

    return {
      boms: { total: bomCount, pendingApproval: pendingBomApproval },
      workCenters: { active: workCenterCount },
      inventoryPolicies: { total: inventoryPolicyCount, belowSafetyStock },
      plannedOrders: { pending: plannedOrderCount },
      sopCycles: {
        active: sopCycleCount,
        currentCycle: currentSopCycle?.name || null,
        currentStatus: currentSopCycle?.status || null,
      },
      pendingApprovals,
      activeWorkflows,
      suppliers: { active: supplierCount, avgLeadTimeDays: Math.round(avgLeadTime * 10) / 10 },
      npi: { inDevelopment: npiInDev, preLaunch: npiPreLaunch },
      promotions: { active: activePromos, upcoming: upcomingPromos },
      fiscalCalendar: {
        type: fiscalCalendar?.type || null,
      },
    };
  }

  // ============================================================================
  // Suppliers
  // ============================================================================

  async getSuppliers(tenantId: string, params: {
    search?: string;
    isActive?: boolean;
    isPreferred?: boolean;
    page?: number;
    pageSize?: number;
  } = {}) {
    const { search, isActive, isPreferred, page = 1, pageSize = 20 } = params;
    const where: any = {
      tenantId,
      ...(search && {
        OR: [
          { name: { contains: search, mode: 'insensitive' } },
          { code: { contains: search, mode: 'insensitive' } },
        ],
      }),
      ...(isActive !== undefined && { status: isActive ? 'ACTIVE' : 'INACTIVE' }),
      ...(isPreferred !== undefined && { attributes: { path: ['isPreferred'], equals: isPreferred } }),
    };

    const [items, total] = await Promise.all([
      this.prisma.supplier.findMany({
        where,
        skip: (page - 1) * pageSize,
        take: pageSize,
        orderBy: { name: 'asc' },
      }),
      this.prisma.supplier.count({ where }),
    ]);

    const normalizedItems = items.map((supplier) => {
      const attributes = (supplier.attributes ?? {}) as Record<string, unknown>;
      const leadTime = attributes.defaultLeadTimeDays;
      const minOrder = attributes.minimumOrderValue;
      return {
        ...supplier,
        isPreferred: Boolean(attributes.isPreferred),
        defaultLeadTimeDays: typeof leadTime === 'number' ? leadTime : undefined,
        minimumOrderValue: typeof minOrder === 'number' ? minOrder : undefined,
      };
    });

    return { items: normalizedItems, total, page, pageSize, totalPages: Math.ceil(total / pageSize) };
  }

  async getSupplier(tenantId: string, supplierId: string) {
    const supplier = await this.prisma.supplier.findFirst({
      where: { id: supplierId, tenantId },
      include: { products: true },
    });
    if (!supplier) {
      throw new NotFoundException('Supplier not found');
    }
    const attributes = (supplier.attributes ?? {}) as Record<string, unknown>;
    const leadTime = attributes.defaultLeadTimeDays;
    const minOrder = attributes.minimumOrderValue;
    return {
      ...supplier,
      isPreferred: Boolean(attributes.isPreferred),
      defaultLeadTimeDays: typeof leadTime === 'number' ? leadTime : undefined,
      minimumOrderValue: typeof minOrder === 'number' ? minOrder : undefined,
    };
  }

  async createSupplier(tenantId: string, dto: any) {
    const currency = dto.currency || await this.resolveTenantCurrency(tenantId);
    return this.prisma.supplier.create({
      data: {
        tenantId,
        code: dto.code,
        name: dto.name,
        contactName: dto.contactName,
        email: dto.contactEmail,
        phone: dto.contactPhone,
        address: dto.address,
        country: dto.country,
        currency,
        paymentTerms: dto.paymentTerms,
        status: dto.isActive === false ? 'INACTIVE' : 'ACTIVE',
        attributes: {
          isPreferred: dto.isPreferred || false,
          ...(dto.defaultLeadTimeDays !== undefined && { defaultLeadTimeDays: dto.defaultLeadTimeDays }),
          ...(dto.minimumOrderValue !== undefined && { minimumOrderValue: dto.minimumOrderValue }),
        },
      },
    });
  }

  async updateSupplier(tenantId: string, supplierId: string, dto: any) {
    const supplier = await this.prisma.supplier.findFirst({
      where: { id: supplierId, tenantId },
    });
    if (!supplier) {
      throw new NotFoundException('Supplier not found');
    }

    const currentAttributes = (supplier.attributes ?? {}) as Record<string, unknown>;
    const nextAttributes = {
      ...currentAttributes,
      ...(dto.isPreferred !== undefined && { isPreferred: dto.isPreferred }),
      ...(dto.defaultLeadTimeDays !== undefined && { defaultLeadTimeDays: dto.defaultLeadTimeDays }),
      ...(dto.minimumOrderValue !== undefined && { minimumOrderValue: dto.minimumOrderValue }),
    };

    return this.prisma.supplier.update({
      where: { id: supplierId },
      data: {
        ...(dto.code && { code: dto.code }),
        ...(dto.name && { name: dto.name }),
        ...(dto.contactName !== undefined && { contactName: dto.contactName }),
        ...(dto.contactEmail !== undefined && { email: dto.contactEmail }),
        ...(dto.contactPhone !== undefined && { phone: dto.contactPhone }),
        ...(dto.address !== undefined && { address: dto.address }),
        ...(dto.country !== undefined && { country: dto.country }),
        ...(dto.currency !== undefined && { currency: dto.currency }),
        ...(dto.paymentTerms !== undefined && { paymentTerms: dto.paymentTerms }),
        ...(dto.isActive !== undefined && { status: dto.isActive ? 'ACTIVE' : 'INACTIVE' }),
        ...((dto.isPreferred !== undefined || dto.defaultLeadTimeDays !== undefined || dto.minimumOrderValue !== undefined)
          && { attributes: nextAttributes }),
      },
    });
  }

  async deleteSupplier(tenantId: string, supplierId: string) {
    const supplier = await this.prisma.supplier.findFirst({
      where: { id: supplierId, tenantId },
    });
    if (!supplier) {
      throw new NotFoundException('Supplier not found');
    }
    await this.prisma.supplier.delete({ where: { id: supplierId } });
    return { success: true };
  }

  async getSupplierProducts(tenantId: string, supplierId: string, params: {
    search?: string;
    supplyType?: string;
    page?: number;
    pageSize?: number;
  } = {}) {
    const { search, page = 1, pageSize = 20 } = params;
    const where: any = {
      supplierId,
      ...(search && { supplierPartNumber: { contains: search, mode: 'insensitive' } }),
    };

    const [items, total] = await Promise.all([
      this.prisma.supplierProduct.findMany({
        where,
        skip: (page - 1) * pageSize,
        take: pageSize,
        orderBy: { isPrimary: 'desc' },
      }),
      this.prisma.supplierProduct.count({ where }),
    ]);

    return { items, total, page, pageSize, totalPages: Math.ceil(total / pageSize) };
  }

  async getProductSuppliers(tenantId: string, productId: string) {
    const links = await this.prisma.supplierProduct.findMany({
      where: { productId },
      include: { supplier: true },
    });
    return links;
  }

  async compareSuppliers(tenantId: string, productId: string) {
    const links = await this.getProductSuppliers(tenantId, productId);
    return links.map(link => ({
      supplierId: link.supplierId,
      supplierName: link.supplier?.name,
      unitCost: Number(link.unitPrice),
      leadTimeDays: link.leadTimeDays,
      isPrimary: link.isPrimary,
    }));
  }

  async linkSupplierProduct(tenantId: string, supplierId: string, dto: any) {
    const currency = dto.currency || await this.resolveTenantCurrency(tenantId);
    return this.prisma.supplierProduct.create({
      data: {
        supplierId,
        productId: dto.productId,
        supplierPartNumber: dto.supplierPartNumber,
        unitPrice: new Decimal(dto.unitCost || 0),
        currency,
        minOrderQty: new Decimal(dto.minimumOrderQty || 1),
        orderMultiple: new Decimal(dto.orderMultiple || 1),
        leadTimeDays: dto.leadTimeDays || 0,
        isPrimary: dto.isPrimary || false,
        effectiveFrom: new Date(),
      },
    });
  }

  async bulkLinkSupplierProducts(tenantId: string, supplierId: string, dto: any) {
    const products = dto.products || [];
    const created = await Promise.all(products.map((product: any) =>
      this.linkSupplierProduct(tenantId, supplierId, product)
    ));
    return created;
  }

  async updateSupplierProduct(tenantId: string, supplierId: string, productId: string, dto: any) {
    const link = await this.prisma.supplierProduct.findFirst({
      where: { supplierId, productId, supplier: { tenantId } },
    });
    if (!link) {
      throw new NotFoundException('Supplier product link not found');
    }

    return this.prisma.supplierProduct.update({
      where: { id: link.id },
      data: {
        ...(dto.unitCost !== undefined && { unitPrice: new Decimal(dto.unitCost) }),
        ...(dto.leadTimeDays !== undefined && { leadTimeDays: dto.leadTimeDays }),
        ...(dto.minimumOrderQty !== undefined && { minOrderQty: new Decimal(dto.minimumOrderQty) }),
        ...(dto.orderMultiple !== undefined && { orderMultiple: new Decimal(dto.orderMultiple) }),
        ...(dto.isPrimary !== undefined && { isPrimary: dto.isPrimary }),
      },
    });
  }

  async unlinkSupplierProduct(tenantId: string, supplierId: string, productId: string) {
    const link = await this.prisma.supplierProduct.findFirst({
      where: { supplierId, productId, supplier: { tenantId } },
    });
    if (!link) {
      throw new NotFoundException('Supplier product link not found');
    }
    await this.prisma.supplierProduct.delete({ where: { id: link.id } });
    return { success: true };
  }

  async setPrimarySupplier(tenantId: string, supplierId: string, productId: string) {
    // Verify supplier belongs to tenant
    const supplier = await this.prisma.supplier.findFirst({ where: { id: supplierId, tenantId } });
    if (!supplier) throw new NotFoundException('Supplier not found');
    await this.prisma.supplierProduct.updateMany({
      where: { productId, supplier: { tenantId } },
      data: { isPrimary: false },
    });

    await this.prisma.supplierProduct.updateMany({
      where: { supplierId, productId },
      data: { isPrimary: true },
    });

    return { success: true };
  }

  async getSupplierPerformance(tenantId: string, supplierId: string, params: { startDate?: string; endDate?: string }) {
    const dateFilter: any = {};
    if (params.startDate) dateFilter.gte = new Date(params.startDate);
    if (params.endDate) dateFilter.lte = new Date(params.endDate);

    // Get goods receipts from this supplier's POs
    const purchaseOrders = await this.prisma.purchaseOrder.findMany({
      where: {
        tenantId,
        supplierId,
        ...(Object.keys(dateFilter).length ? { orderDate: dateFilter } : {}),
      },
      select: { id: true, expectedDate: true },
    });

    const poIds = purchaseOrders.map(po => po.id);

    if (poIds.length === 0) {
      return {
        supplierId,
        totalOrders: 0,
        onTimeDeliveries: 0,
        onTimeDeliveryRate: 0,
        qualityRating: 0,
        totalReceived: 0,
        totalRejected: 0,
        qualityPassRate: 0,
        startDate: params.startDate,
        endDate: params.endDate,
      };
    }

    const goodsReceipts = await this.prisma.goodsReceipt.findMany({
      where: { tenantId, purchaseOrderId: { in: poIds } },
      select: { id: true, receiptDate: true, purchaseOrderId: true },
    });

    // On-time delivery: compare GR receiptDate to PO expectedDeliveryDate
    const poMap = new Map(purchaseOrders.map(po => [po.id, po]));
    let onTimeCount = 0;
    for (const gr of goodsReceipts) {
      const po = poMap.get(gr.purchaseOrderId);
      if (po?.expectedDate && gr.receiptDate <= po.expectedDate) {
        onTimeCount++;
      }
    }

    const onTimeRate = goodsReceipts.length > 0
      ? Math.round((onTimeCount / goodsReceipts.length) * 100) / 100
      : 0;

    // Quality: check QC inspections for received items
    const grIds = goodsReceipts.map(gr => gr.id);
    const inspections = await this.prisma.qualityInspection.findMany({
      where: {
        tenantId,
        goodsReceiptId: { in: grIds },
      },
      select: { status: true, inspectedQty: true, acceptedQty: true, rejectedQty: true },
    });

    const totalInspected = inspections.reduce((sum, qi) => sum + Number(qi.inspectedQty ?? 0), 0);
    const totalRejected = inspections.reduce((sum, qi) => sum + Number(qi.rejectedQty ?? 0), 0);
    const qualityPassRate = totalInspected > 0
      ? Math.round(((totalInspected - totalRejected) / totalInspected) * 100) / 100
      : 1;

    return {
      supplierId,
      totalOrders: purchaseOrders.length,
      onTimeDeliveries: onTimeCount,
      onTimeDeliveryRate: onTimeRate,
      qualityRating: qualityPassRate,
      totalReceived: goodsReceipts.length,
      totalRejected,
      qualityPassRate,
      startDate: params.startDate,
      endDate: params.endDate,
    };
  }

  async getSupplierSummary(tenantId: string) {
    const total = await this.prisma.supplier.count({ where: { tenantId } });
    return { totalSuppliers: total };
  }

  // ============================================================================
  // Promotions
  // ============================================================================

  async getPromotions(tenantId: string, params: any) {
    const where: any = {
      tenantId,
      ...(params.status && { status: params.status }),
      ...(params.type && { type: params.type }),
      ...(params.productId && { productIds: { has: params.productId } }),
      ...(params.locationId && { locationIds: { has: params.locationId } }),
      ...(params.startDateFrom || params.startDateTo ? {
        startDate: {
          ...(params.startDateFrom && { gte: new Date(params.startDateFrom) }),
          ...(params.startDateTo && { lte: new Date(params.startDateTo) }),
        },
      } : {}),
      ...(params.endDateFrom || params.endDateTo ? {
        endDate: {
          ...(params.endDateFrom && { gte: new Date(params.endDateFrom) }),
          ...(params.endDateTo && { lte: new Date(params.endDateTo) }),
        },
      } : {}),
    };

    const page = params.page || 1;
    const pageSize = params.pageSize || 20;

    const [items, total] = await Promise.all([
      this.prisma.promotion.findMany({
        where,
        skip: (page - 1) * pageSize,
        take: pageSize,
        orderBy: { startDate: 'desc' },
      }),
      this.prisma.promotion.count({ where }),
    ]);

    return { items, total, page, pageSize, totalPages: Math.ceil(total / pageSize) };
  }

  async getPromotion(tenantId: string, promotionId: string) {
    const promotion = await this.prisma.promotion.findFirst({
      where: { id: promotionId, tenantId },
      include: { liftFactors: true },
    });
    if (!promotion) {
      throw new NotFoundException('Promotion not found');
    }
    return promotion;
  }

  async createPromotion(tenantId: string, dto: any) {
    // Auto-generate promotion code if not provided
    let code = dto.code;
    if (!code) {
      const count = await this.prisma.promotion.count({ where: { tenantId } });
      code = `PROMO-${String(count + 1).padStart(6, '0')}`;
    }

    return this.prisma.promotion.create({
      data: {
        tenantId,
        code,
        name: dto.name,
        description: dto.description,
        type: dto.type,
        status: dto.status || 'DRAFT',
        startDate: new Date(dto.startDate),
        endDate: new Date(dto.endDate),
        discountPercent: dto.discountPercent,
        discountAmount: dto.discountAmount,
        marketingSpend: dto.marketingSpend,
        budget: dto.marketingSpend,
        notes: dto.notes,
        productIds: dto.productIds || [],
        locationIds: dto.locationIds || [],
        customerIds: [],
        channelIds: [],
      },
    });
  }

  async updatePromotion(tenantId: string, promotionId: string, dto: any) {
    const promotion = await this.prisma.promotion.findFirst({
      where: { id: promotionId, tenantId },
    });
    if (!promotion) {
      throw new NotFoundException('Promotion not found');
    }

    return this.prisma.promotion.update({
      where: { id: promotionId },
      data: {
        ...(dto.code && { code: dto.code }),
        ...(dto.name && { name: dto.name }),
        ...(dto.description !== undefined && { description: dto.description }),
        ...(dto.type && { type: dto.type }),
        ...(dto.startDate && { startDate: new Date(dto.startDate) }),
        ...(dto.endDate && { endDate: new Date(dto.endDate) }),
        ...(dto.discountPercent !== undefined && { discountPercent: dto.discountPercent }),
        ...(dto.discountAmount !== undefined && { discountAmount: dto.discountAmount }),
        ...(dto.marketingSpend !== undefined && { marketingSpend: dto.marketingSpend, budget: dto.marketingSpend }),
        ...(dto.notes !== undefined && { notes: dto.notes }),
        ...(dto.productIds && { productIds: dto.productIds }),
        ...(dto.locationIds && { locationIds: dto.locationIds }),
      },
    });
  }

  async updatePromotionStatus(tenantId: string, promotionId: string, status: string) {
    const promo = await this.prisma.promotion.findFirst({ where: { id: promotionId, tenantId } });
    if (!promo) throw new NotFoundException('Promotion not found');
    return this.prisma.promotion.update({
      where: { id: promotionId },
      data: { status: status as any },
    });
  }

  async deletePromotion(tenantId: string, promotionId: string) {
    const promotion = await this.prisma.promotion.findFirst({
      where: { id: promotionId, tenantId },
    });
    if (!promotion) {
      throw new NotFoundException('Promotion not found');
    }
    await this.prisma.promotion.delete({ where: { id: promotionId } });
    return { success: true };
  }

  async getActivePromotions(tenantId: string, params: any) {
    const today = new Date();
    return this.prisma.promotion.findMany({
      where: {
        tenantId,
        status: 'ACTIVE',
        startDate: { lte: today },
        endDate: { gte: today },
        ...(params.productId && { productIds: { has: params.productId } }),
        ...(params.locationId && { locationIds: { has: params.locationId } }),
      },
    });
  }

  async getUpcomingPromotions(tenantId: string, params: any) {
    const days = params.days || 30;
    const today = new Date();
    const upcoming = new Date();
    upcoming.setDate(today.getDate() + days);

    return this.prisma.promotion.findMany({
      where: {
        tenantId,
        startDate: { gte: today, lte: upcoming },
        ...(params.productId && { productIds: { has: params.productId } }),
        ...(params.locationId && { locationIds: { has: params.locationId } }),
      },
    });
  }

  async getPromotionLiftFactors(tenantId: string, promotionId: string, params: any) {
    return this.prisma.promotionLiftFactor.findMany({
      where: {
        promotionId,
        ...(params.productId && { productId: params.productId }),
        ...(params.locationId && { locationId: params.locationId }),
      },
    });
  }

  async upsertPromotionLiftFactor(tenantId: string, promotionId: string, dto: any) {
    const existing = await this.prisma.promotionLiftFactor.findFirst({
      where: { promotionId, productId: dto.productId, locationId: dto.locationId, promotion: { tenantId } },
    });

    if (existing) {
      return this.prisma.promotionLiftFactor.update({
        where: { id: existing.id },
        data: {
          expectedLift: new Decimal(dto.liftPercent),
          expectedCannibalization: new Decimal(dto.cannibalizationPercent || 0),
          expectedHalo: new Decimal(dto.haloPercent || 0),
        },
      });
    }

    return this.prisma.promotionLiftFactor.create({
      data: {
        promotionId,
        productId: dto.productId,
        locationId: dto.locationId,
        expectedLift: new Decimal(dto.liftPercent),
        expectedCannibalization: new Decimal(dto.cannibalizationPercent || 0),
        expectedHalo: new Decimal(dto.haloPercent || 0),
      },
    });
  }

  async bulkUpsertPromotionLiftFactors(tenantId: string, promotionId: string, dto: any) {
    const liftFactors = dto.liftFactors || [];
    return Promise.all(liftFactors.map((lift: any) => this.upsertPromotionLiftFactor(tenantId, promotionId, lift)));
  }

  async deletePromotionLiftFactor(tenantId: string, liftFactorId: string) {
    const lift = await this.prisma.promotionLiftFactor.findFirst({
      where: { id: liftFactorId, promotion: { tenantId } },
    });
    if (!lift) {
      throw new NotFoundException('Lift factor not found');
    }
    await this.prisma.promotionLiftFactor.delete({ where: { id: liftFactorId } });
    return { success: true };
  }

  async getPromotionImpact(tenantId: string, promotionId: string) {
    const promotion = await this.getPromotion(tenantId, promotionId);
    const startDate = promotion.startDate;
    const endDate = promotion.endDate;

    const forecastResults = await this.prisma.forecastResult.findMany({
      where: {
        tenantId,
        periodDate: { gte: startDate, lte: endDate },
        ...(promotion.productIds?.length ? { productId: { in: promotion.productIds } } : {}),
      },
    });

    const liftFactors = promotion.liftFactors || [];

    const baselineByProduct = new Map<string, { units: number; revenue: number }>();
    const baselineByWeek = new Map<number, { units: number; revenue: number; startDate: Date }>();

    forecastResults.forEach(result => {
      const productId = result.productId || 'unknown';
      const units = Number(result.forecastQuantity || 0);
      const revenue = Number(result.forecastAmount || 0);
      const weekNumber = this.getWeekNumber(startDate, result.periodDate);

      const current = baselineByProduct.get(productId) || { units: 0, revenue: 0 };
      baselineByProduct.set(productId, { units: current.units + units, revenue: current.revenue + revenue });

      const week = baselineByWeek.get(weekNumber) || { units: 0, revenue: 0, startDate: new Date(result.periodDate) };
      baselineByWeek.set(weekNumber, { units: week.units + units, revenue: week.revenue + revenue, startDate: week.startDate });
    });

    const productIds = Array.from(baselineByProduct.keys()).filter(id => id !== 'unknown');
    const products = productIds.length
      ? await this.prisma.product.findMany({
          where: { id: { in: productIds } },
          select: { id: true, code: true, name: true },
        })
      : [];
    const productMap = new Map(products.map(p => [p.id, p]));

    const impactByProduct = Array.from(baselineByProduct.entries()).map(([productId, base]) => {
      const lift = liftFactors
        .filter(lf => !lf.productId || lf.productId === productId)
        .reduce((sum, lf) => sum + this.normalizeLiftPercent(Number(lf.expectedLift || 0)), 0);
      const adjustedUnits = base.units * (1 + lift);
      const product = productMap.get(productId);
      return {
        productId,
        sku: product?.code || '',
        name: product?.name || '',
        baselineForecast: base.units,
        adjustedForecast: adjustedUnits,
        liftUnits: adjustedUnits - base.units,
        liftPercent: base.units > 0 ? ((adjustedUnits - base.units) / base.units) * 100 : 0,
      };
    });

    const impactByWeek = Array.from(baselineByWeek.entries()).map(([weekNumber, base]) => {
      const lift = liftFactors.reduce((sum, lf) => sum + this.normalizeLiftPercent(Number(lf.expectedLift || 0)), 0);
      const adjustedUnits = base.units * (1 + lift);
      return {
        weekNumber,
        startDate: base.startDate.toISOString().slice(0, 10),
        baselineForecast: base.units,
        adjustedForecast: adjustedUnits,
        liftUnits: adjustedUnits - base.units,
        liftPercent: base.units > 0 ? ((adjustedUnits - base.units) / base.units) * 100 : 0,
      };
    });

    const totalBaselineForecast = impactByProduct.reduce((sum, item) => sum + item.baselineForecast, 0);
    const totalAdjustedForecast = impactByProduct.reduce((sum, item) => sum + item.adjustedForecast, 0);
    const totalLiftUnits = totalAdjustedForecast - totalBaselineForecast;
    const totalLiftPercent = totalBaselineForecast > 0 ? (totalLiftUnits / totalBaselineForecast) * 100 : 0;

    const actuals = await this.prisma.actual.findMany({
      where: {
        tenantId,
        actualType: ActualType.SALES,
        periodDate: { gte: startDate, lte: endDate },
        ...(promotion.productIds?.length ? { productId: { in: promotion.productIds } } : {}),
      },
    });
    const totalActualAmount = actuals.reduce((sum, item) => sum + Number(item.amount), 0);
    const totalActualUnits = actuals.reduce((sum, item) => sum + Number(item.quantity || 0), 0);
    const avgUnitPrice = totalActualUnits > 0 ? totalActualAmount / totalActualUnits : 0;
    const revenueImpact = totalLiftUnits * avgUnitPrice;

    const budget = Number((promotion as any).budget || 0);
    const roi = budget > 0 ? revenueImpact / budget : undefined;

    return {
      promotion,
      totalBaselineForecast,
      totalAdjustedForecast,
      totalLiftUnits,
      totalLiftPercent: Number(totalLiftPercent.toFixed(2)),
      revenueImpact: Number(revenueImpact.toFixed(2)),
      roi,
      impactByProduct,
      impactByWeek,
    };
  }

  async getPromotionAdjustedForecast(tenantId: string, params: any) {
    const startDate = new Date(params.startDate);
    const endDate = new Date(params.endDate);
    const forecastResults = await this.prisma.forecastResult.findMany({
      where: {
        tenantId,
        productId: params.productId,
        ...(params.locationId ? { locationId: params.locationId } : {}),
        periodDate: { gte: startDate, lte: endDate },
      },
      orderBy: { periodDate: 'asc' },
    });

    const basePeriods = forecastResults.map(result => ({
      periodDate: result.periodDate.toISOString().slice(0, 10),
      baselineForecast: Number(result.forecastQuantity || 0),
    }));

    if (params.includePromotions === false) {
      return {
        productId: params.productId,
        locationId: params.locationId,
        startDate: params.startDate,
        endDate: params.endDate,
        includePromotions: false,
        periods: basePeriods.map(p => ({ ...p, adjustedForecast: p.baselineForecast })),
      };
    }

    const promotions = await this.prisma.promotion.findMany({
      where: {
        tenantId,
        startDate: { lte: endDate },
        endDate: { gte: startDate },
        productIds: { has: params.productId },
        ...(params.locationId ? { locationIds: { has: params.locationId } } : {}),
      },
      include: { liftFactors: true },
    });

    const periods = basePeriods.map(period => {
      const periodDate = new Date(period.periodDate);
      const activePromos = promotions.filter(promo => promo.startDate <= periodDate && promo.endDate >= periodDate);
      const lift = activePromos.reduce((sum, promo) => {
        const promoLift = promo.liftFactors.reduce((lfSum, lf) => lfSum + this.normalizeLiftPercent(Number(lf.expectedLift || 0)), 0);
        return sum + promoLift;
      }, 0);
      const cappedLift = Math.min(lift, 2);
      return {
        ...period,
        adjustedForecast: Number((period.baselineForecast * (1 + cappedLift)).toFixed(2)),
      };
    });

    return {
      productId: params.productId,
      locationId: params.locationId,
      startDate: params.startDate,
      endDate: params.endDate,
      includePromotions: true,
      periods,
    };
  }

  async getPromotionCalendar(tenantId: string, params: any) {
    return this.getPromotions(tenantId, params);
  }

  async copyPromotion(tenantId: string, promotionId: string, dto: any) {
    const promotion = await this.getPromotion(tenantId, promotionId);
    return this.prisma.promotion.create({
      data: {
        tenantId,
        code: dto.code,
        name: dto.name,
        description: promotion.description,
        type: promotion.type,
        status: 'DRAFT',
        startDate: new Date(dto.startDate),
        endDate: new Date(dto.endDate),
        productIds: promotion.productIds,
        locationIds: promotion.locationIds,
        customerIds: promotion.customerIds,
        channelIds: promotion.channelIds,
      },
    });
  }

  // ============================================================================
  // NPI
  // ============================================================================

  async getNPIs(tenantId: string, params: any) {
    const { status, page = 1, pageSize = 20 } = params;
    const where: any = {
      tenantId,
      ...(status && { status }),
    };

    const [items, total] = await Promise.all([
      this.prisma.newProductIntroduction.findMany({
        where,
        skip: (page - 1) * pageSize,
        take: pageSize,
        orderBy: { createdAt: 'desc' },
      }),
      this.prisma.newProductIntroduction.count({ where }),
    ]);

    const productIds = items.map(item => item.productId);
    const products = await this.prisma.product.findMany({
      where: { id: { in: productIds } },
      select: { id: true, code: true, name: true, category: true, brand: true },
    });
    const productMap = new Map(products.map(p => [p.id, p]));

    const enriched = items.map(item => {
      const product = productMap.get(item.productId);
      return {
        ...item,
        sku: product?.code,
        name: product?.name,
        category: product?.category,
        brand: product?.brand,
        product,
      };
    });

    return { items: enriched, total, page, pageSize, totalPages: Math.ceil(total / pageSize) };
  }

  async getNPI(tenantId: string, npiId: string) {
    const npi = await this.prisma.newProductIntroduction.findFirst({
      where: { id: npiId, tenantId },
    });
    if (!npi) {
      throw new NotFoundException('NPI not found');
    }

    const product = await this.prisma.product.findFirst({
      where: { id: npi.productId, tenantId },
      select: { id: true, code: true, name: true, category: true, brand: true },
    });

    return {
      ...npi,
      sku: product?.code,
      name: product?.name,
      category: product?.category,
      brand: product?.brand,
      product,
    };
  }

  async createNPI(tenantId: string, dto: any) {
    const product = await this.prisma.product.findFirst({
      where: { tenantId, code: dto.sku },
    });

    if (!product) {
      throw new NotFoundException('Product not found for NPI');
    }

    return this.prisma.newProductIntroduction.create({
      data: {
        tenantId,
        productId: product.id,
        status: dto.status || 'CONCEPT',
        launchDate: dto.launchDate ? new Date(dto.launchDate) : null,
        targetLocations: dto.plannedLocationIds || [],
        analogProductIds: dto.analogProductId ? [dto.analogProductId] : [],
        launchCurveType: dto.launchCurveType || 'STANDARD',
        notes: dto.description,
      },
    });
  }

  async updateNPI(tenantId: string, npiId: string, dto: any) {
    const npi = await this.getNPI(tenantId, npiId);
    return this.prisma.newProductIntroduction.update({
      where: { id: npiId },
      data: {
        ...(dto.status && { status: dto.status }),
        ...(dto.launchDate && { launchDate: new Date(dto.launchDate) }),
        ...(dto.analogProductId && { analogProductIds: [dto.analogProductId] }),
        ...(dto.plannedLocationIds && { targetLocations: dto.plannedLocationIds }),
        ...(dto.description !== undefined && { notes: dto.description }),
      },
    });
  }

  async updateNPIStatus(tenantId: string, npiId: string, status: string) {
    const npi = await this.prisma.newProductIntroduction.findFirst({ where: { id: npiId, tenantId } });
    if (!npi) throw new NotFoundException('NPI not found');
    return this.prisma.newProductIntroduction.update({
      where: { id: npiId },
      data: { status: status as any },
    });
  }

  async deleteNPI(tenantId: string, npiId: string) {
    const npi = await this.prisma.newProductIntroduction.findFirst({ where: { id: npiId, tenantId } });
    if (!npi) throw new NotFoundException('NPI not found');
    await this.prisma.newProductIntroduction.delete({ where: { id: npiId } });
    return { success: true };
  }

  async generateNPIForecast(tenantId: string, npiId: string, dto: any) {
    const npi = await this.getNPI(tenantId, npiId);
    const months = dto?.months || 12;
    const useAnalog = dto?.useAnalog === true;
    const adjustmentPercent = dto?.adjustmentPercent || 0;
    const launchDate = npi.launchDate ? new Date(npi.launchDate) : new Date();

    let baseMonthlyUnits = npi.year1Units ? Number(npi.year1Units) / 12 : 100;

    if (useAnalog && npi.analogProductIds?.length) {
      const analogProductId = npi.analogProductIds[0];
      const analogActuals = await this.prisma.actual.findMany({
        where: {
          tenantId,
          productId: analogProductId,
          actualType: ActualType.SALES,
        },
        orderBy: { periodDate: 'desc' },
        take: 12,
      });

      const totalAnalogUnits = analogActuals.reduce((sum, item) => sum + Number(item.quantity || 0), 0);
      if (analogActuals.length > 0) {
        baseMonthlyUnits = totalAnalogUnits / analogActuals.length;
      }
    }

    const adjustedBase = baseMonthlyUnits * (1 + adjustmentPercent / 100);
    const peakUnits = dto?.peakForecastUnits || npi.peakUnits || adjustedBase * 2;
    const curveType = dto?.launchCurveType || npi.launchCurveType || 'STANDARD';

    const ramp = this.buildLaunchCurve(months, curveType);
    const forecasts = [] as Array<{ periodDate: string; forecast: number; cumulative: number; rampPercentage: number }>;
    let cumulative = 0;

    for (let i = 0; i < months; i++) {
      const periodDate = new Date(launchDate);
      periodDate.setMonth(periodDate.getMonth() + i);
      const forecast = Number((peakUnits * ramp[i]).toFixed(2));
      cumulative += forecast;
      forecasts.push({
        periodDate: periodDate.toISOString().slice(0, 10),
        forecast,
        cumulative: Number(cumulative.toFixed(2)),
        rampPercentage: Number((ramp[i] * 100).toFixed(2)),
      });
    }

    return forecasts;
  }

  async findNPIAnalogs(tenantId: string, npiId: string, params: any) {
    const npi = await this.getNPI(tenantId, npiId);
    const product = npi.product as { id?: string; category?: string; brand?: string } | undefined;

    if (!product) return [];

    const candidates = await this.prisma.product.findMany({
      where: {
        tenantId,
        id: { not: product.id },
        ...(params?.categoryOnly ? { category: product.category } : {}),
        ...(params?.brandOnly ? { brand: product.brand } : {}),
      },
      take: params?.limit || 10,
    });

    const results = [] as Array<any>;
    for (const candidate of candidates) {
      const actuals = await this.prisma.actual.findMany({
        where: {
          tenantId,
          productId: candidate.id,
          actualType: ActualType.SALES,
        },
        take: 12,
      });

      const actualsMonths = actuals.length;
      const sameCategory = !!product.category && candidate.category === product.category;
      const sameBrand = !!product.brand && candidate.brand === product.brand;
      const similarityScore = Math.min(
        100,
        (sameCategory ? 60 : 0) + (sameBrand ? 30 : 0) + Math.min(actualsMonths, 12) * (10 / 12),
      );

      results.push({
        product: {
          id: candidate.id,
          sku: candidate.code,
          name: candidate.name,
          category: candidate.category,
          brand: candidate.brand,
        },
        similarityScore: Number(similarityScore.toFixed(1)),
        sameCategory,
        sameBrand,
        hasActuals: actualsMonths > 0,
        actualsMonths,
      });
    }

    return results;
  }

  async setNPIAnalog(tenantId: string, npiId: string, dto: any) {
    return this.updateNPI(tenantId, npiId, {
      analogProductId: dto.analogProductId,
    });
  }

  async getNPIPerformance(tenantId: string, npiId: string) {
    const npi = await this.getNPI(tenantId, npiId);
    const launchDate = npi.launchDate ? new Date(npi.launchDate) : null;
    const now = new Date();
    const monthsSinceLaunch = launchDate
      ? Math.max(1, (now.getFullYear() - launchDate.getFullYear()) * 12 + (now.getMonth() - launchDate.getMonth()) + 1)
      : 0;

    const actuals = await this.prisma.actual.findMany({
      where: {
        tenantId,
        productId: npi.productId,
        actualType: ActualType.SALES,
        ...(launchDate ? { periodDate: { gte: launchDate } } : {}),
      },
    });

    const actualsTotal = actuals.reduce((sum, item) => sum + Number(item.quantity || 0), 0);

    const forecast = await this.generateNPIForecast(tenantId, npiId, { months: monthsSinceLaunch || 12 });
    const forecastTotal = forecast.reduce((sum, item) => sum + item.forecast, 0);

    const variance = actualsTotal - forecastTotal;
    const variancePercent = forecastTotal > 0 ? (variance / forecastTotal) * 100 : 0;
    const onTrack = Math.abs(variancePercent) <= 10;

    return {
      npi,
      monthsSinceLaunch,
      actualsTotal,
      forecastTotal,
      variance,
      variancePercent: Number(variancePercent.toFixed(2)),
      onTrack,
    };
  }

  async compareNPIPerformance(tenantId: string, npiIds: string[]) {
    return Promise.all(npiIds.map(id => this.getNPIPerformance(tenantId, id)));
  }

  async convertNPIToProduct(tenantId: string, npiId: string, dto: any) {
    const npi = await this.getNPI(tenantId, npiId);

    if (npi.status === 'DECLINE') {
      throw new BadRequestException('Cannot convert an NPI in DECLINE status');
    }

    // NPI is linked to a Product via productId. Conversion means transitioning
    // the NPI to MATURITY status and activating the linked product for production.
    const product = await this.prisma.product.update({
      where: { id: npi.productId },
      data: {
        status: 'ACTIVE',
        ...(dto.standardCost !== undefined && { standardCost: new Decimal(dto.standardCost) }),
      },
    });

    // Advance NPI lifecycle to maturity/launched
    const updatedNPI = await this.prisma.newProductIntroduction.update({
      where: { id: npiId },
      data: {
        status: 'MATURITY',
        launchDate: npi.launchDate ?? new Date(),
        maturityDate: new Date(),
      },
    });

    return { npi: updatedNPI, product };
  }

  // ============================================================================
  // Workflow
  // ============================================================================

  async getWorkflowTemplates(tenantId: string, params: any) {
    const { entityType, isActive, page = 1, pageSize = 20 } = params;
    const where: any = {
      tenantId,
      ...(entityType && { entityType }),
      ...(isActive !== undefined && { isActive }),
    };

    const [items, total] = await Promise.all([
      this.prisma.workflowTemplate.findMany({
        where,
        include: { steps: { orderBy: { sequence: 'asc' } } },
        skip: (page - 1) * pageSize,
        take: pageSize,
        orderBy: { createdAt: 'desc' },
      }),
      this.prisma.workflowTemplate.count({ where }),
    ]);

    return { items, total, page, pageSize, totalPages: Math.ceil(total / pageSize) };
  }

  async getWorkflowTemplate(tenantId: string, templateId: string) {
    const template = await this.prisma.workflowTemplate.findFirst({
      where: { id: templateId, tenantId },
      include: { steps: { orderBy: { sequence: 'asc' } } },
    });
    if (!template) {
      throw new NotFoundException('Workflow template not found');
    }
    return template;
  }

  async createWorkflowTemplate(tenantId: string, dto: any) {
    const workflowSteps = Array.isArray(dto.steps) ? dto.steps : [];
    if ((dto.isActive ?? true) && workflowSteps.length < 3) {
      throw new BadRequestException('Active workflow templates must define at least 3 approval steps');
    }
    this.assertWorkflowStepSequenceIntegrity(workflowSteps.map((step: any) => Number(step.stepOrder)));

    return this.prisma.workflowTemplate.create({
      data: {
        tenantId,
        name: dto.name,
        description: dto.description,
        entityType: dto.entityType,
        isActive: dto.isActive ?? true,
        steps: workflowSteps.length
          ? {
              create: workflowSteps.map((step: any) => ({
            sequence: step.stepOrder,
            name: step.name,
            approverType: step.approverType,
            approverRole: this.normalizeApproverRole(step.approverRole),
            approverUserId: step.approverId,
            requiredApprovals: step.requiredApprovals || 1,
          })),
            }
          : undefined,
      },
      include: { steps: { orderBy: { sequence: 'asc' } } },
    });
  }

  async updateWorkflowTemplate(tenantId: string, templateId: string, dto: any) {
    const template = await this.getWorkflowTemplate(tenantId, templateId);

    if (dto.isActive === true && template.steps.length < 3) {
      throw new BadRequestException('Active workflow templates must define at least 3 approval steps');
    }

    return this.prisma.workflowTemplate.update({
      where: { id: template.id },
      data: {
        ...(dto.name && { name: dto.name }),
        ...(dto.description !== undefined && { description: dto.description }),
        ...(dto.entityType && { entityType: dto.entityType }),
        ...(dto.isActive !== undefined && { isActive: dto.isActive }),
      },
    });
  }

  async deleteWorkflowTemplate(tenantId: string, templateId: string) {
    const template = await this.prisma.workflowTemplate.findFirst({ where: { id: templateId, tenantId } });
    if (!template) throw new NotFoundException('Workflow template not found');
    await this.prisma.workflowTemplate.delete({ where: { id: templateId } });
    return { success: true };
  }

  async addWorkflowStep(tenantId: string, templateId: string, dto: any) {
    const template = await this.getWorkflowTemplate(tenantId, templateId);
    const existingSequences = template.steps.map((step) => step.sequence);
    this.assertWorkflowStepSequenceIntegrity([...existingSequences, Number(dto.stepOrder)]);

    const created = await this.prisma.workflowStep.create({
      data: {
        templateId: template.id,
        sequence: dto.stepOrder,
        name: dto.name,
        approverType: dto.approverType,
        approverRole: this.normalizeApproverRole(dto.approverRole),
        approverUserId: dto.approverId,
        requiredApprovals: dto.requiredApprovals || 1,
      },
    });

    if (template.isActive && template.steps.length + 1 < 3) {
      throw new BadRequestException('Active workflow templates must define at least 3 approval steps');
    }

    return created;
  }

  async updateWorkflowStep(tenantId: string, stepId: string, dto: any) {
    const step = await this.prisma.workflowStep.findFirst({
      where: { id: stepId, template: { tenantId } },
      include: { template: { include: { steps: true } } },
    });
    if (!step) {
      throw new NotFoundException('Workflow step not found');
    }

    const nextSequence = dto.stepOrder !== undefined ? Number(dto.stepOrder) : step.sequence;
    const candidateSequences = step.template.steps
      .filter((workflowStep) => workflowStep.id !== step.id)
      .map((workflowStep) => workflowStep.sequence);
    this.assertWorkflowStepSequenceIntegrity([...candidateSequences, nextSequence]);

    return this.prisma.workflowStep.update({
      where: { id: stepId },
      data: {
        ...(dto.stepOrder !== undefined && { sequence: dto.stepOrder }),
        ...(dto.name && { name: dto.name }),
        ...(dto.approverType && { approverType: dto.approverType }),
        ...(dto.approverRole !== undefined && { approverRole: this.normalizeApproverRole(dto.approverRole) ?? null }),
        ...(dto.approverId !== undefined && { approverUserId: dto.approverId }),
        ...(dto.requiredApprovals !== undefined && { requiredApprovals: dto.requiredApprovals }),
      },
    });
  }

  async deleteWorkflowStep(tenantId: string, stepId: string) {
    const step = await this.prisma.workflowStep.findFirst({
      where: { id: stepId, template: { tenantId } },
      include: { template: { include: { steps: true } } },
    });
    if (!step) throw new NotFoundException('Workflow step not found');

    if (step.template.isActive && step.template.steps.length <= 3) {
      throw new BadRequestException('Active workflow templates must retain at least 3 approval steps');
    }

    const remainingSequences = step.template.steps
      .filter((workflowStep) => workflowStep.id !== stepId)
      .map((workflowStep) => workflowStep.sequence);
    this.assertWorkflowStepSequenceIntegrity(remainingSequences);

    await this.prisma.workflowStep.delete({ where: { id: stepId } });
    return { success: true };
  }

  async getWorkflowInstances(tenantId: string, params: any) {
    const { status, entityType, requestedById, page = 1, pageSize = 20 } = params;
    const where: any = {
      tenantId,
      ...(status && { status }),
      ...(entityType && { entityType }),
      ...(requestedById && { submittedBy: requestedById }),
    };

    const [items, total] = await Promise.all([
      this.prisma.workflowInstance.findMany({
        where,
        include: { actions: true, template: true },
        skip: (page - 1) * pageSize,
        take: pageSize,
        orderBy: { submittedAt: 'desc' },
      }),
      this.prisma.workflowInstance.count({ where }),
    ]);

    return { items, total, page, pageSize, totalPages: Math.ceil(total / pageSize) };
  }

  async getWorkflowInstance(tenantId: string, instanceId: string) {
    const instance = await this.prisma.workflowInstance.findFirst({
      where: { id: instanceId, tenantId },
      include: { actions: true, template: { include: { steps: true } } },
    });
    if (!instance) {
      throw new NotFoundException('Workflow instance not found');
    }
    return instance;
  }

  async getMyPendingApprovals(tenantId: string, userId: string) {
    const user = await this.prisma.user.findFirst({
      where: { id: userId, tenantId },
      select: { id: true, role: true },
    });
    if (!user) {
      throw new NotFoundException('User not found');
    }

    const instances = await this.prisma.workflowInstance.findMany({
      where: { tenantId, status: WorkflowStatus.IN_PROGRESS },
      include: { template: { include: { steps: true } } },
      orderBy: { submittedAt: 'desc' },
    });

    return instances.filter((instance) => {
      const currentStep = instance.template.steps.find((step) => step.sequence === instance.currentStep);
      if (!currentStep) return false;
      return this.userCanApproveStep(currentStep.approverType, currentStep.approverRole, currentStep.approverUserId, user.id, user.role);
    });
  }

  async startWorkflow(tenantId: string, userId: string, dto: any) {
    return this.workflowService.startWorkflow(
      tenantId,
      dto.entityType,
      dto.entityId,
      userId,
      dto.notes,
    );
  }

  async approveWorkflow(tenantId: string, instanceId: string, userId: string, comments?: string) {
    const instance = await this.prisma.workflowInstance.findFirst({ where: { id: instanceId, tenantId }, select: { id: true } });
    if (!instance) throw new NotFoundException('Workflow instance not found');
    return this.workflowService.approve(instanceId, userId, comments, tenantId);
  }

  async rejectWorkflow(tenantId: string, instanceId: string, userId: string, comments?: string) {
    const instance = await this.prisma.workflowInstance.findFirst({ where: { id: instanceId, tenantId }, select: { id: true } });
    if (!instance) throw new NotFoundException('Workflow instance not found');
    return this.workflowService.reject(instanceId, userId, comments, tenantId);
  }

  async requestWorkflowChanges(tenantId: string, instanceId: string, userId: string, comments?: string) {
    const [instance, user] = await Promise.all([
      this.prisma.workflowInstance.findFirst({
        where: { id: instanceId, tenantId },
        include: { template: { include: { steps: true } } },
      }),
      this.prisma.user.findFirst({ where: { id: userId, tenantId }, select: { id: true, role: true } }),
    ]);

    if (!instance) throw new NotFoundException('Workflow instance not found');
    if (!user) throw new NotFoundException('User not found');
    if (instance.status !== WorkflowStatus.IN_PROGRESS) {
      throw new BadRequestException('Only in-progress workflows can be returned for changes');
    }

    const currentStep = instance.template.steps.find((step) => step.sequence === instance.currentStep);
    if (!currentStep) {
      throw new BadRequestException('Current workflow step is invalid');
    }

    if (!this.userCanApproveStep(currentStep.approverType, currentStep.approverRole, currentStep.approverUserId, user.id, user.role)) {
      throw new BadRequestException('User is not an authorized approver for the current step');
    }

    await this.prisma.workflowAction.create({
      data: {
        instanceId,
        stepNumber: currentStep.sequence,
        action: WorkflowActionType.RETURN,
        performedBy: userId,
        comments,
      },
    });

    return this.prisma.workflowInstance.update({
      where: { id: instanceId },
      data: { status: WorkflowStatus.ON_HOLD, notes: comments },
    });
  }

  async cancelWorkflow(tenantId: string, instanceId: string, userId: string, reason?: string) {
    const [instance, user] = await Promise.all([
      this.prisma.workflowInstance.findFirst({
        where: { id: instanceId, tenantId },
        include: { template: { include: { steps: true } } },
      }),
      this.prisma.user.findFirst({ where: { id: userId, tenantId }, select: { id: true, role: true } }),
    ]);

    if (!instance) throw new NotFoundException('Workflow instance not found');
    if (!user) throw new NotFoundException('User not found');

    if (instance.status !== WorkflowStatus.IN_PROGRESS && instance.status !== WorkflowStatus.ON_HOLD) {
      throw new BadRequestException('Only active workflows can be cancelled');
    }

    if (instance.submittedBy !== userId && user.role !== UserRole.ADMIN) {
      throw new BadRequestException('Only the submitter or an admin can cancel a workflow');
    }

    await this.prisma.workflowAction.create({
      data: {
        instanceId,
        stepNumber: instance.currentStep,
        action: WorkflowActionType.REJECT,
        performedBy: userId,
        comments: reason,
      },
    });

    return this.prisma.workflowInstance.update({
      where: { id: instanceId },
      data: { status: WorkflowStatus.CANCELLED, notes: reason, completedAt: new Date() },
    });
  }

  async resubmitWorkflow(tenantId: string, instanceId: string, userId: string, notes?: string) {
    const instance = await this.prisma.workflowInstance.findFirst({
      where: { id: instanceId, tenantId },
      include: { template: { include: { steps: true } } },
    });

    if (!instance) throw new NotFoundException('Workflow instance not found');

    if (instance.submittedBy !== userId) {
      throw new BadRequestException('Only the original submitter can resubmit the workflow');
    }

    if (instance.status !== WorkflowStatus.ON_HOLD) {
      throw new BadRequestException('Only workflows on hold can be resubmitted');
    }

    const firstStep = [...instance.template.steps].sort((a, b) => a.sequence - b.sequence)[0];
    if (!firstStep) {
      throw new BadRequestException('Workflow template has no approval steps');
    }

    await this.prisma.workflowAction.create({
      data: {
        instanceId,
        stepNumber: firstStep.sequence,
        action: WorkflowActionType.SUBMIT,
        performedBy: userId,
        comments: notes,
      },
    });

    return this.prisma.workflowInstance.update({
      where: { id: instanceId },
      data: { status: WorkflowStatus.IN_PROGRESS, currentStep: firstStep.sequence, notes },
    });
  }

  async getWorkflowMetrics(tenantId: string, params: any) {
    const { entityType, startDate, endDate } = params ?? {};

    const submittedAt: Prisma.DateTimeFilter = {};
    if (startDate) {
      submittedAt.gte = this.parseDateOrThrow(startDate, 'startDate');
    }
    if (endDate) {
      submittedAt.lte = this.parseDateOrThrow(endDate, 'endDate');
    }

    const where: Prisma.WorkflowInstanceWhereInput = {
      tenantId,
      ...(entityType && { entityType }),
      ...(Object.keys(submittedAt).length ? { submittedAt } : {}),
    };

    const instances = await this.prisma.workflowInstance.findMany({
      where,
      include: {
        actions: {
          select: {
            action: true,
          },
        },
      },
    });

    const total = instances.length;
    const statusBreakdown = {
      inProgress: instances.filter((instance) => instance.status === WorkflowStatus.IN_PROGRESS).length,
      approved: instances.filter((instance) => instance.status === WorkflowStatus.APPROVED).length,
      rejected: instances.filter((instance) => instance.status === WorkflowStatus.REJECTED).length,
      cancelled: instances.filter((instance) => instance.status === WorkflowStatus.CANCELLED).length,
      onHold: instances.filter((instance) => instance.status === WorkflowStatus.ON_HOLD).length,
    };

    const completedInstances = instances.filter(
      (instance) =>
        (instance.status === WorkflowStatus.APPROVED ||
          instance.status === WorkflowStatus.REJECTED ||
          instance.status === WorkflowStatus.CANCELLED) &&
        !!instance.completedAt,
    );

    const averageCompletionHours = completedInstances.length
      ? this.roundToTwo(
          completedInstances.reduce((sum, instance) => {
            const completionMs = new Date(instance.completedAt as Date).getTime() - new Date(instance.submittedAt).getTime();
            return sum + completionMs / (1000 * 60 * 60);
          }, 0) / completedInstances.length,
        )
      : 0;

    const actionCounts = instances.reduce(
      (acc, instance) => {
        for (const action of instance.actions) {
          if (action.action === WorkflowActionType.APPROVE) acc.approvals += 1;
          if (action.action === WorkflowActionType.REJECT) acc.rejections += 1;
          if (action.action === WorkflowActionType.RETURN) acc.returns += 1;
          if (action.action === WorkflowActionType.DELEGATE) acc.delegations += 1;
        }
        return acc;
      },
      { approvals: 0, rejections: 0, returns: 0, delegations: 0 },
    );

    return {
      total,
      statusBreakdown,
      approvalRate: total ? this.roundToTwo((statusBreakdown.approved / total) * 100) : 0,
      rejectionRate: total ? this.roundToTwo((statusBreakdown.rejected / total) * 100) : 0,
      averageCompletionHours,
      actionCounts,
      period: {
        startDate: startDate ?? null,
        endDate: endDate ?? null,
      },
    };
  }

  async getApproverWorkload(tenantId: string) {
    const [instances, activeUsers] = await Promise.all([
      this.prisma.workflowInstance.findMany({
        where: { tenantId, status: WorkflowStatus.IN_PROGRESS },
        include: { template: { include: { steps: true } } },
      }),
      this.prisma.user.findMany({
        where: { tenantId, status: UserStatus.ACTIVE },
        select: { id: true, role: true },
      }),
    ]);

    const roleUsers = {
      [UserRole.ADMIN]: activeUsers.filter((user) => user.role === UserRole.ADMIN),
      [UserRole.PLANNER]: activeUsers.filter((user) => user.role === UserRole.PLANNER),
      [UserRole.FINANCE]: activeUsers.filter((user) => user.role === UserRole.FINANCE),
      [UserRole.VIEWER]: activeUsers.filter((user) => user.role === UserRole.VIEWER),
    };

    const pendingByUser = new Map<string, number>();

    for (const instance of instances) {
      const currentStep = instance.template.steps.find((step) => step.sequence === instance.currentStep);
      if (!currentStep) continue;

      const incrementUser = (userId: string) => {
        pendingByUser.set(userId, (pendingByUser.get(userId) ?? 0) + 1);
      };

      if (currentStep.approverType === ApproverType.USER) {
        if (currentStep.approverUserId) incrementUser(currentStep.approverUserId);
        continue;
      }

      if (currentStep.approverType === ApproverType.ROLE && currentStep.approverRole) {
        for (const user of roleUsers[currentStep.approverRole]) {
          incrementUser(user.id);
        }
        continue;
      }

      if (currentStep.approverType === ApproverType.MANAGER) {
        for (const user of roleUsers[UserRole.ADMIN]) {
          incrementUser(user.id);
        }
        continue;
      }

      if (currentStep.approverType === ApproverType.DYNAMIC) {
        for (const user of activeUsers) {
          if (user.role !== UserRole.VIEWER) {
            incrementUser(user.id);
          }
        }
      }
    }

    const userRoleLookup = new Map(activeUsers.map((user) => [user.id, user.role]));
    const approverWorkload = Array.from(pendingByUser.entries())
      .map(([userId, pendingApprovals]) => ({
        userId,
        role: userRoleLookup.get(userId) ?? null,
        pendingApprovals,
      }))
      .sort((left, right) => right.pendingApprovals - left.pendingApprovals);

    const roleSummary = [UserRole.ADMIN, UserRole.PLANNER, UserRole.FINANCE, UserRole.VIEWER].map((role) => {
      const approvers = roleUsers[role];
      const pendingApprovals = approvers.reduce((sum, user) => sum + (pendingByUser.get(user.id) ?? 0), 0);
      return {
        role,
        approverCount: approvers.length,
        pendingApprovals,
        avgPendingPerApprover: approvers.length ? this.roundToTwo(pendingApprovals / approvers.length) : 0,
      };
    });

    return {
      totalApprovers: approverWorkload.length,
      totalPendingInstances: instances.length,
      approverWorkload,
      roleSummary,
    };
  }

  private parseDateOrThrow(value: string, fieldName: 'startDate' | 'endDate'): Date {
    const parsed = new Date(value);
    if (Number.isNaN(parsed.getTime())) {
      throw new BadRequestException(`${fieldName} must be a valid ISO date`);
    }
    return parsed;
  }

  private roundToTwo(value: number): number {
    return Math.round(value * 100) / 100;
  }

  private normalizeApproverRole(approverRole?: string): UserRole | undefined {
    if (!approverRole) return undefined;
    const normalized = approverRole.toUpperCase();
    if (!Object.values(UserRole).includes(normalized as UserRole)) {
      throw new BadRequestException(`Invalid approver role: ${approverRole}`);
    }
    return normalized as UserRole;
  }

  private assertWorkflowStepSequenceIntegrity(sequences: number[]) {
    if (!sequences.length) return;

    const uniqueSorted = Array.from(new Set(sequences)).sort((a, b) => a - b);
    if (uniqueSorted.length !== sequences.length) {
      throw new BadRequestException('Workflow steps must have unique stepOrder values');
    }

    for (let index = 0; index < uniqueSorted.length; index += 1) {
      const expected = index + 1;
      if (uniqueSorted[index] !== expected) {
        throw new BadRequestException('Workflow stepOrder values must be contiguous and start at 1');
      }
    }
  }

  private userCanApproveStep(
    approverType: ApproverType,
    approverRole: UserRole | null,
    approverUserId: string | null,
    userId: string,
    userRole: UserRole,
  ): boolean {
    if (approverType === ApproverType.USER) return approverUserId === userId;
    if (approverType === ApproverType.ROLE) return !!approverRole && approverRole === userRole;
    if (approverType === ApproverType.MANAGER) return userRole === UserRole.ADMIN;
    if (approverType === ApproverType.DYNAMIC) return userRole !== UserRole.VIEWER;
    return false;
  }

  // ============================================================================
  // Helpers
  // ============================================================================

  private mapBOMResponse(bom: any, productMap: Map<string, any>) {
    return {
      id: bom.id,
      productId: bom.parentProductId,
      product: productMap.get(bom.parentProductId),
      bomType: bom.type,
      status: bom.status,
      revision: bom.version,
      effectiveDate: bom.effectiveFrom,
      expiryDate: bom.effectiveTo,
      standardCost: bom.standardCost,
      components: bom.components?.map((c: any) => this.mapBOMComponentResponse(c, productMap.get(c.componentProductId))) || [],
    };
  }

  private mapBOMComponentResponse(component: any, product?: any) {
    return {
      id: component.id,
      bomId: component.bomId,
      componentProductId: component.componentProductId,
      componentProduct: product,
      quantityPer: Number(component.quantity),
      uom: component.uom,
      isPhantom: component.isPhantom,
      position: component.sequence,
      wastagePercent: component.scrapPercent ? Number(component.scrapPercent) : 0,
    };
  }

  private mapCapacityResponse(capacity: any) {
    return {
      id: capacity.id,
      workCenterId: capacity.workCenterId,
      effectiveDate: capacity.effectiveFrom,
      endDate: capacity.effectiveTo,
      standardCapacityPerHour: capacity.capacityPerDay ? Number(capacity.capacityPerDay) / Number(capacity.hoursPerShift || 8) : 0,
      maxCapacityPerHour: capacity.capacityPerDay ? Number(capacity.capacityPerDay) / Number(capacity.hoursPerShift || 8) : 0,
      availableHoursPerDay: Number(capacity.hoursPerShift || 8),
      availableDaysPerWeek: 5,
      plannedDowntimePercent: 0,
      unplannedDowntimePercent: 0,
    };
  }

  private mapShiftResponse(shift: any) {
    return {
      id: shift.id,
      workCenterId: shift.workCenterId,
      name: shift.shiftName,
      startTime: shift.startTime,
      endTime: shift.endTime,
      daysOfWeek: shift.daysOfWeek,
      effectiveDate: new Date().toISOString().slice(0, 10),
      endDate: undefined,
      breakMinutes: shift.breakMinutes,
      capacityFactor: 1,
    };
  }

  private buildPeriods(startDate: string, endDate: string, granularity: string) {
    const periods = [] as Array<{ label: string; days: number; start: Date; end: Date }>;
    const start = new Date(startDate);
    const end = new Date(endDate);
    const current = new Date(start);

    while (current <= end) {
      const periodStart = new Date(current);
      let periodEnd = new Date(current);

      if (granularity === 'WEEK') {
        periodEnd.setDate(periodEnd.getDate() + 6);
      } else if (granularity === 'DAY') {
        periodEnd = new Date(current);
      } else {
        periodEnd.setMonth(periodEnd.getMonth() + 1);
        periodEnd.setDate(periodEnd.getDate() - 1);
      }

      if (periodEnd > end) periodEnd = new Date(end);

      const days = Math.max(1, Math.ceil((periodEnd.getTime() - periodStart.getTime()) / (1000 * 60 * 60 * 24)) + 1);
      periods.push({ label: periodStart.toISOString().slice(0, 10), days, start: periodStart, end: periodEnd });

      current.setDate(periodEnd.getDate() + 1);
      current.setMonth(periodEnd.getMonth());
    }

    return periods;
  }

  private buildLaunchCurve(months: number, curveType: string) {
    const safeMonths = Math.max(1, months);
    const start = curveType === 'FAST' ? 0.6 : curveType === 'SLOW' ? 0.2 : 0.4;
    const end = curveType === 'SLOW' ? 0.9 : 1.0;
    const ramp = [] as number[];

    for (let i = 0; i < safeMonths; i++) {
      const progress = safeMonths === 1 ? 1 : i / (safeMonths - 1);
      ramp.push(Number((start + (end - start) * progress).toFixed(4)));
    }

    return ramp;
  }

  private getWeekNumber(startDate: Date, periodDate: Date) {
    const diffDays = Math.max(0, Math.floor((periodDate.getTime() - startDate.getTime()) / (1000 * 60 * 60 * 24)));
    return Math.floor(diffDays / 7) + 1;
  }

  private normalizeLiftPercent(value: number) {
    return value > 1 ? value / 100 : value;
  }

  // ============================================
  // PURCHASE ORDER MANAGEMENT
  // ============================================

  async getPurchaseOrders(tenantId: string, filters?: {
    status?: string;
    supplierId?: string;
    startDate?: string;
    endDate?: string;
  }) {
    const where: any = { tenantId };
    
    if (filters?.status) {
      where.status = this.mapApiStatusToPrismaStatus(filters.status);
    }
    if (filters?.supplierId) {
      where.supplierId = filters.supplierId;
    }
    if (filters?.startDate || filters?.endDate) {
      where.orderDate = {};
      if (filters.startDate) where.orderDate.gte = new Date(filters.startDate);
      if (filters.endDate) where.orderDate.lte = new Date(filters.endDate);
    }

    const purchaseOrders = await this.prisma.purchaseOrder.findMany({
      where,
      include: {
        lines: true,
        receipts: true,
      },
      orderBy: { orderDate: 'desc' },
    });

    // Fetch suppliers to enrich responses
    const supplierIds = [...new Set(purchaseOrders.map(po => po.supplierId))];
    const suppliers = supplierIds.length > 0
      ? await this.prisma.supplier.findMany({
          where: { id: { in: supplierIds } },
          select: { id: true, name: true },
        })
      : [];
    const supplierMap = new Map(suppliers.map(s => [s.id, s]));

    // Fetch products to enrich line-level responses
    const allProductIds = [...new Set(purchaseOrders.flatMap(po => po.lines.map(l => l.productId)))];
    const products = allProductIds.length > 0
      ? await this.prisma.product.findMany({
          where: { id: { in: allProductIds } },
          select: { id: true, code: true, name: true, unitOfMeasure: true },
        })
      : [];
    const productMap = new Map(products.map(p => [p.id, p as any]));

    return purchaseOrders.map(po => this.mapPurchaseOrderResponse(po, supplierMap.get(po.supplierId), productMap));
  }

  async getPurchaseOrder(tenantId: string, id: string) {
    const po = await this.prisma.purchaseOrder.findFirst({
      where: { id, tenantId },
      include: {
        lines: true,
        receipts: {
          include: {
            lines: true,
          },
        },
      },
    });
    if (!po) {
      throw new NotFoundException('Purchase order not found');
    }

    const supplier = await this.prisma.supplier.findFirst({
      where: { id: po.supplierId, tenantId },
      select: { id: true, name: true },
    });

    // Fetch products for line enrichment
    const lineProductIds = [...new Set(po.lines.map(l => l.productId))];
    const products = lineProductIds.length > 0
      ? await this.prisma.product.findMany({
          where: { id: { in: lineProductIds } },
          select: { id: true, code: true, name: true, unitOfMeasure: true },
        })
      : [];
    const productMap = new Map(products.map(p => [p.id, p as any]));

    return this.mapPurchaseOrderResponse(po, supplier, productMap);
  }

  async createPurchaseOrder(tenantId: string, userId: string, data: {
    supplierId: string;
    expectedDate: string;
    lines: Array<{
      productId: string;
      quantity: number;
      unitPrice: number;
    }>;
    notes?: string;
    locationId?: string;
  }) {
    return this.prisma.$transaction(async (tx) => {
      const poNumber = await this.sequence.nextNumber(tx, 'PO');

      // Resolve locationId
      let resolvedLocationId = data.locationId;
      if (!resolvedLocationId) {
        const defaultLocation = await tx.location.findFirst({
          where: { tenantId, status: 'ACTIVE' },
          select: { id: true },
        });
        resolvedLocationId = defaultLocation?.id;
      }

      if (!resolvedLocationId) {
        throw new BadRequestException('No active location found for this tenant. Please create a location first.');
      }

      // Lookup product UOMs for the PO lines
      const productIds = [...new Set(data.lines.map(l => l.productId))];
      const products = await tx.product.findMany({ where: { id: { in: productIds } }, select: { id: true, unitOfMeasure: true } });
      const productUomMap = new Map(products.map(p => [p.id, p.unitOfMeasure]));

      // Lookup active purchase contracts for price enforcement
      const activeContracts = await tx.purchaseContract.findMany({
        where: {
          tenantId,
          supplierId: data.supplierId,
          status: 'ACTIVE',
          startDate: { lte: new Date() },
          endDate: { gte: new Date() },
        },
        include: { lines: true },
      });

      // Build contract price map: productId -> agreedPrice
      const contractPriceMap = new Map<string, number>();
      for (const contract of activeContracts) {
        for (const line of contract.lines) {
          if (productIds.includes(line.productId)) {
            contractPriceMap.set(line.productId, Number(line.agreedPrice));
          }
        }
      }

      // Apply contract prices where available
      const resolvedLines = data.lines.map((line, idx) => {
        const contractPrice = contractPriceMap.get(line.productId);
        const finalPrice = contractPrice !== undefined ? contractPrice : line.unitPrice;
        return {
          lineNumber: idx + 1,
          productId: line.productId,
          quantity: line.quantity,
          unitPrice: finalPrice,
          receivedQty: 0,
          uom: productUomMap.get(line.productId) || 'EA',
          expectedDate: new Date(data.expectedDate),
        };
      });

      const created = await tx.purchaseOrder.create({
        data: {
          tenantId,
          orderNumber: poNumber,
          supplierId: data.supplierId,
          locationId: resolvedLocationId,
          createdById: userId,
          orderDate: new Date(),
          expectedDate: new Date(data.expectedDate),
          status: 'DRAFT',
          totalAmount: resolvedLines.reduce((sum, l) => sum + l.quantity * l.unitPrice, 0),
          notes: data.notes,
          lines: { create: resolvedLines },
        },
        include: { lines: true },
      });

      const supplier = await tx.supplier.findFirst({ where: { id: data.supplierId, tenantId }, select: { id: true, name: true } });
      return this.mapPurchaseOrderResponse(created, supplier);
    });
  }

  async updatePurchaseOrder(tenantId: string, id: string, data: {
    expectedDate?: string;
    notes?: string;
    lines?: Array<{
      id?: string;
      productId: string;
      quantity: number;
      unitPrice: number;
    }>;
  }) {
    const po = await this.prisma.purchaseOrder.findFirst({
      where: { id, tenantId },
    });

    if (!po) throw new NotFoundException('Purchase order not found');
    if (po.status !== 'DRAFT') throw new BadRequestException('Can only edit draft orders');

    // Update lines if provided
    if (data.lines) {
      // Delete existing lines
      await this.prisma.purchaseOrderLine.deleteMany({
        where: { purchaseOrderId: id },
      });

      // Create new lines
      const lineProductIds = [...new Set(data.lines.map(l => l.productId))];
      const lineProducts = await this.prisma.product.findMany({
        where: { id: { in: lineProductIds } },
        select: { id: true, unitOfMeasure: true },
      });
      const lineUomMap = new Map(lineProducts.map(p => [p.id, p.unitOfMeasure]));

      await this.prisma.purchaseOrderLine.createMany({
        data: data.lines.map((line, idx) => ({
          purchaseOrderId: id,
          lineNumber: idx + 1,
          productId: line.productId,
          quantity: line.quantity,
          unitPrice: line.unitPrice,
          receivedQty: 0,
          uom: lineUomMap.get(line.productId) || 'EA',
          expectedDate: new Date(),
        })),
      });
    }

    return this.prisma.purchaseOrder.update({
      where: { id },
      data: {
        expectedDate: data.expectedDate ? new Date(data.expectedDate) : undefined,
        notes: data.notes,
        totalAmount: data.lines 
          ? data.lines.reduce((sum, l) => sum + l.quantity * l.unitPrice, 0)
          : undefined,
      },
      include: {
        lines: true,
      },
    }).then(po => this.mapPurchaseOrderResponse(po));
  }

  async releasePurchaseOrder(tenantId: string, id: string) {
    const po = await this.prisma.purchaseOrder.findFirst({
      where: { id, tenantId },
    });

    if (!po) throw new NotFoundException('Purchase order not found');
    if (po.status !== 'DRAFT') throw new BadRequestException('Can only release draft orders');

    await this.prisma.purchaseOrder.update({
      where: { id },
      data: {
        status: 'SENT',
        approvedAt: new Date(),
      },
    });
    return this.getPurchaseOrder(tenantId, id);
  }

  async cancelPurchaseOrder(tenantId: string, id: string, reason?: string) {
    const po = await this.prisma.purchaseOrder.findFirst({
      where: { id, tenantId },
    });

    if (!po) throw new NotFoundException('Purchase order not found');
    if (po.status === 'RECEIVED' || po.status === 'CANCELLED') {
      throw new BadRequestException('Cannot cancel completed or already cancelled orders');
    }

    await this.prisma.purchaseOrder.update({
      where: { id },
      data: {
        status: 'CANCELLED',
        notes: reason ? `${po.notes || ''}\nCancelled: ${reason}` : po.notes,
      },
    });
    return this.getPurchaseOrder(tenantId, id);
  }

  // Convert planned orders to purchase orders
  async convertPlannedOrdersToPurchaseOrders(tenantId: string, userId: string, plannedOrderIds: string[]) {
    const plannedOrders = await this.prisma.plannedOrder.findMany({
      where: {
        id: { in: plannedOrderIds },
        tenantId,
        orderType: 'PURCHASE',
        status: 'PLANNED',
      },
      include: {
        supplier: true,
      },
    });

    if (plannedOrders.length === 0) {
      throw new BadRequestException('No valid planned purchase orders found');
    }

    // Group by supplier
    const bySupplier = new Map<string, typeof plannedOrders>();
    for (const order of plannedOrders) {
      const supplierId = order.supplierId || 'default';
      if (!bySupplier.has(supplierId)) {
        bySupplier.set(supplierId, []);
      }
      bySupplier.get(supplierId)!.push(order);
    }

    const createdPOs: any[] = [];

    for (const [supplierId, orders] of bySupplier) {
      if (supplierId === 'default') continue; // Skip orders without supplier

      // Find latest expected date
      const latestDate = orders.reduce((max, o) => 
        o.dueDate > max ? o.dueDate : max, orders[0].dueDate);

      // Fetch unit prices from SupplierProduct for each product
      const productIds = orders.map(o => o.productId);
      const supplierProducts = await this.prisma.supplierProduct.findMany({
        where: {
          supplierId,
          productId: { in: productIds },
        },
      });
      const priceMap = new Map(supplierProducts.map(sp => [sp.productId, Number(sp.unitPrice)]));

      const po = await this.createPurchaseOrder(tenantId, userId, {
        supplierId,
        expectedDate: latestDate.toISOString(),
        lines: orders.map(o => ({
          productId: o.productId,
          quantity: Number(o.quantity),
          unitPrice: priceMap.get(o.productId) ?? 0,
        })),
        notes: `Created from planned orders: ${orders.map(o => o.id).join(', ')}`,
      });

      createdPOs.push(po);

      // Update planned orders to FIRMED
      await this.prisma.plannedOrder.updateMany({
        where: { id: { in: orders.map(o => o.id) }, tenantId },
        data: { status: 'FIRMED' },
      });
    }

    return createdPOs;
  }

  // ============================================
  // GOODS RECEIPT MANAGEMENT
  // ============================================

  async createGoodsReceipt(tenantId: string, userId: string, data: {
    purchaseOrderId: string;
    lines: Array<{
      purchaseOrderLineId: string;
      quantity: number;
      lotNumber?: string;
    }>;
    notes?: string;
  }) {
    return this.prisma.$transaction(async (tx) => {
      const po = await tx.purchaseOrder.findFirst({
        where: { id: data.purchaseOrderId, tenantId },
        include: { lines: true },
      });

      if (!po) throw new NotFoundException('Purchase order not found');
      if (po.status !== 'SENT' && po.status !== 'PARTIALLY_RECEIVED') {
        throw new BadRequestException('Can only receive against released orders');
      }

      const grNumber = await this.sequence.nextNumber(tx, 'GR');

      const gr = await tx.goodsReceipt.create({
        data: {
          tenantId,
          receiptNumber: grNumber,
          purchaseOrderId: data.purchaseOrderId,
          locationId: po.locationId,
          receiptDate: new Date(),
          status: 'PENDING',
          receivedById: userId,
          notes: data.notes,
          lines: {
            create: data.lines.map((line, idx) => ({
              lineNumber: idx + 1,
              productId: po.lines.find(l => l.id === line.purchaseOrderLineId)?.productId || po.lines[0]?.productId,
              quantity: line.quantity,
              uom: po.lines.find(l => l.id === line.purchaseOrderLineId)?.uom || 'EA',
              lotNumber: line.lotNumber,
            })),
          },
        },
        include: {
          lines: true,
        },
      });

      return this.mapGoodsReceiptResponse(gr);
    });
  }

  async confirmGoodsReceipt(tenantId: string, id: string) {
    return this.prisma.$transaction(async (tx) => {
      // Idempotency: prevent double-confirmation
      const duplicate = await this.idempotency.acquire(tx, 'GRN_CONFIRM', id, tenantId);
      if (duplicate) return this.mapGoodsReceiptResponse(
        await tx.goodsReceipt.findFirst({ where: { id, tenantId }, include: { lines: true } }),
      );

      // Pessimistic lock on the GR row
      const lockedGR = await tx.$queryRaw<Array<{ id: string; status: string; version: number }>>(
        Prisma.sql`SELECT id, status, version FROM goods_receipts WHERE id = ${id} AND tenant_id = ${tenantId} FOR UPDATE`,
      );
      if (!lockedGR.length) throw new NotFoundException('Goods receipt not found');
      if (lockedGR[0].status !== 'PENDING') throw new BadRequestException('Receipt already processed');

      const gr = await tx.goodsReceipt.findFirst({
        where: { id, tenantId },
        include: { lines: true },
      });

      const productIds = [...new Set(gr.lines.map(l => l.productId))];
      const products = await tx.product.findMany({
        where: { id: { in: productIds } },
        select: { id: true, qcRequired: true, batchTracked: true, code: true, name: true, unitOfMeasure: true },
      });
      const productMap = new Map(products.map(p => [p.id, p]));

      let supplierInspectionMap = new Map<string, boolean>();
      if (gr.purchaseOrderId) {
        const po = await tx.purchaseOrder.findFirst({
          where: { id: gr.purchaseOrderId },
          select: { supplierId: true },
        });
        if (po?.supplierId) {
          const supplierProducts = await tx.supplierProduct.findMany({
            where: { supplierId: po.supplierId, productId: { in: productIds } },
            select: { productId: true, inspectionRequired: true },
          });
          supplierInspectionMap = new Map(supplierProducts.map(sp => [sp.productId, sp.inspectionRequired]));
        }
      }

      const qcRequiredForAnyLine = gr.lines.some(line => {
        const prod = productMap.get(line.productId);
        return prod?.qcRequired || supplierInspectionMap.get(line.productId);
      });

      await tx.goodsReceipt.update({
        where: { id },
        data: {
          status: 'POSTED',
          qcStatus: qcRequiredForAnyLine ? 'QC_PENDING' : 'NOT_REQUIRED',
        },
      });

      const resolvedLocation = await tx.location.findFirst({
        where: { tenantId, status: 'ACTIVE' },
        select: { id: true },
      });
      const locationId = resolvedLocation?.id || gr.locationId;

      // Auto-create batches for batch-tracked products upon receipt
      for (const line of gr.lines) {
        const prod = productMap.get(line.productId);
        if (prod?.batchTracked && !line.batchId) {
          const batchNumber = await this.sequence.nextNumber(tx, 'BN');
          const batch = await tx.batch.create({
            data: {
              tenantId,
              batchNumber,
              productId: line.productId,
              locationId,
              quantity: Number(line.quantity),
              availableQty: Number(line.quantity),
              uom: prod.unitOfMeasure || line.uom || 'EA',
              status: 'AVAILABLE',
              expiryDate: line.expiryDate ?? undefined,
              purchaseOrderId: gr.purchaseOrderId ?? undefined,
              notes: `Auto-created from GR ${gr.receiptNumber}`,
            },
          });
          // Link GR line to the newly created batch
          await tx.goodsReceiptLine.update({
            where: { id: line.id },
            data: { batchId: batch.id },
          });
          // Mutate in-memory reference for downstream use in this transaction
          (line as any).batchId = batch.id;
        }
      }

      for (const line of gr.lines) {
        const prod = productMap.get(line.productId);
        const needsQC = prod?.qcRequired || supplierInspectionMap.get(line.productId);
        const uom = prod?.unitOfMeasure || line.uom || 'EA';

        // Record receipt through append-only ledger (handles InventoryLevel atomically)
        await this.ledger.recordEntry(tx, {
          tenantId,
          productId: line.productId,
          locationId,
          entryType: LedgerEntryType.LEDGER_RECEIPT,
          quantity: new Decimal(line.quantity.toString()),
          uom,
          referenceType: 'GOODS_RECEIPT',
          referenceId: gr.id,
          referenceNumber: gr.receiptNumber,
          lotNumber: line.lotNumber ?? undefined,
          notes: `GR ${gr.receiptNumber}`,
        });

        // Also create the legacy InventoryTransaction record for backward compat
        await tx.inventoryTransaction.create({
          data: {
            tenantId,
            productId: line.productId,
            locationId,
            transactionType: 'RECEIPT',
            quantity: Number(line.quantity),
            uom,
            referenceType: 'GOODS_RECEIPT',
            referenceId: gr.id,
            lotNumber: line.lotNumber,
            transactionDate: new Date(),
            createdById: gr.receivedById,
          },
        });

        if (needsQC) {
          // Place hold through the ledger (moves qty to quarantine atomically)
          await this.ledger.placeHold(tx, {
            tenantId,
            productId: line.productId,
            locationId,
            quantity: new Decimal(line.quantity.toString()),
            uom,
            holdReason: 'QC_INSPECTION',
            placedById: gr.receivedById,
            referenceType: 'GOODS_RECEIPT',
            referenceId: gr.id,
            notes: `QC hold from GR ${gr.receiptNumber}`,
          });

          // Auto-create quality inspection with sequence-safe number
          const qiNumber = await this.sequence.nextNumber(tx, 'QI');
          await tx.qualityInspection.create({
            data: {
              tenantId,
              inspectionNumber: qiNumber,
              productId: line.productId,
              goodsReceiptId: gr.id,
              purchaseOrderId: gr.purchaseOrderId,
              locationId,
              inspectionType: 'INCOMING',
              status: 'PENDING',
              inspectedQty: new Decimal(line.quantity.toString()),
              notes: `Auto-created from GR ${gr.receiptNumber} for ${prod?.code || 'product'}`,
            },
          });
        }
      }

      // Update PO received quantities and status
      if (gr.purchaseOrderId) {
        // Costing: Process receipt costing for each line through the centralized engine
        const po = await tx.purchaseOrder.findFirst({
          where: { id: gr.purchaseOrderId, tenantId },
          include: { lines: true },
        });
        for (const line of gr.lines) {
          const poLine = po?.lines.find(l => l.productId === line.productId);
          const unitPrice = poLine ? Number(poLine.unitPrice) : 0;

          if (unitPrice > 0) {
            await this.costingEngine.calculatePurchaseReceiptCost({
              tenantId,
              goodsReceiptId: gr.id,
              goodsReceiptLineId: line.id,
              productId: line.productId,
              locationId,
              quantity: new Decimal(line.quantity.toString()),
              unitPrice: new Decimal(unitPrice.toString()),
              uom: productMap.get(line.productId)?.unitOfMeasure || 'EA',
              purchaseCurrency: po?.currency || await this.resolveTenantCurrency(tenantId),
              // baseCurrency resolved from tenant.defaultCurrency inside CostingEngine
              batchId: line.batchId ?? undefined,
              userId: gr.receivedById,
            });
          }
        }

        for (const line of gr.lines) {
          const poLine = await tx.purchaseOrderLine.findFirst({
            where: { purchaseOrderId: gr.purchaseOrderId, productId: line.productId },
          });
          if (poLine) {
            await tx.purchaseOrderLine.update({
              where: { id: poLine.id },
              data: { receivedQty: { increment: Number(line.quantity) } },
            });
          }
        }

        const updatedPO = await tx.purchaseOrder.findFirst({
          where: { id: gr.purchaseOrderId, tenantId },
          include: { lines: true },
        });

        if (updatedPO) {
          const allReceived = updatedPO.lines.every(
            l => Number(l.receivedQty) >= Number(l.quantity),
          );
          await tx.purchaseOrder.update({
            where: { id: gr.purchaseOrderId },
            data: { status: allReceived ? 'RECEIVED' : 'PARTIALLY_RECEIVED' },
          });
        }
      }

      // Stamp idempotency record
      await this.idempotency.stamp(tx, 'GRN_CONFIRM', id, tenantId, gr!.id);

      return this.mapGoodsReceiptResponse(gr);
    });
  }
  // ============================================

  private mapWorkOrderResponse(wo: any, product?: any): any {
    if (!wo) return null;
    return {
      ...wo,
      woNumber: wo.orderNumber,
      quantity: Number(wo.plannedQty),
      completedQuantity: Number(wo.completedQty),
      scrapQuantity: Number(wo.scrappedQty),
      scheduledStart: wo.plannedStartDate,
      scheduledEnd: wo.plannedEndDate,
      actualStart: wo.actualStartDate,
      actualEnd: wo.actualEndDate,
      product: product
        ? { id: product.id, sku: product.code, name: product.name }
        : undefined,
      operations: wo.operations?.map((op: any) => this.mapOperationResponse(op)),
      materialIssues: wo.materialIssues?.map((mi: any) => ({
        ...mi,
        quantity: Number(mi.quantity),
      })),
      completions: wo.completions?.map((c: any) => ({
        ...c,
        quantity: Number(c.completedQty),
        scrapQuantity: Number(c.scrappedQty),
      })),
    };
  }

  private mapOperationResponse(op: any): any {
    return {
      ...op,
      plannedSetupTime: Number(op.plannedSetupTime),
      plannedRunTime: Number(op.plannedRunTime),
      actualSetupTime: op.actualSetupTime ? Number(op.actualSetupTime) : null,
      actualRunTime: op.actualRunTime ? Number(op.actualRunTime) : null,
      actualStart: op.startedAt,
      actualEnd: op.completedAt,
      laborEntries: op.laborEntries?.map((le: any) => ({
        ...le,
        hours: le.hoursWorked ? Number(le.hoursWorked) : null,
        employeeId: le.workerId,
      })),
    };
  }

  private mapPurchaseOrderResponse(po: any, supplier?: any, productMap?: Map<string, { id: string; code: string; name: string; unitOfMeasure: string; standardCost?: number }>): any {
    if (!po) return null;
    const statusMap: Record<string, string> = {
      SENT: 'RELEASED',
      PARTIALLY_RECEIVED: 'PARTIAL',
      RECEIVED: 'COMPLETED',
    };
    return {
      ...po,
      poNumber: po.orderNumber,
      status: statusMap[po.status] || po.status,
      totalAmount: po.totalAmount ? Number(po.totalAmount) : null,
      supplier: supplier
        ? { id: supplier.id, name: supplier.name }
        : undefined,
      lines: po.lines?.map((line: any) => {
        const product = productMap?.get(line.productId);
        return {
          ...line,
          quantity: Number(line.quantity),
          unitPrice: Number(line.unitPrice),
          receivedQuantity: Number(line.receivedQty),
          product: product ? { id: product.id, code: product.code, name: product.name, unitOfMeasure: product.unitOfMeasure, standardCost: product.standardCost } : undefined,
        };
      }),
      goodsReceipts: po.receipts?.map((gr: any) => ({
        ...gr,
        grNumber: gr.receiptNumber,
      })),
    };
  }

  private mapGoodsReceiptResponse(gr: any): any {
    if (!gr) return null;
    return {
      ...gr,
      grNumber: gr.receiptNumber,
      status: gr.status === 'POSTED' ? 'CONFIRMED' : gr.status,
    };
  }

  private mapApiStatusToPrismaStatus(apiStatus: string): string {
    const reverseMap: Record<string, string> = {
      RELEASED: 'SENT',
      PARTIAL: 'PARTIALLY_RECEIVED',
      COMPLETED: 'RECEIVED',
    };
    return reverseMap[apiStatus] || apiStatus;
  }

  // ============================================
  // WORK ORDER MANAGEMENT
  // ============================================

  async getWorkOrders(tenantId: string, filters?: {
    status?: string;
    workCenterId?: string;
    startDate?: string;
    endDate?: string;
  }) {
    const where: any = { tenantId };
    
    if (filters?.status) {
      where.status = filters.status;
    }
    if (filters?.workCenterId) {
      where.workCenterId = filters.workCenterId;
    }
    if (filters?.startDate || filters?.endDate) {
      where.plannedStartDate = {};
      if (filters.startDate) where.plannedStartDate.gte = new Date(filters.startDate);
      if (filters.endDate) where.plannedStartDate.lte = new Date(filters.endDate);
    }

    const workOrders = await this.prisma.workOrder.findMany({
      where,
      include: {
        operations: true,
        materialIssues: true,
        completions: true,
      },
      orderBy: { plannedStartDate: 'asc' },
    });

    // Fetch products to enrich responses
    const productIds = [...new Set(workOrders.map(wo => wo.productId))];
    const products = productIds.length > 0
      ? await this.prisma.product.findMany({
          where: { id: { in: productIds } },
          select: { id: true, code: true, name: true },
        })
      : [];
    const productMap = new Map(products.map(p => [p.id, p]));

    return workOrders.map(wo => this.mapWorkOrderResponse(wo, productMap.get(wo.productId)));
  }

  async getWorkOrder(tenantId: string, id: string) {
    const wo = await this.prisma.workOrder.findFirst({
      where: { id, tenantId },
      include: {
        operations: {
          include: {
            laborEntries: true,
          },
          orderBy: { sequence: 'asc' },
        },
        materialIssues: true,
        completions: true,
      },
    });
    if (!wo) {
      throw new NotFoundException('Work order not found');
    }

    const product = await this.prisma.product.findFirst({
      where: { id: wo.productId },
      select: { id: true, code: true, name: true },
    });

    return this.mapWorkOrderResponse(wo, product);
  }

  async createWorkOrder(tenantId: string, userId: string, data: {
    productId: string;
    quantity: number;
    scheduledStart: string;
    scheduledEnd: string;
    workCenterId?: string;
    bomId?: string;
    routingId?: string;
    priority?: number;
    notes?: string;
  }) {
    return this.prisma.$transaction(async (tx) => {
      const woNumber = await this.sequence.nextNumber(tx, 'WO');

      // Get BOM for the product if not specified
      let bomId = data.bomId;
      if (!bomId) {
        const bom = await tx.billOfMaterial.findFirst({
          where: {
            tenantId,
            parentProductId: data.productId,
            status: 'ACTIVE',
            effectiveFrom: { lte: new Date() },
          },
          orderBy: { effectiveFrom: 'desc' },
        });
        bomId = bom?.id;
      }

      // Get routing if not specified
      let routingId = data.routingId;
      if (!routingId && bomId) {
        const routing = await tx.routing.findFirst({
          where: { tenantId, bomId, status: 'ACTIVE' },
        });
        routingId = routing?.id;
      }

      // Resolve location
      const location = await tx.location.findFirst({ where: { tenantId, status: 'ACTIVE' }, select: { id: true } });
      if (!location) {
        throw new BadRequestException('No active location found for this tenant. Please create a location first.');
      }

      // Create work order
      const workOrder = await tx.workOrder.create({
        data: {
          tenantId,
          orderNumber: woNumber,
          productId: data.productId,
          plannedQty: data.quantity,
          completedQty: 0,
          scrappedQty: 0,
          plannedStartDate: new Date(data.scheduledStart),
          plannedEndDate: new Date(data.scheduledEnd),
          status: 'PLANNED',
          priority: data.priority || 5,
          bomId: bomId || undefined,
          locationId: location.id,
          createdById: userId,
          routingId,
          notes: data.notes,
        },
      });

      // Create operations from routing
      if (routingId) {
        const routing = await tx.routing.findFirst({
          where: { id: routingId },
          include: { operations: { orderBy: { sequence: 'asc' } } },
        });

        if (routing) {
          await tx.workOrderOperation.createMany({
            data: routing.operations.map(op => ({
              workOrderId: workOrder.id,
              sequence: op.sequence,
              operationCode: op.operationCode,
              operationName: op.operationName,
              workCenterId: op.workCenterId,
              plannedSetupTime: Number(op.setupTime),
              plannedRunTime: Number(op.runTimePerUnit) * data.quantity,
              status: 'PENDING' as const,
            })),
          });
        }
      }

      return this.getWorkOrder(tenantId, workOrder.id);
    });
  }

  async releaseWorkOrder(tenantId: string, id: string) {
    return this.prisma.$transaction(async (tx) => {
      // Pessimistic lock on WO to prevent concurrent state changes
      const lockedWO = await tx.$queryRaw<Array<{ id: string; status: string; version: number }>>(
        Prisma.sql`SELECT id, status, version FROM work_orders WHERE id = ${id} AND tenant_id = ${tenantId} FOR UPDATE`,
      );
      if (!lockedWO.length) throw new NotFoundException('Work order not found');
      if (lockedWO[0].status !== 'PLANNED') throw new BadRequestException('Can only release planned orders');

      const wo = await tx.workOrder.findFirst({
        where: { id, tenantId },
      });
      if (!wo) throw new NotFoundException('Work order not found');

      // Check material availability via BOM and create reservations through the ledger
      const bom = await tx.billOfMaterial.findFirst({
        where: { id: wo.bomId },
        include: { components: true },
      });

      let materialWarnings: string[] = [];
      if (bom) {
        for (const comp of bom.components) {
          const required = Number(comp.quantity) * Number(wo.plannedQty);
          const invLevel = await tx.inventoryLevel.findFirst({
            where: { productId: comp.componentProductId, tenantId },
          });
          const available = invLevel ? Number(invLevel.availableQty) : 0;

          if (available < required) {
            const product = await tx.product.findFirst({
              where: { id: comp.componentProductId },
            });
            materialWarnings.push(`${product?.code}: need ${required}, have ${available}`);
          }

          // Reserve available stock through concurrency-safe ledger
          const reserveQty = Math.min(required, Math.max(available, 0));
          if (reserveQty > 0) {
            await this.ledger.createReservation(tx, {
              tenantId,
              productId: comp.componentProductId,
              locationId: wo.locationId,
              quantity: new Decimal(reserveQty),
              uom: comp.uom || 'EA',
              referenceType: 'WORK_ORDER',
              referenceId: wo.id,
              requiredDate: wo.plannedStartDate,
              reservedById: tenantId,
              notes: `Reserved for WO ${wo.orderNumber}`,
            });
          }
        }

        if (materialWarnings.length > 0) {
          this.logger.warn(`WO ${wo.orderNumber} released with material shortages: ${materialWarnings.join('; ')}`);
        }
      }

      const updated = await tx.workOrder.update({
        where: { id },
        data: { status: 'RELEASED', version: { increment: 1 } },
        include: {
          operations: true,
          materialIssues: true,
          completions: true,
        },
      });

      // Initialize work order cost tracking (idempotent)
      try {
        await tx.workOrderCost.create({
          data: {
            tenantId,
            workOrderId: id,
            materialCost: 0,
            laborCost: 0,
            overheadCost: 0,
            subcontractCost: 0,
            scrapCost: 0,
            totalCost: 0,
            costPerUnit: 0,
            stdMaterialCost: 0,
            stdLaborCost: 0,
            stdOverheadCost: 0,
            stdTotalCost: 0,
            materialVariance: 0,
            laborVariance: 0,
            overheadVariance: 0,
            totalVariance: 0,
            completedQty: 0,
          },
        });
      } catch (e: any) {
        // Only swallow unique constraint violation (P2002) — the record already exists
        if (e?.code !== 'P2002') {
          throw e;
        }
      }

      const product = await tx.product.findFirst({ where: { id: updated.productId, tenantId }, select: { id: true, code: true, name: true } });
      const response = this.mapWorkOrderResponse(updated, product);
      if (materialWarnings.length > 0) {
        response.warnings = materialWarnings;
      }
      return response;
    });
  }

  async startWorkOrder(tenantId: string, id: string) {
    return this.prisma.$transaction(async (tx) => {
      // Pessimistic lock on WO
      const lockedWO = await tx.$queryRaw<Array<{ id: string; status: string }>>(
        Prisma.sql`SELECT id, status FROM work_orders WHERE id = ${id} AND tenant_id = ${tenantId} FOR UPDATE`,
      );
      if (!lockedWO.length) throw new NotFoundException('Work order not found');
      if (lockedWO[0].status !== 'RELEASED') throw new BadRequestException('Can only start released orders');

      await tx.workOrder.update({
        where: { id },
        data: {
          status: 'IN_PROGRESS',
          actualStartDate: new Date(),
          version: { increment: 1 },
        },
      });
      return this.getWorkOrder(tenantId, id);
    });
  }

  async completeWorkOrder(tenantId: string, id: string) {
    return this.prisma.$transaction(async (tx) => {
      // Idempotency: prevent double-completion
      const duplicate = await this.idempotency.acquire(tx, 'WO_COMPLETE', id, tenantId);
      if (duplicate) return this.getWorkOrder(tenantId, id);

      // Pessimistic lock on the work order row
      const lockedWO = await tx.$queryRaw<Array<{ id: string; status: string; version: number }>>(
        Prisma.sql`SELECT id, status, version FROM work_orders WHERE id = ${id} AND tenant_id = ${tenantId} FOR UPDATE`,
      );
      if (!lockedWO.length) throw new NotFoundException('Work order not found');
      if (lockedWO[0].status !== 'IN_PROGRESS') throw new BadRequestException('Can only complete in-progress orders');

      const wo = await tx.workOrder.findFirst({
        where: { id, tenantId },
      });
      if (!wo) throw new NotFoundException('Work order not found');

      // Optimistic version check + increment
      await tx.workOrder.update({
        where: { id },
        data: {
          status: 'COMPLETED',
          actualEndDate: new Date(),
          version: { increment: 1 },
        },
      });

      // Release any remaining reservations through the concurrency-safe ledger
      const activeReservations = await tx.inventoryReservation.findMany({
        where: { tenantId, referenceType: 'WORK_ORDER', referenceId: id, status: 'ACTIVE' },
      });
      for (const res of activeReservations) {
        await this.ledger.releaseReservation(tx, {
          reservationId: res.id,
          releasedById: tenantId,
        });
      }

      // Stamp idempotency record
      await this.idempotency.stamp(tx, 'WO_COMPLETE', id, tenantId, id);

      // CostingEngine is the SINGLE source of truth for cost computation.
      // No legacy overhead/variance calculation here.
      // Uses InTx variant to participate in this transaction — no nested tx.
      const product = await tx.product.findFirst({
        where: { id: wo.productId },
        select: { unitOfMeasure: true },
      });
      await this.costingEngine.completeWorkOrderCostInTx(tx, {
        tenantId,
        workOrderId: id,
        productId: wo.productId,
        locationId: wo.locationId,
        completedQty: wo.completedQty,
        scrappedQty: wo.scrappedQty,
        uom: product?.unitOfMeasure || 'EA',
        userId: tenantId,
      });

      return this.getWorkOrder(tenantId, id);
    });
  }

  async cancelWorkOrder(tenantId: string, id: string, reason?: string) {
    return this.prisma.$transaction(async (tx) => {
      // Pessimistic lock on work order
      const lockedWO = await tx.$queryRaw<Array<{ id: string; status: string }>>(
        Prisma.sql`SELECT id, status FROM work_orders WHERE id = ${id} AND tenant_id = ${tenantId} FOR UPDATE`,
      );
      if (!lockedWO.length) throw new NotFoundException('Work order not found');
      if (lockedWO[0].status === 'COMPLETED' || lockedWO[0].status === 'CANCELLED') {
        throw new BadRequestException('Cannot cancel completed or already cancelled orders');
      }

      const wo = await tx.workOrder.findFirst({
        where: { id, tenantId },
      });
      if (!wo) throw new NotFoundException('Work order not found');

      // Release all active reservations through the concurrency-safe ledger
      const activeReservations = await tx.inventoryReservation.findMany({
        where: { tenantId, referenceType: 'WORK_ORDER', referenceId: id, status: 'ACTIVE' },
      });
      for (const res of activeReservations) {
        await this.ledger.releaseReservation(tx, {
          reservationId: res.id,
          releasedById: tenantId,
        });
      }

      await tx.workOrder.update({
        where: { id },
        data: {
          status: 'CANCELLED',
          notes: reason ? `${wo.notes || ''}\nCancelled: ${reason}` : wo.notes,
          version: { increment: 1 },
        },
      });
      return this.getWorkOrder(tenantId, id);
    });
  }

  // Convert planned orders to work orders
  async convertPlannedOrdersToWorkOrders(tenantId: string, userId: string, plannedOrderIds: string[]) {
    const plannedOrders = await this.prisma.plannedOrder.findMany({
      where: {
        id: { in: plannedOrderIds },
        tenantId,
        orderType: 'PRODUCTION',
        status: 'PLANNED',
      },
    });

    if (plannedOrders.length === 0) {
      throw new BadRequestException('No valid planned work orders found');
    }

    const createdWOs: any[] = [];

    for (const order of plannedOrders) {
      // Calculate lead time for scheduling
      const policy = await this.prisma.inventoryPolicy.findFirst({
        where: { productId: order.productId, tenantId },
      });
      const leadTimeDays = policy?.leadTimeDays || 7;
      const startDate = new Date(order.dueDate);
      startDate.setDate(startDate.getDate() - leadTimeDays);

      const wo = await this.createWorkOrder(tenantId, userId, {
        productId: order.productId,
        quantity: Number(order.quantity),
        scheduledStart: startDate.toISOString(),
        scheduledEnd: order.dueDate.toISOString(),
        notes: `Created from planned order: ${order.id}`,
      });

      createdWOs.push(wo);

      // Update planned order to FIRMED
      await this.prisma.plannedOrder.update({
        where: { id: order.id },
        data: { status: 'FIRMED' },
      });
    }

    return createdWOs;
  }

  // ============================================
  // WORK ORDER OPERATIONS
  // ============================================

  async startOperation(tenantId: string, operationId: string) {
    const operation = await this.prisma.workOrderOperation.findFirst({
      where: { id: operationId, workOrder: { tenantId } },
    });

    if (!operation) throw new NotFoundException('Operation not found');
    if (operation.status !== 'PENDING') throw new BadRequestException('Can only start pending operations');

    return this.prisma.workOrderOperation.update({
      where: { id: operationId },
      data: {
        status: 'IN_PROGRESS',
        startedAt: new Date(),
      },
    });
  }

  async completeOperation(tenantId: string, operationId: string, data: {
    actualSetupTime?: number;
    actualRunTime?: number;
  }) {
    const operation = await this.prisma.workOrderOperation.findFirst({
      where: { id: operationId, workOrder: { tenantId } },
    });

    if (!operation) throw new NotFoundException('Operation not found');
    if (operation.status !== 'IN_PROGRESS') throw new BadRequestException('Can only complete in-progress operations');

    return this.prisma.workOrderOperation.update({
      where: { id: operationId },
      data: {
        status: 'COMPLETED',
        completedAt: new Date(),
        actualSetupTime: data.actualSetupTime,
        actualRunTime: data.actualRunTime,
      },
    });
  }

  // ============================================
  // MATERIAL ISSUE (BACKFLUSH)
  // ============================================

  async issueMaterial(tenantId: string, userId: string, data: {
    workOrderId: string;
    productId: string;
    quantity: number;
    lotNumber?: string;
    batchId?: string;
    notes?: string;
  }) {
    return this.prisma.$transaction(async (tx) => {
      const wo = await tx.workOrder.findFirst({
        where: { id: data.workOrderId, tenantId },
      });

      if (!wo) throw new NotFoundException('Work order not found');
      if (wo.status !== 'RELEASED' && wo.status !== 'IN_PROGRESS') {
        throw new BadRequestException('Can only issue to released or in-progress orders');
      }

      // Get product for UOM and cost
      const product = await tx.product.findFirst({
        where: { id: data.productId },
        select: { unitOfMeasure: true, standardCost: true, code: true },
      });
      const uom = product?.unitOfMeasure || 'EA';

      // Check reservation for this WO — fulfill reserved stock first
      const reservation = await tx.inventoryReservation.findFirst({
        where: {
          tenantId,
          productId: data.productId,
          referenceType: 'WORK_ORDER',
          referenceId: data.workOrderId,
          status: 'ACTIVE',
        },
      });

      // If there's a reservation, release it first (returns reserved qty to available)
      if (reservation) {
        const reservedRemaining = Number(reservation.reservedQty) - Number(reservation.fulfilledQty);
        const qtyFromReservation = Math.min(data.quantity, reservedRemaining);
        if (qtyFromReservation > 0) {
          await this.ledger.releaseReservation(tx, {
            reservationId: reservation.id,
            releasedById: userId,
            fulfilledQty: new Decimal(qtyFromReservation),
          });
        }
      }

      // Create material issue with sequence-safe number
      const miNumber = await this.sequence.nextNumber(tx, 'MI');
      const issue = await tx.materialIssue.create({
        data: {
          tenantId,
          issueNumber: miNumber,
          workOrderId: data.workOrderId,
          productId: data.productId,
          locationId: wo.locationId,
          quantity: data.quantity,
          uom,
          issueDate: new Date(),
          issuedById: userId,
          lotNumber: data.lotNumber,
          batchId: data.batchId,
          notes: data.notes,
        },
      });

      // Issue stock through the concurrency-safe append-only ledger
      await this.ledger.recordEntry(tx, {
        tenantId,
        productId: data.productId,
        locationId: wo.locationId,
        entryType: LedgerEntryType.LEDGER_ISSUE,
        quantity: new Decimal(data.quantity),
        uom,
        referenceType: 'WORK_ORDER',
        referenceId: data.workOrderId,
        referenceNumber: miNumber,
        lotNumber: data.lotNumber ?? undefined,
        notes: `Issued to WO ${wo.orderNumber}`,
      });

      // Also create legacy InventoryTransaction for backward compat
      await tx.inventoryTransaction.create({
        data: {
          tenantId,
          productId: data.productId,
          locationId: wo.locationId,
          transactionType: 'ISSUE',
          quantity: -data.quantity,
          uom,
          referenceType: 'WORK_ORDER',
          referenceId: data.workOrderId,
          transactionDate: new Date(),
          createdById: userId,
          lotNumber: data.lotNumber,
          batchId: data.batchId,
          notes: `Issued to WO ${wo.orderNumber}`,
        },
      });

      // CostingEngine is the SINGLE source of truth for material cost.
      // No legacy workOrderCost.materialCost increment — CostingEngine handles via WIP accumulation.
      // Uses InTx variant to participate in this transaction.
      await this.costingEngine.issueMaterialCostInTx(tx, {
        tenantId,
        workOrderId: data.workOrderId,
        materialIssueId: issue.id,
        productId: data.productId,
        locationId: wo.locationId,
        quantity: data.quantity,
        uom,
        batchId: data.batchId,
        userId,
      });

      // Update batch quantity if batch tracking
      if (data.batchId) {
        await tx.batch.updateMany({
          where: { id: data.batchId, tenantId },
          data: {
            availableQty: { decrement: data.quantity },
          },
        });
      }

      return issue;
    });
  }

  async backflushMaterials(tenantId: string, workOrderId: string, completedQty: number, userId?: string) {
    const wo = await this.prisma.workOrder.findFirst({
      where: { id: workOrderId, tenantId },
      include: {
        materialIssues: true,
      },
    });

    if (!wo) throw new NotFoundException('Work order not found');

    const bom = await this.prisma.billOfMaterial.findFirst({
      where: { id: wo.bomId, tenantId },
      include: { components: true },
    });

    if (!bom) throw new BadRequestException('Work order has no BOM');

    const issues: any[] = [];

    for (const comp of bom.components) {
      const requiredQty = Number(comp.quantity) * completedQty;
      
      // Check already issued qty for this component
      const alreadyIssued = wo.materialIssues
        .filter(i => i.productId === comp.componentProductId)
        .reduce((sum, i) => sum + Number(i.quantity), 0);

      const toIssue = requiredQty - alreadyIssued;

      if (toIssue > 0) {
        const issue = await this.issueMaterial(tenantId, userId || tenantId, {
          workOrderId,
          productId: comp.componentProductId,
          quantity: toIssue,
          notes: 'Backflushed',
        });
        issues.push(issue);
      }
    }

    return issues;
  }

  // ============================================
  // PRODUCTION COMPLETION
  // ============================================

  async reportProductionCompletion(tenantId: string, userId: string, data: {
    workOrderId: string;
    quantity: number;
    scrapQuantity?: number;
    operationId?: string;
    lotNumber?: string;
    batchId?: string;
    notes?: string;
  }) {
    return this.prisma.$transaction(async (tx) => {
      // Pessimistic lock on the work order to serialize concurrent completions
      const lockedWO = await tx.$queryRaw<Array<{ id: string; status: string; version: number }>>(
        Prisma.sql`SELECT id, status, version FROM work_orders WHERE id = ${data.workOrderId} AND tenant_id = ${tenantId} FOR UPDATE`,
      );
      if (!lockedWO.length) throw new NotFoundException('Work order not found');
      if (lockedWO[0].status !== 'IN_PROGRESS') throw new BadRequestException('Work order must be in progress');

      const wo = await tx.workOrder.findFirst({
        where: { id: data.workOrderId, tenantId },
      });
      if (!wo) throw new NotFoundException('Work order not found');

      // Get product for QC check
      const product = await tx.product.findFirst({
        where: { id: wo.productId },
        select: { id: true, qcRequired: true, batchTracked: true, unitOfMeasure: true, code: true, standardCost: true },
      });
      const uom = product?.unitOfMeasure || 'EA';

      // Create completion record with sequence-safe number
      const pcNumber = await this.sequence.nextNumber(tx, 'PC');
      const completion = await tx.productionCompletion.create({
        data: {
          tenantId,
          completionNumber: pcNumber,
          workOrderId: data.workOrderId,
          productId: wo.productId,
          locationId: wo.locationId,
          completedQty: data.quantity,
          scrappedQty: data.scrapQuantity || 0,
          uom,
          completionDate: new Date(),
          completedById: userId,
          lotNumber: data.lotNumber,
          batchId: data.batchId,
          notes: data.notes,
        },
      });

      // Update work order quantities with version increment
      await tx.workOrder.update({
        where: { id: data.workOrderId },
        data: {
          completedQty: { increment: data.quantity },
          scrappedQty: { increment: data.scrapQuantity || 0 },
          version: { increment: 1 },
        },
      });

      // Backflush materials (calls issueMaterial which is already tx-safe)
      await this.backflushMaterials(tenantId, data.workOrderId, data.quantity, userId);

      // NOTE: Do NOT record LEDGER_PRODUCTION_RECEIPT here.
      // completeWorkOrderCostInTx handles the FG ledger receipt at WO completion
      // to avoid double-counting inventory (partial receipts + final total).

      // Also create legacy InventoryTransaction for backward compat
      await tx.inventoryTransaction.create({
        data: {
          tenantId,
          productId: wo.productId,
          locationId: wo.locationId,
          transactionType: 'PRODUCTION_RECEIPT',
          quantity: data.quantity,
          uom,
          referenceType: 'WORK_ORDER',
          referenceId: data.workOrderId,
          transactionDate: new Date(),
          createdById: userId,
          lotNumber: data.lotNumber,
          batchId: data.batchId,
          notes: `Produced from WO ${wo.orderNumber}`,
        },
      });

      // If product requires QC, hold produced inventory for inspection
      if (product?.qcRequired) {
        await this.ledger.placeHold(tx, {
          tenantId,
          productId: wo.productId,
          locationId: wo.locationId,
          quantity: new Decimal(data.quantity),
          uom,
          holdReason: 'QC_INSPECTION',
          placedById: userId,
          referenceType: 'WORK_ORDER',
          referenceId: data.workOrderId,
          notes: `QC hold from production WO ${wo.orderNumber}`,
        });

        // Auto-create quality inspection with sequence-safe number
        const qiNumber = await this.sequence.nextNumber(tx, 'QI');
        await tx.qualityInspection.create({
          data: {
            tenantId,
            inspectionNumber: qiNumber,
            productId: wo.productId,
            workOrderId: data.workOrderId,
            locationId: wo.locationId,
            inspectionType: 'IN_PROCESS',
            status: 'PENDING',
            inspectedQty: new Decimal(data.quantity),
            notes: `Auto-created from production completion for WO ${wo.orderNumber}`,
          },
        });
      }

      // Scrap costing — routed through CostingEngine (single source of truth)
      if (data.scrapQuantity && data.scrapQuantity > 0) {
        await this.costingEngine.costScrapInTx(tx, {
          tenantId,
          productId: wo.productId,
          locationId: wo.locationId,
          quantity: data.scrapQuantity,
          uom: product?.unitOfMeasure || 'EA',
          workOrderId: data.workOrderId,
          referenceId: completion.id,
          userId,
        });
      }

      // CostingEngine tracks completedQty via completeWorkOrderCost at WO completion.
      // No legacy workOrderCost.completedQty/scrapCost increment here.

      // Update batch if batch tracking is enabled
      if (data.batchId && product?.batchTracked) {
        await tx.batch.updateMany({
          where: { id: data.batchId, tenantId },
          data: {
            quantity: { increment: data.quantity },
            availableQty: { increment: product.qcRequired ? 0 : data.quantity },
          },
        });
      }

      // Check if WO is fully completed
      const updatedWO = await tx.workOrder.findFirst({
        where: { id: data.workOrderId, tenantId },
      });

      if (updatedWO && Number(updatedWO.completedQty) >= Number(updatedWO.plannedQty)) {
        // Complete the work order inline within this same tx
        await tx.workOrder.update({
          where: { id: data.workOrderId },
          data: { status: 'COMPLETED', actualEndDate: new Date() },
        });

        // Settle WIP, create FG cost layers, post journals, and compute variances
        await this.costingEngine.completeWorkOrderCostInTx(tx, {
          tenantId,
          workOrderId: data.workOrderId,
          productId: wo.productId,
          locationId: wo.locationId,
          completedQty: updatedWO.completedQty,
          scrappedQty: updatedWO.scrappedQty,
          uom,
          userId,
        });

        // Release any remaining reservations
        const remaining = await tx.inventoryReservation.findMany({
          where: { tenantId, referenceType: 'WORK_ORDER', referenceId: data.workOrderId, status: 'ACTIVE' },
        });
        for (const res of remaining) {
          await this.ledger.releaseReservation(tx, {
            reservationId: res.id,
            releasedById: tenantId,
          });
        }
      }

      return {
        ...completion,
        quantity: Number(completion.completedQty),
        scrapQuantity: Number(completion.scrappedQty),
      };
    });
  }

  // ============================================
  // LABOR TRACKING
  // ============================================

  async recordLabor(tenantId: string, userId: string, data: {
    operationId: string;
    laborType: 'SETUP' | 'RUN' | 'IDLE' | 'REWORK' | 'TEARDOWN';
    startTime: string;
    endTime: string;
    workerId?: string;
    employeeId?: string;
    notes?: string;
  }) {
    return this.prisma.$transaction(async (tx) => {
      const operation = await tx.workOrderOperation.findFirst({
        where: { id: data.operationId, workOrder: { tenantId } },
      });

      if (!operation) throw new NotFoundException('Operation not found');

      const start = new Date(data.startTime);
      const end = new Date(data.endTime);
      const hours = (end.getTime() - start.getTime()) / (1000 * 60 * 60);

      // Map TEARDOWN to IDLE (schema uses IDLE instead of TEARDOWN)
      const laborTypeMap: Record<string, string> = { TEARDOWN: 'IDLE' };
      const mappedLaborType = laborTypeMap[data.laborType] || data.laborType;

      const entry = await tx.laborEntry.create({
        data: {
          tenantId,
          operationId: data.operationId,
          laborType: mappedLaborType as any,
          startTime: start,
          endTime: end,
          hoursWorked: hours,
          workerId: data.workerId || data.employeeId || userId,
          notes: data.notes,
        },
      });

      // CostingEngine is the SINGLE source of truth for labor cost.
      // No legacy workOrderCost.laborCost increment — CostingEngine handles via WIP accumulation.
      if (operation.workCenterId) {
        const workCenter = await tx.workCenter.findFirst({
          where: { id: operation.workCenterId },
          select: { costPerHour: true },
        });
        const costPerHour = workCenter?.costPerHour ? Number(workCenter.costPerHour) : 0;

        // Route through CostingEngine (fatal — no try/catch)
        if (costPerHour > 0) {
          await this.costingEngine.recordLaborCostToWIPInTx(tx, {
            tenantId,
            workOrderId: operation.workOrderId,
            laborEntryId: entry.id,
            hours,
            costPerHour,
            isSetup: data.laborType === 'SETUP',
            userId,
          });
        } else {
          this.logger.warn(
            `Work center ${operation.workCenterId} has zero cost/hour. ` +
            `Labor entry ${entry.id} (${hours}h) tracked but NOT costed. WIP may be understated. ` +
            `Configure WorkCenter.costPerHour to enable labor costing.`,
          );
        }
      }

      // Return mapped response
      return {
        ...entry,
        hours: entry.hoursWorked ? Number(entry.hoursWorked) : null,
        employeeId: entry.workerId,
        laborType: data.laborType,
      };
    });
  }

  async getLaborEntriesForWorkOrder(tenantId: string, workOrderId: string) {
    const entries = await this.prisma.laborEntry.findMany({
      where: {
        tenantId,
        operation: {
          workOrderId,
        },
      },
      include: {
        operation: true,
      },
      orderBy: { startTime: 'desc' },
    });

    const laborTypeReverseMap: Record<string, string> = { IDLE: 'TEARDOWN' };
    return entries.map(entry => ({
      ...entry,
      hours: entry.hoursWorked ? Number(entry.hoursWorked) : null,
      employeeId: entry.workerId,
      laborType: laborTypeReverseMap[entry.laborType] || entry.laborType,
    }));
  }

  // ============================================
  // INVENTORY TRANSACTIONS
  // ============================================

  async createInventoryTransaction(tenantId: string, data: {
    productId: string;
    transactionType: string;
    quantity: number;
    locationId?: string;
    referenceType?: string;
    referenceId?: string;
    toLocationId?: string;
    lotNumber?: string;
    batchId?: string;
    notes?: string;
    userId?: string;
    uom?: string;
  }) {
    return this.prisma.$transaction(async (tx) => {
      // Resolve locationId
      let resolvedLocationId = data.locationId;
      if (!resolvedLocationId) {
        const defaultLocation = await tx.location.findFirst({
          where: { tenantId, status: 'ACTIVE' },
          select: { id: true },
        });
        resolvedLocationId = defaultLocation?.id;
      }

      if (!resolvedLocationId) {
        throw new BadRequestException('No active location found for this tenant. Please create a location first.');
      }

      // Get product UOM for enforcement
      const product = await tx.product.findFirst({
        where: { id: data.productId },
        select: { unitOfMeasure: true, batchTracked: true },
      });
      const productUom = product?.unitOfMeasure || 'EA';
      const transactionUom = data.uom || productUom;

      // UOM enforcement: convert if transaction UOM differs from product UOM
      let effectiveQuantity = data.quantity;
      if (transactionUom !== productUom) {
        try {
          const conversion = await this.convertUom(tenantId, transactionUom, productUom, Math.abs(data.quantity), data.productId);
          effectiveQuantity = data.quantity > 0 ? conversion.result : -conversion.result;
          this.logger.log(`UOM conversion: ${Math.abs(data.quantity)} ${transactionUom} → ${Math.abs(effectiveQuantity)} ${productUom} for product ${data.productId}`);
        } catch {
          this.logger.warn(`No UOM conversion from ${transactionUom} to ${productUom} — using quantity as-is`);
        }
      }

      // Map transaction type to ledger entry type
      const ledgerTypeMap: Record<string, LedgerEntryType> = {
        'RECEIPT': LedgerEntryType.LEDGER_RECEIPT,
        'PRODUCTION_RECEIPT': LedgerEntryType.LEDGER_PRODUCTION_RECEIPT,
        'ISSUE': LedgerEntryType.LEDGER_ISSUE,
        'PRODUCTION_ISSUE': LedgerEntryType.LEDGER_PRODUCTION_ISSUE,
        'ADJUSTMENT': LedgerEntryType.LEDGER_ADJUSTMENT,
        'TRANSFER': effectiveQuantity > 0 ? LedgerEntryType.LEDGER_TRANSFER_IN : LedgerEntryType.LEDGER_TRANSFER_OUT,
        'SCRAP': LedgerEntryType.LEDGER_SCRAP,
        'RETURN': LedgerEntryType.LEDGER_RETURN,
      };

      const ledgerType = ledgerTypeMap[data.transactionType];

      // Route through the concurrency-safe append-only ledger
      if (ledgerType) {
        await this.ledger.recordEntry(tx, {
          tenantId,
          productId: data.productId,
          locationId: resolvedLocationId,
          entryType: ledgerType,
          quantity: new Decimal(Math.abs(effectiveQuantity)),
          uom: productUom,
          referenceType: data.referenceType,
          referenceId: data.referenceId,
          lotNumber: data.lotNumber ?? undefined,
          notes: data.notes,
        });
      }

      // Create transaction record (legacy compatibility)
      const itNumber = await this.sequence.nextNumber(tx, 'IT');
      const transaction = await tx.inventoryTransaction.create({
        data: {
          tenantId,
          productId: data.productId,
          transactionType: data.transactionType as any,
          quantity: effectiveQuantity,
          locationId: resolvedLocationId,
          createdById: data.userId || tenantId,
          uom: productUom,
          referenceType: data.referenceType,
          referenceId: data.referenceId,
          toLocationId: data.toLocationId,
          lotNumber: data.lotNumber,
          batchId: data.batchId,
          notes: data.notes,
          transactionDate: new Date(),
        },
      });

      return transaction;
    });
  }

  async getInventoryTransactions(tenantId: string, filters?: {
    productId?: string;
    transactionType?: string;
    startDate?: string;
    endDate?: string;
    limit?: number;
  }) {
    const where: any = { tenantId };
    
    if (filters?.productId) {
      where.productId = filters.productId;
    }
    if (filters?.transactionType) {
      where.transactionType = filters.transactionType;
    }
    if (filters?.startDate || filters?.endDate) {
      where.transactionDate = {};
      if (filters.startDate) where.transactionDate.gte = new Date(filters.startDate);
      if (filters.endDate) where.transactionDate.lte = new Date(filters.endDate);
    }

    return this.prisma.inventoryTransaction.findMany({
      where,
      orderBy: { transactionDate: 'desc' },
      take: filters?.limit || 100,
    });
  }

  async adjustInventory(tenantId: string, data: {
    productId: string;
    quantity: number;
    reason: string;
  }) {
    return this.prisma.$transaction(async (tx) => {
      const location = await tx.location.findFirst({
        where: { tenantId, status: 'ACTIVE' },
        select: { id: true },
      });
      if (!location) throw new BadRequestException('No active location found');

      const product = await tx.product.findFirst({
        where: { id: data.productId },
        select: { unitOfMeasure: true },
      });
      const uom = product?.unitOfMeasure || 'EA';

      // Route through concurrency-safe ledger
      await this.ledger.recordEntry(tx, {
        tenantId,
        productId: data.productId,
        locationId: location.id,
        entryType: LedgerEntryType.LEDGER_ADJUSTMENT,
        quantity: new Decimal(Math.abs(data.quantity)),
        uom,
        notes: `Adjustment: ${data.reason}`,
      });

      // Create legacy transaction record
      return tx.inventoryTransaction.create({
        data: {
          tenantId,
          productId: data.productId,
          locationId: location.id,
          transactionType: data.quantity >= 0 ? 'ADJUSTMENT_IN' : 'ADJUSTMENT_OUT',
          quantity: data.quantity,
          uom,
          transactionDate: new Date(),
          createdById: tenantId,
          notes: `Adjustment: ${data.reason}`,
        },
      });
    });
  }

  async transferInventory(tenantId: string, data: {
    productId: string;
    quantity: number;
    fromLocation: string;
    toLocation: string;
    notes?: string;
  }) {
    return this.prisma.$transaction(async (tx) => {
      const product = await tx.product.findFirst({
        where: { id: data.productId },
        select: { unitOfMeasure: true },
      });
      const uom = product?.unitOfMeasure || 'EA';
      const qty = new Decimal(data.quantity);

      // Atomic transfer out + in through the concurrency-safe ledger
      await this.ledger.recordEntry(tx, {
        tenantId,
        productId: data.productId,
        locationId: data.fromLocation,
        entryType: LedgerEntryType.LEDGER_TRANSFER_OUT,
        quantity: qty,
        uom,
        notes: `Transfer OUT: ${data.notes || ''}`,
      });

      await this.ledger.recordEntry(tx, {
        tenantId,
        productId: data.productId,
        locationId: data.toLocation,
        entryType: LedgerEntryType.LEDGER_TRANSFER_IN,
        quantity: qty,
        uom,
        notes: `Transfer IN: ${data.notes || ''}`,
      });

      // Create legacy transaction records
      await tx.inventoryTransaction.create({
        data: {
          tenantId,
          productId: data.productId,
          locationId: data.fromLocation,
          toLocationId: data.toLocation,
          transactionType: 'TRANSFER',
          quantity: -data.quantity,
          uom,
          transactionDate: new Date(),
          createdById: tenantId,
          notes: `Transfer OUT: ${data.notes || ''}`,
        },
      });

      return tx.inventoryTransaction.create({
        data: {
          tenantId,
          productId: data.productId,
          locationId: data.toLocation,
          transactionType: 'TRANSFER',
          quantity: data.quantity,
          uom,
          transactionDate: new Date(),
          createdById: tenantId,
          notes: `Transfer IN: ${data.notes || ''}`,
        },
      });
    });
  }

  // ============================================
  // MRP ACTION MESSAGES
  // ============================================

  async generateActionMessages(tenantId: string) {
    const messages: Array<{
      type: 'EXPEDITE' | 'DEFER' | 'CANCEL' | 'INCREASE' | 'DECREASE';
      priority: 'HIGH' | 'MEDIUM' | 'LOW';
      orderType: string;
      orderId: string;
      orderNumber: string;
      productSku: string;
      message: string;
      suggestedAction: string;
    }> = [];

    // Check work orders for expedite/defer
    const workOrders = await this.prisma.workOrder.findMany({
      where: {
        tenantId,
        status: { in: ['PLANNED', 'RELEASED', 'IN_PROGRESS'] },
      },
    });

    const today = new Date();

    for (const wo of workOrders) {
      const product = await this.prisma.product.findFirst({ where: { id: wo.productId, tenantId } });
      const productCode = product?.code || 'Unknown';

      // Check if order is late
      if (wo.plannedEndDate < today && wo.status !== 'COMPLETED') {
        messages.push({
          type: 'EXPEDITE',
          priority: 'HIGH',
          orderType: 'WORK_ORDER',
          orderId: wo.id,
          orderNumber: wo.orderNumber,
          productSku: productCode,
          message: `Work order ${wo.orderNumber} is past due`,
          suggestedAction: 'Expedite production or reschedule',
        });
      }

      // Check for excess inventory (might not need this WO)
      const invLevel = await this.prisma.inventoryLevel.findFirst({
        where: { productId: wo.productId, tenantId },
      });
      const invPolicy = await this.prisma.inventoryPolicy.findFirst({
        where: { productId: wo.productId, tenantId },
      });
      const onHand = invLevel ? Number(invLevel.onHandQty) : 0;
      const safetyStock = invPolicy ? Number(invPolicy.safetyStockQty || 0) : 0;

      if (onHand > safetyStock * 3 && safetyStock > 0) {
        messages.push({
          type: 'DEFER',
          priority: 'LOW',
          orderType: 'WORK_ORDER',
          orderId: wo.id,
          orderNumber: wo.orderNumber,
          productSku: productCode,
          message: `High inventory level for ${productCode}`,
          suggestedAction: 'Consider deferring or reducing quantity',
        });
      }
    }

    // Check purchase orders
    const purchaseOrders = await this.prisma.purchaseOrder.findMany({
      where: {
        tenantId,
        status: { in: ['DRAFT', 'SENT', 'PARTIALLY_RECEIVED'] },
      },
      include: {
        lines: true,
      },
    });

    // Collect all product IDs from PO lines to fetch codes in one query
    const poLineProductIds = new Set<string>();
    for (const po of purchaseOrders) {
      for (const line of po.lines) {
        poLineProductIds.add(line.productId);
      }
    }
    const poProducts = poLineProductIds.size > 0
      ? await this.prisma.product.findMany({
          where: { id: { in: Array.from(poLineProductIds) }, tenantId },
          select: { id: true, code: true },
        })
      : [];
    const poProductMap = new Map(poProducts.map(p => [p.id, p.code]));

    for (const po of purchaseOrders) {
      if (po.expectedDate < today && po.status !== 'RECEIVED') {
        const skus = po.lines.map(l => poProductMap.get(l.productId) || 'Unknown').join(', ');
        messages.push({
          type: 'EXPEDITE',
          priority: 'HIGH',
          orderType: 'PURCHASE_ORDER',
          orderId: po.id,
          orderNumber: po.orderNumber,
          productSku: skus,
          message: `Purchase order ${po.orderNumber} is past due`,
          suggestedAction: 'Contact supplier or find alternative source',
        });
      }
    }

    return messages.sort((a, b) => {
      const priorityOrder = { HIGH: 0, MEDIUM: 1, LOW: 2 };
      return priorityOrder[a.priority] - priorityOrder[b.priority];
    });
  }

  // ============================================
  // PEGGING (DEMAND TRACKING)
  // ============================================

  async getPegging(tenantId: string, productId: string) {
    const product = await this.prisma.product.findFirst({
      where: { id: productId, tenantId },
    });

    if (!product) throw new NotFoundException('Product not found');

    // Get demand sources - work orders that use this product as a component
    const bomsUsingProduct = await this.prisma.bOMComponent.findMany({
      where: { componentProductId: productId },
      select: { bomId: true, quantity: true },
    });
    const bomIds = bomsUsingProduct.map(b => b.bomId);

    const workOrderDemand = bomIds.length > 0 ? await this.prisma.workOrder.findMany({
      where: {
        tenantId,
        status: { in: ['PLANNED', 'RELEASED', 'IN_PROGRESS'] },
        bomId: { in: bomIds },
      },
    }) : [];

    // Get supply sources
    const purchaseOrders = await this.prisma.purchaseOrder.findMany({
      where: {
        tenantId,
        status: { in: ['SENT', 'PARTIALLY_RECEIVED'] },
        lines: {
          some: { productId },
        },
      },
      include: {
        lines: {
          where: { productId },
        },
      },
    });

    const workOrderSupply = await this.prisma.workOrder.findMany({
      where: {
        tenantId,
        productId,
        status: { in: ['PLANNED', 'RELEASED', 'IN_PROGRESS'] },
      },
    });

    // Build pegging tree
    const demandRecords = await Promise.all(workOrderDemand.map(async (wo) => {
      const parentProduct = await this.prisma.product.findFirst({ where: { id: wo.productId, tenantId } });
      const bomComp = bomsUsingProduct.find(b => b.bomId === wo.bomId);
      return {
        type: 'WORK_ORDER',
        orderId: wo.id,
        orderNumber: wo.orderNumber,
        parentProduct: parentProduct?.code || 'Unknown',
        quantity: bomComp
          ? Number(bomComp.quantity) * Number(wo.plannedQty)
          : 0,
        dueDate: wo.plannedEndDate,
      };
    }));

    const supplyRecords = [
      ...purchaseOrders.map(po => ({
        type: 'PURCHASE_ORDER',
        orderId: po.id,
        orderNumber: po.orderNumber,
        supplier: po.supplierId,
        quantity: po.lines.reduce((sum, l) => 
          sum + Number(l.quantity) - Number(l.receivedQty), 0),
        expectedDate: po.expectedDate,
      })),
      ...workOrderSupply.map(wo => ({
        type: 'WORK_ORDER',
        orderId: wo.id,
        orderNumber: wo.orderNumber,
        quantity: Number(wo.plannedQty) - Number(wo.completedQty),
        expectedDate: wo.plannedEndDate,
      })),
    ];

    // Get inventory level and policy
    const invLevel = await this.prisma.inventoryLevel.findFirst({
      where: { productId, tenantId },
    });
    const invPolicy = await this.prisma.inventoryPolicy.findFirst({
      where: { productId, tenantId },
    });
    const currentStock = invLevel ? Number(invLevel.onHandQty) : 0;
    const safetyStock = invPolicy ? Number(invPolicy.safetyStockQty || 0) : 0;

    return {
      product: {
        id: product.id,
        sku: product.code,
        name: product.name,
        currentStock,
        safetyStock,
      },
      demand: demandRecords,
      supply: supplyRecords,
      netPosition: currentStock
        + supplyRecords.reduce((sum, s) => sum + s.quantity, 0)
        - demandRecords.reduce((sum, d) => sum + d.quantity, 0),
    };
  }

  // ============================================
  // SCHEDULED RECEIPTS
  // ============================================

  async getScheduledReceipts(tenantId: string, productId?: string) {
    const receipts: Array<{
      type: string;
      orderId: string;
      orderNumber: string;
      productId: string;
      productSku: string;
      quantity: number;
      expectedDate: Date;
      status: string;
    }> = [];

    // Get from purchase orders
    const poWhere: any = { 
      tenantId,
      status: { in: ['SENT', 'PARTIALLY_RECEIVED'] },
    };
    if (productId) {
      poWhere.lines = { some: { productId } };
    }

    const purchaseOrders = await this.prisma.purchaseOrder.findMany({
      where: poWhere,
      include: {
        lines: {
          where: productId ? { productId } : undefined,
        },
      },
    });

    for (const po of purchaseOrders) {
      for (const line of po.lines) {
        const pending = Number(line.quantity) - Number(line.receivedQty);
        if (pending > 0) {
          const lineProduct = await this.prisma.product.findFirst({ where: { id: line.productId, tenantId } });
          receipts.push({
            type: 'PURCHASE_ORDER',
            orderId: po.id,
            orderNumber: po.orderNumber,
            productId: line.productId,
            productSku: lineProduct?.code || 'Unknown',
            quantity: pending,
            expectedDate: po.expectedDate,
            status: po.status,
          });
        }
      }
    }

    // Get from work orders
    const woWhere: any = {
      tenantId,
      status: { in: ['PLANNED', 'RELEASED', 'IN_PROGRESS'] },
    };
    if (productId) {
      woWhere.productId = productId;
    }

    const workOrders = await this.prisma.workOrder.findMany({
      where: woWhere,
    });

    for (const wo of workOrders) {
      const pending = Number(wo.plannedQty) - Number(wo.completedQty);
      if (pending > 0) {
        const woProduct = await this.prisma.product.findFirst({ where: { id: wo.productId, tenantId } });
        receipts.push({
          type: 'WORK_ORDER',
          orderId: wo.id,
          orderNumber: wo.orderNumber,
          productId: wo.productId,
          productSku: woProduct?.code || 'Unknown',
          quantity: pending,
          expectedDate: wo.plannedEndDate,
          status: wo.status,
        });
      }
    }

    return receipts.sort((a, b) => 
      a.expectedDate.getTime() - b.expectedDate.getTime()
    );
  }

  // ===================== CREATE PLANNED ORDER =====================
  async createPlannedOrder(tenantId: string, dto: {
    productId: string;
    locationId?: string;
    orderType: string;
    quantity: number;
    dueDate: string;
    startDate?: string;
    supplierId?: string;
  }) {
    const product = await this.prisma.product.findFirst({
      where: { id: dto.productId, tenantId },
    });
    if (!product) throw new NotFoundException('Product not found');

    const order = await this.prisma.plannedOrder.create({
      data: {
        tenantId,
        productId: dto.productId,
        locationId: dto.locationId || tenantId,
        orderType: dto.orderType as any,
        quantity: dto.quantity,
        dueDate: new Date(dto.dueDate),
        startDate: dto.startDate ? new Date(dto.startDate) : new Date(),
        status: 'PLANNED',
      },
    });
    return order;
  }

  // ===================== SIMULATE LOAD BALANCING =====================
  async simulateLoadBalancing(tenantId: string, params: {
    sourceWorkCenterId: string;
    targetWorkCenterIds: string[];
    startDate: string;
    endDate: string;
    maxShiftPercent?: number;
  }) {
    const source = await this.prisma.workCenter.findFirst({
      where: { id: params.sourceWorkCenterId, tenantId },
    });
    if (!source) throw new NotFoundException('Source work center not found');

    const targets = await this.prisma.workCenter.findMany({
      where: { id: { in: params.targetWorkCenterIds }, tenantId, status: 'ACTIVE' },
    });

    const maxShift = params.maxShiftPercent ?? 30;
    const startDate = new Date(params.startDate);
    const endDate = new Date(params.endDate);
    const periodDays = Math.max(1, Math.ceil((endDate.getTime() - startDate.getTime()) / (1000 * 60 * 60 * 24)) + 1);

    // Helper: compute utilization for a work center in the given period
    const computeUtilization = async (workCenterId: string): Promise<{ available: number; planned: number; utilPct: number }> => {
      const capacity = await this.prisma.workCenterCapacity.findFirst({
        where: { workCenterId },
        orderBy: { effectiveFrom: 'desc' },
      });
      const availableHours = capacity ? Number(capacity.capacityPerDay) * periodDays : 0;

      const ops = await this.prisma.workOrderOperation.findMany({
        where: {
          workCenterId,
          workOrder: {
            tenantId,
            status: { in: ['PLANNED', 'RELEASED', 'IN_PROGRESS'] },
            plannedStartDate: { lte: endDate },
            plannedEndDate: { gte: startDate },
          },
        },
      });
      const plannedHours = ops.reduce((sum, op) => sum + Number(op.plannedSetupTime) + Number(op.plannedRunTime), 0);
      const utilPct = availableHours > 0 ? (plannedHours / availableHours) * 100 : 0;
      return { available: availableHours, planned: plannedHours, utilPct };
    };

    const sourceUtil = await computeUtilization(source.id);

    const suggestions = await Promise.all(targets.map(async (t) => {
      const targetUtil = await computeUtilization(t.id);

      // Determine how much load (%) to shift: min of maxShift and how much source is over-target
      const sourceOverload = Math.max(0, sourceUtil.utilPct - Number(source.utilization));
      const targetHeadroom = Math.max(0, 100 - targetUtil.utilPct);
      const proposedShift = Math.min(maxShift, sourceOverload, targetHeadroom);

      const shiftHours = sourceUtil.available > 0 ? (proposedShift / 100) * sourceUtil.available : 0;
      const resultingSourcePlanned = sourceUtil.planned - shiftHours;
      const resultingTargetPlanned = targetUtil.planned + shiftHours;
      const resultingSourceUtil = sourceUtil.available > 0 ? (resultingSourcePlanned / sourceUtil.available) * 100 : 0;
      const resultingTargetUtil = targetUtil.available > 0 ? (resultingTargetPlanned / targetUtil.available) * 100 : 0;

      return {
        targetWorkCenterId: t.id,
        targetWorkCenterName: t.name,
        currentUtilization: targetUtil.utilPct,
        proposedShift,
        resultingSourceUtil: Math.max(0, resultingSourceUtil),
        resultingTargetUtil: Math.max(0, resultingTargetUtil),
      };
    }));

    return {
      sourceWorkCenter: { id: source.id, name: source.name, currentUtilization: sourceUtil.utilPct },
      period: { startDate: params.startDate, endDate: params.endDate },
      maxShiftPercent: maxShift,
      suggestions,
    };
  }

  // ============================================================================
  // Forecast Accuracy Metric Operations
  // ============================================================================

  async getForecastAccuracyMetrics(tenantId: string, params: {
    productId?: string;
    locationId?: string;
    startDate?: string;
    endDate?: string;
    granularity?: string;
    page?: number;
    pageSize?: number;
  } = {}) {
    const { productId, locationId, startDate, endDate, granularity, page = 1, pageSize = 20 } = params;
    const where: any = {
      tenantId,
      ...(productId && { productId }),
      ...(locationId && { locationId }),
      ...(granularity && { granularity }),
      ...(startDate || endDate ? {
        periodDate: {
          ...(startDate && { gte: new Date(startDate) }),
          ...(endDate && { lte: new Date(endDate) }),
        },
      } : {}),
    };

    const [items, total] = await Promise.all([
      this.prisma.forecastAccuracyMetric.findMany({
        where,
        skip: (page - 1) * pageSize,
        take: pageSize,
        orderBy: { periodDate: 'desc' },
      }),
      this.prisma.forecastAccuracyMetric.count({ where }),
    ]);

    return { items, total, page, pageSize, totalPages: Math.ceil(total / pageSize) };
  }

  async getForecastAccuracyMetric(tenantId: string, id: string) {
    const metric = await this.prisma.forecastAccuracyMetric.findFirst({
      where: { id, tenantId },
    });
    if (!metric) {
      throw new NotFoundException('Forecast accuracy metric not found');
    }
    return metric;
  }

  async createForecastAccuracyMetric(tenantId: string, dto: any) {
    return this.prisma.forecastAccuracyMetric.create({
      data: {
        tenantId,
        productId: dto.productId,
        locationId: dto.locationId,
        periodDate: new Date(dto.periodDate),
        forecastQty: new Decimal(dto.forecastQty),
        actualQty: new Decimal(dto.actualQty),
        mape: dto.mape !== undefined ? new Decimal(dto.mape) : null,
        bias: dto.bias !== undefined ? new Decimal(dto.bias) : null,
        trackingSignal: dto.trackingSignal !== undefined ? new Decimal(dto.trackingSignal) : null,
        mad: dto.mad !== undefined ? new Decimal(dto.mad) : null,
        forecastModel: dto.forecastModel,
        forecastVersion: dto.forecastVersion,
        granularity: dto.granularity || 'MONTHLY',
      },
    });
  }

  async updateForecastAccuracyMetric(tenantId: string, id: string, dto: any) {
    const metric = await this.prisma.forecastAccuracyMetric.findFirst({
      where: { id, tenantId },
    });
    if (!metric) {
      throw new NotFoundException('Forecast accuracy metric not found');
    }
    return this.prisma.forecastAccuracyMetric.update({
      where: { id },
      data: {
        ...(dto.forecastQty !== undefined && { forecastQty: new Decimal(dto.forecastQty) }),
        ...(dto.actualQty !== undefined && { actualQty: new Decimal(dto.actualQty) }),
        ...(dto.mape !== undefined && { mape: new Decimal(dto.mape) }),
        ...(dto.bias !== undefined && { bias: new Decimal(dto.bias) }),
        ...(dto.trackingSignal !== undefined && { trackingSignal: new Decimal(dto.trackingSignal) }),
        ...(dto.mad !== undefined && { mad: new Decimal(dto.mad) }),
        ...(dto.forecastModel !== undefined && { forecastModel: dto.forecastModel }),
        ...(dto.forecastVersion !== undefined && { forecastVersion: dto.forecastVersion }),
        ...(dto.granularity !== undefined && { granularity: dto.granularity }),
      },
    });
  }

  async deleteForecastAccuracyMetric(tenantId: string, id: string) {
    const metric = await this.prisma.forecastAccuracyMetric.findFirst({
      where: { id, tenantId },
    });
    if (!metric) {
      throw new NotFoundException('Forecast accuracy metric not found');
    }
    await this.prisma.forecastAccuracyMetric.delete({ where: { id } });
    return { success: true };
  }

  // ============================================================================
  // Quality Inspection Operations
  // ============================================================================

  async getQualityInspections(tenantId: string, params: {
    status?: string;
    inspectionType?: string;
    workOrderId?: string;
    purchaseOrderId?: string;
    productId?: string;
    page?: number;
    pageSize?: number;
  } = {}) {
    const { status, inspectionType, workOrderId, purchaseOrderId, productId, page = 1, pageSize = 20 } = params;
    const where: any = {
      tenantId,
      ...(status && { status }),
      ...(inspectionType && { inspectionType }),
      ...(workOrderId && { workOrderId }),
      ...(purchaseOrderId && { purchaseOrderId }),
      ...(productId && { productId }),
    };

    const [items, total] = await Promise.all([
      this.prisma.qualityInspection.findMany({
        where,
        include: {
          product: { select: { id: true, code: true, name: true, unitOfMeasure: true } },
          location: { select: { id: true, code: true, name: true } },
          workOrder: { select: { id: true, orderNumber: true } },
          purchaseOrder: { select: { id: true, orderNumber: true } },
        },
        skip: (page - 1) * pageSize,
        take: pageSize,
        orderBy: { inspectionDate: 'desc' },
      }),
      this.prisma.qualityInspection.count({ where }),
    ]);

    return { items, total, page, pageSize, totalPages: Math.ceil(total / pageSize) };
  }

  async getQualityInspection(tenantId: string, id: string) {
    const inspection = await this.prisma.qualityInspection.findFirst({
      where: { id, tenantId },
      include: {
        product: { select: { id: true, code: true, name: true, unitOfMeasure: true } },
        location: { select: { id: true, code: true, name: true } },
        workOrder: { select: { id: true, orderNumber: true } },
        purchaseOrder: { select: { id: true, orderNumber: true } },
      },
    });
    if (!inspection) {
      throw new NotFoundException('Quality inspection not found');
    }
    return inspection;
  }

  async createQualityInspection(tenantId: string, dto: any) {
    return this.prisma.$transaction(async (tx) => {
      const product = await tx.product.findFirst({
        where: { id: dto.productId, tenantId },
        select: { id: true },
      });
      if (!product) {
        throw new BadRequestException('Invalid product for tenant');
      }

      const [workOrder, purchaseOrder, goodsReceipt] = await Promise.all([
        dto.workOrderId
          ? tx.workOrder.findFirst({
              where: { id: dto.workOrderId, tenantId },
              select: { id: true, productId: true, locationId: true },
            })
          : Promise.resolve(null),
        dto.purchaseOrderId
          ? tx.purchaseOrder.findFirst({
              where: { id: dto.purchaseOrderId, tenantId },
              select: { id: true, locationId: true },
            })
          : Promise.resolve(null),
        dto.goodsReceiptId
          ? tx.goodsReceipt.findFirst({
              where: { id: dto.goodsReceiptId, tenantId },
              select: { id: true, locationId: true },
            })
          : Promise.resolve(null),
      ]);

      if (dto.workOrderId && !workOrder) {
        throw new BadRequestException('Invalid work order for tenant');
      }
      if (dto.purchaseOrderId && !purchaseOrder) {
        throw new BadRequestException('Invalid purchase order for tenant');
      }
      if (dto.goodsReceiptId && !goodsReceipt) {
        throw new BadRequestException('Invalid goods receipt for tenant');
      }

      if (workOrder && workOrder.productId !== dto.productId) {
        throw new BadRequestException('Work order product does not match inspection product');
      }

      if (purchaseOrder) {
        const poLine = await tx.purchaseOrderLine.findFirst({
          where: { purchaseOrderId: purchaseOrder.id, productId: dto.productId },
          select: { id: true },
        });
        if (!poLine) {
          throw new BadRequestException('Purchase order does not contain the selected product');
        }
      }

      if (goodsReceipt) {
        const grLine = await tx.goodsReceiptLine.findFirst({
          where: { goodsReceiptId: goodsReceipt.id, productId: dto.productId },
          select: { id: true },
        });
        if (!grLine) {
          throw new BadRequestException('Goods receipt does not contain the selected product');
        }
      }

      const resolvedLocationId =
        dto.locationId ?? workOrder?.locationId ?? goodsReceipt?.locationId ?? purchaseOrder?.locationId;

      if (!resolvedLocationId) {
        throw new BadRequestException('Location is required for quality inspection');
      }

      const location = await tx.location.findFirst({
        where: { id: resolvedLocationId, tenantId },
        select: { id: true },
      });
      if (!location) {
        throw new BadRequestException('Invalid location for tenant');
      }

      if (workOrder && workOrder.locationId !== resolvedLocationId) {
        throw new BadRequestException('Work order location does not match inspection location');
      }
      if (purchaseOrder && purchaseOrder.locationId !== resolvedLocationId) {
        throw new BadRequestException('Purchase order location does not match inspection location');
      }
      if (goodsReceipt && goodsReceipt.locationId !== resolvedLocationId) {
        throw new BadRequestException('Goods receipt location does not match inspection location');
      }

      if (dto.inspectorId) {
        const inspector = await tx.user.findFirst({
          where: { id: dto.inspectorId, tenantId },
          select: { id: true },
        });
        if (!inspector) {
          throw new BadRequestException('Invalid inspector for tenant');
        }
      }

      const inspectionNumber = await this.sequence.nextNumber(tx, 'QI');

      return tx.qualityInspection.create({
        data: {
          tenantId,
          inspectionNumber,
          productId: dto.productId,
          workOrderId: dto.workOrderId,
          purchaseOrderId: dto.purchaseOrderId,
          goodsReceiptId: dto.goodsReceiptId,
          locationId: resolvedLocationId,
          inspectionType: dto.inspectionType,
          status: 'PENDING',
          inspectedQty: new Decimal(dto.inspectedQty),
          defectType: dto.defectType,
          defectDescription: dto.defectDescription,
          inspectorId: dto.inspectorId,
          notes: dto.notes,
        },
      });
    });
  }

  async updateQualityInspection(tenantId: string, id: string, dto: any) {
    const inspection = await this.prisma.qualityInspection.findFirst({
      where: { id, tenantId },
    });
    if (!inspection) {
      throw new NotFoundException('Quality inspection not found');
    }

    const acceptedQty = dto.acceptedQty !== undefined ? new Decimal(dto.acceptedQty) : inspection.acceptedQty;
    const rejectedQty = dto.rejectedQty !== undefined ? new Decimal(dto.rejectedQty) : inspection.rejectedQty;
    if (acceptedQty.lt(0) || rejectedQty.lt(0)) {
      throw new BadRequestException('Accepted and rejected quantities must be non-negative');
    }
    if (acceptedQty.add(rejectedQty).gt(inspection.inspectedQty)) {
      throw new BadRequestException('Accepted + rejected quantities cannot exceed inspected quantity');
    }

    return this.prisma.qualityInspection.update({
      where: { id },
      data: {
        ...(dto.acceptedQty !== undefined && { acceptedQty: new Decimal(dto.acceptedQty) }),
        ...(dto.rejectedQty !== undefined && { rejectedQty: new Decimal(dto.rejectedQty) }),
        ...(dto.defectType !== undefined && { defectType: dto.defectType }),
        ...(dto.defectDescription !== undefined && { defectDescription: dto.defectDescription }),
        ...(dto.notes !== undefined && { notes: dto.notes }),
        ...(dto.results !== undefined && { results: dto.results }),
      },
    });
  }

  async updateQualityInspectionStatus(tenantId: string, id: string, status: string, userId: string) {
    return this.prisma.$transaction(async (tx) => {
      const normalizedStatus = String(status || '').toUpperCase();
      const validStatuses = new Set([
        'PENDING',
        'IN_PROGRESS',
        'PASSED',
        'FAILED',
        'CONDITIONALLY_ACCEPTED',
      ]);
      if (!validStatuses.has(normalizedStatus)) {
        throw new BadRequestException('Invalid quality inspection status');
      }

      const inspection = await tx.qualityInspection.findFirst({
        where: { id, tenantId },
      });
      if (!inspection) {
        throw new NotFoundException('Quality inspection not found');
      }

      const updated = await tx.qualityInspection.update({
        where: { id },
        data: {
          status: normalizedStatus as any,
          ...(normalizedStatus === 'PASSED' || normalizedStatus === 'FAILED' || normalizedStatus === 'CONDITIONALLY_ACCEPTED'
            ? { completedDate: new Date() }
            : {}),
        },
      });

      // Release or keep inventory hold based on QI outcome
      if (inspection.goodsReceiptId && (normalizedStatus === 'PASSED' || normalizedStatus === 'CONDITIONALLY_ACCEPTED')) {
        // Find active holds for this product at QC_INSPECTION reason
        const holds = await tx.inventoryHold.findMany({
          where: {
            tenantId,
            productId: inspection.productId,
            holdReason: { in: ['QC_INSPECTION', 'QC_PENDING'] },
            status: 'ACTIVE',
          },
        });

        for (const hold of holds) {
          // Release hold through the concurrency-safe ledger
          await this.ledger.releaseHold(tx, {
            holdId: hold.id,
            releasedById: userId,
            notes: `Released by QI ${inspection.inspectionNumber} - ${normalizedStatus}`,
          });
        }

        // Update GR qcStatus
        await tx.goodsReceipt.update({
          where: { id: inspection.goodsReceiptId },
          data: { qcStatus: normalizedStatus === 'PASSED' ? 'QC_PASSED' : 'QC_CONDITIONAL' },
        });
      } else if (inspection.goodsReceiptId && normalizedStatus === 'FAILED') {
        // Mark holds as rejected (inventory stays unavailable)
        await tx.inventoryHold.updateMany({
          where: {
            tenantId,
            productId: inspection.productId,
            holdReason: { in: ['QC_INSPECTION', 'QC_PENDING'] },
            status: 'ACTIVE',
          },
          data: {
            status: 'REJECTED',
            inspectionId: inspection.id,
          },
        });

        // Update GR qcStatus
        await tx.goodsReceipt.update({
          where: { id: inspection.goodsReceiptId },
          data: { qcStatus: 'QC_FAILED' },
        });
      }

      return updated;
    });
  }

  async deleteQualityInspection(tenantId: string, id: string) {
    const inspection = await this.prisma.qualityInspection.findFirst({
      where: { id, tenantId },
    });
    if (!inspection) {
      throw new NotFoundException('Quality inspection not found');
    }
    await this.prisma.qualityInspection.delete({ where: { id } });
    return { success: true };
  }

  // ============================================================================
  // UOM Master Operations
  // ============================================================================

  async getUoms(tenantId: string, params: {
    category?: string;
    isActive?: boolean;
    search?: string;
    page?: number;
    pageSize?: number;
  } = {}) {
    const { category, isActive, search, page = 1, pageSize = 50 } = params;
    const where: any = {
      tenantId,
      ...(category && { category }),
      ...(isActive !== undefined && { isActive }),
      ...(search && {
        OR: [
          { code: { contains: search, mode: 'insensitive' } },
          { name: { contains: search, mode: 'insensitive' } },
          { symbol: { contains: search, mode: 'insensitive' } },
        ],
      }),
    };

    const [items, total] = await Promise.all([
      this.prisma.unitOfMeasure.findMany({
        where,
        skip: (page - 1) * pageSize,
        take: pageSize,
        orderBy: [{ category: 'asc' }, { sortOrder: 'asc' }, { code: 'asc' }],
      }),
      this.prisma.unitOfMeasure.count({ where }),
    ]);

    return { items, total, page, pageSize, totalPages: Math.ceil(total / pageSize) };
  }

  async getUom(tenantId: string, id: string) {
    const uom = await this.prisma.unitOfMeasure.findFirst({
      where: { id, tenantId },
    });
    if (!uom) {
      throw new NotFoundException('UOM not found');
    }
    return uom;
  }

  async createUom(tenantId: string, dto: any) {
    // Ensure code is uppercase and trimmed
    const code = dto.code.trim().toUpperCase();

    // Check for duplicate code
    const existing = await this.prisma.unitOfMeasure.findFirst({
      where: { tenantId, code },
    });
    if (existing) {
      throw new ConflictException(`UOM with code "${code}" already exists`);
    }

    return this.prisma.unitOfMeasure.create({
      data: {
        tenantId,
        code,
        name: dto.name.trim(),
        symbol: dto.symbol?.trim() || null,
        category: dto.category || 'OTHER',
        description: dto.description?.trim() || null,
        decimals: dto.decimals ?? 2,
        isBase: dto.isBase ?? false,
        isActive: dto.isActive ?? true,
        sortOrder: dto.sortOrder ?? 0,
      },
    });
  }

  async updateUom(tenantId: string, id: string, dto: any) {
    const uom = await this.prisma.unitOfMeasure.findFirst({
      where: { id, tenantId },
    });
    if (!uom) {
      throw new NotFoundException('UOM not found');
    }

    return this.prisma.unitOfMeasure.update({
      where: { id },
      data: {
        ...(dto.name !== undefined && { name: dto.name.trim() }),
        ...(dto.symbol !== undefined && { symbol: dto.symbol?.trim() || null }),
        ...(dto.category !== undefined && { category: dto.category }),
        ...(dto.description !== undefined && { description: dto.description?.trim() || null }),
        ...(dto.decimals !== undefined && { decimals: dto.decimals }),
        ...(dto.isBase !== undefined && { isBase: dto.isBase }),
        ...(dto.isActive !== undefined && { isActive: dto.isActive }),
        ...(dto.sortOrder !== undefined && { sortOrder: dto.sortOrder }),
      },
    });
  }

  async deleteUom(tenantId: string, id: string) {
    const uom = await this.prisma.unitOfMeasure.findFirst({
      where: { id, tenantId },
    });
    if (!uom) {
      throw new NotFoundException('UOM not found');
    }

    // Check if UOM is referenced in any conversions
    const conversionCount = await this.prisma.unitOfMeasureConversion.count({
      where: {
        tenantId,
        OR: [{ fromUomId: id }, { toUomId: id }],
      },
    });
    if (conversionCount > 0) {
      throw new ConflictException(`Cannot delete UOM "${uom.code}" — it is referenced by ${conversionCount} conversion(s). Deactivate it instead.`);
    }

    await this.prisma.unitOfMeasure.delete({ where: { id } });
    return { success: true };
  }

  // ============================================================================
  // UOM Conversion Operations
  // ============================================================================

  async getUomConversions(tenantId: string, params: {
    productId?: string;
    fromUom?: string;
    toUom?: string;
    isActive?: boolean;
    page?: number;
    pageSize?: number;
  } = {}) {
    const { productId, fromUom, toUom, isActive, page = 1, pageSize = 20 } = params;
    const where: any = {
      tenantId,
      ...(productId && { productId }),
      ...(fromUom && { fromUom }),
      ...(toUom && { toUom }),
      ...(isActive !== undefined && { isActive }),
    };

    const [items, total] = await Promise.all([
      this.prisma.unitOfMeasureConversion.findMany({
        where,
        skip: (page - 1) * pageSize,
        take: pageSize,
        orderBy: { createdAt: 'desc' },
        include: {
          product: { select: { id: true, code: true, name: true } },
          fromUomRef: { select: { id: true, code: true, name: true, symbol: true, category: true } },
          toUomRef: { select: { id: true, code: true, name: true, symbol: true, category: true } },
        },
      }),
      this.prisma.unitOfMeasureConversion.count({ where }),
    ]);

    return { items, total, page, pageSize, totalPages: Math.ceil(total / pageSize) };
  }

  async getUomConversion(tenantId: string, id: string) {
    const conversion = await this.prisma.unitOfMeasureConversion.findFirst({
      where: { id, tenantId },
    });
    if (!conversion) {
      throw new NotFoundException('UOM conversion not found');
    }
    return conversion;
  }

  async createUomConversion(tenantId: string, dto: any) {
    return this.prisma.unitOfMeasureConversion.create({
      data: {
        tenantId,
        fromUom: dto.fromUom,
        toUom: dto.toUom,
        fromUomId: dto.fromUomId || null,
        toUomId: dto.toUomId || null,
        productId: dto.productId,
        factor: new Decimal(dto.factor),
        isActive: dto.isActive ?? true,
      },
    });
  }

  async updateUomConversion(tenantId: string, id: string, dto: any) {
    const conversion = await this.prisma.unitOfMeasureConversion.findFirst({
      where: { id, tenantId },
    });
    if (!conversion) {
      throw new NotFoundException('UOM conversion not found');
    }

    return this.prisma.unitOfMeasureConversion.update({
      where: { id },
      data: {
        ...(dto.factor !== undefined && { factor: new Decimal(dto.factor) }),
        ...(dto.isActive !== undefined && { isActive: dto.isActive }),
      },
    });
  }

  async deleteUomConversion(tenantId: string, id: string) {
    const conversion = await this.prisma.unitOfMeasureConversion.findFirst({
      where: { id, tenantId },
    });
    if (!conversion) {
      throw new NotFoundException('UOM conversion not found');
    }
    await this.prisma.unitOfMeasureConversion.delete({ where: { id } });
    return { success: true };
  }

  // ============================================================================
  // Location Hierarchy Operations
  // ============================================================================

  async getLocationHierarchies(tenantId: string, params: {
    hierarchyType?: string;
    parentId?: string;
    page?: number;
    pageSize?: number;
  } = {}) {
    const { hierarchyType, parentId, page = 1, pageSize = 50 } = params;
    const where: any = {
      tenantId,
      ...(hierarchyType && { hierarchyType }),
      ...(parentId !== undefined && { parentId }),
    };

    const [items, total] = await Promise.all([
      this.prisma.locationHierarchy.findMany({
        where,
        include: { children: true },
        skip: (page - 1) * pageSize,
        take: pageSize,
        orderBy: { level: 'asc' },
      }),
      this.prisma.locationHierarchy.count({ where }),
    ]);

    return { items, total, page, pageSize, totalPages: Math.ceil(total / pageSize) };
  }

  async getLocationHierarchyNode(tenantId: string, id: string) {
    const node = await this.prisma.locationHierarchy.findFirst({
      where: { id, tenantId },
      include: { children: true },
    });
    if (!node) {
      throw new NotFoundException('Location hierarchy node not found');
    }
    return node;
  }

  async createLocationHierarchy(tenantId: string, dto: any) {
    return this.prisma.locationHierarchy.create({
      data: {
        tenantId,
        locationId: dto.locationId,
        parentId: dto.parentId,
        level: dto.level ?? 0,
        hierarchyType: dto.hierarchyType || 'OPERATIONAL',
        path: dto.path,
      },
    });
  }

  async updateLocationHierarchy(tenantId: string, id: string, dto: any) {
    const node = await this.prisma.locationHierarchy.findFirst({
      where: { id, tenantId },
    });
    if (!node) {
      throw new NotFoundException('Location hierarchy node not found');
    }

    return this.prisma.locationHierarchy.update({
      where: { id },
      data: {
        ...(dto.parentId !== undefined && { parentId: dto.parentId }),
        ...(dto.level !== undefined && { level: dto.level }),
        ...(dto.hierarchyType !== undefined && { hierarchyType: dto.hierarchyType }),
        ...(dto.path !== undefined && { path: dto.path }),
      },
    });
  }

  async deleteLocationHierarchy(tenantId: string, id: string) {
    const node = await this.prisma.locationHierarchy.findFirst({
      where: { id, tenantId },
    });
    if (!node) {
      throw new NotFoundException('Location hierarchy node not found');
    }
    await this.prisma.locationHierarchy.delete({ where: { id } });
    return { success: true };
  }

  // ============================================================================
  // Capacity Plan Operations
  // ============================================================================

  async getCapacityPlans(tenantId: string, params: {
    status?: string;
    planType?: string;
    page?: number;
    pageSize?: number;
  } = {}) {
    const { status, planType, page = 1, pageSize = 20 } = params;
    const where: any = {
      tenantId,
      ...(status && { status }),
      ...(planType && { planType }),
    };

    const [items, total] = await Promise.all([
      this.prisma.capacityPlan.findMany({
        where,
        include: { buckets: true },
        skip: (page - 1) * pageSize,
        take: pageSize,
        orderBy: { createdAt: 'desc' },
      }),
      this.prisma.capacityPlan.count({ where }),
    ]);

    return { items, total, page, pageSize, totalPages: Math.ceil(total / pageSize) };
  }

  async getCapacityPlanById(tenantId: string, id: string) {
    const plan = await this.prisma.capacityPlan.findFirst({
      where: { id, tenantId },
      include: { buckets: { orderBy: { periodDate: 'asc' } } },
    });
    if (!plan) {
      throw new NotFoundException('Capacity plan not found');
    }
    return plan;
  }

  async createCapacityPlanRecord(tenantId: string, dto: any) {
    return this.prisma.capacityPlan.create({
      data: {
        tenantId,
        name: dto.name,
        description: dto.description,
        planType: dto.planType || 'RCCP',
        status: dto.status || 'DRAFT',
        planningHorizon: dto.planningHorizon ?? 52,
        granularity: dto.granularity || 'WEEKLY',
        startDate: new Date(dto.startDate),
        endDate: new Date(dto.endDate),
        createdById: dto.createdById,
      },
      include: { buckets: true },
    });
  }

  async updateCapacityPlanRecord(tenantId: string, id: string, dto: any) {
    const plan = await this.prisma.capacityPlan.findFirst({
      where: { id, tenantId },
    });
    if (!plan) {
      throw new NotFoundException('Capacity plan not found');
    }

    return this.prisma.capacityPlan.update({
      where: { id },
      data: {
        ...(dto.name !== undefined && { name: dto.name }),
        ...(dto.description !== undefined && { description: dto.description }),
        ...(dto.planType !== undefined && { planType: dto.planType }),
        ...(dto.status !== undefined && { status: dto.status }),
        ...(dto.planningHorizon !== undefined && { planningHorizon: dto.planningHorizon }),
        ...(dto.granularity !== undefined && { granularity: dto.granularity }),
        ...(dto.startDate !== undefined && { startDate: new Date(dto.startDate) }),
        ...(dto.endDate !== undefined && { endDate: new Date(dto.endDate) }),
      },
      include: { buckets: true },
    });
  }

  async deleteCapacityPlanRecord(tenantId: string, id: string) {
    const plan = await this.prisma.capacityPlan.findFirst({
      where: { id, tenantId },
    });
    if (!plan) {
      throw new NotFoundException('Capacity plan not found');
    }
    await this.prisma.capacityPlan.delete({ where: { id } });
    return { success: true };
  }

  // Capacity Plan Buckets (nested under CapacityPlan)

  async getCapacityPlanBuckets(tenantId: string, planId: string) {
    const plan = await this.prisma.capacityPlan.findFirst({
      where: { id: planId, tenantId },
    });
    if (!plan) {
      throw new NotFoundException('Capacity plan not found');
    }
    return this.prisma.capacityPlanBucket.findMany({
      where: { capacityPlanId: planId },
      orderBy: { periodDate: 'asc' },
    });
  }

  async createCapacityPlanBucket(tenantId: string, planId: string, dto: any) {
    const plan = await this.prisma.capacityPlan.findFirst({
      where: { id: planId, tenantId },
    });
    if (!plan) {
      throw new NotFoundException('Capacity plan not found');
    }

    return this.prisma.capacityPlanBucket.create({
      data: {
        capacityPlanId: planId,
        workCenterId: dto.workCenterId,
        periodDate: new Date(dto.periodDate),
        availableCapacity: dto.availableCapacity !== undefined ? new Decimal(dto.availableCapacity) : new Decimal(0),
        requiredCapacity: dto.requiredCapacity !== undefined ? new Decimal(dto.requiredCapacity) : new Decimal(0),
        loadPercent: dto.loadPercent !== undefined ? new Decimal(dto.loadPercent) : new Decimal(0),
        overloadFlag: dto.overloadFlag ?? false,
        notes: dto.notes,
      },
    });
  }

  async deleteCapacityPlanBucket(tenantId: string, planId: string, bucketId: string) {
    const plan = await this.prisma.capacityPlan.findFirst({
      where: { id: planId, tenantId },
    });
    if (!plan) {
      throw new NotFoundException('Capacity plan not found');
    }
    const bucket = await this.prisma.capacityPlanBucket.findFirst({
      where: { id: bucketId, capacityPlanId: planId },
    });
    if (!bucket) {
      throw new NotFoundException('Capacity plan bucket not found');
    }
    await this.prisma.capacityPlanBucket.delete({ where: { id: bucketId } });
    return { success: true };
  }

  // ============================================================================
  // SOP Gap Analysis Operations
  // ============================================================================

  async getSOPGapAnalyses(tenantId: string, params: {
    cycleId?: string;
    productId?: string;
    status?: string;
    page?: number;
    pageSize?: number;
  } = {}) {
    const { cycleId, productId, status, page = 1, pageSize = 20 } = params;
    const where: any = {
      tenantId,
      ...(cycleId && { cycleId }),
      ...(productId && { productId }),
      ...(status && { status }),
    };

    const [items, total] = await Promise.all([
      this.prisma.sOPGapAnalysis.findMany({
        where,
        skip: (page - 1) * pageSize,
        take: pageSize,
        orderBy: { periodDate: 'asc' },
      }),
      this.prisma.sOPGapAnalysis.count({ where }),
    ]);

    return { items, total, page, pageSize, totalPages: Math.ceil(total / pageSize) };
  }

  async getSOPGapAnalysisById(tenantId: string, id: string) {
    const gap = await this.prisma.sOPGapAnalysis.findFirst({
      where: { id, tenantId },
    });
    if (!gap) {
      throw new NotFoundException('SOP gap analysis not found');
    }
    return gap;
  }

  async createSOPGapAnalysis(tenantId: string, dto: any) {
    return this.prisma.sOPGapAnalysis.create({
      data: {
        tenantId,
        cycleId: dto.cycleId,
        productId: dto.productId,
        locationId: dto.locationId,
        periodDate: new Date(dto.periodDate),
        demandQty: dto.demandQty !== undefined ? new Decimal(dto.demandQty) : new Decimal(0),
        supplyQty: dto.supplyQty !== undefined ? new Decimal(dto.supplyQty) : new Decimal(0),
        gapQty: dto.gapQty !== undefined ? new Decimal(dto.gapQty) : new Decimal(0),
        gapRevenue: dto.gapRevenue !== undefined ? new Decimal(dto.gapRevenue) : new Decimal(0),
        gapCost: dto.gapCost !== undefined ? new Decimal(dto.gapCost) : new Decimal(0),
        resolution: dto.resolution,
        priority: dto.priority,
        assignedTo: dto.assignedTo,
        status: 'OPEN',
      },
    });
  }

  async updateSOPGapAnalysis(tenantId: string, id: string, dto: any) {
    const gap = await this.prisma.sOPGapAnalysis.findFirst({
      where: { id, tenantId },
    });
    if (!gap) {
      throw new NotFoundException('SOP gap analysis not found');
    }

    return this.prisma.sOPGapAnalysis.update({
      where: { id },
      data: {
        ...(dto.demandQty !== undefined && { demandQty: new Decimal(dto.demandQty) }),
        ...(dto.supplyQty !== undefined && { supplyQty: new Decimal(dto.supplyQty) }),
        ...(dto.gapQty !== undefined && { gapQty: new Decimal(dto.gapQty) }),
        ...(dto.gapRevenue !== undefined && { gapRevenue: new Decimal(dto.gapRevenue) }),
        ...(dto.gapCost !== undefined && { gapCost: new Decimal(dto.gapCost) }),
        ...(dto.resolution !== undefined && { resolution: dto.resolution }),
        ...(dto.priority !== undefined && { priority: dto.priority }),
        ...(dto.assignedTo !== undefined && { assignedTo: dto.assignedTo }),
        ...(dto.status !== undefined && { status: dto.status }),
      },
    });
  }

  async deleteSOPGapAnalysis(tenantId: string, id: string) {
    const gap = await this.prisma.sOPGapAnalysis.findFirst({
      where: { id, tenantId },
    });
    if (!gap) {
      throw new NotFoundException('SOP gap analysis not found');
    }
    await this.prisma.sOPGapAnalysis.delete({ where: { id } });
    return { success: true };
  }

  // ============================================================================
  // Purchase Contract Operations
  // ============================================================================

  async getPurchaseContracts(tenantId: string, params: {
    supplierId?: string;
    status?: string;
    contractType?: string;
    page?: number;
    pageSize?: number;
  } = {}) {
    const { supplierId, status, contractType, page = 1, pageSize = 20 } = params;
    const where: any = {
      tenantId,
      ...(supplierId && { supplierId }),
      ...(status && { status }),
      ...(contractType && { contractType }),
    };

    const [items, total] = await Promise.all([
      this.prisma.purchaseContract.findMany({
        where,
        include: { lines: true },
        skip: (page - 1) * pageSize,
        take: pageSize,
        orderBy: { createdAt: 'desc' },
      }),
      this.prisma.purchaseContract.count({ where }),
    ]);

    return { items, total, page, pageSize, totalPages: Math.ceil(total / pageSize) };
  }

  async getPurchaseContractById(tenantId: string, id: string) {
    const contract = await this.prisma.purchaseContract.findFirst({
      where: { id, tenantId },
      include: { lines: true },
    });
    if (!contract) {
      throw new NotFoundException('Purchase contract not found');
    }
    return contract;
  }

  async createPurchaseContractRecord(tenantId: string, dto: any) {
    const currency = dto.currency || await this.resolveTenantCurrency(tenantId);
    return this.prisma.purchaseContract.create({
      data: {
        tenantId,
        contractNumber: dto.contractNumber,
        supplierId: dto.supplierId,
        contractType: dto.contractType || 'BLANKET',
        status: 'DRAFT',
        startDate: new Date(dto.startDate),
        endDate: new Date(dto.endDate),
        totalValue: dto.totalValue !== undefined ? new Decimal(dto.totalValue) : null,
        currency,
        paymentTerms: dto.paymentTerms,
        notes: dto.notes,
        createdById: dto.createdById,
        ...(dto.lines?.length ? {
          lines: {
            create: dto.lines.map((line: any) => ({
              productId: line.productId,
              agreedPrice: new Decimal(line.agreedPrice),
              agreedQty: line.agreedQty !== undefined ? new Decimal(line.agreedQty) : null,
              minOrderQty: line.minOrderQty !== undefined ? new Decimal(line.minOrderQty) : null,
              leadTimeDays: line.leadTimeDays,
              uom: line.uom,
            })),
          },
        } : {}),
      },
      include: { lines: true },
    });
  }

  async updatePurchaseContractRecord(tenantId: string, id: string, dto: any) {
    const contract = await this.prisma.purchaseContract.findFirst({
      where: { id, tenantId },
    });
    if (!contract) {
      throw new NotFoundException('Purchase contract not found');
    }

    return this.prisma.purchaseContract.update({
      where: { id },
      data: {
        ...(dto.contractType !== undefined && { contractType: dto.contractType }),
        ...(dto.status !== undefined && { status: dto.status }),
        ...(dto.startDate !== undefined && { startDate: new Date(dto.startDate) }),
        ...(dto.endDate !== undefined && { endDate: new Date(dto.endDate) }),
        ...(dto.totalValue !== undefined && { totalValue: new Decimal(dto.totalValue) }),
        ...(dto.currency !== undefined && { currency: dto.currency }),
        ...(dto.paymentTerms !== undefined && { paymentTerms: dto.paymentTerms }),
        ...(dto.notes !== undefined && { notes: dto.notes }),
      },
      include: { lines: true },
    });
  }

  async deletePurchaseContractRecord(tenantId: string, id: string) {
    const contract = await this.prisma.purchaseContract.findFirst({
      where: { id, tenantId },
    });
    if (!contract) {
      throw new NotFoundException('Purchase contract not found');
    }
    await this.prisma.purchaseContract.delete({ where: { id } });
    return { success: true };
  }

  // Purchase Contract Lines (nested under PurchaseContract)

  async getPurchaseContractLines(tenantId: string, contractId: string) {
    const contract = await this.prisma.purchaseContract.findFirst({
      where: { id: contractId, tenantId },
    });
    if (!contract) {
      throw new NotFoundException('Purchase contract not found');
    }
    return this.prisma.purchaseContractLine.findMany({
      where: { contractId },
    });
  }

  async createPurchaseContractLine(tenantId: string, contractId: string, dto: any) {
    const contract = await this.prisma.purchaseContract.findFirst({
      where: { id: contractId, tenantId },
    });
    if (!contract) {
      throw new NotFoundException('Purchase contract not found');
    }

    return this.prisma.purchaseContractLine.create({
      data: {
        contractId,
        productId: dto.productId,
        agreedPrice: new Decimal(dto.agreedPrice),
        agreedQty: dto.agreedQty !== undefined ? new Decimal(dto.agreedQty) : null,
        minOrderQty: dto.minOrderQty !== undefined ? new Decimal(dto.minOrderQty) : null,
        leadTimeDays: dto.leadTimeDays,
        uom: dto.uom,
      },
    });
  }

  async deletePurchaseContractLine(tenantId: string, contractId: string, lineId: string) {
    const contract = await this.prisma.purchaseContract.findFirst({
      where: { id: contractId, tenantId },
    });
    if (!contract) {
      throw new NotFoundException('Purchase contract not found');
    }
    const line = await this.prisma.purchaseContractLine.findFirst({
      where: { id: lineId, contractId },
    });
    if (!line) {
      throw new NotFoundException('Purchase contract line not found');
    }
    await this.prisma.purchaseContractLine.delete({ where: { id: lineId } });
    return { success: true };
  }

  // ============================================================================
  // Product Costing Operations
  // ============================================================================

  async getProductCostings(tenantId: string, params: {
    productId?: string;
    locationId?: string;
    costType?: string;
    page?: number;
    pageSize?: number;
  } = {}) {
    const { productId, locationId, costType, page = 1, pageSize = 20 } = params;
    const where: any = {
      tenantId,
      ...(productId && { productId }),
      ...(locationId && { locationId }),
      ...(costType && { costType }),
    };

    const [items, total] = await Promise.all([
      this.prisma.productCosting.findMany({
        where,
        skip: (page - 1) * pageSize,
        take: pageSize,
        orderBy: { effectiveFrom: 'desc' },
      }),
      this.prisma.productCosting.count({ where }),
    ]);

    return { items, total, page, pageSize, totalPages: Math.ceil(total / pageSize) };
  }

  async getProductCostingById(tenantId: string, id: string) {
    const costing = await this.prisma.productCosting.findFirst({
      where: { id, tenantId },
    });
    if (!costing) {
      throw new NotFoundException('Product costing not found');
    }
    return costing;
  }

  async createProductCosting(tenantId: string, dto: any) {
    const materialCost = dto.materialCost ?? 0;
    const laborCost = dto.laborCost ?? 0;
    const overheadCost = dto.overheadCost ?? 0;
    const subcontractCost = dto.subcontractCost ?? 0;
    const totalCost = materialCost + laborCost + overheadCost + subcontractCost;

    // Resolve currency from tenant settings if not provided — never hardcode 'USD'
    let currency = dto.currency;
    if (!currency) {
      currency = await this.resolveTenantCurrency(tenantId);
    }

    return this.prisma.productCosting.create({
      data: {
        tenantId,
        productId: dto.productId,
        locationId: dto.locationId,
        costType: dto.costType || 'STANDARD',
        effectiveFrom: new Date(dto.effectiveFrom),
        effectiveTo: dto.effectiveTo ? new Date(dto.effectiveTo) : null,
        materialCost: new Decimal(materialCost),
        laborCost: new Decimal(laborCost),
        overheadCost: new Decimal(overheadCost),
        subcontractCost: new Decimal(subcontractCost),
        totalCost: new Decimal(totalCost),
        currency,
        version: dto.version,
        notes: dto.notes,
      },
    });
  }

  async updateProductCosting(tenantId: string, id: string, dto: any) {
    const costing = await this.prisma.productCosting.findFirst({
      where: { id, tenantId },
    });
    if (!costing) {
      throw new NotFoundException('Product costing not found');
    }

    const materialCost = dto.materialCost !== undefined ? dto.materialCost : Number(costing.materialCost);
    const laborCost = dto.laborCost !== undefined ? dto.laborCost : Number(costing.laborCost);
    const overheadCost = dto.overheadCost !== undefined ? dto.overheadCost : Number(costing.overheadCost);
    const subcontractCost = dto.subcontractCost !== undefined ? dto.subcontractCost : Number(costing.subcontractCost);
    const totalCost = materialCost + laborCost + overheadCost + subcontractCost;

    return this.prisma.productCosting.update({
      where: { id },
      data: {
        ...(dto.costType !== undefined && { costType: dto.costType }),
        ...(dto.effectiveFrom !== undefined && { effectiveFrom: new Date(dto.effectiveFrom) }),
        ...(dto.effectiveTo !== undefined && { effectiveTo: dto.effectiveTo ? new Date(dto.effectiveTo) : null }),
        ...(dto.materialCost !== undefined && { materialCost: new Decimal(dto.materialCost) }),
        ...(dto.laborCost !== undefined && { laborCost: new Decimal(dto.laborCost) }),
        ...(dto.overheadCost !== undefined && { overheadCost: new Decimal(dto.overheadCost) }),
        ...(dto.subcontractCost !== undefined && { subcontractCost: new Decimal(dto.subcontractCost) }),
        totalCost: new Decimal(totalCost),
        ...(dto.currency !== undefined && { currency: dto.currency }),
        ...(dto.version !== undefined && { version: dto.version }),
        ...(dto.notes !== undefined && { notes: dto.notes }),
      },
    });
  }

  async deleteProductCosting(tenantId: string, id: string) {
    const costing = await this.prisma.productCosting.findFirst({
      where: { id, tenantId },
    });
    if (!costing) {
      throw new NotFoundException('Product costing not found');
    }
    await this.prisma.productCosting.delete({ where: { id } });
    return { success: true };
  }

  // ============================================
  // ADDITIONAL ENDPOINTS — UOM Convert, Hierarchy Tree, etc.
  // ============================================

  async convertUom(tenantId: string, fromUom: string, toUom: string, quantity: number, productId?: string) {
    // Try product-specific conversion first, then fall back to generic
    const where: any = { tenantId, fromUom, toUom, isActive: true };
    if (productId) {
      const specific = await this.prisma.unitOfMeasureConversion.findFirst({
        where: { ...where, productId },
      });
      if (specific) {
        return { fromUom, toUom, quantity, result: quantity * Number(specific.factor), factor: Number(specific.factor) };
      }
    }
    const generic = await this.prisma.unitOfMeasureConversion.findFirst({
      where: { ...where, productId: null },
    });
    if (!generic) {
      // Try reverse direction
      const reverse = await this.prisma.unitOfMeasureConversion.findFirst({
        where: { tenantId, fromUom: toUom, toUom: fromUom, isActive: true, productId: productId || null },
      });
      if (reverse) {
        const factor = 1 / Number(reverse.factor);
        return { fromUom, toUom, quantity, result: quantity * factor, factor };
      }
      throw new NotFoundException(`No UOM conversion found from ${fromUom} to ${toUom}`);
    }
    return { fromUom, toUom, quantity, result: quantity * Number(generic.factor), factor: Number(generic.factor) };
  }

  async getHierarchyTree(tenantId: string, hierarchyType?: string) {
    const where: any = { tenantId };
    if (hierarchyType) where.hierarchyType = hierarchyType;

    const nodes = await this.prisma.locationHierarchy.findMany({
      where,
      include: {
        location: { select: { id: true, name: true, code: true, type: true } },
      },
      orderBy: [{ level: 'asc' }, { createdAt: 'asc' }],
    });

    // Build tree structure
    const nodeMap = new Map<string, any>();
    const roots: any[] = [];

    for (const node of nodes) {
      const treeNode = {
        id: node.id,
        locationId: node.locationId,
        location: node.location,
        parentId: node.parentId,
        level: node.level,
        hierarchyType: node.hierarchyType,
        path: node.path,
        children: [],
      };
      nodeMap.set(node.id, treeNode);
    }

    for (const node of nodes) {
      const treeNode = nodeMap.get(node.id);
      if (node.parentId && nodeMap.has(node.parentId)) {
        nodeMap.get(node.parentId).children.push(treeNode);
      } else {
        roots.push(treeNode);
      }
    }

    return roots;
  }

  async getCapacityPlanBucket(tenantId: string, planId: string, bucketId: string) {
    const plan = await this.prisma.capacityPlan.findFirst({ where: { id: planId, tenantId } });
    if (!plan) throw new NotFoundException('Capacity plan not found');

    const bucket = await this.prisma.capacityPlanBucket.findFirst({
      where: { id: bucketId, capacityPlanId: planId },
      include: { workCenter: { select: { id: true, name: true, code: true } } },
    });
    if (!bucket) throw new NotFoundException('Bucket not found');
    return bucket;
  }

  async updateCapacityPlanBucket(tenantId: string, planId: string, bucketId: string, dto: any) {
    const plan = await this.prisma.capacityPlan.findFirst({ where: { id: planId, tenantId } });
    if (!plan) throw new NotFoundException('Capacity plan not found');

    const bucket = await this.prisma.capacityPlanBucket.findFirst({
      where: { id: bucketId, capacityPlanId: planId },
    });
    if (!bucket) throw new NotFoundException('Bucket not found');

    return this.prisma.capacityPlanBucket.update({
      where: { id: bucketId },
      data: {
        ...(dto.periodDate !== undefined && { periodDate: new Date(dto.periodDate) }),
        ...(dto.availableCapacity !== undefined && { availableCapacity: dto.availableCapacity }),
        ...(dto.requiredCapacity !== undefined && { requiredCapacity: dto.requiredCapacity }),
        ...(dto.loadPercent !== undefined && { loadPercent: dto.loadPercent }),
        ...(dto.overloadFlag !== undefined && { overloadFlag: dto.overloadFlag }),
        ...(dto.notes !== undefined && { notes: dto.notes }),
      },
    });
  }

  async getPurchaseContractLine(tenantId: string, contractId: string, lineId: string) {
    const contract = await this.prisma.purchaseContract.findFirst({ where: { id: contractId, tenantId } });
    if (!contract) throw new NotFoundException('Purchase contract not found');

    const line = await this.prisma.purchaseContractLine.findFirst({
      where: { id: lineId, contractId },
      include: { product: { select: { id: true, name: true, code: true } } },
    });
    if (!line) throw new NotFoundException('Contract line not found');
    return line;
  }

  async updatePurchaseContractLine(tenantId: string, contractId: string, lineId: string, dto: any) {
    const contract = await this.prisma.purchaseContract.findFirst({ where: { id: contractId, tenantId } });
    if (!contract) throw new NotFoundException('Purchase contract not found');

    const line = await this.prisma.purchaseContractLine.findFirst({
      where: { id: lineId, contractId },
    });
    if (!line) throw new NotFoundException('Contract line not found');

    return this.prisma.purchaseContractLine.update({
      where: { id: lineId },
      data: {
        ...(dto.agreedPrice !== undefined && { agreedPrice: dto.agreedPrice }),
        ...(dto.agreedQty !== undefined && { agreedQty: dto.agreedQty }),
        ...(dto.consumedQty !== undefined && { consumedQty: dto.consumedQty }),
        ...(dto.minOrderQty !== undefined && { minOrderQty: dto.minOrderQty }),
        ...(dto.leadTimeDays !== undefined && { leadTimeDays: dto.leadTimeDays }),
        ...(dto.uom !== undefined && { uom: dto.uom }),
      },
    });
  }

  // ──── Batch Management ────

  async getBatches(tenantId: string, params?: { status?: string; productId?: string; locationId?: string; expiringBefore?: string; pageSize?: number }) {
    const where: any = { tenantId };
    if (params?.status) where.status = params.status;
    if (params?.productId) where.productId = params.productId;
    if (params?.locationId) where.locationId = params.locationId;
    if (params?.expiringBefore) where.expiryDate = { lte: new Date(params.expiringBefore) };

    const items = await this.prisma.batch.findMany({
      where,
      orderBy: { createdAt: 'desc' },
      take: Number(params?.pageSize) || 100,
    });

    // Enrich with product and location names
    const productIds = [...new Set(items.map(i => i.productId))];
    const locationIds = [...new Set(items.map(i => i.locationId))];
    const [products, locations] = await Promise.all([
      productIds.length ? this.prisma.product.findMany({ where: { id: { in: productIds } }, select: { id: true, name: true, code: true, unitOfMeasure: true } }) : [],
      locationIds.length ? this.prisma.location.findMany({ where: { id: { in: locationIds } }, select: { id: true, name: true, code: true } }) : [],
    ]);
    const prodMap = new Map(products.map(p => [p.id, p] as const));
    const locMap = new Map(locations.map(l => [l.id, l] as const));

    return {
      items: items.map(b => ({ ...b, product: prodMap.get(b.productId) || null, location: locMap.get(b.locationId) || null })),
      total: items.length,
    };
  }

  async getBatch(tenantId: string, id: string) {
    const batch = await this.prisma.batch.findFirst({ where: { id, tenantId } });
    if (!batch) throw new NotFoundException('Batch not found');

    const [product, location] = await Promise.all([
      this.prisma.product.findUnique({ where: { id: batch.productId }, select: { id: true, name: true, code: true, unitOfMeasure: true } }),
      this.prisma.location.findUnique({ where: { id: batch.locationId }, select: { id: true, name: true, code: true } }),
    ]);

    return { ...batch, product, location };
  }

  async createBatch(tenantId: string, dto: any) {
    return this.prisma.$transaction(async (tx) => {
      let batchNumber = dto.batchNumber;
      if (!batchNumber) {
        batchNumber = await this.sequence.nextNumber(tx, 'BN');
      }

      return tx.batch.create({
        data: {
          tenantId,
          batchNumber,
          productId: dto.productId,
          locationId: dto.locationId,
          quantity: dto.quantity,
          availableQty: dto.availableQty ?? dto.quantity,
          uom: dto.uom || 'EA',
          status: dto.status || 'CREATED',
          manufacturingDate: dto.manufacturingDate ? new Date(dto.manufacturingDate) : undefined,
          expiryDate: dto.expiryDate ? new Date(dto.expiryDate) : undefined,
          supplierId: dto.supplierId || undefined,
          purchaseOrderId: dto.purchaseOrderId || undefined,
          workOrderId: dto.workOrderId || undefined,
          costPerUnit: dto.costPerUnit,
          notes: dto.notes,
        },
      });
    });
  }

  async updateBatch(tenantId: string, id: string, dto: any) {
    const batch = await this.prisma.batch.findFirst({ where: { id, tenantId } });
    if (!batch) throw new NotFoundException('Batch not found');

    return this.prisma.batch.update({
      where: { id },
      data: {
        ...(dto.quantity !== undefined && { quantity: dto.quantity }),
        ...(dto.availableQty !== undefined && { availableQty: dto.availableQty }),
        ...(dto.status !== undefined && { status: dto.status }),
        ...(dto.locationId !== undefined && { locationId: dto.locationId }),
        ...(dto.expiryDate !== undefined && { expiryDate: new Date(dto.expiryDate) }),
        ...(dto.costPerUnit !== undefined && { costPerUnit: dto.costPerUnit }),
        ...(dto.notes !== undefined && { notes: dto.notes }),
      },
    });
  }

  async deleteBatch(tenantId: string, id: string) {
    const batch = await this.prisma.batch.findFirst({ where: { id, tenantId } });
    if (!batch) throw new NotFoundException('Batch not found');
    return this.prisma.batch.delete({ where: { id } });
  }

  // ============================================
  // INVENTORY RESERVATIONS
  // ============================================

  async getInventoryReservations(tenantId: string, params: {
    productId?: string;
    referenceType?: string;
    referenceId?: string;
    status?: string;
    page?: number;
    pageSize?: number;
  } = {}) {
    const { productId, referenceType, referenceId, status, page = 1, pageSize = 20 } = params;
    const where: any = {
      tenantId,
      ...(productId && { productId }),
      ...(referenceType && { referenceType }),
      ...(referenceId && { referenceId }),
      ...(status && { status }),
    };

    const [items, total] = await Promise.all([
      this.prisma.inventoryReservation.findMany({
        where,
        skip: (page - 1) * pageSize,
        take: pageSize,
        orderBy: { createdAt: 'desc' },
      }),
      this.prisma.inventoryReservation.count({ where }),
    ]);

    return {
      items: items.map(r => ({
        ...r,
        reservedQty: Number(r.reservedQty),
        fulfilledQty: Number(r.fulfilledQty),
      })),
      total,
      page,
      pageSize,
      totalPages: Math.ceil(total / pageSize),
    };
  }

  async getInventoryReservation(tenantId: string, id: string) {
    const reservation = await this.prisma.inventoryReservation.findFirst({
      where: { id, tenantId },
    });
    if (!reservation) throw new NotFoundException('Inventory reservation not found');
    return {
      ...reservation,
      reservedQty: Number(reservation.reservedQty),
      fulfilledQty: Number(reservation.fulfilledQty),
    };
  }

  // ============================================
  // INVENTORY HOLDS
  // ============================================

  async getInventoryHolds(tenantId: string, params: {
    productId?: string;
    status?: string;
    holdReason?: string;
    page?: number;
    pageSize?: number;
  } = {}) {
    const { productId, status, holdReason, page = 1, pageSize = 20 } = params;
    const where: any = {
      tenantId,
      ...(productId && { productId }),
      ...(status && { status }),
      ...(holdReason && { holdReason }),
    };

    const [items, total] = await Promise.all([
      this.prisma.inventoryHold.findMany({
        where,
        skip: (page - 1) * pageSize,
        take: pageSize,
        orderBy: { createdAt: 'desc' },
      }),
      this.prisma.inventoryHold.count({ where }),
    ]);

    return {
      items: items.map(h => ({
        ...h,
        heldQty: Number(h.heldQty),
        releasedQty: Number(h.releasedQty),
      })),
      total,
      page,
      pageSize,
      totalPages: Math.ceil(total / pageSize),
    };
  }

  async getInventoryHold(tenantId: string, id: string) {
    const hold = await this.prisma.inventoryHold.findFirst({
      where: { id, tenantId },
    });
    if (!hold) throw new NotFoundException('Inventory hold not found');
    return {
      ...hold,
      heldQty: Number(hold.heldQty),
      releasedQty: Number(hold.releasedQty),
    };
  }

  async releaseInventoryHold(tenantId: string, id: string, releaseQty?: number) {
    return this.prisma.$transaction(async (tx) => {
      const hold = await tx.inventoryHold.findFirst({
        where: { id, tenantId },
      });
      if (!hold) throw new NotFoundException('Inventory hold not found');
      if (hold.status !== 'ACTIVE') throw new BadRequestException('Can only release active holds');

      // Release through the concurrency-safe ledger (handles hold update + ledger entry atomically)
      await this.ledger.releaseHold(tx, {
        holdId: id,
        releasedById: tenantId,
        releasedQty: releaseQty ? new Decimal(releaseQty) : undefined,
        notes: 'Released via manufacturing service',
      });

      return this.getInventoryHold(tenantId, id);
    });
  }

  // ============================================
  // WORK ORDER COSTS
  // ============================================

  async getWorkOrderCosts(tenantId: string, params: {
    workOrderId?: string;
    page?: number;
    pageSize?: number;
  } = {}) {
    const { workOrderId, page = 1, pageSize = 20 } = params;
    const where: any = {
      tenantId,
      ...(workOrderId && { workOrderId }),
    };

    const [items, total] = await Promise.all([
      this.prisma.workOrderCost.findMany({
        where,
        skip: (page - 1) * pageSize,
        take: pageSize,
        orderBy: { createdAt: 'desc' },
      }),
      this.prisma.workOrderCost.count({ where }),
    ]);

    return {
      items: items.map(c => ({
        ...c,
        materialCost: Number(c.materialCost),
        laborCost: Number(c.laborCost),
        overheadCost: Number(c.overheadCost),
        subcontractCost: Number(c.subcontractCost),
        scrapCost: Number(c.scrapCost),
        totalCost: Number(c.totalCost),
        costPerUnit: Number(c.costPerUnit),
        stdMaterialCost: Number(c.stdMaterialCost),
        stdLaborCost: Number(c.stdLaborCost),
        stdOverheadCost: Number(c.stdOverheadCost),
        stdTotalCost: Number(c.stdTotalCost),
        materialVariance: Number(c.materialVariance),
        laborVariance: Number(c.laborVariance),
        overheadVariance: Number(c.overheadVariance),
        totalVariance: Number(c.totalVariance),
        completedQty: Number(c.completedQty),
      })),
      total,
      page,
      pageSize,
      totalPages: Math.ceil(total / pageSize),
    };
  }

  async getWorkOrderCost(tenantId: string, workOrderId: string) {
    const cost = await this.prisma.workOrderCost.findFirst({
      where: { workOrderId, tenantId },
    });
    if (!cost) throw new NotFoundException('Work order cost record not found');
    return {
      ...cost,
      materialCost: Number(cost.materialCost),
      laborCost: Number(cost.laborCost),
      overheadCost: Number(cost.overheadCost),
      subcontractCost: Number(cost.subcontractCost),
      scrapCost: Number(cost.scrapCost),
      totalCost: Number(cost.totalCost),
      costPerUnit: Number(cost.costPerUnit),
      stdMaterialCost: Number(cost.stdMaterialCost),
      stdLaborCost: Number(cost.stdLaborCost),
      stdOverheadCost: Number(cost.stdOverheadCost),
      stdTotalCost: Number(cost.stdTotalCost),
      materialVariance: Number(cost.materialVariance),
      laborVariance: Number(cost.laborVariance),
      overheadVariance: Number(cost.overheadVariance),
      totalVariance: Number(cost.totalVariance),
      completedQty: Number(cost.completedQty),
    };
  }

  // ==========================================================================
  // Product Category Master
  // ==========================================================================

  async getProductCategories(tenantId: string, params?: {
    isActive?: boolean;
    search?: string;
    parentId?: string | null;
    page?: number;
    pageSize?: number;
  }) {
    const where: any = { tenantId };
    if (params?.isActive !== undefined) where.isActive = params.isActive;
    if (params?.parentId !== undefined) where.parentId = params.parentId || null;
    if (params?.search) {
      where.OR = [
        { code: { contains: params.search, mode: 'insensitive' } },
        { name: { contains: params.search, mode: 'insensitive' } },
      ];
    }
    const page = params?.page || 1;
    const pageSize = params?.pageSize || 100;
    const [data, total] = await Promise.all([
      this.prisma.productCategory.findMany({
        where,
        orderBy: [{ sortOrder: 'asc' }, { name: 'asc' }],
        skip: (page - 1) * pageSize,
        take: pageSize,
        include: { parent: { select: { id: true, code: true, name: true } }, children: { select: { id: true, code: true, name: true }, where: { isActive: true } } },
      }),
      this.prisma.productCategory.count({ where }),
    ]);
    return { data, total, page, pageSize, totalPages: Math.ceil(total / pageSize) };
  }

  async getProductCategory(tenantId: string, id: string) {
    const cat = await this.prisma.productCategory.findFirst({
      where: { id, tenantId },
      include: { parent: { select: { id: true, code: true, name: true } }, children: { select: { id: true, code: true, name: true }, where: { isActive: true } } },
    });
    if (!cat) throw new NotFoundException('Product category not found');
    return cat;
  }

  async createProductCategory(tenantId: string, dto: any) {
    const code = dto.code.toUpperCase().trim();
    const existing = await this.prisma.productCategory.findUnique({
      where: { tenantId_code: { tenantId, code } },
    });
    if (existing) throw new ConflictException(`Product category with code "${code}" already exists`);
    if (dto.parentId) {
      const parent = await this.prisma.productCategory.findFirst({ where: { id: dto.parentId, tenantId } });
      if (!parent) throw new NotFoundException('Parent category not found');
    }
    return this.prisma.productCategory.create({
      data: { tenantId, code, name: dto.name, description: dto.description, color: dto.color, icon: dto.icon, parentId: dto.parentId, sortOrder: dto.sortOrder ?? 0, isActive: dto.isActive ?? true },
    });
  }

  async updateProductCategory(tenantId: string, id: string, dto: any) {
    const cat = await this.prisma.productCategory.findFirst({ where: { id, tenantId } });
    if (!cat) throw new NotFoundException('Product category not found');
    if (dto.parentId) {
      if (dto.parentId === id) throw new BadRequestException('Category cannot be its own parent');
      const parent = await this.prisma.productCategory.findFirst({ where: { id: dto.parentId, tenantId } });
      if (!parent) throw new NotFoundException('Parent category not found');
    }
    return this.prisma.productCategory.update({
      where: { id },
      data: { ...dto },
    });
  }

  async deleteProductCategory(tenantId: string, id: string) {
    const cat = await this.prisma.productCategory.findFirst({
      where: { id, tenantId },
      include: { children: { select: { id: true } } },
    });
    if (!cat) throw new NotFoundException('Product category not found');
    if (cat.children.length > 0) throw new ConflictException('Cannot delete category with subcategories. Remove or reassign them first.');
    await this.prisma.productCategory.delete({ where: { id } });
    return { deleted: true };
  }

  // ═══════════════════════════════════════════════════════════════════════
  // PRODUCTION BRANCH — Production Lines
  // ═══════════════════════════════════════════════════════════════════════

  async getProductionLines(tenantId: string, params?: { status?: string }) {
    return this.prisma.productionLine.findMany({
      where: { tenantId, ...(params?.status ? { status: params.status as any } : {}) },
      include: { stations: { orderBy: { sequence: 'asc' } } },
      orderBy: { code: 'asc' },
    });
  }

  async getProductionLine(tenantId: string, id: string) {
    const line = await this.prisma.productionLine.findFirst({
      where: { id, tenantId },
      include: { stations: { orderBy: { sequence: 'asc' } }, downtimeRecords: { orderBy: { startTime: 'desc' }, take: 20, include: { reason: true } } },
    });
    if (!line) throw new NotFoundException('Production line not found');
    return line;
  }

  async createProductionLine(tenantId: string, dto: any) {
    return this.prisma.productionLine.create({
      data: { tenantId, code: dto.code, name: dto.name, description: dto.description, locationId: dto.locationId, outputRate: dto.outputRate, outputUom: dto.outputUom },
    });
  }

  async updateProductionLine(tenantId: string, id: string, dto: any) {
    const line = await this.prisma.productionLine.findFirst({ where: { id, tenantId } });
    if (!line) throw new NotFoundException('Production line not found');
    return this.prisma.productionLine.update({ where: { id }, data: dto });
  }

  async deleteProductionLine(tenantId: string, id: string) {
    const line = await this.prisma.productionLine.findFirst({ where: { id, tenantId } });
    if (!line) throw new NotFoundException('Production line not found');
    await this.prisma.productionLine.delete({ where: { id } });
    return { deleted: true };
  }

  async addProductionLineStation(tenantId: string, lineId: string, dto: any) {
    const line = await this.prisma.productionLine.findFirst({ where: { id: lineId, tenantId } });
    if (!line) throw new NotFoundException('Production line not found');
    return this.prisma.productionLineStation.create({
      data: { productionLineId: lineId, workCenterId: dto.workCenterId, sequence: dto.sequence ?? 10, stationName: dto.stationName, isBottleneck: dto.isBottleneck ?? false },
    });
  }

  async removeProductionLineStation(_tenantId: string, _lineId: string, stationId: string) {
    await this.prisma.productionLineStation.delete({ where: { id: stationId } });
    return { deleted: true };
  }

  // ═══════════════════════════════════════════════════════════════════════
  // PRODUCTION BRANCH — Downtime Reasons (Master)
  // ═══════════════════════════════════════════════════════════════════════

  async getDowntimeReasons(tenantId: string) {
    return this.prisma.downtimeReason.findMany({ where: { tenantId }, orderBy: { code: 'asc' } });
  }

  async createDowntimeReason(tenantId: string, dto: any) {
    return this.prisma.downtimeReason.create({
      data: { tenantId, code: dto.code, name: dto.name, category: dto.category ?? 'UNPLANNED', isPlanned: dto.isPlanned ?? false },
    });
  }

  async updateDowntimeReason(tenantId: string, id: string, dto: any) {
    const reason = await this.prisma.downtimeReason.findFirst({ where: { id, tenantId } });
    if (!reason) throw new NotFoundException('Downtime reason not found');
    return this.prisma.downtimeReason.update({ where: { id }, data: dto });
  }

  async deleteDowntimeReason(tenantId: string, id: string) {
    const reason = await this.prisma.downtimeReason.findFirst({ where: { id, tenantId } });
    if (!reason) throw new NotFoundException('Downtime reason not found');
    await this.prisma.downtimeReason.delete({ where: { id } });
    return { deleted: true };
  }

  // ═══════════════════════════════════════════════════════════════════════
  // PRODUCTION BRANCH — Downtime Records
  // ═══════════════════════════════════════════════════════════════════════

  async getDowntimeRecords(tenantId: string, params?: { productionLineId?: string; startDate?: string; endDate?: string }) {
    const where: any = { tenantId };
    if (params?.productionLineId) where.productionLineId = params.productionLineId;
    if (params?.startDate || params?.endDate) {
      where.startTime = {};
      if (params?.startDate) where.startTime.gte = new Date(params.startDate);
      if (params?.endDate) where.startTime.lte = new Date(params.endDate);
    }
    return this.prisma.downtimeRecord.findMany({
      where,
      include: { reason: true, productionLine: { select: { id: true, code: true, name: true } } },
      orderBy: { startTime: 'desc' },
    });
  }

  async createDowntimeRecord(tenantId: string, userId: string, dto: any) {
    const durationMinutes = dto.durationMinutes ??
      (dto.endTime ? Math.round((new Date(dto.endTime).getTime() - new Date(dto.startTime).getTime()) / 60000 * 100) / 100 : null);

    return this.prisma.downtimeRecord.create({
      data: {
        tenantId,
        downtimeReasonId: dto.downtimeReasonId,
        productionLineId: dto.productionLineId,
        workOrderId: dto.workOrderId,
        startTime: new Date(dto.startTime),
        endTime: dto.endTime ? new Date(dto.endTime) : null,
        durationMinutes,
        notes: dto.notes,
        reportedById: userId,
      },
      include: { reason: true },
    });
  }

  async updateDowntimeRecord(tenantId: string, id: string, dto: any) {
    const record = await this.prisma.downtimeRecord.findFirst({ where: { id, tenantId } });
    if (!record) throw new NotFoundException('Downtime record not found');
    const data: any = { ...dto };
    if (dto.endTime) {
      data.endTime = new Date(dto.endTime);
      if (!dto.durationMinutes) {
        data.durationMinutes = Math.round((new Date(dto.endTime).getTime() - record.startTime.getTime()) / 60000 * 100) / 100;
      }
    }
    return this.prisma.downtimeRecord.update({ where: { id }, data, include: { reason: true } });
  }

  async deleteDowntimeRecord(tenantId: string, id: string) {
    const record = await this.prisma.downtimeRecord.findFirst({ where: { id, tenantId } });
    if (!record) throw new NotFoundException('Downtime record not found');
    await this.prisma.downtimeRecord.delete({ where: { id } });
    return { deleted: true };
  }

  // ═══════════════════════════════════════════════════════════════════════
  // PRODUCTION BRANCH — Scrap Reasons (Master)
  // ═══════════════════════════════════════════════════════════════════════

  async getScrapReasons(tenantId: string) {
    return this.prisma.scrapReason.findMany({ where: { tenantId }, orderBy: { code: 'asc' } });
  }

  async createScrapReason(tenantId: string, dto: any) {
    return this.prisma.scrapReason.create({
      data: { tenantId, code: dto.code, name: dto.name, category: dto.category },
    });
  }

  async updateScrapReason(tenantId: string, id: string, dto: any) {
    const reason = await this.prisma.scrapReason.findFirst({ where: { id, tenantId } });
    if (!reason) throw new NotFoundException('Scrap reason not found');
    return this.prisma.scrapReason.update({ where: { id }, data: dto });
  }

  async deleteScrapReason(tenantId: string, id: string) {
    const reason = await this.prisma.scrapReason.findFirst({ where: { id, tenantId } });
    if (!reason) throw new NotFoundException('Scrap reason not found');
    await this.prisma.scrapReason.delete({ where: { id } });
    return { deleted: true };
  }

  // ═══════════════════════════════════════════════════════════════════════
  // PRODUCTION BRANCH — Production KPIs / OEE
  // ═══════════════════════════════════════════════════════════════════════

  async getProductionKPIs(tenantId: string, params?: { productionLineId?: string; startDate?: string; endDate?: string }) {
    const dateFilter: any = {};
    if (params?.startDate) dateFilter.gte = new Date(params.startDate);
    if (params?.endDate) dateFilter.lte = new Date(params.endDate);

    // Work order throughput
    const workOrders = await this.prisma.workOrder.findMany({
      where: {
        tenantId,
        ...(Object.keys(dateFilter).length ? { actualEndDate: dateFilter } : {}),
        status: { in: ['COMPLETED', 'CLOSED'] },
      },
      select: { id: true, plannedQty: true, completedQty: true, scrappedQty: true, actualStartDate: true, actualEndDate: true },
    });

    const totalPlanned = workOrders.reduce((s, w) => s + Number(w.plannedQty ?? 0), 0);
    const totalCompleted = workOrders.reduce((s, w) => s + Number(w.completedQty ?? 0), 0);
    const totalScrapped = workOrders.reduce((s, w) => s + Number(w.scrappedQty ?? 0), 0);

    // Downtime
    const downtimeWhere: any = { tenantId };
    if (params?.productionLineId) downtimeWhere.productionLineId = params.productionLineId;
    if (Object.keys(dateFilter).length) downtimeWhere.startTime = dateFilter;

    const downtimeRecords = await this.prisma.downtimeRecord.findMany({
      where: downtimeWhere,
      select: { durationMinutes: true, reason: { select: { isPlanned: true, category: true } } },
    });

    const plannedDowntimeMin = downtimeRecords
      .filter(d => d.reason.isPlanned)
      .reduce((s, d) => s + Number(d.durationMinutes ?? 0), 0);
    const unplannedDowntimeMin = downtimeRecords
      .filter(d => !d.reason.isPlanned)
      .reduce((s, d) => s + Number(d.durationMinutes ?? 0), 0);
    const totalDowntimeMin = plannedDowntimeMin + unplannedDowntimeMin;

    // OEE components
    const totalAvailableMin = 8 * 60 * 30; // nominal: 8h/day * 30 days
    const availability = totalAvailableMin > 0
      ? Math.round(((totalAvailableMin - totalDowntimeMin) / totalAvailableMin) * 100) / 100
      : 1;
    const performance = totalPlanned > 0
      ? Math.min(1, Math.round((totalCompleted / totalPlanned) * 100) / 100)
      : 1;
    const quality = totalCompleted > 0
      ? Math.round(((totalCompleted - totalScrapped) / totalCompleted) * 100) / 100
      : 1;
    const oee = Math.round(availability * performance * quality * 100) / 100;

    // Downtime by category
    const downtimeByCategory = downtimeRecords.reduce((acc, d) => {
      const cat = d.reason.category || 'UNCATEGORIZED';
      acc[cat] = (acc[cat] || 0) + Number(d.durationMinutes ?? 0);
      return acc;
    }, {} as Record<string, number>);

    return {
      totalWorkOrders: workOrders.length,
      totalPlanned,
      totalCompleted,
      totalScrapped,
      yieldRate: totalPlanned > 0 ? Math.round(((totalCompleted - totalScrapped) / totalPlanned) * 100) / 100 : 0,
      oee,
      availability,
      performance,
      quality,
      plannedDowntimeMinutes: plannedDowntimeMin,
      unplannedDowntimeMinutes: unplannedDowntimeMin,
      totalDowntimeMinutes: totalDowntimeMin,
      downtimeByCategory,
    };
  }
}
