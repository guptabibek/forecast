import { Injectable, Logger } from '@nestjs/common';
import { AiLedgerType, AiPurchaseStatus, AiRefundKind, AiRefundStatus, Prisma } from '@prisma/client';
import { randomUUID } from 'crypto';
import { PrismaService } from '../../core/database/prisma.service';
import { BillingAuditService } from './billing-audit.service';
import { BillingNotFoundError, BillingValidationError } from './billing.errors';
import { StripeClient } from './stripe.client';
import { WalletService } from './wallet.service';

/**
 * Refunds — always super-admin approved, always ledgered.
 *  - WALLET_CREDIT: credits the wallet back (ledger REFUND, positive).
 *  - CASH: money returned to the card via Stripe; the wallet gives the
 *    credits back (ledger REFUND, negative) and the purchase is marked
 *    REFUNDED. Full and partial amounts supported.
 */
@Injectable()
export class RefundService {
  private readonly logger = new Logger(RefundService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly wallet: WalletService,
    private readonly stripe: StripeClient,
    private readonly audit: BillingAuditService,
  ) {}

  async list(filter: { tenantId?: string; page?: number; pageSize?: number }) {
    const page = Math.max(1, filter.page ?? 1);
    const pageSize = Math.min(200, Math.max(1, filter.pageSize ?? 50));
    const where = filter.tenantId ? { tenantId: filter.tenantId } : {};
    const [rows, total] = await Promise.all([
      this.prisma.aiRefund.findMany({ where, orderBy: { createdAt: 'desc' }, skip: (page - 1) * pageSize, take: pageSize }),
      this.prisma.aiRefund.count({ where }),
    ]);
    return { rows, total, page, pageSize };
  }

  async create(
    admin: { id: string; email?: string; role?: string; ip?: string },
    input: {
      tenantId: string;
      amount: number;
      kind: AiRefundKind;
      reason: string;
      purchaseId?: string;
      disputeId?: string;
      evidenceUrl?: string;
    },
  ) {
    if (!Number.isFinite(input.amount) || input.amount <= 0) {
      throw new BillingValidationError('Refund amount must be positive');
    }
    if (!input.reason?.trim()) throw new BillingValidationError('Refund reason is required');
    const wallet = await this.wallet.getOrCreateWallet(input.tenantId);
    const amount = new Prisma.Decimal(input.amount);

    let purchase = null;
    let fullyRefunded = false;
    if (input.purchaseId) {
      purchase = await this.prisma.aiCreditPurchase.findFirst({
        where: { id: input.purchaseId, tenantId: input.tenantId },
      });
      if (!purchase) throw new BillingNotFoundError('Related purchase not found');
      // Cap CUMULATIVE refunds at the original amount — several partial
      // refunds must never add up to more than was paid.
      const refundedSoFar = await this.prisma.aiRefund.aggregate({
        where: { purchaseId: purchase.id, status: { in: [AiRefundStatus.COMPLETED, AiRefundStatus.PENDING] } },
        _sum: { amount: true },
      });
      const alreadyRefunded = new Prisma.Decimal(refundedSoFar._sum.amount ?? 0);
      const remaining = new Prisma.Decimal(purchase.amount).minus(alreadyRefunded);
      if (amount.greaterThan(remaining)) {
        throw new BillingValidationError(
          `Refund exceeds the refundable remainder of this purchase (${remaining.toFixed(2)} of ${new Prisma.Decimal(purchase.amount).toFixed(2)} left)`,
        );
      }
      fullyRefunded = alreadyRefunded.plus(amount).greaterThanOrEqualTo(new Prisma.Decimal(purchase.amount));
    }
    if (input.kind === AiRefundKind.CASH && !purchase?.stripePaymentIntentId) {
      throw new BillingValidationError('Cash refunds require a Stripe purchase with a payment intent');
    }

    const refund = await this.prisma.aiRefund.create({
      data: {
        tenantId: input.tenantId,
        walletId: wallet.id,
        purchaseId: input.purchaseId ?? null,
        disputeId: input.disputeId ?? null,
        amount,
        kind: input.kind,
        reason: input.reason.slice(0, 1000),
        status: AiRefundStatus.PENDING,
        approvedById: admin.id,
        evidenceUrl: input.evidenceUrl?.slice(0, 1000) ?? null,
      },
    });

    try {
      let stripeRefundId: string | null = null;
      if (input.kind === AiRefundKind.CASH) {
        const result = await this.stripe.createRefund({
          paymentIntentId: purchase!.stripePaymentIntentId as string,
          amountCents: Math.round(input.amount * 100),
          idempotencyKey: `refund-${refund.id}`,
        });
        stripeRefundId = result.id;
      }

      const transaction = await this.wallet.postTransaction({
        tenantId: input.tenantId,
        type: AiLedgerType.REFUND,
        // WALLET_CREDIT gives credits back (+); CASH takes the refunded
        // credits out of the wallet because the money went back to the card.
        amount: input.kind === AiRefundKind.WALLET_CREDIT ? amount : amount.negated(),
        createdById: admin.id,
        notes: `Refund: ${input.reason.slice(0, 200)}`,
        relatedEntityType: 'ai_refund',
        relatedEntityId: refund.id,
        metadata: { kind: input.kind, disputeId: input.disputeId ?? null },
        // CASH refunds may legitimately overdraw an already-spent wallet —
        // that becomes a receivable visible in the ledger.
        allowNegativeBalance: input.kind === AiRefundKind.CASH,
      });

      const completed = await this.prisma.aiRefund.update({
        where: { id: refund.id },
        data: { status: AiRefundStatus.COMPLETED, stripeRefundId, transactionId: transaction.id },
      });
      // Only a FULL cumulative refund changes the purchase status — a partial
      // refund leaves the purchase COMPLETED (the ledger and refund rows
      // carry the partial-refund history).
      if (input.kind === AiRefundKind.CASH && input.purchaseId && fullyRefunded) {
        await this.prisma.aiCreditPurchase.update({
          where: { id: input.purchaseId },
          data: { status: AiPurchaseStatus.REFUNDED },
        });
      }
      await this.audit.record({
        actorId: admin.id, actorEmail: admin.email, actorRole: admin.role, ipAddress: admin.ip,
        tenantId: input.tenantId,
        action: 'REFUND_COMPLETED', entityType: 'ai_refund', entityId: refund.id,
        afterState: { amount: amount.toString(), kind: input.kind, stripeRefundId, transactionId: transaction.id },
        reason: input.reason,
      });
      return completed;
    } catch (error: any) {
      await this.prisma.aiRefund.update({ where: { id: refund.id }, data: { status: AiRefundStatus.FAILED } });
      await this.audit.record({
        actorId: admin.id, actorEmail: admin.email, actorRole: admin.role, ipAddress: admin.ip,
        tenantId: input.tenantId,
        action: 'REFUND_FAILED', entityType: 'ai_refund', entityId: refund.id,
        reason: String(error?.message ?? error).slice(0, 500),
      });
      throw error;
    }
  }
}
