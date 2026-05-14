import { ManufacturingService } from './manufacturing.service';

function createServiceContext() {
  const service = new ManufacturingService({} as any, {} as any, {} as any, {} as any, {} as any, {} as any);
  const prisma = {
    sOPCycle: {
      findFirst: jest.fn(),
      create: jest.fn(),
      update: jest.fn(),
    },
    user: {
      findMany: jest.fn(),
    },
  } as any;

  (service as any).prisma = prisma;

  return { service, prisma };
}

describe('ManufacturingService S&OP manager normalization', () => {
  it('persists validated manager assignments when creating an S&OP cycle', async () => {
    const context = createServiceContext();
    context.prisma.sOPCycle.findFirst.mockResolvedValue(null);
    context.prisma.user.findMany.mockResolvedValue([
      { id: '9cc4b7cf-a531-4a02-a6af-9caa7ec68d90' },
      { id: '6957f6ca-7bf5-4056-ad16-f5c50415c746' },
    ]);
    context.prisma.sOPCycle.create.mockResolvedValue({ id: 'cycle-1' });

    await context.service.createSOPCycle('tenant-1', 'user-1', {
      name: 'S&OP 2026-04',
      fiscalYear: 2026,
      fiscalPeriod: 4,
      planningStart: new Date('2026-04-01T00:00:00.000Z'),
      demandReviewDate: new Date('2026-04-05T00:00:00.000Z'),
      supplyReviewDate: new Date('2026-04-10T00:00:00.000Z'),
      preSopDate: new Date('2026-04-15T00:00:00.000Z'),
      executiveSopDate: new Date('2026-04-20T00:00:00.000Z'),
      planningEnd: new Date('2026-04-30T00:00:00.000Z'),
      demandManagerId: '9cc4b7cf-a531-4a02-a6af-9caa7ec68d90',
      executiveSponsorId: '6957f6ca-7bf5-4056-ad16-f5c50415c746',
    });

    expect(context.prisma.user.findMany).toHaveBeenCalledWith({
      where: {
        tenantId: 'tenant-1',
        status: 'ACTIVE',
        id: {
          in: [
            '9cc4b7cf-a531-4a02-a6af-9caa7ec68d90',
            '6957f6ca-7bf5-4056-ad16-f5c50415c746',
          ],
        },
      },
      select: { id: true },
    });
    expect(context.prisma.sOPCycle.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          demandManager: '9cc4b7cf-a531-4a02-a6af-9caa7ec68d90',
          executiveSponsor: '6957f6ca-7bf5-4056-ad16-f5c50415c746',
        }),
      }),
    );
  });

  it('rejects manager assignments that do not belong to an active tenant user', async () => {
    const context = createServiceContext();
    context.prisma.sOPCycle.findFirst.mockResolvedValue({
      id: 'cycle-1',
      planningEnd: new Date('2026-04-30T00:00:00.000Z'),
    });
    context.prisma.user.findMany.mockResolvedValue([]);

    await expect(
      context.service.updateSOPCycle('tenant-1', 'cycle-1', {
        demandManagerId: '9cc4b7cf-a531-4a02-a6af-9caa7ec68d90',
      }),
    ).rejects.toThrow('Demand manager user was not found for this tenant');
  });

  it('allows clearing a manager assignment on update', async () => {
    const context = createServiceContext();
    context.prisma.sOPCycle.findFirst.mockResolvedValue({
      id: 'cycle-1',
      planningEnd: new Date('2026-04-30T00:00:00.000Z'),
    });
    context.prisma.sOPCycle.update.mockResolvedValue({ id: 'cycle-1' });

    await context.service.updateSOPCycle('tenant-1', 'cycle-1', {
      demandManagerId: '',
    });

    expect(context.prisma.user.findMany).not.toHaveBeenCalled();
    expect(context.prisma.sOPCycle.update).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          demandManager: null,
        }),
      }),
    );
  });
});