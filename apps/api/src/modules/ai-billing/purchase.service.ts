import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { AiLedgerType, AiPurchaseMethod, AiPurchaseStatus, Prisma } from '@prisma/client';
import { randomUUID } from 'crypto';
import { PrismaService } from '../../core/database/prisma.service';
import { BillingAuditService } from './billing-audit.service';
import { BillingNotFoundError, BillingValidationError } from './billing.errors';
import { StripeClient, StripeWebhookEvent } from './stripe.client';
import { WalletService } from './wallet.service';

const MIN_PURCHASE = 1;
const MAX_PURCHASE = 100000;

/**
 * Credit purchases. Two rails:
 *  - Stripe Checkout: create PENDING purchase → hosted checkout → signed
 *    webhook → idempotent completion → ledger PURCHASE entry.
 *  - Manual bank transfer: customer uploads proof → super-admin review queue
 *    → approval posts the ledger entry (rejection never touches the wallet).
 * There is deliberately NO cap on how often credits can be purchased.
 */
@Injectable()
export class PurchaseService {
  private readonly logger = new Logger(PurchaseService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly wallet: WalletService,
    private readonly stripe: StripeClient,
    private readonly audit: BillingAuditService,
    private readonly config: ConfigService,
  ) {}

  async listForTenant(tenantId: string, page = 1, pageSize = 50) {
    const where = { tenantId };
    const [rows, total] = await Promise.all([
      this.prisma.aiCreditPurchase.findMany({
        where, orderBy: { createdAt: 'desc' }, skip: (page - 1) * pageSize, take: Math.min(pageSize, 200),
      }),
      this.prisma.aiCreditPurchase.count({ where }),
    ]);
    return { rows, total, page, pageSize };
  }

  /** Super-admin: bank transfers awaiting review (and recent decisions). */
  async listReviewQueue(status?: AiPurchaseStatus) {
    const rows = await this.prisma.aiCreditPurchase.findMany({
      where: { method: AiPurchaseMethod.BANK_TRANSFER, ...(status ? { status } : {}) },
      orderBy: { createdAt: 'desc' },
      take: 200,
    });
    const tenants = await this.prisma.tenant.findMany({
      where: { id: { in: [...new Set(rows.map((row) => row.tenantId))] } },
      select: { id: true, name: true },
    });
    const nameById = new Map(tenants.map((tenant) => [tenant.id, tenant.name]));
    return rows.map((row) => ({ ...row, tenantName: nameById.get(row.tenantId) ?? row.tenantId }));
  }

  // ── Stripe rail ────────────────────────────────────────────────────────────

  async createStripeCheckout(
    user: { id: string; tenantId: string; email?: string },
    input: { amount: number; successUrl?: string; cancelUrl?: string },
  ) {
    this.validateAmount(input.amount);
    if (!this.stripe.isConfigured()) {
      throw new BillingValidationError('Card payments are not available — Stripe is not configured');
    }
    const wallet = await this.wallet.getOrCreateWallet(user.tenantId);
    const baseUrl = this.config.get<string>('APP_PUBLIC_URL') || this.config.get<string>('FRONTEND_URL') || 'http://localhost:3000';

    const purchase = await this.prisma.aiCreditPurchase.create({
      data: {
        tenantId: user.tenantId,
        walletId: wallet.id,
        userId: user.id,
        method: AiPurchaseMethod.STRIPE,
        amount: new Prisma.Decimal(input.amount),
        currency: wallet.currency,
        status: AiPurchaseStatus.PENDING,
        idempotencyKey: randomUUID(),
      },
    });

    const session = await this.stripe.createCheckoutSession({
      amountCents: Math.round(input.amount * 100),
      currency: wallet.currency,
      customerEmail: user.email ?? null,
      successUrl: input.successUrl ?? `${baseUrl}/billing/ai?purchase=success`,
      cancelUrl: input.cancelUrl ?? `${baseUrl}/billing/ai?purchase=cancelled`,
      purchaseId: purchase.id,
      tenantId: user.tenantId,
      idempotencyKey: purchase.idempotencyKey as string,
    });

    await this.prisma.aiCreditPurchase.update({
      where: { id: purchase.id },
      data: { stripeSessionId: session.id },
    });
    return { purchaseId: purchase.id, checkoutUrl: session.url };
  }

  /**
   * Webhook entry point. The signature is already verified by the caller.
   *
   * Financial rules:
   *  - Credits are granted ONLY when Stripe says the money is there
   *    (`payment_status === 'paid'`, or the async_payment_succeeded event).
   *    `checkout.session.completed` alone is NOT proof of payment — async
   *    payment methods complete the session before funds settle.
   *  - The session amount must match our purchase row exactly; a mismatch is
   *    treated as suspected fraud: no credit, loud audit entry.
   *  - Idempotent: PENDING→COMPLETED happens under a row lock that re-checks
   *    status, and stripe_event_id is unique.
   */
  async handleStripeEvent(event: StripeWebhookEvent): Promise<{ handled: boolean }> {
    if (event.type === 'checkout.session.completed' || event.type === 'checkout.session.async_payment_succeeded') {
      const session = event.data.object;
      const purchase = await this.findPurchaseForSession(session);
      if (!purchase) {
        this.logger.warn(`Stripe webhook for unknown purchase (session=${session?.id})`);
        return { handled: false };
      }

      if (event.type === 'checkout.session.completed' && session?.payment_status !== 'paid') {
        // Session finished but funds have not settled (async payment method).
        // Keep the purchase PENDING — async_payment_succeeded/failed decides.
        this.logger.log(`Stripe session ${session?.id} completed but unpaid (payment_status=${session?.payment_status}) — awaiting settlement`);
        return { handled: true };
      }

      const expectedCents = Math.round(Number(purchase.amount) * 100);
      const amountTotal = Number(session?.amount_total);
      if (Number.isFinite(amountTotal) && amountTotal !== expectedCents) {
        await this.audit.record({
          tenantId: purchase.tenantId,
          action: 'PURCHASE_AMOUNT_MISMATCH',
          entityType: 'ai_credit_purchase',
          entityId: purchase.id,
          afterState: { expectedCents, stripeAmountTotal: amountTotal, sessionId: session?.id, eventId: event.id },
          reason: 'Stripe session amount does not match the purchase — wallet NOT credited (suspected fraud or misconfiguration)',
        });
        this.logger.error(`Stripe amount mismatch for purchase ${purchase.id}: expected ${expectedCents}, got ${amountTotal}`);
        return { handled: false };
      }

      await this.completePurchase(purchase.id, {
        stripeEventId: event.id,
        stripePaymentIntentId: (session?.payment_intent as string) ?? null,
        source: 'stripe_webhook',
      });
      return { handled: true };
    }
    if (event.type === 'checkout.session.async_payment_failed') {
      const purchase = await this.findPurchaseForSession(event.data.object);
      if (purchase && purchase.status === AiPurchaseStatus.PENDING) {
        await this.prisma.aiCreditPurchase.update({
          where: { id: purchase.id },
          data: { status: AiPurchaseStatus.REJECTED, stripeEventId: event.id, reviewNote: 'Asynchronous payment failed at Stripe' },
        });
      }
      return { handled: true };
    }
    if (event.type === 'checkout.session.expired') {
      const sessionId = event.data.object?.id as string | undefined;
      if (sessionId) {
        await this.prisma.aiCreditPurchase.updateMany({
          where: { stripeSessionId: sessionId, status: AiPurchaseStatus.PENDING },
          data: { status: AiPurchaseStatus.EXPIRED, stripeEventId: event.id },
        });
      }
      return { handled: true };
    }
    return { handled: false };
  }

  private async findPurchaseForSession(session: Record<string, any> | undefined) {
    const purchaseId = session?.metadata?.purchaseId as string | undefined;
    const sessionId = session?.id as string | undefined;
    if (purchaseId) return this.prisma.aiCreditPurchase.findUnique({ where: { id: purchaseId } });
    if (sessionId) return this.prisma.aiCreditPurchase.findUnique({ where: { stripeSessionId: sessionId } });
    return null;
  }

  /**
   * Sweep for the reservation cron: card purchases whose checkout session was
   * abandoned and whose webhook never arrived must not sit PENDING forever.
   * Bank transfers are exempt — they wait for human review.
   */
  async expireStaleStripePurchases(olderThanHours = 25): Promise<number> {
    const cutoff = new Date(Date.now() - olderThanHours * 3600 * 1000);
    const result = await this.prisma.aiCreditPurchase.updateMany({
      where: { method: AiPurchaseMethod.STRIPE, status: AiPurchaseStatus.PENDING, createdAt: { lt: cutoff } },
      data: { status: AiPurchaseStatus.EXPIRED },
    });
    if (result.count) this.logger.log(`Expired ${result.count} stale PENDING Stripe purchases`);
    return result.count;
  }

  // ── Bank transfer rail ─────────────────────────────────────────────────────

  async submitBankTransfer(
    user: { id: string; tenantId: string },
    input: { amount: number; proofUrl?: string; proofNote?: string },
  ) {
    this.validateAmount(input.amount);
    if (!input.proofUrl && !input.proofNote) {
      throw new BillingValidationError('Bank transfer submissions require payment proof (link or note)');
    }
    const wallet = await this.wallet.getOrCreateWallet(user.tenantId);
    const purchase = await this.prisma.aiCreditPurchase.create({
      data: {
        tenantId: user.tenantId,
        walletId: wallet.id,
        userId: user.id,
        method: AiPurchaseMethod.BANK_TRANSFER,
        amount: new Prisma.Decimal(input.amount),
        currency: wallet.currency,
        status: AiPurchaseStatus.PENDING,
        proofUrl: input.proofUrl?.slice(0, 1000) ?? null,
        proofNote: input.proofNote?.slice(0, 2000) ?? null,
      },
    });
    await this.audit.record({
      actorId: user.id, tenantId: user.tenantId,
      action: 'BANK_TRANSFER_SUBMITTED', entityType: 'ai_credit_purchase', entityId: purchase.id,
      afterState: { amount: purchase.amount.toString(), currency: purchase.currency },
    });
    return purchase;
  }

  async cancelOwnPending(user: { id: string; tenantId: string }, purchaseId: string) {
    const purchase = await this.prisma.aiCreditPurchase.findFirst({
      where: { id: purchaseId, tenantId: user.tenantId },
    });
    if (!purchase) throw new BillingNotFoundError('Purchase not found');
    if (purchase.status !== AiPurchaseStatus.PENDING) {
      throw new BillingValidationError(`Only PENDING purchases can be cancelled (current: ${purchase.status})`);
    }
    return this.prisma.aiCreditPurchase.update({
      where: { id: purchase.id },
      data: { status: AiPurchaseStatus.CANCELLED },
    });
  }

  async reviewBankTransfer(
    admin: { id: string; email?: string; role?: string; ip?: string },
    purchaseId: string,
    decision: { approve: boolean; note?: string },
  ) {
    const purchase = await this.prisma.aiCreditPurchase.findUnique({ where: { id: purchaseId } });
    if (!purchase) throw new BillingNotFoundError('Purchase not found');
    if (purchase.method !== AiPurchaseMethod.BANK_TRANSFER) {
      throw new BillingValidationError('Only bank transfer purchases go through manual review');
    }
    if (purchase.status !== AiPurchaseStatus.PENDING) {
      throw new BillingValidationError(`Purchase already ${purchase.status}`);
    }

    if (!decision.approve) {
      const rejected = await this.prisma.aiCreditPurchase.update({
        where: { id: purchase.id },
        data: {
          status: AiPurchaseStatus.REJECTED,
          reviewedById: admin.id,
          reviewedAt: new Date(),
          reviewNote: decision.note?.slice(0, 2000) ?? null,
        },
      });
      await this.audit.record({
        actorId: admin.id, actorEmail: admin.email, actorRole: admin.role, ipAddress: admin.ip,
        tenantId: purchase.tenantId,
        action: 'BANK_TRANSFER_REJECTED', entityType: 'ai_credit_purchase', entityId: purchase.id,
        beforeState: { status: purchase.status }, afterState: { status: 'REJECTED' }, reason: decision.note,
      });
      return rejected;
    }
    return this.completePurchase(purchase.id, {
      reviewedById: admin.id,
      reviewNote: decision.note ?? null,
      source: 'bank_transfer_review',
      actor: admin,
    });
  }

  // ── shared completion (the only path that credits a wallet) ───────────────

  private async completePurchase(
    purchaseId: string,
    context: {
      stripeEventId?: string;
      stripePaymentIntentId?: string | null;
      reviewedById?: string;
      reviewNote?: string | null;
      source: string;
      actor?: { id?: string; email?: string; role?: string; ip?: string };
    },
  ) {
    const completed = await this.prisma.$transaction(async (tx) => {
      const rows = await tx.$queryRaw<Array<{ id: string }>>`
        SELECT id FROM ai_credit_purchases WHERE id = ${purchaseId}::uuid FOR UPDATE`;
      if (!rows.length) throw new BillingNotFoundError('Purchase not found');
      const purchase = await tx.aiCreditPurchase.findUniqueOrThrow({ where: { id: purchaseId } });
      if (purchase.status === AiPurchaseStatus.COMPLETED) return { purchase, transaction: null, alreadyCompleted: true };
      if (purchase.status !== AiPurchaseStatus.PENDING) {
        throw new BillingValidationError(`Purchase is ${purchase.status}, cannot complete`);
      }

      const transaction = await this.wallet.postTransaction(
        {
          tenantId: purchase.tenantId,
          type: AiLedgerType.PURCHASE,
          amount: purchase.amount,
          createdById: context.reviewedById ?? purchase.userId,
          notes: context.source === 'stripe_webhook' ? 'Stripe credit purchase' : 'Bank transfer credit purchase',
          relatedEntityType: 'ai_credit_purchase',
          relatedEntityId: purchase.id,
          metadata: { source: context.source },
        },
        tx,
      );
      const updated = await tx.aiCreditPurchase.update({
        where: { id: purchase.id },
        data: {
          status: AiPurchaseStatus.COMPLETED,
          ...(context.stripeEventId ? { stripeEventId: context.stripeEventId } : {}),
          ...(context.stripePaymentIntentId !== undefined ? { stripePaymentIntentId: context.stripePaymentIntentId } : {}),
          ...(context.reviewedById ? { reviewedById: context.reviewedById, reviewedAt: new Date() } : {}),
          ...(context.reviewNote !== undefined ? { reviewNote: context.reviewNote } : {}),
        },
      });
      return { purchase: updated, transaction, alreadyCompleted: false };
    }, { isolationLevel: Prisma.TransactionIsolationLevel.ReadCommitted });

    if (!completed.alreadyCompleted) {
      await this.audit.record({
        actorId: context.actor?.id ?? null,
        actorEmail: context.actor?.email,
        actorRole: context.actor?.role,
        ipAddress: context.actor?.ip,
        tenantId: completed.purchase.tenantId,
        action: 'PURCHASE_COMPLETED',
        entityType: 'ai_credit_purchase',
        entityId: completed.purchase.id,
        afterState: {
          amount: completed.purchase.amount.toString(),
          method: completed.purchase.method,
          source: context.source,
          transactionId: completed.transaction?.id,
        },
      });
    }
    return completed.purchase;
  }

  private validateAmount(amount: number) {
    if (!Number.isFinite(amount) || amount < MIN_PURCHASE || amount > MAX_PURCHASE) {
      throw new BillingValidationError(`Purchase amount must be between ${MIN_PURCHASE} and ${MAX_PURCHASE}`);
    }
  }
}
