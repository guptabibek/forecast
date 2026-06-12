import { Injectable, Logger } from '@nestjs/common';
import { AiLedgerType, AiReservationStatus, AiWalletStatus, Prisma } from '@prisma/client';
import { randomBytes } from 'crypto';
import { PrismaService } from '../../core/database/prisma.service';
import { BillingAuditService } from './billing-audit.service';
import {
  BillingNotFoundError,
  BillingValidationError,
  InsufficientCreditsError,
  WalletSuspendedError,
} from './billing.errors';

const D = (value: Prisma.Decimal | number | string): Prisma.Decimal => new Prisma.Decimal(value);
const ZERO = new Prisma.Decimal(0);

/** Reservations not finalized/released within this window are auto-expired. */
const RESERVATION_TTL_MS = 10 * 60 * 1000;

export interface PostTransactionInput {
  tenantId: string;
  type: AiLedgerType;
  /** Signed amount: credits positive, charges negative. */
  amount: Prisma.Decimal | number | string;
  createdById?: string | null;
  notes?: string | null;
  relatedEntityType?: string | null;
  relatedEntityId?: string | null;
  metadata?: Record<string, unknown>;
  /**
   * USAGE finalization may legally take the balance slightly below zero when
   * actual tokens exceed the reserved estimate. Everything else must keep the
   * balance non-negative.
   */
  allowNegativeBalance?: boolean;
}

type Tx = Prisma.TransactionClient;

/**
 * The ONLY writer of wallet balances. Every change happens inside a
 * row-locked database transaction together with an append-only ledger row
 * (before/after snapshots), so the books always reconcile:
 *
 *   wallet.balance === SUM(ledger.amount)   for every wallet, at all times.
 *
 * Nothing else in the codebase may update ai_wallets balance columns.
 */
@Injectable()
export class WalletService {
  private readonly logger = new Logger(WalletService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: BillingAuditService,
  ) {}

  async getOrCreateWallet(tenantId: string) {
    const existing = await this.prisma.aiWallet.findUnique({ where: { tenantId } });
    if (existing) return existing;
    try {
      return await this.prisma.aiWallet.create({ data: { tenantId } });
    } catch {
      // Concurrent first-touch — the unique constraint means it now exists.
      const wallet = await this.prisma.aiWallet.findUnique({ where: { tenantId } });
      if (!wallet) throw new BillingNotFoundError('Wallet could not be created');
      return wallet;
    }
  }

  /** Wallet + derived figures the dashboards need. */
  async getWalletSummary(tenantId: string) {
    const wallet = await this.getOrCreateWallet(tenantId);
    const available = D(wallet.balance).minus(D(wallet.reservedBalance));
    const low = wallet.lowBalanceThreshold !== null && available.lessThan(D(wallet.lowBalanceThreshold));
    const critical =
      wallet.criticalBalanceThreshold !== null && available.lessThan(D(wallet.criticalBalanceThreshold));
    return {
      ...wallet,
      availableBalance: available,
      balanceState: critical ? 'critical' : low ? 'low' : 'ok',
    };
  }

  /**
   * Post a ledger transaction and apply it to the wallet atomically.
   * Returns the created ledger row.
   */
  async postTransaction(input: PostTransactionInput, outerTx?: Tx) {
    const run = async (tx: Tx) => {
      const wallet = await this.lockWalletByTenant(tx, input.tenantId);
      return this.applyTransaction(tx, wallet, input);
    };
    if (outerTx) return run(outerTx);
    return this.prisma.$transaction(run, { isolationLevel: Prisma.TransactionIsolationLevel.ReadCommitted });
  }

  /**
   * Hold credits ahead of an AI request. Fails with 402 when the available
   * (unreserved) balance cannot cover the estimate — this is what prevents
   * concurrent requests from over-spending a wallet.
   */
  async reserveCredits(input: {
    tenantId: string;
    userId?: string | null;
    amount: Prisma.Decimal | number | string;
    requestId?: string | null;
  }) {
    const amount = D(input.amount);
    if (amount.lessThanOrEqualTo(ZERO)) throw new BillingValidationError('Reservation amount must be positive');

    return this.prisma.$transaction(async (tx) => {
      const wallet = await this.lockWalletByTenant(tx, input.tenantId);
      if (wallet.status === AiWalletStatus.SUSPENDED) throw new WalletSuspendedError();
      if (wallet.status === AiWalletStatus.CLOSED) throw new WalletSuspendedError('AI wallet is closed');

      const available = D(wallet.balance).minus(D(wallet.reservedBalance));
      if (available.lessThan(amount)) {
        throw new InsufficientCreditsError(
          `Insufficient AI credits: available ${available.toFixed(6)}, required ${amount.toFixed(6)}`,
        );
      }

      const reservation = await tx.aiCreditReservation.create({
        data: {
          walletId: wallet.id,
          tenantId: input.tenantId,
          userId: input.userId ?? null,
          amount,
          requestId: input.requestId ?? null,
          expiresAt: new Date(Date.now() + RESERVATION_TTL_MS),
        },
      });
      await tx.aiWallet.update({
        where: { id: wallet.id },
        data: { reservedBalance: D(wallet.reservedBalance).plus(amount), lastActivityAt: new Date() },
      });
      return reservation;
    }, { isolationLevel: Prisma.TransactionIsolationLevel.ReadCommitted });
  }

  /**
   * Settle a reservation with the ACTUAL charge (which may differ from the
   * estimate): releases the hold and posts the USAGE_CHARGE ledger entry in
   * one transaction. Returns the ledger row, or null for a zero charge.
   */
  async finalizeReservation(
    reservationId: string,
    actualCharge: Prisma.Decimal | number | string,
    context: { createdById?: string | null; requestId?: string | null; notes?: string | null; metadata?: Record<string, unknown> },
  ) {
    const charge = D(actualCharge);
    if (charge.isNegative()) throw new BillingValidationError('Usage charge cannot be negative');

    return this.prisma.$transaction(async (tx) => {
      const reservation = await this.lockReservation(tx, reservationId);
      if (reservation.status !== AiReservationStatus.ACTIVE) {
        throw new BillingValidationError(`Reservation is ${reservation.status}, not ACTIVE`);
      }
      const wallet = await this.lockWalletById(tx, reservation.walletId);

      await tx.aiWallet.update({
        where: { id: wallet.id },
        data: { reservedBalance: Prisma.Decimal.max(ZERO, D(wallet.reservedBalance).minus(D(reservation.amount))) },
      });
      await tx.aiCreditReservation.update({
        where: { id: reservation.id },
        data: { status: AiReservationStatus.FINALIZED, finalizedAt: new Date() },
      });

      if (charge.isZero()) return { reservation, transaction: null };

      // Re-read the wallet (reserved changed) for an exact before snapshot.
      const fresh = await tx.aiWallet.findUniqueOrThrow({ where: { id: wallet.id } });
      const transaction = await this.applyTransaction(tx, fresh, {
        tenantId: reservation.tenantId,
        type: AiLedgerType.USAGE_CHARGE,
        amount: charge.negated(),
        createdById: context.createdById ?? reservation.userId,
        notes: context.notes ?? null,
        relatedEntityType: 'ai_usage',
        relatedEntityId: context.requestId ?? reservation.requestId ?? reservation.id,
        metadata: context.metadata,
        // Actuals may exceed the reserve estimate; the request already ran.
        allowNegativeBalance: true,
      });
      return { reservation, transaction };
    }, { isolationLevel: Prisma.TransactionIsolationLevel.ReadCommitted });
  }

  /** Release a hold without charging (failed/aborted AI request). */
  async releaseReservation(reservationId: string, status: AiReservationStatus = AiReservationStatus.RELEASED) {
    return this.prisma.$transaction(async (tx) => {
      const reservation = await this.lockReservation(tx, reservationId);
      if (reservation.status !== AiReservationStatus.ACTIVE) return reservation;
      const wallet = await this.lockWalletById(tx, reservation.walletId);
      await tx.aiWallet.update({
        where: { id: wallet.id },
        data: { reservedBalance: Prisma.Decimal.max(ZERO, D(wallet.reservedBalance).minus(D(reservation.amount))) },
      });
      return tx.aiCreditReservation.update({
        where: { id: reservation.id },
        data: { status, finalizedAt: new Date() },
      });
    }, { isolationLevel: Prisma.TransactionIsolationLevel.ReadCommitted });
  }

  /** Cron sweep: release reservations whose caller died mid-flight. */
  async expireStaleReservations(): Promise<number> {
    const stale = await this.prisma.aiCreditReservation.findMany({
      where: { status: AiReservationStatus.ACTIVE, expiresAt: { lt: new Date() } },
      select: { id: true },
      take: 200,
    });
    for (const row of stale) {
      try {
        await this.releaseReservation(row.id, AiReservationStatus.EXPIRED);
      } catch (error: any) {
        this.logger.warn(`Failed to expire reservation ${row.id}: ${String(error?.message ?? error)}`);
      }
    }
    if (stale.length) this.logger.log(`Expired ${stale.length} stale AI credit reservations`);
    return stale.length;
  }

  async listTransactions(filter: {
    tenantId?: string;
    type?: AiLedgerType;
    page?: number;
    pageSize?: number;
  }) {
    const page = Math.max(1, filter.page ?? 1);
    const pageSize = Math.min(200, Math.max(1, filter.pageSize ?? 50));
    const where = {
      ...(filter.tenantId ? { tenantId: filter.tenantId } : {}),
      ...(filter.type ? { type: filter.type } : {}),
    };
    const [rows, total] = await Promise.all([
      this.prisma.aiWalletTransaction.findMany({
        where,
        orderBy: { createdAt: 'desc' },
        skip: (page - 1) * pageSize,
        take: pageSize,
      }),
      this.prisma.aiWalletTransaction.count({ where }),
    ]);
    return { rows, total, page, pageSize };
  }

  async updateWalletSettings(
    tenantId: string,
    settings: {
      status?: AiWalletStatus;
      lowBalanceThreshold?: number | null;
      criticalBalanceThreshold?: number | null;
      suspendThreshold?: number | null;
      autoRechargeEnabled?: boolean;
      autoRechargeThreshold?: number | null;
      autoRechargeAmount?: number | null;
      autoRechargeMonthlyLimit?: number | null;
    },
    actor: { id?: string; email?: string; role?: string; ip?: string },
  ) {
    const wallet = await this.getOrCreateWallet(tenantId);
    const updated = await this.prisma.aiWallet.update({
      where: { id: wallet.id },
      data: {
        ...(settings.status !== undefined ? { status: settings.status } : {}),
        ...(settings.lowBalanceThreshold !== undefined ? { lowBalanceThreshold: settings.lowBalanceThreshold } : {}),
        ...(settings.criticalBalanceThreshold !== undefined
          ? { criticalBalanceThreshold: settings.criticalBalanceThreshold }
          : {}),
        ...(settings.suspendThreshold !== undefined ? { suspendThreshold: settings.suspendThreshold } : {}),
        ...(settings.autoRechargeEnabled !== undefined ? { autoRechargeEnabled: settings.autoRechargeEnabled } : {}),
        ...(settings.autoRechargeThreshold !== undefined ? { autoRechargeThreshold: settings.autoRechargeThreshold } : {}),
        ...(settings.autoRechargeAmount !== undefined ? { autoRechargeAmount: settings.autoRechargeAmount } : {}),
        ...(settings.autoRechargeMonthlyLimit !== undefined
          ? { autoRechargeMonthlyLimit: settings.autoRechargeMonthlyLimit }
          : {}),
      },
    });
    await this.audit.record({
      actorId: actor.id,
      actorEmail: actor.email,
      actorRole: actor.role,
      tenantId,
      action: 'WALLET_SETTINGS_UPDATED',
      entityType: 'ai_wallet',
      entityId: wallet.id,
      beforeState: wallet,
      afterState: updated,
      ipAddress: actor.ip,
    });
    return updated;
  }

  // ── internals ──────────────────────────────────────────────────────────────

  /**
   * Apply a ledger entry to an already-locked wallet row. Computes the
   * before/after snapshot, enforces the non-negative invariant, mirrors the
   * amount into the lifetime aggregate for its type, and auto-suspends when
   * the configured suspension threshold is crossed.
   */
  private async applyTransaction(
    tx: Tx,
    wallet: { id: string; tenantId: string; balance: Prisma.Decimal; status: AiWalletStatus; suspendThreshold: Prisma.Decimal | null; totalPurchased: Prisma.Decimal; totalConsumed: Prisma.Decimal; totalRefunded: Prisma.Decimal; totalAdjusted: Prisma.Decimal },
    input: PostTransactionInput,
  ) {
    const amount = D(input.amount);
    if (amount.isZero()) throw new BillingValidationError('Ledger amount cannot be zero');
    if (wallet.status === AiWalletStatus.CLOSED) throw new WalletSuspendedError('AI wallet is closed');

    const balanceBefore = D(wallet.balance);
    const balanceAfter = balanceBefore.plus(amount);
    if (balanceAfter.isNegative() && !input.allowNegativeBalance) {
      throw new InsufficientCreditsError(
        `Transaction would overdraw the wallet (balance ${balanceBefore.toFixed(6)}, amount ${amount.toFixed(6)})`,
      );
    }

    const transaction = await tx.aiWalletTransaction.create({
      data: {
        walletId: wallet.id,
        tenantId: input.tenantId,
        type: input.type,
        amount,
        balanceBefore,
        balanceAfter,
        referenceNo: this.newReferenceNo(),
        relatedEntityType: input.relatedEntityType ?? null,
        relatedEntityId: input.relatedEntityId ?? null,
        createdById: input.createdById ?? null,
        notes: input.notes?.slice(0, 1000) ?? null,
        metadata: (input.metadata ?? {}) as Prisma.InputJsonValue,
      },
    });

    const aggregates = this.aggregateDelta(input.type, amount, wallet);
    const shouldSuspend =
      wallet.suspendThreshold !== null &&
      balanceAfter.lessThan(D(wallet.suspendThreshold)) &&
      wallet.status === AiWalletStatus.ACTIVE;

    await tx.aiWallet.update({
      where: { id: wallet.id },
      data: {
        balance: balanceAfter,
        ...aggregates,
        ...(shouldSuspend ? { status: AiWalletStatus.SUSPENDED } : {}),
        lastActivityAt: new Date(),
      },
    });
    if (shouldSuspend) {
      await this.audit.recordIn(tx as unknown as Pick<PrismaService, 'aiBillingAuditLog'>, {
        tenantId: input.tenantId,
        action: 'WALLET_AUTO_SUSPENDED',
        entityType: 'ai_wallet',
        entityId: wallet.id,
        afterState: { balance: balanceAfter.toString(), suspendThreshold: wallet.suspendThreshold?.toString() },
        reason: 'Balance fell below the configured suspension threshold',
      });
    }
    return transaction;
  }

  private aggregateDelta(
    type: AiLedgerType,
    amount: Prisma.Decimal,
    wallet: { totalPurchased: Prisma.Decimal; totalConsumed: Prisma.Decimal; totalRefunded: Prisma.Decimal; totalAdjusted: Prisma.Decimal },
  ) {
    switch (type) {
      case AiLedgerType.PURCHASE:
        return { totalPurchased: D(wallet.totalPurchased).plus(amount.abs()) };
      case AiLedgerType.USAGE_CHARGE:
        return { totalConsumed: D(wallet.totalConsumed).plus(amount.abs()) };
      case AiLedgerType.REFUND:
        return { totalRefunded: D(wallet.totalRefunded).plus(amount.abs()) };
      default:
        return { totalAdjusted: D(wallet.totalAdjusted).plus(amount) };
    }
  }

  private async lockWalletByTenant(tx: Tx, tenantId: string) {
    // Ensure the row exists before locking (first-touch wallets).
    const wallet = await tx.aiWallet.findUnique({ where: { tenantId } });
    if (!wallet) {
      return tx.aiWallet.create({ data: { tenantId } });
    }
    await tx.$queryRaw`SELECT id FROM ai_wallets WHERE id = ${wallet.id}::uuid FOR UPDATE`;
    return tx.aiWallet.findUniqueOrThrow({ where: { id: wallet.id } });
  }

  private async lockWalletById(tx: Tx, walletId: string) {
    await tx.$queryRaw`SELECT id FROM ai_wallets WHERE id = ${walletId}::uuid FOR UPDATE`;
    return tx.aiWallet.findUniqueOrThrow({ where: { id: walletId } });
  }

  private async lockReservation(tx: Tx, reservationId: string) {
    const rows = await tx.$queryRaw<Array<{ id: string }>>`
      SELECT id FROM ai_credit_reservations WHERE id = ${reservationId}::uuid FOR UPDATE`;
    if (!rows.length) throw new BillingNotFoundError('Reservation not found');
    return tx.aiCreditReservation.findUniqueOrThrow({ where: { id: reservationId } });
  }

  private newReferenceNo(): string {
    return `TXN-${Date.now().toString(36).toUpperCase()}-${randomBytes(4).toString('hex').toUpperCase()}`;
  }
}
