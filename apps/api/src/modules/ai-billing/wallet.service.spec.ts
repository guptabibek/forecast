import { AiLedgerType, AiReservationStatus, AiWalletStatus, Prisma } from '@prisma/client';
import { WalletService } from './wallet.service';
import { InsufficientCreditsError, WalletSuspendedError } from './billing.errors';

const D = (value: number | string) => new Prisma.Decimal(value);

/**
 * In-memory double of the Prisma surface WalletService touches, so the
 * ledger invariants can be asserted without a database:
 *   - every balance change produces exactly one ledger row
 *   - balanceAfter === balanceBefore + amount
 *   - wallet.balance always equals the running ledger sum
 */
function buildHarness(walletOverrides: Partial<any> = {}) {
  const wallet: any = {
    id: 'wallet-1',
    tenantId: 'tenant-1',
    currency: 'USD',
    balance: D(100),
    reservedBalance: D(0),
    totalPurchased: D(0),
    totalConsumed: D(0),
    totalRefunded: D(0),
    totalAdjusted: D(0),
    status: AiWalletStatus.ACTIVE,
    suspendThreshold: null,
    lowBalanceThreshold: null,
    criticalBalanceThreshold: null,
    ...walletOverrides,
  };
  const ledger: any[] = [];
  const reservations = new Map<string, any>();
  let reservationSeq = 0;

  const tx: any = {
    $queryRaw: jest.fn().mockImplementation((strings: TemplateStringsArray, ..._args: any[]) => {
      const sql = strings.join('?');
      if (sql.includes('ai_credit_reservations')) {
        const id = _args[0];
        return Promise.resolve(reservations.has(id) ? [{ id }] : []);
      }
      return Promise.resolve([{ id: wallet.id }]);
    }),
    aiWallet: {
      findUnique: jest.fn().mockImplementation(() => Promise.resolve({ ...wallet })),
      findUniqueOrThrow: jest.fn().mockImplementation(() => Promise.resolve({ ...wallet })),
      create: jest.fn(),
      update: jest.fn().mockImplementation(({ data }: any) => {
        Object.assign(wallet, data);
        return Promise.resolve({ ...wallet });
      }),
    },
    aiWalletTransaction: {
      create: jest.fn().mockImplementation(({ data }: any) => {
        const row = { id: `txn-${ledger.length + 1}`, createdAt: new Date(), ...data };
        ledger.push(row);
        return Promise.resolve(row);
      }),
    },
    aiCreditReservation: {
      create: jest.fn().mockImplementation(({ data }: any) => {
        reservationSeq += 1;
        const row = { id: `res-${reservationSeq}`, status: AiReservationStatus.ACTIVE, ...data };
        reservations.set(row.id, row);
        return Promise.resolve(row);
      }),
      findUniqueOrThrow: jest.fn().mockImplementation(({ where }: any) => Promise.resolve({ ...reservations.get(where.id) })),
      update: jest.fn().mockImplementation(({ where, data }: any) => {
        const row = { ...reservations.get(where.id), ...data };
        reservations.set(where.id, row);
        return Promise.resolve(row);
      }),
    },
    aiBillingAuditLog: { create: jest.fn().mockResolvedValue({}) },
  };

  const prisma: any = {
    ...tx,
    $transaction: jest.fn().mockImplementation((fn: any) => fn(tx)),
  };
  const audit = { record: jest.fn(), recordIn: jest.fn() } as any;
  const service = new WalletService(prisma, audit);
  return { service, wallet, ledger, reservations, prisma, audit };
}

describe('WalletService (financial core)', () => {
  it('posts a credit with exact before/after snapshots and aggregate mirror', async () => {
    const { service, wallet, ledger } = buildHarness();
    const txn = await service.postTransaction({
      tenantId: 'tenant-1', type: AiLedgerType.PURCHASE, amount: 50, notes: 'Stripe purchase',
    });
    expect(txn.balanceBefore.toString()).toBe('100');
    expect(txn.balanceAfter.toString()).toBe('150');
    expect(txn.referenceNo).toMatch(/^TXN-/);
    expect(wallet.balance.toString()).toBe('150');
    expect(wallet.totalPurchased.toString()).toBe('50');
    expect(ledger).toHaveLength(1);
  });

  it('rejects overdrafts — no ledger row, no balance change', async () => {
    const { service, wallet, ledger } = buildHarness();
    await expect(
      service.postTransaction({ tenantId: 'tenant-1', type: AiLedgerType.ADMIN_ADJUSTMENT, amount: -150 }),
    ).rejects.toBeInstanceOf(InsufficientCreditsError);
    expect(wallet.balance.toString()).toBe('100');
    expect(ledger).toHaveLength(0);
  });

  it('rejects zero-amount entries and closed wallets', async () => {
    const closed = buildHarness({ status: AiWalletStatus.CLOSED });
    await expect(
      closed.service.postTransaction({ tenantId: 'tenant-1', type: AiLedgerType.PURCHASE, amount: 10 }),
    ).rejects.toBeInstanceOf(WalletSuspendedError);

    const { service } = buildHarness();
    await expect(
      service.postTransaction({ tenantId: 'tenant-1', type: AiLedgerType.CORRECTION, amount: 0 }),
    ).rejects.toThrow('Ledger amount cannot be zero');
  });

  it('auto-suspends when the balance crosses the suspension threshold', async () => {
    const { service, wallet } = buildHarness({ suspendThreshold: D('0.5'), balance: D(1), reservedBalance: D(0) });
    // allowNegativeBalance not needed: 1 - 0.8 = 0.2 < 0.5 threshold
    await service.postTransaction({ tenantId: 'tenant-1', type: AiLedgerType.ADMIN_ADJUSTMENT, amount: -0.8 });
    expect(wallet.status).toBe(AiWalletStatus.SUSPENDED);
  });

  describe('reservation lifecycle', () => {
    it('reserve blocks when AVAILABLE (not raw) balance is insufficient', async () => {
      const { service } = buildHarness({ balance: D(10), reservedBalance: D(8) });
      await expect(
        service.reserveCredits({ tenantId: 'tenant-1', amount: 5 }),
      ).rejects.toBeInstanceOf(InsufficientCreditsError);
    });

    it('reserve → finalize charges actuals and releases the hold atomically', async () => {
      const { service, wallet, ledger } = buildHarness({ balance: D(20) });
      const reservation = await service.reserveCredits({ tenantId: 'tenant-1', amount: 5 });
      expect(wallet.reservedBalance.toString()).toBe('5');

      const { transaction } = await service.finalizeReservation(reservation.id, 3.25, { requestId: null });
      expect(wallet.reservedBalance.toString()).toBe('0');
      expect(wallet.balance.toString()).toBe('16.75');
      expect(wallet.totalConsumed.toString()).toBe('3.25');
      expect(transaction?.type).toBe(AiLedgerType.USAGE_CHARGE);
      expect(transaction?.amount.toString()).toBe('-3.25');
      expect(ledger).toHaveLength(1);
    });

    it('finalize with zero charge releases without a ledger row', async () => {
      const { service, wallet, ledger } = buildHarness({ balance: D(20) });
      const reservation = await service.reserveCredits({ tenantId: 'tenant-1', amount: 5 });
      const { transaction } = await service.finalizeReservation(reservation.id, 0, {});
      expect(transaction).toBeNull();
      expect(ledger).toHaveLength(0);
      expect(wallet.reservedBalance.toString()).toBe('0');
      expect(wallet.balance.toString()).toBe('20');
    });

    it('release returns the hold untouched (failed AI request) and double-finalize is rejected', async () => {
      const { service, wallet, ledger } = buildHarness({ balance: D(20) });
      const reservation = await service.reserveCredits({ tenantId: 'tenant-1', amount: 5 });
      await service.releaseReservation(reservation.id);
      expect(wallet.reservedBalance.toString()).toBe('0');
      expect(wallet.balance.toString()).toBe('20');
      expect(ledger).toHaveLength(0);
      await expect(service.finalizeReservation(reservation.id, 1, {})).rejects.toThrow(/not ACTIVE/);
    });

    it('suspended wallets cannot reserve', async () => {
      const { service } = buildHarness({ status: AiWalletStatus.SUSPENDED });
      await expect(service.reserveCredits({ tenantId: 'tenant-1', amount: 1 })).rejects.toBeInstanceOf(WalletSuspendedError);
    });

    it('finalize may take the balance below zero when actuals exceed the estimate (request already ran)', async () => {
      const { service, wallet } = buildHarness({ balance: D(1) });
      const reservation = await service.reserveCredits({ tenantId: 'tenant-1', amount: 1 });
      await service.finalizeReservation(reservation.id, 1.4, {});
      expect(wallet.balance.toString()).toBe('-0.4');
    });
  });

  it('ledger always reconciles: balance equals starting balance plus signed ledger sum', async () => {
    const { service, wallet, ledger } = buildHarness({ balance: D(0) });
    await service.postTransaction({ tenantId: 'tenant-1', type: AiLedgerType.PURCHASE, amount: 100 });
    await service.postTransaction({ tenantId: 'tenant-1', type: AiLedgerType.BONUS_CREDIT, amount: 10 });
    const reservation = await service.reserveCredits({ tenantId: 'tenant-1', amount: 20 });
    await service.finalizeReservation(reservation.id, 17.5, {});
    await service.postTransaction({ tenantId: 'tenant-1', type: AiLedgerType.REFUND, amount: 2.5 });

    const ledgerSum = ledger.reduce((sum, row) => sum.plus(row.amount), D(0));
    expect(wallet.balance.toString()).toBe(ledgerSum.toString());
    expect(wallet.balance.toString()).toBe('95');
    // Chain integrity: each row's before equals the previous row's after.
    for (let i = 1; i < ledger.length; i += 1) {
      expect(ledger[i].balanceBefore.toString()).toBe(ledger[i - 1].balanceAfter.toString());
    }
  });
});
