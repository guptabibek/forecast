import { BadRequestException, Injectable } from '@nestjs/common';
import {
    CAPAPriority,
    CAPAStatus,
    CAPAType,
    CharacteristicType,
    NCRDisposition,
    NCRSeverity,
    NCRStatus,
    NCRType,
    Prisma,
    QualityInspectionStatus,
    QualityInspectionType,
    SamplingProcedure,
} from '@prisma/client';
import { Decimal } from '@prisma/client/runtime/library';
import { PrismaService } from '../../../core/database/prisma.service';
import { InventoryLedgerService } from './inventory-ledger.service';
import { SequenceService } from './sequence.service';

/**
 * QualityService — Full quality management engine.
 *
 * Inspection Plans → Quality Inspections → NCRs → CAPAs
 *
 * Key behaviors:
 * - Auto-creates inspections on goods receipt and production completion
 *   when product.qcRequired is true
 * - Moves inventory to quarantine when inspection is required
 * - Auto-creates NCRs when inspections fail
 * - CAPA workflow for corrective/preventive actions
 * - Sampling procedures (fixed, percentage, AQL, skip-lot)
 */
@Injectable()
export class QualityService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly inventoryLedger: InventoryLedgerService,
    private readonly sequence: SequenceService,
  ) {}

  // ────────────────────────────────────────────────────────────────────────
  // Inspection Plans
  // ────────────────────────────────────────────────────────────────────────

  async createInspectionPlan(
    tenantId: string,
    data: {
      planNumber: string;
      name: string;
      productId?: string;
      inspectionType: QualityInspectionType;
      samplingProcedure?: SamplingProcedure;
      sampleSize?: number;
      samplePercentage?: number;
      aqlLevel?: string;
      effectiveFrom?: Date;
      effectiveTo?: Date;
      description?: string;
      createdById?: string;
      characteristics?: Array<{
        characteristicName: string;
        characteristicType?: CharacteristicType;
        uom?: string;
        lowerLimit?: number;
        upperLimit?: number;
        targetValue?: number;
        isCritical?: boolean;
        method?: string;
        equipment?: string;
      }>;
    },
  ) {
    return this.prisma.inspectionPlan.create({
      data: {
        tenantId,
        planNumber: data.planNumber,
        name: data.name,
        productId: data.productId,
        inspectionType: data.inspectionType,
        samplingProcedure: data.samplingProcedure ?? SamplingProcedure.FIXED,
        sampleSize: data.sampleSize,
        samplePercentage: data.samplePercentage ? new Decimal(data.samplePercentage) : undefined,
        aqlLevel: data.aqlLevel,
        effectiveFrom: data.effectiveFrom,
        effectiveTo: data.effectiveTo,
        description: data.description,
        createdById: data.createdById,
        characteristics: data.characteristics
          ? {
              create: data.characteristics.map((c, idx) => ({
                sequence: (idx + 1) * 10,
                characteristicName: c.characteristicName,
                characteristicType: c.characteristicType ?? CharacteristicType.QUANTITATIVE,
                uom: c.uom,
                lowerLimit: c.lowerLimit ? new Decimal(c.lowerLimit) : undefined,
                upperLimit: c.upperLimit ? new Decimal(c.upperLimit) : undefined,
                targetValue: c.targetValue ? new Decimal(c.targetValue) : undefined,
                isCritical: c.isCritical ?? false,
                method: c.method,
                equipment: c.equipment,
              })),
            }
          : undefined,
      },
      include: { characteristics: true },
    });
  }

  async getInspectionPlans(tenantId: string, filters?: { productId?: string; inspectionType?: QualityInspectionType; isActive?: boolean }) {
    return this.prisma.inspectionPlan.findMany({
      where: {
        tenantId,
        ...(filters?.productId && { productId: filters.productId }),
        ...(filters?.inspectionType && { inspectionType: filters.inspectionType }),
        ...(filters?.isActive !== undefined && { isActive: filters.isActive }),
      },
      include: { characteristics: { orderBy: { sequence: 'asc' } } },
      orderBy: { createdAt: 'desc' },
    });
  }

  async getInspectionPlan(tenantId: string, id: string) {
    return this.prisma.inspectionPlan.findFirstOrThrow({
      where: { id, tenantId },
      include: { characteristics: { orderBy: { sequence: 'asc' } } },
    });
  }

  /**
   * Find the applicable inspection plan for a product and inspection type.
   * Checks for product-specific plan first, then generic plan.
   */
  async resolveInspectionPlan(
    tenantId: string,
    productId: string,
    inspectionType: QualityInspectionType,
  ) {
    const now = new Date();
    // Product-specific plan first
    let plan = await this.prisma.inspectionPlan.findFirst({
      where: {
        tenantId,
        productId,
        inspectionType,
        isActive: true,
        OR: [
          { effectiveFrom: null },
          { effectiveFrom: { lte: now } },
        ],
        AND: [
          { OR: [{ effectiveTo: null }, { effectiveTo: { gte: now } }] },
        ],
      },
      include: { characteristics: { orderBy: { sequence: 'asc' } } },
      orderBy: { version: 'desc' },
    });

    // Fall back to generic plan (no product)
    if (!plan) {
      plan = await this.prisma.inspectionPlan.findFirst({
        where: {
          tenantId,
          productId: null,
          inspectionType,
          isActive: true,
        },
        include: { characteristics: { orderBy: { sequence: 'asc' } } },
        orderBy: { version: 'desc' },
      });
    }

    return plan;
  }

  // ────────────────────────────────────────────────────────────────────────
  // Quality Inspections
  // ────────────────────────────────────────────────────────────────────────

  /**
   * Auto-create an inspection triggered by goods receipt or production.
   * Applies sampling procedure from inspection plan.
   * Places inventory on quarantine hold if inspection is required.
   */
  async triggerInspection(
    tx: Prisma.TransactionClient,
    params: {
      tenantId: string;
      productId: string;
      locationId: string;
      inspectionType: QualityInspectionType;
      totalQty: Decimal | number;
      uom: string;
      workOrderId?: string;
      purchaseOrderId?: string;
      goodsReceiptId?: string;
      batchId?: string;
      inspectorId?: string;
      userId: string;
    },
  ): Promise<{ inspectionRequired: boolean; inspectionId?: string }> {
    // Check if product requires QC
    const product = await tx.product.findUniqueOrThrow({
      where: { id: params.productId },
    });

    if (!product.qcRequired) {
      return { inspectionRequired: false };
    }

    // Find applicable inspection plan
    const plan = await this.resolveInspectionPlan(
      params.tenantId,
      params.productId,
      params.inspectionType,
    );

    const totalQty = new Decimal(params.totalQty.toString());

    // Calculate sample size from plan
    const sampleSize = plan
      ? this.calculateSampleSize(plan, totalQty.toNumber())
      : totalQty.toNumber();

    // Generate inspection number via DB sequence (concurrency-safe)
    const inspectionNumber = await this.sequence.nextNumber(tx, 'QI');

    // Create inspection
    const inspection = await tx.qualityInspection.create({
      data: {
        tenantId: params.tenantId,
        inspectionNumber,
        productId: params.productId,
        locationId: params.locationId,
        inspectionType: params.inspectionType,
        status: QualityInspectionStatus.PENDING,
        inspectedQty: totalQty,
        workOrderId: params.workOrderId,
        purchaseOrderId: params.purchaseOrderId,
        goodsReceiptId: params.goodsReceiptId,
        inspectionPlanId: plan?.id,
        sampleSize,
        lotSize: totalQty.toNumber(),
        batchId: params.batchId,
        inspectorId: params.inspectorId,
      },
    });

    // Place inventory on quarantine hold
    await this.inventoryLedger.placeHold(tx, {
      tenantId: params.tenantId,
      productId: params.productId,
      locationId: params.locationId,
      batchId: params.batchId,
      quantity: totalQty,
      uom: params.uom,
      holdReason: 'QC_PENDING',
      inspectionId: inspection.id,
      placedById: params.userId,
      referenceType: 'QUALITY_INSPECTION',
      referenceId: inspection.id,
      notes: `Auto-hold for inspection ${inspectionNumber}`,
    });

    return { inspectionRequired: true, inspectionId: inspection.id };
  }

  /**
   * Record inspection results against plan characteristics.
   * Wrapped in a transaction for atomicity.
   */
  async recordInspectionResults(
    tenantId: string,
    inspectionId: string,
    results: Array<{
      characteristicId: string;
      measuredValue?: number;
      qualitativeResult?: string;
      inspectorId?: string;
      notes?: string;
    }>,
  ) {
    return this.prisma.$transaction(async (tx) => {
      const inspection = await tx.qualityInspection.findFirstOrThrow({
        where: { id: inspectionId, tenantId },
        include: {
          inspectionPlan: { include: { characteristics: true } },
        },
      });

      if (inspection.status !== QualityInspectionStatus.PENDING &&
          inspection.status !== QualityInspectionStatus.IN_PROGRESS) {
        throw new BadRequestException('Inspection is not in a recordable state');
      }

      // Update status to in-progress
      await tx.qualityInspection.update({
        where: { id: inspectionId },
        data: { status: QualityInspectionStatus.IN_PROGRESS },
      });

      // Record each result
      const resultRecords = [];
      for (const result of results) {
        // Find characteristic to check spec limits
        const characteristic = inspection.inspectionPlan?.characteristics.find(
          (c) => c.id === result.characteristicId,
        );

        let isWithinSpec = true;
        if (characteristic && result.measuredValue !== undefined) {
          const measured = new Decimal(result.measuredValue);
          if (characteristic.lowerLimit && measured.lt(characteristic.lowerLimit)) {
            isWithinSpec = false;
          }
          if (characteristic.upperLimit && measured.gt(characteristic.upperLimit)) {
            isWithinSpec = false;
          }
        }

        if (result.qualitativeResult === 'FAIL' || result.qualitativeResult === 'NOT_ACCEPTABLE') {
          isWithinSpec = false;
        }

        const record = await tx.inspectionResult.create({
          data: {
            inspectionId,
            characteristicId: result.characteristicId,
            measuredValue: result.measuredValue ? new Decimal(result.measuredValue) : undefined,
            qualitativeResult: result.qualitativeResult,
            isWithinSpec,
            inspectorId: result.inspectorId,
            notes: result.notes,
          },
        });
        resultRecords.push(record);
      }

      return resultRecords;
    });
  }

  /**
   * Complete an inspection — PASS or FAIL.
   * On FAIL: auto-creates NCR, keeps inventory on hold.
   * On PASS: releases quarantine hold, moves inventory to available.
   */
  async completeInspection(
    tenantId: string,
    inspectionId: string,
    params: {
      status: QualityInspectionStatus;
      acceptedQty: Decimal | number;
      rejectedQty: Decimal | number;
      defectType?: string;
      defectDescription?: string;
      notes?: string;
      userId: string;
    },
  ) {
    return this.prisma.$transaction(async (tx) => {
      const inspection = await tx.qualityInspection.findFirstOrThrow({
        where: { id: inspectionId, tenantId },
      });

      if (inspection.status === QualityInspectionStatus.PASSED ||
          inspection.status === QualityInspectionStatus.FAILED) {
        throw new BadRequestException('Inspection has already been completed');
      }

      const acceptedQty = new Decimal(params.acceptedQty.toString());
      const rejectedQty = new Decimal(params.rejectedQty.toString());

      // Validate: accepted + rejected must equal total inspected qty
      const totalInspected = acceptedQty.add(rejectedQty);
      if (!totalInspected.eq(inspection.inspectedQty)) {
        throw new BadRequestException(
          `accepted (${acceptedQty}) + rejected (${rejectedQty}) = ${totalInspected} ` +
          `must equal inspected qty (${inspection.inspectedQty})`,
        );
      }

      // Update inspection
      await tx.qualityInspection.update({
        where: { id: inspectionId },
        data: {
          status: params.status,
          acceptedQty,
          rejectedQty,
          defectType: params.defectType,
          defectDescription: params.defectDescription,
          completedDate: new Date(),
          notes: params.notes,
          results: {
            acceptedQty: acceptedQty.toString(),
            rejectedQty: rejectedQty.toString(),
          },
        },
      });

      // Find related holds
      const holds = await tx.inventoryHold.findMany({
        where: {
          inspectionId,
          status: 'ACTIVE',
        },
      });

      if (params.status === QualityInspectionStatus.PASSED ||
          params.status === QualityInspectionStatus.CONDITIONALLY_ACCEPTED) {
        // Release quarantine holds
        for (const hold of holds) {
          await this.inventoryLedger.releaseHold(tx, {
            holdId: hold.id,
            releasedById: params.userId,
            notes: `Released by inspection ${inspection.inspectionNumber} — ${params.status}`,
          });
        }
      } else if (params.status === QualityInspectionStatus.FAILED) {
        // Auto-create NCR — derive UOM from the product instead of hardcoding
        const product = await tx.product.findUnique({
          where: { id: inspection.productId },
          select: { unitOfMeasure: true },
        });
        const ncr = await this.createNCR(tx, {
          tenantId: inspection.tenantId,
          title: `Failed inspection: ${inspection.inspectionNumber}`,
          description: params.defectDescription ?? `Quality inspection ${inspection.inspectionNumber} failed. Defect type: ${params.defectType ?? 'unspecified'}`,
          ncrType: NCRType.NCR_PRODUCT,
          severity: NCRSeverity.NCR_MAJOR,
          sourceType: 'INSPECTION',
          sourceId: inspectionId,
          productId: inspection.productId,
          locationId: inspection.locationId ?? undefined,
          batchId: inspection.batchId ?? undefined,
          workOrderId: inspection.workOrderId ?? undefined,
          inspectionId,
          affectedQty: rejectedQty,
          uom: product?.unitOfMeasure ?? 'EA',
          reportedById: params.userId,
        });

        // Update goods receipt QC status if applicable
        if (inspection.goodsReceiptId) {
          await tx.goodsReceipt.update({
            where: { id: inspection.goodsReceiptId },
            data: { qcStatus: 'QC_FAILED' },
          });
        }

        return { inspection: { id: inspectionId, status: params.status }, ncr };
      }

      // Update goods receipt QC status if applicable
      if (inspection.goodsReceiptId) {
        await tx.goodsReceipt.update({
          where: { id: inspection.goodsReceiptId },
          data: { qcStatus: params.status === QualityInspectionStatus.PASSED ? 'QC_PASSED' : 'QC_CONDITIONAL' },
        });
      }

      return { inspection: { id: inspectionId, status: params.status }, ncr: null };
    });
  }

  // ────────────────────────────────────────────────────────────────────────
  // Non-Conformance Reports (NCR)
  // ────────────────────────────────────────────────────────────────────────

  async createNCR(
    tx: Prisma.TransactionClient,
    params: {
      tenantId: string;
      title: string;
      description: string;
      ncrType?: NCRType;
      severity?: NCRSeverity;
      sourceType?: string;
      sourceId?: string;
      productId?: string;
      locationId?: string;
      batchId?: string;
      workOrderId?: string;
      inspectionId?: string;
      affectedQty?: Decimal | number;
      uom?: string;
      reportedById: string;
      assignedToId?: string;
      dueDate?: Date;
    },
  ) {
    // Generate NCR number via DB sequence (concurrency-safe)
    const ncrNumber = await this.sequence.nextNumber(tx, 'NCR');

    return tx.nonConformanceReport.create({
      data: {
        tenantId: params.tenantId,
        ncrNumber,
        title: params.title,
        description: params.description,
        ncrType: params.ncrType ?? NCRType.NCR_PRODUCT,
        severity: params.severity ?? NCRSeverity.NCR_MINOR,
        status: NCRStatus.NCR_OPEN,
        sourceType: params.sourceType,
        sourceId: params.sourceId,
        productId: params.productId,
        locationId: params.locationId,
        batchId: params.batchId,
        workOrderId: params.workOrderId,
        inspectionId: params.inspectionId,
        affectedQty: params.affectedQty ? new Decimal(params.affectedQty.toString()) : undefined,
        uom: params.uom,
        reportedById: params.reportedById,
        assignedToId: params.assignedToId,
        dueDate: params.dueDate,
      },
    });
  }

  async getNCRs(tenantId: string, filters?: { status?: NCRStatus; productId?: string; workOrderId?: string }) {
    return this.prisma.nonConformanceReport.findMany({
      where: {
        tenantId,
        ...(filters?.status && { status: filters.status }),
        ...(filters?.productId && { productId: filters.productId }),
        ...(filters?.workOrderId && { workOrderId: filters.workOrderId }),
      },
      include: {
        product: true,
        inspection: true,
        reportedBy: { select: { id: true, firstName: true, lastName: true } },
        assignedTo: { select: { id: true, firstName: true, lastName: true } },
        correctiveActions: true,
      },
      orderBy: { createdAt: 'desc' },
    });
  }

  async getNCR(tenantId: string, id: string) {
    return this.prisma.nonConformanceReport.findFirstOrThrow({
      where: { id, tenantId },
      include: {
        product: true,
        location: true,
        batch: true,
        workOrder: true,
        inspection: true,
        reportedBy: { select: { id: true, firstName: true, lastName: true, email: true } },
        assignedTo: { select: { id: true, firstName: true, lastName: true, email: true } },
        closedBy: { select: { id: true, firstName: true, lastName: true, email: true } },
        correctiveActions: true,
      },
    });
  }

  async updateNCRStatus(
    tenantId: string,
    id: string,
    data: {
      status: NCRStatus;
      disposition?: NCRDisposition;
      dispositionQty?: number;
      rootCause?: string;
      containmentAction?: string;
      closedById?: string;
      costImpact?: number;
    },
  ) {
    const ncr = await this.prisma.nonConformanceReport.findFirstOrThrow({
      where: { id, tenantId },
      select: {
        id: true,
        status: true,
        affectedQty: true,
        closedAt: true,
      },
    });

    const ncrTransitions: Record<NCRStatus, NCRStatus[]> = {
      [NCRStatus.NCR_OPEN]: [NCRStatus.NCR_UNDER_REVIEW, NCRStatus.NCR_DISPOSITION_PENDING, NCRStatus.NCR_VOID],
      [NCRStatus.NCR_UNDER_REVIEW]: [NCRStatus.NCR_DISPOSITION_PENDING, NCRStatus.NCR_CORRECTIVE_ACTION, NCRStatus.NCR_VOID],
      [NCRStatus.NCR_DISPOSITION_PENDING]: [NCRStatus.NCR_CORRECTIVE_ACTION, NCRStatus.NCR_CLOSED, NCRStatus.NCR_VOID],
      [NCRStatus.NCR_CORRECTIVE_ACTION]: [NCRStatus.NCR_CLOSED, NCRStatus.NCR_VOID],
      [NCRStatus.NCR_CLOSED]: [],
      [NCRStatus.NCR_VOID]: [],
    };

    if (ncr.status !== data.status && !ncrTransitions[ncr.status].includes(data.status)) {
      throw new BadRequestException(`Invalid NCR status transition from ${ncr.status} to ${data.status}`);
    }

    if (data.dispositionQty !== undefined) {
      if (data.dispositionQty < 0) {
        throw new BadRequestException('Disposition quantity cannot be negative');
      }
      if (ncr.affectedQty && data.dispositionQty > ncr.affectedQty.toNumber()) {
        throw new BadRequestException('Disposition quantity cannot exceed affected quantity');
      }
    }

    if (data.costImpact !== undefined && data.costImpact < 0) {
      throw new BadRequestException('Cost impact cannot be negative');
    }

    if (data.status === NCRStatus.NCR_CLOSED) {
      if (!data.disposition) {
        throw new BadRequestException('Disposition is required before closing NCR');
      }
      if (!data.closedById) {
        throw new BadRequestException('Closed-by user is required before closing NCR');
      }
    }

    if (data.closedById) {
      const closedBy = await this.prisma.user.findFirst({
        where: { id: data.closedById, tenantId },
        select: { id: true },
      });
      if (!closedBy) {
        throw new BadRequestException('Invalid closed-by user for this tenant');
      }
    }

    return this.prisma.nonConformanceReport.update({
      where: { id },
      data: {
        status: data.status,
        disposition: data.disposition,
        dispositionQty: data.dispositionQty !== undefined ? new Decimal(data.dispositionQty) : undefined,
        rootCause: data.rootCause,
        containmentAction: data.containmentAction,
        closedById: data.closedById,
        closedAt: data.status === NCRStatus.NCR_CLOSED ? ncr.closedAt ?? new Date() : undefined,
        costImpact: data.costImpact !== undefined ? new Decimal(data.costImpact) : undefined,
      },
    });
  }

  // ────────────────────────────────────────────────────────────────────────
  // Corrective/Preventive Actions (CAPA)
  // ────────────────────────────────────────────────────────────────────────

  async createCAPA(
    tenantId: string,
    data: {
      title: string;
      description: string;
      capaType?: CAPAType;
      priority?: CAPAPriority;
      ncrId?: string;
      proposedAction: string;
      assignedToId?: string;
      dueDate: Date;
      createdById: string;
    },
  ) {
    // Wrap in $transaction so the sequence number is part of the same atomic unit
    return this.prisma.$transaction(async (tx) => {
      const createdBy = await tx.user.findFirst({
        where: { id: data.createdById, tenantId },
        select: { id: true },
      });
      if (!createdBy) {
        throw new BadRequestException('Invalid creator for this tenant');
      }

      if (data.assignedToId) {
        const assignedTo = await tx.user.findFirst({
          where: { id: data.assignedToId, tenantId },
          select: { id: true },
        });
        if (!assignedTo) {
          throw new BadRequestException('Assigned user does not belong to this tenant');
        }
      }

      if (data.ncrId) {
        const ncr = await tx.nonConformanceReport.findFirst({
          where: { id: data.ncrId, tenantId },
          select: { id: true, status: true },
        });
        if (!ncr) {
          throw new BadRequestException('NCR not found for this tenant');
        }
        if (ncr.status === NCRStatus.NCR_VOID) {
          throw new BadRequestException('Cannot create CAPA for a void NCR');
        }
      }

      const capaNumber = await this.sequence.nextNumber(tx, 'CAPA');

      return tx.correctiveAction.create({
        data: {
          tenantId,
          capaNumber,
          title: data.title,
          description: data.description,
          capaType: data.capaType ?? CAPAType.CORRECTIVE,
          status: CAPAStatus.CAPA_OPEN,
          priority: data.priority ?? CAPAPriority.CAPA_MEDIUM,
          ncrId: data.ncrId,
          proposedAction: data.proposedAction,
          assignedToId: data.assignedToId,
          dueDate: data.dueDate,
          createdById: data.createdById,
        },
      });
    });
  }

  async getCAPAs(tenantId: string, filters?: { status?: CAPAStatus; ncrId?: string }) {
    return this.prisma.correctiveAction.findMany({
      where: {
        tenantId,
        ...(filters?.status && { status: filters.status }),
        ...(filters?.ncrId && { ncrId: filters.ncrId }),
      },
      include: {
        ncr: { select: { id: true, ncrNumber: true, title: true } },
        assignedTo: { select: { id: true, firstName: true, lastName: true } },
        createdBy: { select: { id: true, firstName: true, lastName: true } },
      },
      orderBy: { createdAt: 'desc' },
    });
  }

  async getCAPA(tenantId: string, id: string) {
    return this.prisma.correctiveAction.findFirstOrThrow({
      where: { id, tenantId },
      include: {
        ncr: true,
        assignedTo: { select: { id: true, firstName: true, lastName: true, email: true } },
        verifiedBy: { select: { id: true, firstName: true, lastName: true, email: true } },
        createdBy: { select: { id: true, firstName: true, lastName: true, email: true } },
      },
    });
  }

  async updateCAPAStatus(
    tenantId: string,
    id: string,
    data: {
      status: CAPAStatus;
      actualAction?: string;
      verificationMethod?: string;
      verificationResult?: string;
      verifiedById?: string;
      completedDate?: Date;
      effectivenessCheck?: boolean;
      costOfAction?: number;
    },
  ) {
    const capa = await this.prisma.correctiveAction.findFirstOrThrow({
      where: { id, tenantId },
      select: {
        id: true,
        status: true,
        actualAction: true,
        verificationMethod: true,
        verificationResult: true,
        verifiedById: true,
      },
    });

    const capaTransitions: Record<CAPAStatus, CAPAStatus[]> = {
      [CAPAStatus.CAPA_OPEN]: [CAPAStatus.CAPA_IN_PROGRESS, CAPAStatus.CAPA_CANCELLED],
      [CAPAStatus.CAPA_IN_PROGRESS]: [CAPAStatus.CAPA_VERIFICATION, CAPAStatus.CAPA_CANCELLED],
      [CAPAStatus.CAPA_VERIFICATION]: [CAPAStatus.CAPA_CLOSED, CAPAStatus.CAPA_IN_PROGRESS, CAPAStatus.CAPA_CANCELLED],
      [CAPAStatus.CAPA_CLOSED]: [],
      [CAPAStatus.CAPA_CANCELLED]: [],
    };

    if (capa.status !== data.status && !capaTransitions[capa.status].includes(data.status)) {
      throw new BadRequestException(`Invalid CAPA status transition from ${capa.status} to ${data.status}`);
    }

    if (data.costOfAction !== undefined && data.costOfAction < 0) {
      throw new BadRequestException('Cost of action cannot be negative');
    }

    if (data.verifiedById) {
      const verifier = await this.prisma.user.findFirst({
        where: { id: data.verifiedById, tenantId },
        select: { id: true },
      });
      if (!verifier) {
        throw new BadRequestException('Verifier does not belong to this tenant');
      }
    }

    const actualAction = data.actualAction ?? capa.actualAction ?? undefined;
    const verificationMethod = data.verificationMethod ?? capa.verificationMethod ?? undefined;
    const verificationResult = data.verificationResult ?? capa.verificationResult ?? undefined;
    const verifiedById = data.verifiedById ?? capa.verifiedById ?? undefined;

    if (data.status === CAPAStatus.CAPA_VERIFICATION && !actualAction) {
      throw new BadRequestException('Actual action is required before CAPA enters verification');
    }

    if (data.status === CAPAStatus.CAPA_CLOSED) {
      if (!actualAction) {
        throw new BadRequestException('Actual action is required before closing CAPA');
      }
      if (!verificationMethod || !verificationResult) {
        throw new BadRequestException('Verification method and result are required before closing CAPA');
      }
      if (!verifiedById) {
        throw new BadRequestException('Verifier is required before closing CAPA');
      }
    }

    return this.prisma.correctiveAction.update({
      where: { id },
      data: {
        status: data.status,
        actualAction: data.actualAction,
        verificationMethod: data.verificationMethod,
        verificationResult: data.verificationResult,
        verifiedById: data.verifiedById,
        completedDate: data.status === CAPAStatus.CAPA_CLOSED ? data.completedDate ?? new Date() : data.completedDate,
        verifiedDate: data.status === CAPAStatus.CAPA_CLOSED && verifiedById ? new Date() : undefined,
        effectivenessCheck: data.effectivenessCheck,
        costOfAction: data.costOfAction !== undefined ? new Decimal(data.costOfAction) : undefined,
      },
    });
  }

  // ────────────────────────────────────────────────────────────────────────
  // Dashboard & Analytics
  // ────────────────────────────────────────────────────────────────────────

  async getQualityDashboard(tenantId: string) {
    const [
      openInspections,
      failedInspections,
      openNCRs,
      openCAPAs,
      overdueCAPAs,
    ] = await Promise.all([
      this.prisma.qualityInspection.count({
        where: { tenantId, status: { in: [QualityInspectionStatus.PENDING, QualityInspectionStatus.IN_PROGRESS] } },
      }),
      this.prisma.qualityInspection.count({
        where: { tenantId, status: QualityInspectionStatus.FAILED },
      }),
      this.prisma.nonConformanceReport.count({
        where: { tenantId, status: { in: [NCRStatus.NCR_OPEN, NCRStatus.NCR_UNDER_REVIEW, NCRStatus.NCR_DISPOSITION_PENDING] } },
      }),
      this.prisma.correctiveAction.count({
        where: { tenantId, status: { in: [CAPAStatus.CAPA_OPEN, CAPAStatus.CAPA_IN_PROGRESS] } },
      }),
      this.prisma.correctiveAction.count({
        where: { tenantId, status: { in: [CAPAStatus.CAPA_OPEN, CAPAStatus.CAPA_IN_PROGRESS] }, dueDate: { lt: new Date() } },
      }),
    ]);

    return {
      openInspections,
      failedInspections,
      openNCRs,
      openCAPAs,
      overdueCAPAs,
    };
  }

  // ────────────────────────────────────────────────────────────────────────
  // Private helpers
  // ────────────────────────────────────────────────────────────────────────

  private calculateSampleSize(
    plan: { samplingProcedure: SamplingProcedure; sampleSize: number | null; samplePercentage: Decimal | null },
    lotSize: number,
  ): number {
    switch (plan.samplingProcedure) {
      case SamplingProcedure.FIXED:
        return plan.sampleSize ?? lotSize;

      case SamplingProcedure.PERCENTAGE:
        const pct = plan.samplePercentage ? plan.samplePercentage.toNumber() / 100 : 1;
        return Math.max(1, Math.ceil(lotSize * pct));

      case SamplingProcedure.AQL:
        // Simplified AQL sampling - use standard lookup tables in production
        if (lotSize <= 25) return Math.min(5, lotSize);
        if (lotSize <= 150) return 20;
        if (lotSize <= 500) return 50;
        if (lotSize <= 1200) return 80;
        return 125;

      case SamplingProcedure.SKIP_LOT:
        // Skip-lot: inspect every Nth lot. Return 0 to skip.
        return 0;

      default:
        return lotSize;
    }
  }
}
