import { AiDisputeStatus, AiLedgerType, AiRefundKind, Prisma } from '@prisma/client';
import { DisputeService } from './dispute.service';
import { BillingValidationError } from './billing.errors';

const D = (value: number | string) => new Prisma.Decimal(value);

function buildHarness(options: { alreadyReversed?: boolean } = {}) {
  const dispute: any = {
    id: 'dispute-1',
    tenantId: 'tenant-1',
    raisedById: 'user-1',
    type: 'UNEXPECTED_CHARGE',
    status: AiDisputeStatus.OPEN,
    subject: 'Charged twice',
    description: 'desc',
    messages: [],
  };
  const originalCharge = {
    id: 'txn-charge', tenantId: 'tenant-1', type: AiLedgerType.USAGE_CHARGE,
    amount: D(-2.5), referenceNo: 'TXN-CHARGE',
  };
  const prisma: any = {
    aiDispute: {
      findFirst: jest.fn().mockImplementation(() => Promise.resolve({ ...dispute })),
      create: jest.fn(),
      update: jest.fn().mockImplementation(({ data }: any) => {
        Object.assign(dispute, data);
        return Promise.resolve({ ...dispute });
      }),
      findMany: jest.fn(),
      count: jest.fn(),
    },
    aiDisputeMessage: { create: jest.fn().mockResolvedValue({}) },
    aiWalletTransaction: {
      findFirst: jest.fn().mockImplementation(({ where }: any) => {
        if (where.type === AiLedgerType.USAGE_CHARGE) return Promise.resolve(originalCharge);
        if (where.type === AiLedgerType.CHARGE_REVERSAL) {
          return Promise.resolve(options.alreadyReversed ? { id: 'txn-rev', referenceNo: 'TXN-REV' } : null);
        }
        return Promise.resolve(null);
      }),
    },
    aiUsageLog: { findFirst: jest.fn() },
  };
  const wallet = { postTransaction: jest.fn().mockResolvedValue({ id: 'txn-new', referenceNo: 'TXN-NEW' }) } as any;
  const refunds = { create: jest.fn().mockResolvedValue({ id: 'refund-1' }) } as any;
  const audit = { record: jest.fn() } as any;
  const service = new DisputeService(prisma, wallet, refunds, audit);
  const admin = { id: 'admin-1', email: 'admin@x.com', role: 'SUPER_ADMIN', ip: '1.1.1.1' };
  return { service, dispute, prisma, wallet, refunds, audit, admin };
}

describe('DisputeService admin actions (every monetary outcome is ledgered)', () => {
  it('REVERSE_CHARGE posts the exact inverse of the original charge and resolves the dispute', async () => {
    const { service, dispute, wallet, admin } = buildHarness();
    await service.adminAction(admin, 'dispute-1', { action: 'REVERSE_CHARGE', transactionId: 'txn-charge' });

    expect(wallet.postTransaction).toHaveBeenCalledWith(expect.objectContaining({
      type: AiLedgerType.CHARGE_REVERSAL,
      relatedEntityType: 'ai_wallet_transaction',
      relatedEntityId: 'txn-charge',
    }));
    const amount = wallet.postTransaction.mock.calls[0][0].amount as Prisma.Decimal;
    expect(amount.toString()).toBe('2.5'); // inverse of -2.5
    expect(dispute.status).toBe(AiDisputeStatus.RESOLVED);
  });

  it('refuses to reverse the same charge twice', async () => {
    const { service, wallet, admin } = buildHarness({ alreadyReversed: true });
    await expect(
      service.adminAction(admin, 'dispute-1', { action: 'REVERSE_CHARGE', transactionId: 'txn-charge' }),
    ).rejects.toThrow(/already reversed/);
    expect(wallet.postTransaction).not.toHaveBeenCalled();
  });

  it('CASH refunds from a dispute require the related purchaseId', async () => {
    const { service, refunds, admin } = buildHarness();
    await expect(
      service.adminAction(admin, 'dispute-1', { action: 'APPROVE_REFUND', amount: 10, kind: AiRefundKind.CASH }),
    ).rejects.toBeInstanceOf(BillingValidationError);
    expect(refunds.create).not.toHaveBeenCalled();

    await service.adminAction(admin, 'dispute-1', {
      action: 'APPROVE_REFUND', amount: 10, kind: AiRefundKind.CASH, purchaseId: 'purchase-9',
    });
    expect(refunds.create).toHaveBeenCalledWith(admin, expect.objectContaining({
      amount: 10, kind: AiRefundKind.CASH, purchaseId: 'purchase-9', disputeId: 'dispute-1',
    }));
  });

  it('ISSUE_BONUS_CREDITS posts a BONUS_CREDIT ledger entry', async () => {
    const { service, wallet, admin } = buildHarness();
    await service.adminAction(admin, 'dispute-1', { action: 'ISSUE_BONUS_CREDITS', amount: 5, note: 'goodwill' });
    expect(wallet.postTransaction).toHaveBeenCalledWith(expect.objectContaining({ type: AiLedgerType.BONUS_CREDIT }));
  });

  it('REJECT closes the dispute without touching the wallet', async () => {
    const { service, dispute, wallet, admin } = buildHarness();
    await service.adminAction(admin, 'dispute-1', { action: 'REJECT', note: 'charge is correct' });
    expect(dispute.status).toBe(AiDisputeStatus.CLOSED);
    expect(wallet.postTransaction).not.toHaveBeenCalled();
  });

  it('no action is possible on a CLOSED dispute', async () => {
    const { service, dispute, admin } = buildHarness();
    dispute.status = AiDisputeStatus.CLOSED;
    await expect(
      service.adminAction(admin, 'dispute-1', { action: 'ISSUE_BONUS_CREDITS', amount: 5 }),
    ).rejects.toThrow(/closed/i);
  });
});
