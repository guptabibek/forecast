import { AiLedgerType, AiPurchaseStatus, AiRefundKind, AiRefundStatus, Prisma } from '@prisma/client';
import { RefundService } from './refund.service';
import { BillingValidationError } from './billing.errors';

const D = (value: number | string) => new Prisma.Decimal(value);

function buildHarness(options: { alreadyRefunded?: number; noPaymentIntent?: boolean } = {}) {
  const purchase: any = {
    id: 'purchase-1',
    tenantId: 'tenant-1',
    amount: D(100),
    status: AiPurchaseStatus.COMPLETED,
    stripePaymentIntentId: options.noPaymentIntent ? null : 'pi_1',
  };
  const refundRow: any = { id: 'refund-1', status: AiRefundStatus.PENDING };
  const prisma: any = {
    aiCreditPurchase: {
      findFirst: jest.fn().mockResolvedValue(purchase),
      update: jest.fn().mockImplementation(({ data }: any) => {
        Object.assign(purchase, data);
        return Promise.resolve({ ...purchase });
      }),
    },
    aiRefund: {
      aggregate: jest.fn().mockResolvedValue({ _sum: { amount: D(options.alreadyRefunded ?? 0) } }),
      create: jest.fn().mockImplementation(({ data }: any) => Promise.resolve({ ...refundRow, ...data })),
      update: jest.fn().mockImplementation(({ data }: any) => {
        Object.assign(refundRow, data);
        return Promise.resolve({ ...refundRow });
      }),
      findMany: jest.fn(),
      count: jest.fn(),
    },
  };
  const wallet = {
    getOrCreateWallet: jest.fn().mockResolvedValue({ id: 'wallet-1' }),
    postTransaction: jest.fn().mockResolvedValue({ id: 'txn-refund' }),
  } as any;
  const stripe = { createRefund: jest.fn().mockResolvedValue({ id: 're_1', status: 'succeeded' }) } as any;
  const audit = { record: jest.fn() } as any;
  const service = new RefundService(prisma, wallet, stripe, audit);
  const admin = { id: 'admin-1', email: 'a@x.com', role: 'SUPER_ADMIN', ip: '1.1.1.1' };
  return { service, purchase, refundRow, prisma, wallet, stripe, audit, admin };
}

describe('RefundService (cumulative caps + ledger direction)', () => {
  it('WALLET_CREDIT refund credits the wallet (positive ledger amount)', async () => {
    const { service, wallet, admin } = buildHarness();
    await service.create(admin, { tenantId: 'tenant-1', amount: 25, kind: AiRefundKind.WALLET_CREDIT, reason: 'usage dispute' });
    const posted = wallet.postTransaction.mock.calls[0][0];
    expect(posted.type).toBe(AiLedgerType.REFUND);
    expect((posted.amount as Prisma.Decimal).toString()).toBe('25');
  });

  it('CASH refund debits the wallet, calls Stripe, and a PARTIAL one keeps the purchase COMPLETED', async () => {
    const { service, purchase, wallet, stripe, admin } = buildHarness();
    await service.create(admin, { tenantId: 'tenant-1', amount: 40, kind: AiRefundKind.CASH, reason: 'partial', purchaseId: 'purchase-1' });
    expect(stripe.createRefund).toHaveBeenCalledWith(expect.objectContaining({ paymentIntentId: 'pi_1', amountCents: 4000 }));
    const posted = wallet.postTransaction.mock.calls[0][0];
    expect((posted.amount as Prisma.Decimal).toString()).toBe('-40');
    // Partial refund must NOT mark the whole purchase refunded.
    expect(purchase.status).toBe(AiPurchaseStatus.COMPLETED);
  });

  it('a FULL cumulative refund marks the purchase REFUNDED', async () => {
    const { service, purchase, admin } = buildHarness({ alreadyRefunded: 60 });
    await service.create(admin, { tenantId: 'tenant-1', amount: 40, kind: AiRefundKind.CASH, reason: 'rest', purchaseId: 'purchase-1' });
    expect(purchase.status).toBe(AiPurchaseStatus.REFUNDED);
  });

  it('cumulative refunds can never exceed the original purchase amount', async () => {
    const { service, wallet, admin } = buildHarness({ alreadyRefunded: 80 });
    await expect(
      service.create(admin, { tenantId: 'tenant-1', amount: 40, kind: AiRefundKind.WALLET_CREDIT, reason: 'too much', purchaseId: 'purchase-1' }),
    ).rejects.toThrow(/refundable remainder/);
    expect(wallet.postTransaction).not.toHaveBeenCalled();
  });

  it('CASH refunds require a Stripe payment intent', async () => {
    const { service, admin } = buildHarness({ noPaymentIntent: true });
    await expect(
      service.create(admin, { tenantId: 'tenant-1', amount: 10, kind: AiRefundKind.CASH, reason: 'x', purchaseId: 'purchase-1' }),
    ).rejects.toBeInstanceOf(BillingValidationError);
  });

  it('a Stripe failure marks the refund FAILED and posts nothing to the wallet', async () => {
    const { service, refundRow, wallet, stripe, admin } = buildHarness();
    stripe.createRefund.mockRejectedValue(new Error('stripe down'));
    await expect(
      service.create(admin, { tenantId: 'tenant-1', amount: 10, kind: AiRefundKind.CASH, reason: 'x', purchaseId: 'purchase-1' }),
    ).rejects.toThrow('stripe down');
    expect(refundRow.status).toBe(AiRefundStatus.FAILED);
    expect(wallet.postTransaction).not.toHaveBeenCalled();
  });
});
