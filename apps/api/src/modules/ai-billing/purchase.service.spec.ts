import { AiPurchaseMethod, AiPurchaseStatus, Prisma } from '@prisma/client';
import { PurchaseService } from './purchase.service';
import { BillingValidationError } from './billing.errors';

const D = (value: number | string) => new Prisma.Decimal(value);

function buildHarness(purchaseOverrides: Partial<any> = {}) {
  const purchase: any = {
    id: 'purchase-1',
    tenantId: 'tenant-1',
    walletId: 'wallet-1',
    userId: 'user-1',
    method: AiPurchaseMethod.STRIPE,
    amount: D(100),
    currency: 'USD',
    status: AiPurchaseStatus.PENDING,
    stripeSessionId: 'cs_1',
    ...purchaseOverrides,
  };
  const tx: any = {
    $queryRaw: jest.fn().mockResolvedValue([{ id: purchase.id }]),
    aiCreditPurchase: {
      findUniqueOrThrow: jest.fn().mockImplementation(() => Promise.resolve({ ...purchase })),
      update: jest.fn().mockImplementation(({ data }: any) => {
        Object.assign(purchase, data);
        return Promise.resolve({ ...purchase });
      }),
    },
  };
  const prisma: any = {
    aiCreditPurchase: {
      findUnique: jest.fn().mockImplementation(() => Promise.resolve({ ...purchase })),
      findFirst: jest.fn().mockImplementation(() => Promise.resolve({ ...purchase })),
      create: jest.fn().mockImplementation(({ data }: any) => Promise.resolve({ id: 'purchase-new', ...data })),
      update: jest.fn().mockImplementation(({ data }: any) => {
        Object.assign(purchase, data);
        return Promise.resolve({ ...purchase });
      }),
      updateMany: jest.fn().mockResolvedValue({ count: 1 }),
      findMany: jest.fn().mockResolvedValue([]),
      count: jest.fn().mockResolvedValue(0),
    },
    $transaction: jest.fn().mockImplementation((fn: any) => fn(tx)),
    tenant: { findMany: jest.fn().mockResolvedValue([]) },
  };
  const wallet = {
    getOrCreateWallet: jest.fn().mockResolvedValue({ id: 'wallet-1', currency: 'USD' }),
    postTransaction: jest.fn().mockResolvedValue({ id: 'txn-1' }),
  } as any;
  const stripe = { isConfigured: jest.fn().mockReturnValue(true), createCheckoutSession: jest.fn(), createRefund: jest.fn() } as any;
  const audit = { record: jest.fn() } as any;
  const config = { get: jest.fn().mockReturnValue(undefined) } as any;
  const service = new PurchaseService(prisma, wallet, stripe, audit, config);
  return { service, purchase, prisma, wallet, stripe, audit };
}

const completedEvent = (overrides: Partial<any> = {}) => ({
  id: 'evt_1',
  type: 'checkout.session.completed',
  data: {
    object: {
      id: 'cs_1',
      payment_intent: 'pi_1',
      payment_status: 'paid',
      amount_total: 10000, // $100 in cents — matches the purchase row
      metadata: { purchaseId: 'purchase-1' },
      ...overrides,
    },
  },
});

describe('PurchaseService', () => {
  it('completes a purchase exactly once — replayed webhooks are no-ops (idempotency)', async () => {
    const { service, purchase, wallet } = buildHarness();

    await service.handleStripeEvent(completedEvent() as any);
    expect(purchase.status).toBe(AiPurchaseStatus.COMPLETED);
    expect(wallet.postTransaction).toHaveBeenCalledTimes(1);
    expect(wallet.postTransaction.mock.calls[0][0]).toMatchObject({ type: 'PURCHASE', tenantId: 'tenant-1' });

    // Stripe redelivers the same event — the wallet must NOT be credited twice.
    await service.handleStripeEvent(completedEvent() as any);
    expect(wallet.postTransaction).toHaveBeenCalledTimes(1);
  });

  it('expired checkout sessions mark the purchase EXPIRED without touching the wallet', async () => {
    const { service, prisma, wallet } = buildHarness();
    await service.handleStripeEvent({ id: 'evt_2', type: 'checkout.session.expired', data: { object: { id: 'cs_1' } } } as any);
    expect(prisma.aiCreditPurchase.updateMany).toHaveBeenCalledWith(
      expect.objectContaining({ where: expect.objectContaining({ stripeSessionId: 'cs_1', status: AiPurchaseStatus.PENDING }) }),
    );
    expect(wallet.postTransaction).not.toHaveBeenCalled();
  });

  it('does NOT credit when the session completed but is unpaid (async payment pending)', async () => {
    const { service, purchase, wallet } = buildHarness();
    await service.handleStripeEvent(completedEvent({ payment_status: 'unpaid' }) as any);
    expect(purchase.status).toBe(AiPurchaseStatus.PENDING);
    expect(wallet.postTransaction).not.toHaveBeenCalled();

    // Settlement arrives later → credit exactly once.
    await service.handleStripeEvent({
      id: 'evt_async', type: 'checkout.session.async_payment_succeeded',
      data: { object: { id: 'cs_1', payment_intent: 'pi_1', amount_total: 10000, metadata: { purchaseId: 'purchase-1' } } },
    } as any);
    expect(purchase.status).toBe(AiPurchaseStatus.COMPLETED);
    expect(wallet.postTransaction).toHaveBeenCalledTimes(1);
  });

  it('rejects the purchase when the async payment fails', async () => {
    const { service, purchase, wallet } = buildHarness();
    await service.handleStripeEvent({
      id: 'evt_fail', type: 'checkout.session.async_payment_failed',
      data: { object: { id: 'cs_1', metadata: { purchaseId: 'purchase-1' } } },
    } as any);
    expect(purchase.status).toBe(AiPurchaseStatus.REJECTED);
    expect(wallet.postTransaction).not.toHaveBeenCalled();
  });

  it('refuses to credit on a session amount mismatch and writes a fraud audit entry', async () => {
    const { service, purchase, wallet, audit } = buildHarness();
    const result = await service.handleStripeEvent(completedEvent({ amount_total: 999999 }) as any);
    expect(result.handled).toBe(false);
    expect(purchase.status).toBe(AiPurchaseStatus.PENDING);
    expect(wallet.postTransaction).not.toHaveBeenCalled();
    expect(audit.record).toHaveBeenCalledWith(expect.objectContaining({ action: 'PURCHASE_AMOUNT_MISMATCH' }));
  });

  it('expires stale PENDING Stripe purchases but never bank transfers', async () => {
    const { service, prisma } = buildHarness();
    await service.expireStaleStripePurchases(25);
    expect(prisma.aiCreditPurchase.updateMany).toHaveBeenCalledWith(expect.objectContaining({
      where: expect.objectContaining({ method: AiPurchaseMethod.STRIPE, status: AiPurchaseStatus.PENDING }),
      data: { status: AiPurchaseStatus.EXPIRED },
    }));
  });

  it('bank transfer approval credits the wallet; rejection never does', async () => {
    const approve = buildHarness({ method: AiPurchaseMethod.BANK_TRANSFER, stripeSessionId: null });
    await approve.service.reviewBankTransfer({ id: 'admin-1' } as any, 'purchase-1', { approve: true, note: 'verified' });
    expect(approve.purchase.status).toBe(AiPurchaseStatus.COMPLETED);
    expect(approve.wallet.postTransaction).toHaveBeenCalledTimes(1);

    const reject = buildHarness({ method: AiPurchaseMethod.BANK_TRANSFER, stripeSessionId: null });
    await reject.service.reviewBankTransfer({ id: 'admin-1' } as any, 'purchase-1', { approve: false, note: 'no proof' });
    expect(reject.purchase.status).toBe(AiPurchaseStatus.REJECTED);
    expect(reject.wallet.postTransaction).not.toHaveBeenCalled();
  });

  it('refuses to re-review a decided bank transfer', async () => {
    const { service } = buildHarness({ method: AiPurchaseMethod.BANK_TRANSFER, status: AiPurchaseStatus.REJECTED });
    await expect(
      service.reviewBankTransfer({ id: 'admin-1' } as any, 'purchase-1', { approve: true }),
    ).rejects.toBeInstanceOf(BillingValidationError);
  });

  it('bank transfer submission requires proof and a sane amount', async () => {
    const { service } = buildHarness();
    await expect(
      service.submitBankTransfer({ id: 'user-1', tenantId: 'tenant-1' }, { amount: 100 }),
    ).rejects.toThrow(/payment proof/);
    await expect(
      service.submitBankTransfer({ id: 'user-1', tenantId: 'tenant-1' }, { amount: 0.5, proofNote: 'x' }),
    ).rejects.toThrow(/between/);
  });
});
