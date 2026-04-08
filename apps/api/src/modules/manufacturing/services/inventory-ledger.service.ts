import { BadRequestException, ConflictException, Injectable } from '@nestjs/common';
import { InventoryStatus, LedgerEntryType, Prisma } from '@prisma/client';
import { Decimal } from '@prisma/client/runtime/library';
import { PrismaService } from '../../../core/database/prisma.service';
import { SequenceService } from './sequence.service';

/**
 * InventoryLedgerService — Append-only inventory ledger engine.
 *
 * All inventory movements are recorded as immutable ledger entries.
 * On-hand balances are derived by summing ledger entries, not by
 * direct mutation. InventoryLevel is updated as a materialized view
 * for fast reads, but the ledger is the source of truth.
 *
 * Concurrency safety: Uses SELECT ... FOR UPDATE on InventoryLevel
 * rows to serialize concurrent writes per (product, location).
 */
@Injectable()
export class InventoryLedgerService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly sequence: SequenceService,
  ) {}

  /**
   * Record an inventory movement in the append-only ledger.
   * This is the ONLY way inventory balances should change.
   *
   * @param tx - Prisma transaction client (caller must wrap in $transaction)
   * @param params - Ledger entry parameters
   * @returns Created ledger entry
   */
  async recordEntry(
    tx: Prisma.TransactionClient,
    params: {
      tenantId: string;
      productId: string;
      locationId: string;
      batchId?: string;
      entryType: LedgerEntryType;
      quantity: Decimal | number;
      uom: string;
      unitCost?: Decimal | number;
      referenceType?: string;
      referenceId?: string;
      referenceNumber?: string;
      lotNumber?: string;
      inventoryStatus?: InventoryStatus;
      journalEntryId?: string;
      createdById?: string;
      notes?: string;
    },
  ) {
    const qty = new Decimal(params.quantity.toString());
    const cost = new Decimal((params.unitCost ?? 0).toString());
    const totalCost = qty.abs().mul(cost);

    // Lock the inventory level row for this product+location
    const levelRows = await tx.$queryRaw<Array<{
      id: string;
      on_hand_qty: string;
      reserved_qty: string;
      quarantine_qty: string;
      allocated_qty: string;
      version: number;
    }>>(Prisma.sql`
      SELECT id, on_hand_qty, reserved_qty, quarantine_qty, allocated_qty, version
      FROM inventory_levels
      WHERE tenant_id = ${params.tenantId} AND product_id = ${params.productId} AND location_id = ${params.locationId}
      FOR UPDATE
    `,
    );

    let currentOnHand = new Decimal(0);
    let currentReserved = new Decimal(0);
    let currentQuarantine = new Decimal(0);
    let levelId: string | null = null;
    let currentVersion = 1;

    if (levelRows.length > 0) {
      const row = levelRows[0];
      levelId = row.id;
      currentOnHand = new Decimal(row.on_hand_qty);
      currentReserved = new Decimal(row.reserved_qty);
      currentQuarantine = new Decimal(row.quarantine_qty);
      currentVersion = row.version;
    }

    // Calculate new balances based on entry type
    const { onHandDelta, reservedDelta, quarantineDelta } =
      this.calculateDeltas(params.entryType, qty);

    const newOnHand = currentOnHand.add(onHandDelta);
    const newReserved = currentReserved.add(reservedDelta);
    const newQuarantine = currentQuarantine.add(quarantineDelta);
    const newAvailable = newOnHand.sub(newReserved).sub(newQuarantine);

    // Validate: on-hand cannot go negative (except for specific adjustments)
    if (newOnHand.isNegative() && !this.isNegativeAllowed(params.entryType)) {
      throw new BadRequestException(
        `Insufficient on-hand quantity. Current: ${currentOnHand}, Requested: ${qty.abs()}, Product: ${params.productId}`,
      );
    }

    // Create the immutable ledger entry
    const ledgerEntry = await tx.inventoryLedger.create({
      data: {
        tenantId: params.tenantId,
        productId: params.productId,
        locationId: params.locationId,
        batchId: params.batchId,
        entryType: params.entryType,
        quantity: qty,
        uom: params.uom,
        unitCost: cost,
        totalCost,
        referenceType: params.referenceType,
        referenceId: params.referenceId,
        referenceNumber: params.referenceNumber,
        lotNumber: params.lotNumber,
        inventoryStatus: params.inventoryStatus ?? InventoryStatus.INV_AVAILABLE,
        runningBalance: newOnHand,
        journalEntryId: params.journalEntryId,
        createdById: params.createdById,
        notes: params.notes,
      },
    });

    // Upsert materialized balance (InventoryLevel) with optimistic lock check
    if (levelId) {
      const affected = await tx.$executeRaw(Prisma.sql`
        UPDATE inventory_levels SET
          on_hand_qty = ${newOnHand.toString()},
          reserved_qty = ${newReserved.toString()},
          quarantine_qty = ${newQuarantine.toString()},
          available_qty = ${newAvailable.toString()},
          version = version + 1,
          updated_at = NOW()
        WHERE id = ${levelId} AND version = ${currentVersion}
      `,
      );
      if (affected === 0) {
        throw new ConflictException(
          `Optimistic lock conflict on InventoryLevel for product ${params.productId}. Another transaction modified this row. Retry the operation.`,
        );
      }
    } else {
      await tx.inventoryLevel.create({
        data: {
          tenantId: params.tenantId,
          productId: params.productId,
          locationId: params.locationId,
          onHandQty: newOnHand,
          reservedQty: newReserved,
          quarantineQty: newQuarantine,
          availableQty: newAvailable,
          version: 1,
        },
      });
    }

    // Update batch quantities if batch-tracked
    if (params.batchId && !onHandDelta.isZero()) {
      await tx.batch.update({
        where: { id: params.batchId },
        data: {
          quantity: { increment: onHandDelta },
          availableQty: { increment: onHandDelta.sub(reservedDelta) },
        },
      });
    }

    return ledgerEntry;
  }

  /**
   * Create a concurrency-safe inventory reservation.
   * Reserves stock by moving it from available to reserved status.
   */
  async createReservation(
    tx: Prisma.TransactionClient,
    params: {
      tenantId: string;
      productId: string;
      locationId: string;
      batchId?: string;
      quantity: Decimal | number;
      uom: string;
      referenceType: string;
      referenceId: string;
      referenceNumber?: string;
      reservedById: string;
      requiredDate?: Date;
      notes?: string;
    },
  ) {
    const qty = new Decimal(params.quantity.toString());

    // Check available quantity under lock
    const levelRows = await tx.$queryRaw<Array<{
      available_qty: string;
    }>>(Prisma.sql`
      SELECT available_qty FROM inventory_levels
      WHERE tenant_id = ${params.tenantId} AND product_id = ${params.productId} AND location_id = ${params.locationId}
      FOR UPDATE
    `,
    );

    const available = levelRows.length > 0
      ? new Decimal(levelRows[0].available_qty)
      : new Decimal(0);

    if (available.lt(qty)) {
      throw new ConflictException(
        `Insufficient available quantity for reservation. Available: ${available}, Requested: ${qty}`,
      );
    }

    // Generate reservation number via DB sequence (concurrency-safe)
    const reservationNumber = await this.sequence.nextNumber(tx, 'RSV');

    // Create reservation record
    const reservation = await tx.inventoryReservation.create({
      data: {
        tenantId: params.tenantId,
        reservationNumber,
        productId: params.productId,
        locationId: params.locationId,
        batchId: params.batchId,
        reservedQty: qty,
        uom: params.uom,
        status: 'ACTIVE',
        referenceType: params.referenceType,
        referenceId: params.referenceId,
        referenceNumber: params.referenceNumber,
        reservedById: params.reservedById,
        requiredDate: params.requiredDate,
        notes: params.notes,
      },
    });

    // Record ledger entry for reservation
    await this.recordEntry(tx, {
      tenantId: params.tenantId,
      productId: params.productId,
      locationId: params.locationId,
      batchId: params.batchId,
      entryType: LedgerEntryType.LEDGER_RESERVATION,
      quantity: qty,
      uom: params.uom,
      inventoryStatus: InventoryStatus.INV_RESERVED,
      referenceType: params.referenceType,
      referenceId: params.referenceId,
      referenceNumber: reservationNumber,
      createdById: params.reservedById,
      notes: params.notes,
    });

    return reservation;
  }

  /**
   * Release (cancel or fulfill) a reservation.
   */
  async releaseReservation(
    tx: Prisma.TransactionClient,
    params: {
      reservationId: string;
      tenantId?: string;
      releasedById: string;
      fulfilledQty?: Decimal | number;
    },
  ) {
    const reservation = await tx.inventoryReservation.findUniqueOrThrow({
      where: { id: params.reservationId },
    });

    // Tenant isolation: prevent cross-tenant reservation release
    if (params.tenantId && reservation.tenantId !== params.tenantId) {
      throw new BadRequestException('Reservation not found');
    }

    if (reservation.status !== 'ACTIVE') {
      throw new BadRequestException('Reservation is not active');
    }

    const releaseQty = params.fulfilledQty
      ? new Decimal(params.fulfilledQty.toString())
      : reservation.reservedQty;

    await tx.inventoryReservation.update({
      where: { id: params.reservationId },
      data: {
        status: 'RELEASED',
        fulfilledQty: releaseQty,
        releasedById: params.releasedById,
        releasedAt: new Date(),
      },
    });

    // Record ledger entry for unreservation — use releaseQty, NOT full reservedQty
    await this.recordEntry(tx, {
      tenantId: reservation.tenantId,
      productId: reservation.productId,
      locationId: reservation.locationId,
      batchId: reservation.batchId ?? undefined,
      entryType: LedgerEntryType.LEDGER_UNRESERVATION,
      quantity: releaseQty,
      uom: reservation.uom,
      inventoryStatus: InventoryStatus.INV_AVAILABLE,
      referenceType: reservation.referenceType,
      referenceId: reservation.referenceId,
      referenceNumber: reservation.reservationNumber,
      createdById: params.releasedById,
    });
  }

  /**
   * Place inventory on hold (quarantine).
   */
  async placeHold(
    tx: Prisma.TransactionClient,
    params: {
      tenantId: string;
      productId: string;
      locationId: string;
      batchId?: string;
      quantity: Decimal | number;
      uom: string;
      holdReason: string;
      inspectionId?: string;
      placedById: string;
      referenceType?: string;
      referenceId?: string;
      notes?: string;
    },
  ) {
    const qty = new Decimal(params.quantity.toString());

    // Generate hold number via DB sequence (concurrency-safe)
    const holdNumber = await this.sequence.nextNumber(tx, 'HLD');

    const hold = await tx.inventoryHold.create({
      data: {
        tenantId: params.tenantId,
        holdNumber,
        productId: params.productId,
        locationId: params.locationId,
        batchId: params.batchId,
        heldQty: qty,
        uom: params.uom,
        holdReason: params.holdReason,
        status: 'ACTIVE',
        inspectionId: params.inspectionId,
        placedById: params.placedById,
        referenceType: params.referenceType,
        referenceId: params.referenceId,
        notes: params.notes,
      },
    });

    // Record ledger entry for hold
    await this.recordEntry(tx, {
      tenantId: params.tenantId,
      productId: params.productId,
      locationId: params.locationId,
      batchId: params.batchId,
      entryType: LedgerEntryType.LEDGER_HOLD,
      quantity: qty,
      uom: params.uom,
      inventoryStatus: InventoryStatus.INV_QUARANTINE,
      referenceType: 'HOLD',
      referenceId: hold.id,
      referenceNumber: holdNumber,
      createdById: params.placedById,
      notes: params.notes,
    });

    return hold;
  }

  /**
   * Release a hold — moves quantity from quarantine back to available.
   */
  async releaseHold(
    tx: Prisma.TransactionClient,
    params: {
      holdId: string;
      tenantId?: string;
      releasedById: string;
      releasedQty?: Decimal | number;
      notes?: string;
    },
  ) {
    const hold = await tx.inventoryHold.findUniqueOrThrow({
      where: { id: params.holdId },
    });

    // Tenant isolation: prevent cross-tenant hold release
    if (params.tenantId && hold.tenantId !== params.tenantId) {
      throw new BadRequestException('Hold not found');
    }

    if (hold.status !== 'ACTIVE') {
      throw new BadRequestException('Hold is not active');
    }

    const releaseQty = params.releasedQty
      ? new Decimal(params.releasedQty.toString())
      : hold.heldQty;

    const isPartialRelease = releaseQty.lt(hold.heldQty);

    if (isPartialRelease) {
      // Partial release: decrement held quantity but keep status ACTIVE
      await tx.inventoryHold.update({
        where: { id: params.holdId },
        data: {
          heldQty: hold.heldQty.sub(releaseQty),
          releasedQty: (hold.releasedQty ?? new Decimal(0)).add(releaseQty),
          notes: params.notes ?? hold.notes,
        },
      });
    } else {
      // Full release
      await tx.inventoryHold.update({
        where: { id: params.holdId },
        data: {
          status: 'RELEASED',
          releasedQty: releaseQty,
          releasedById: params.releasedById,
          releasedAt: new Date(),
          notes: params.notes ?? hold.notes,
        },
      });
    }

    await this.recordEntry(tx, {
      tenantId: hold.tenantId,
      productId: hold.productId,
      locationId: hold.locationId,
      batchId: hold.batchId ?? undefined,
      entryType: LedgerEntryType.LEDGER_RELEASE,
      quantity: releaseQty,
      uom: hold.uom,
      inventoryStatus: InventoryStatus.INV_AVAILABLE,
      referenceType: 'HOLD',
      referenceId: hold.id,
      referenceNumber: hold.holdNumber,
      createdById: params.releasedById,
      notes: params.notes,
    });
  }

  /**
   * Get current balance for a product+location from the materialized view,
   * or compute from ledger if desired (reconciliation).
   */
  async getBalance(
    tenantId: string,
    productId: string,
    locationId: string,
  ) {
    return this.prisma.inventoryLevel.findUnique({
      where: {
        tenantId_productId_locationId: {
          tenantId,
          productId,
          locationId,
        },
      },
    });
  }

  /**
   * Reconcile materialized balance against ledger sum.
   * Returns discrepancy if any.
   */
  async reconcileBalance(
    tenantId: string,
    productId: string,
    locationId: string,
  ) {
    // Sum ALL ledger entries by type to get true on-hand balance.
    // Receipt types are positive, issue types are negative.
    // Do NOT filter by inventory_status — that omits reservation/hold entries.
    const ledgerSum = await this.prisma.$queryRaw<Array<{
      total_qty: string;
    }>>(Prisma.sql`
      SELECT COALESCE(SUM(
        CASE
          WHEN entry_type IN ('LEDGER_RECEIPT','LEDGER_PRODUCTION_RECEIPT','LEDGER_RETURN','LEDGER_TRANSFER_IN') THEN ABS(quantity)
          WHEN entry_type IN ('LEDGER_ISSUE','LEDGER_PRODUCTION_ISSUE','LEDGER_SCRAP','LEDGER_TRANSFER_OUT') THEN -ABS(quantity)
          WHEN entry_type = 'LEDGER_ADJUSTMENT' THEN quantity
          ELSE 0
        END
      ), 0) as total_qty
      FROM inventory_ledger
      WHERE tenant_id = ${tenantId} AND product_id = ${productId} AND location_id = ${locationId}
    `,
    );

    const materializedLevel = await this.getBalance(tenantId, productId, locationId);
    const ledgerBalance = new Decimal(ledgerSum[0]?.total_qty ?? '0');
    const materializedBalance = materializedLevel?.onHandQty ?? new Decimal(0);
    const discrepancy = ledgerBalance.sub(materializedBalance);

    return {
      ledgerBalance,
      materializedBalance,
      discrepancy,
      isConsistent: discrepancy.isZero(),
    };
  }

  /**
   * Get ledger entries for a product+location, with pagination.
   */
  async getLedgerEntries(
    tenantId: string,
    filters: {
      productId?: string;
      locationId?: string;
      batchId?: string;
      entryType?: LedgerEntryType;
      referenceType?: string;
      referenceId?: string;
      fromDate?: Date;
      toDate?: Date;
    },
    pagination: { skip?: number; take?: number } = {},
  ) {
    const where: Prisma.InventoryLedgerWhereInput = {
      tenantId,
      ...(filters.productId && { productId: filters.productId }),
      ...(filters.locationId && { locationId: filters.locationId }),
      ...(filters.batchId && { batchId: filters.batchId }),
      ...(filters.entryType && { entryType: filters.entryType }),
      ...(filters.referenceType && { referenceType: filters.referenceType }),
      ...(filters.referenceId && { referenceId: filters.referenceId }),
      ...((filters.fromDate || filters.toDate) && {
        transactionDate: {
          ...(filters.fromDate && { gte: filters.fromDate }),
          ...(filters.toDate && { lte: filters.toDate }),
        },
      }),
    };

    const [entries, total] = await Promise.all([
      this.prisma.inventoryLedger.findMany({
        where,
        orderBy: { sequenceNumber: 'desc' },
        skip: pagination.skip ?? 0,
        take: pagination.take ?? 50,
      }),
      this.prisma.inventoryLedger.count({ where }),
    ]);

    return { entries, total };
  }

  // ────────────────────────────────────────────────────────────────────────
  // Private helpers
  // ────────────────────────────────────────────────────────────────────────

  private calculateDeltas(
    entryType: LedgerEntryType,
    quantity: Decimal,
  ): {
    onHandDelta: Decimal;
    reservedDelta: Decimal;
    quarantineDelta: Decimal;
  } {
    const zero = new Decimal(0);
    const absQty = quantity.abs();

    switch (entryType) {
      case LedgerEntryType.LEDGER_RECEIPT:
      case LedgerEntryType.LEDGER_PRODUCTION_RECEIPT:
      case LedgerEntryType.LEDGER_RETURN:
      case LedgerEntryType.LEDGER_TRANSFER_IN:
        return { onHandDelta: absQty, reservedDelta: zero, quarantineDelta: zero };

      case LedgerEntryType.LEDGER_ISSUE:
      case LedgerEntryType.LEDGER_PRODUCTION_ISSUE:
      case LedgerEntryType.LEDGER_SCRAP:
      case LedgerEntryType.LEDGER_TRANSFER_OUT:
        return { onHandDelta: absQty.neg(), reservedDelta: zero, quarantineDelta: zero };

      case LedgerEntryType.LEDGER_ADJUSTMENT:
        // quantity can be positive (in) or negative (out)
        return { onHandDelta: quantity, reservedDelta: zero, quarantineDelta: zero };

      case LedgerEntryType.LEDGER_RESERVATION:
        // Reservation doesn't change on-hand, it moves to reserved
        return { onHandDelta: zero, reservedDelta: absQty, quarantineDelta: zero };

      case LedgerEntryType.LEDGER_UNRESERVATION:
        // Unreservation releases reserved back to available
        return { onHandDelta: zero, reservedDelta: absQty.neg(), quarantineDelta: zero };

      case LedgerEntryType.LEDGER_HOLD:
        // Hold moves to quarantine
        return { onHandDelta: zero, reservedDelta: zero, quarantineDelta: absQty };

      case LedgerEntryType.LEDGER_RELEASE:
        // Release from quarantine
        return { onHandDelta: zero, reservedDelta: zero, quarantineDelta: absQty.neg() };

      default:
        return { onHandDelta: zero, reservedDelta: zero, quarantineDelta: zero };
    }
  }

  private isNegativeAllowed(entryType: LedgerEntryType): boolean {
    return entryType === LedgerEntryType.LEDGER_ADJUSTMENT;
  }
}
