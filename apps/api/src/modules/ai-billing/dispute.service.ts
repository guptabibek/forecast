import { Injectable } from '@nestjs/common';
import {
  AiDisputeStatus,
  AiDisputeType,
  AiLedgerType,
  AiRefundKind,
  Prisma,
} from '@prisma/client';
import { PrismaService } from '../../core/database/prisma.service';
import { BillingAuditService } from './billing-audit.service';
import { BillingNotFoundError, BillingValidationError } from './billing.errors';
import { RefundService } from './refund.service';
import { WalletService } from './wallet.service';

export type DisputeAdminAction =
  | { action: 'APPROVE_REFUND'; amount: number; kind: AiRefundKind; purchaseId?: string; note?: string }
  | { action: 'PARTIAL_REFUND'; amount: number; kind: AiRefundKind; purchaseId?: string; note?: string }
  | { action: 'REJECT'; note: string }
  | { action: 'ISSUE_BONUS_CREDITS'; amount: number; note?: string }
  | { action: 'REVERSE_CHARGE'; transactionId: string; note?: string }
  | { action: 'MANUAL_ADJUSTMENT'; amount: number; note: string }
  | { action: 'ESCALATE'; assignedToId?: string; note?: string };

/**
 * Dispute management. Customers raise disputes against transactions or usage
 * logs; super admins investigate and act. Every monetary outcome flows
 * through the ledger (refund / bonus / reversal / adjustment) and every
 * action is recorded in the dispute thread AND the immutable audit log.
 */
@Injectable()
export class DisputeService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly wallet: WalletService,
    private readonly refunds: RefundService,
    private readonly audit: BillingAuditService,
  ) {}

  async create(
    user: { id: string; tenantId: string },
    input: {
      type: AiDisputeType;
      subject: string;
      description: string;
      relatedTransactionId?: string;
      relatedUsageLogId?: string;
    },
  ) {
    if (!input.subject?.trim() || !input.description?.trim()) {
      throw new BillingValidationError('Dispute subject and description are required');
    }
    if (input.relatedTransactionId) {
      const txn = await this.prisma.aiWalletTransaction.findFirst({
        where: { id: input.relatedTransactionId, tenantId: user.tenantId },
      });
      if (!txn) throw new BillingNotFoundError('Related transaction not found in your account');
    }
    if (input.relatedUsageLogId) {
      const usage = await this.prisma.aiUsageLog.findFirst({
        where: { id: input.relatedUsageLogId, tenantId: user.tenantId },
      });
      if (!usage) throw new BillingNotFoundError('Related usage record not found in your account');
    }
    const dispute = await this.prisma.aiDispute.create({
      data: {
        tenantId: user.tenantId,
        raisedById: user.id,
        type: input.type,
        subject: input.subject.slice(0, 300),
        description: input.description.slice(0, 5000),
        relatedTransactionId: input.relatedTransactionId ?? null,
        relatedUsageLogId: input.relatedUsageLogId ?? null,
      },
    });
    await this.audit.record({
      actorId: user.id, tenantId: user.tenantId,
      action: 'DISPUTE_OPENED', entityType: 'ai_dispute', entityId: dispute.id,
      afterState: { type: dispute.type, subject: dispute.subject },
    });
    return dispute;
  }

  async list(filter: { tenantId?: string; status?: AiDisputeStatus; page?: number; pageSize?: number }) {
    const page = Math.max(1, filter.page ?? 1);
    const pageSize = Math.min(100, Math.max(1, filter.pageSize ?? 25));
    const where = {
      ...(filter.tenantId ? { tenantId: filter.tenantId } : {}),
      ...(filter.status ? { status: filter.status } : {}),
    };
    const [rows, total] = await Promise.all([
      this.prisma.aiDispute.findMany({ where, orderBy: { createdAt: 'desc' }, skip: (page - 1) * pageSize, take: pageSize }),
      this.prisma.aiDispute.count({ where }),
    ]);
    return { rows, total, page, pageSize };
  }

  async getWithThread(disputeId: string, tenantId?: string) {
    const dispute = await this.prisma.aiDispute.findFirst({
      where: { id: disputeId, ...(tenantId ? { tenantId } : {}) },
      include: { messages: { orderBy: { createdAt: 'asc' } } },
    });
    if (!dispute) throw new BillingNotFoundError('Dispute not found');
    return dispute;
  }

  async addMessage(
    author: { id: string; tenantId?: string; isAdmin: boolean },
    disputeId: string,
    input: { body: string; attachmentUrl?: string },
  ) {
    if (!input.body?.trim()) throw new BillingValidationError('Message body is required');
    const dispute = await this.getWithThread(disputeId, author.isAdmin ? undefined : author.tenantId);
    const message = await this.prisma.aiDisputeMessage.create({
      data: {
        disputeId: dispute.id,
        tenantId: dispute.tenantId,
        authorId: author.id,
        authorRole: author.isAdmin ? 'ADMIN' : 'CUSTOMER',
        body: input.body.slice(0, 5000),
        attachmentUrl: input.attachmentUrl?.slice(0, 1000) ?? null,
      },
    });
    // A customer reply flips AWAITING_CUSTOMER back to investigation.
    if (!author.isAdmin && dispute.status === AiDisputeStatus.AWAITING_CUSTOMER) {
      await this.prisma.aiDispute.update({
        where: { id: dispute.id },
        data: { status: AiDisputeStatus.UNDER_INVESTIGATION },
      });
    }
    return message;
  }

  async updateStatus(
    admin: { id: string; email?: string; role?: string; ip?: string },
    disputeId: string,
    status: AiDisputeStatus,
    note?: string,
  ) {
    const before = await this.getWithThread(disputeId);
    const updated = await this.prisma.aiDispute.update({
      where: { id: disputeId },
      data: {
        status,
        ...(status === AiDisputeStatus.RESOLVED || status === AiDisputeStatus.CLOSED
          ? { resolvedById: admin.id, resolvedAt: new Date(), ...(note ? { resolutionNotes: note.slice(0, 5000) } : {}) }
          : {}),
      },
    });
    await this.systemMessage(disputeId, before.tenantId, `Status changed: ${before.status} → ${status}${note ? ` — ${note}` : ''}`);
    await this.audit.record({
      actorId: admin.id, actorEmail: admin.email, actorRole: admin.role, ipAddress: admin.ip,
      tenantId: before.tenantId,
      action: 'DISPUTE_STATUS_CHANGED', entityType: 'ai_dispute', entityId: disputeId,
      beforeState: { status: before.status }, afterState: { status }, reason: note,
    });
    return updated;
  }

  /** Super-admin dispute resolution actions — every monetary one is ledgered. */
  async adminAction(
    admin: { id: string; email?: string; role?: string; ip?: string },
    disputeId: string,
    action: DisputeAdminAction,
  ) {
    const dispute = await this.getWithThread(disputeId);
    if (dispute.status === AiDisputeStatus.CLOSED) {
      throw new BillingValidationError('Dispute is closed');
    }

    switch (action.action) {
      case 'APPROVE_REFUND':
      case 'PARTIAL_REFUND': {
        // CASH refunds go back to the card and therefore need the original
        // Stripe purchase to refund against.
        if (action.kind === AiRefundKind.CASH && !action.purchaseId) {
          throw new BillingValidationError('Cash refunds from a dispute require the related purchaseId');
        }
        const refund = await this.refunds.create(admin, {
          tenantId: dispute.tenantId,
          amount: action.amount,
          kind: action.kind,
          reason: `Dispute ${dispute.id.slice(0, 8)}: ${action.note ?? dispute.subject}`,
          disputeId: dispute.id,
          purchaseId: action.purchaseId,
        });
        await this.resolve(admin, dispute, `${action.action === 'PARTIAL_REFUND' ? 'Partial refund' : 'Refund'} of ${action.amount} approved (${action.kind})`, action.note);
        return { refundId: refund.id };
      }
      case 'REJECT': {
        await this.prisma.aiDispute.update({
          where: { id: dispute.id },
          data: { status: AiDisputeStatus.CLOSED, resolvedById: admin.id, resolvedAt: new Date(), resolutionNotes: action.note.slice(0, 5000) },
        });
        await this.systemMessage(dispute.id, dispute.tenantId, `Dispute rejected: ${action.note}`);
        await this.auditAction(admin, dispute.id, dispute.tenantId, 'DISPUTE_REJECTED', action.note);
        return { rejected: true };
      }
      case 'ISSUE_BONUS_CREDITS': {
        if (!Number.isFinite(action.amount) || action.amount <= 0) throw new BillingValidationError('Bonus amount must be positive');
        const transaction = await this.wallet.postTransaction({
          tenantId: dispute.tenantId,
          type: AiLedgerType.BONUS_CREDIT,
          amount: new Prisma.Decimal(action.amount),
          createdById: admin.id,
          notes: `Dispute goodwill credit: ${action.note ?? dispute.subject}`.slice(0, 1000),
          relatedEntityType: 'ai_dispute',
          relatedEntityId: dispute.id,
        });
        await this.resolve(admin, dispute, `Bonus credits issued: ${action.amount}`, action.note);
        return { transactionId: transaction.id };
      }
      case 'REVERSE_CHARGE': {
        const original = await this.prisma.aiWalletTransaction.findFirst({
          where: { id: action.transactionId, tenantId: dispute.tenantId, type: AiLedgerType.USAGE_CHARGE },
        });
        if (!original) throw new BillingNotFoundError('Original usage charge not found for this tenant');
        // A charge may be reversed exactly once — a second reversal would
        // pay the customer twice for the same transaction.
        const alreadyReversed = await this.prisma.aiWalletTransaction.findFirst({
          where: {
            tenantId: dispute.tenantId,
            type: AiLedgerType.CHARGE_REVERSAL,
            relatedEntityType: 'ai_wallet_transaction',
            relatedEntityId: original.id,
          },
        });
        if (alreadyReversed) {
          throw new BillingValidationError(`Charge ${original.referenceNo} was already reversed (${alreadyReversed.referenceNo})`);
        }
        const transaction = await this.wallet.postTransaction({
          tenantId: dispute.tenantId,
          type: AiLedgerType.CHARGE_REVERSAL,
          amount: new Prisma.Decimal(original.amount).negated(), // charge was negative → reversal positive
          createdById: admin.id,
          notes: `Reversal of ${original.referenceNo} (dispute)`.slice(0, 1000),
          relatedEntityType: 'ai_wallet_transaction',
          relatedEntityId: original.id,
          metadata: { disputeId: dispute.id },
        });
        await this.resolve(admin, dispute, `Charge ${original.referenceNo} reversed`, action.note);
        return { transactionId: transaction.id };
      }
      case 'MANUAL_ADJUSTMENT': {
        if (!Number.isFinite(action.amount) || action.amount === 0) throw new BillingValidationError('Adjustment amount must be non-zero');
        const transaction = await this.wallet.postTransaction({
          tenantId: dispute.tenantId,
          type: AiLedgerType.DISPUTE_RESOLUTION,
          amount: new Prisma.Decimal(action.amount),
          createdById: admin.id,
          notes: `Dispute adjustment: ${action.note}`.slice(0, 1000),
          relatedEntityType: 'ai_dispute',
          relatedEntityId: dispute.id,
        });
        await this.resolve(admin, dispute, `Manual adjustment of ${action.amount} applied`, action.note);
        return { transactionId: transaction.id };
      }
      case 'ESCALATE': {
        await this.prisma.aiDispute.update({
          where: { id: dispute.id },
          data: { status: AiDisputeStatus.UNDER_INVESTIGATION, ...(action.assignedToId ? { assignedToId: action.assignedToId } : {}) },
        });
        await this.systemMessage(dispute.id, dispute.tenantId, `Escalated${action.note ? `: ${action.note}` : ''}`);
        await this.auditAction(admin, dispute.id, dispute.tenantId, 'DISPUTE_ESCALATED', action.note);
        return { escalated: true };
      }
      default:
        throw new BillingValidationError('Unknown dispute action');
    }
  }

  // ── internals ──────────────────────────────────────────────────────────────

  private async resolve(
    admin: { id: string; email?: string; role?: string; ip?: string },
    dispute: { id: string; tenantId: string },
    summary: string,
    note?: string,
  ) {
    await this.prisma.aiDispute.update({
      where: { id: dispute.id },
      data: {
        status: AiDisputeStatus.RESOLVED,
        resolvedById: admin.id,
        resolvedAt: new Date(),
        resolutionNotes: `${summary}${note ? ` — ${note}` : ''}`.slice(0, 5000),
      },
    });
    await this.systemMessage(dispute.id, dispute.tenantId, summary);
    await this.auditAction(admin, dispute.id, dispute.tenantId, 'DISPUTE_RESOLVED', `${summary}${note ? ` — ${note}` : ''}`);
  }

  private async systemMessage(disputeId: string, tenantId: string, body: string) {
    await this.prisma.aiDisputeMessage.create({
      data: { disputeId, tenantId, authorId: null, authorRole: 'SYSTEM', body: body.slice(0, 5000) },
    });
  }

  private async auditAction(
    admin: { id: string; email?: string; role?: string; ip?: string },
    disputeId: string,
    tenantId: string,
    action: string,
    reason?: string,
  ) {
    await this.audit.record({
      actorId: admin.id, actorEmail: admin.email, actorRole: admin.role, ipAddress: admin.ip,
      tenantId, action, entityType: 'ai_dispute', entityId: disputeId, reason,
    });
  }
}
