import { FxRateService } from './fx-rate.service';

describe('FxRateService', () => {
  it('returns 1 when currencies match', async () => {
    const service = new FxRateService({} as any);
    await expect(service.getRate('t1', 'USD', 'USD', new Date())).resolves.toBe(1);
  });

  it('throws when rate missing', async () => {
    const prisma = {
      fxRate: {
        findFirst: jest.fn().mockResolvedValue(null),
      },
    } as any;
    const service = new FxRateService(prisma);

    await expect(
      service.getRate('t1', 'EUR', 'USD', new Date('2026-02-01')),
    ).rejects.toThrow('FX rate missing');
  });

  it('returns numeric rate when found', async () => {
    const prisma = {
      fxRate: {
        findFirst: jest.fn().mockResolvedValue({ rate: '1.23' }),
      },
    } as any;
    const service = new FxRateService(prisma);

    await expect(
      service.getRate('t1', 'EUR', 'USD', new Date('2026-02-01')),
    ).resolves.toBe(1.23);
  });
});
