import { BadRequestException } from '@nestjs/common';
import { DataService } from './data.service';

function createMockPrisma() {
  return {
    product: {
      findFirst: jest.fn(),
      create: jest.fn(),
    },
    costCenter: {
      findFirst: jest.fn(),
      create: jest.fn(),
      update: jest.fn(),
    },
    productCategory: {
      findFirst: jest.fn(),
    },
    unitOfMeasure: {
      findFirst: jest.fn(),
    },
    user: {
      findFirst: jest.fn(),
    },
  } as any;
}

describe('DataService product normalization', () => {
  const user = { tenantId: 'tenant-1' };

  it('resolves category and unit-of-measure IDs into canonical product fields', async () => {
    const prisma = createMockPrisma();
    prisma.product.findFirst.mockResolvedValue(null);
    prisma.productCategory.findFirst.mockResolvedValue({
      id: 'category-1',
      name: 'Component',
      code: 'COMPONENT',
    });
    prisma.unitOfMeasure.findFirst.mockResolvedValue({
      id: 'uom-1',
      code: 'EA',
      name: 'Each',
    });
    prisma.product.create.mockResolvedValue({
      id: 'product-1',
      code: 'PROD-001',
      name: 'Widget',
      status: 'ACTIVE',
      category: 'Component',
      categoryId: 'category-1',
      unitOfMeasure: 'EA',
      unitOfMeasureId: 'uom-1',
    });

    const service = new DataService(prisma, {} as any);

    const result = await service.createDimension(
      'product',
      {
        code: 'PROD-001',
        name: 'Widget',
        categoryId: 'category-1',
        unitOfMeasureId: 'uom-1',
      } as any,
      user,
    );

    expect(prisma.product.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          category: 'Component',
          categoryId: 'category-1',
          unitOfMeasure: 'EA',
          unitOfMeasureId: 'uom-1',
        }),
      }),
    );
    expect(result).toEqual(expect.objectContaining({ isActive: true }));
  });

  it('rejects unknown product category references', async () => {
    const prisma = createMockPrisma();
    prisma.product.findFirst.mockResolvedValue(null);
    prisma.productCategory.findFirst.mockResolvedValue(null);

    const service = new DataService(prisma, {} as any);

    await expect(
      service.createDimension(
        'product',
        {
          code: 'PROD-001',
          name: 'Widget',
          categoryId: 'category-missing',
        } as any,
        user,
      ),
    ).rejects.toBeInstanceOf(BadRequestException);
  });

  it('resolves legacy category and unit-of-measure strings against tenant masters', async () => {
    const prisma = createMockPrisma();
    prisma.product.findFirst.mockResolvedValue(null);
    prisma.productCategory.findFirst.mockResolvedValue({
      id: 'category-1',
      name: 'Component',
      code: 'COMPONENT',
    });
    prisma.unitOfMeasure.findFirst.mockResolvedValue({
      id: 'uom-1',
      code: 'EA',
      name: 'Each',
    });
    prisma.product.create.mockResolvedValue({
      id: 'product-1',
      code: 'PROD-001',
      name: 'Widget',
      status: 'ACTIVE',
    });

    const service = new DataService(prisma, {} as any);

    await service.createDimension(
      'product',
      {
        code: 'PROD-001',
        name: 'Widget',
        category: 'component',
        unitOfMeasure: 'ea',
      } as any,
      user,
    );

    expect(prisma.productCategory.findFirst).toHaveBeenCalled();
    expect(prisma.unitOfMeasure.findFirst).toHaveBeenCalled();
    expect(prisma.product.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          category: 'Component',
          categoryId: 'category-1',
          unitOfMeasure: 'EA',
          unitOfMeasureId: 'uom-1',
        }),
      }),
    );
  });
});

describe('DataService cost center normalization', () => {
  const user = { tenantId: 'tenant-1' };

  it('persists validated cost center managers as canonical user links', async () => {
    const prisma = createMockPrisma();
    prisma.costCenter.findFirst.mockResolvedValueOnce(null);
    prisma.user.findFirst.mockResolvedValue({
      id: 'user-1',
      email: 'alice@example.com',
      firstName: 'Alice',
      lastName: 'Johnson',
    });
    prisma.costCenter.create.mockResolvedValue({
      id: 'cost-center-1',
      code: 'CC-001',
      name: 'Operations',
      status: 'ACTIVE',
      managerId: 'user-1',
      manager: 'Alice Johnson',
    });

    const service = new DataService(prisma, {} as any);

    await service.createDimension(
      'cost_center',
      {
        code: 'CC-001',
        name: 'Operations',
        managerId: 'user-1',
      } as any,
      user,
    );

    expect(prisma.costCenter.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          managerUser: { connect: { id: 'user-1' } },
          manager: 'Alice Johnson',
        }),
      }),
    );
  });

  it('rejects unknown cost center managers', async () => {
    const prisma = createMockPrisma();
    prisma.costCenter.findFirst.mockResolvedValueOnce(null);
    prisma.user.findFirst.mockResolvedValue(null);

    const service = new DataService(prisma, {} as any);

    await expect(
      service.createDimension(
        'cost_center',
        {
          code: 'CC-001',
          name: 'Operations',
          managerId: 'missing-user',
        } as any,
        user,
      ),
    ).rejects.toBeInstanceOf(BadRequestException);
  });

  it('allows clearing manager assignments on cost center updates', async () => {
    const prisma = createMockPrisma();
    prisma.costCenter.findFirst.mockResolvedValue({
      id: 'cost-center-1',
      code: 'CC-001',
      name: 'Operations',
      status: 'ACTIVE',
      managerId: 'user-1',
      manager: 'Alice Johnson',
    });
    prisma.costCenter.update.mockResolvedValue({
      id: 'cost-center-1',
      code: 'CC-001',
      name: 'Operations',
      status: 'ACTIVE',
      managerId: null,
      manager: null,
    });

    const service = new DataService(prisma, {} as any);

    await service.updateDimension(
      'cost_center',
      'cost-center-1',
      {
        managerId: null,
      } as any,
      user,
    );

    expect(prisma.costCenter.update).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { id: 'cost-center-1' },
        data: expect.objectContaining({
          managerUser: { disconnect: true },
          manager: null,
        }),
      }),
    );
  });
});