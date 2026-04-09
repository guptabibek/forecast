import { describe, expect, it, jest } from '@jest/globals';
import { ManufacturingService } from './manufacturing.service';

const PRODUCT_ID = '11111111-1111-4111-8111-111111111111';
const LOCATION_ID = '22222222-2222-4222-8222-222222222222';
const CUSTOMER_ID = '33333333-3333-4333-8333-333333333333';
const CHANNEL_ID = '55555555-5555-4555-8555-555555555555';
const PROMOTION_ID = '44444444-4444-4444-8444-444444444444';

function buildPromotion(overrides: Record<string, unknown> = {}) {
  return {
    id: PROMOTION_ID,
    tenantId: 'tenant-1',
    code: 'PROMO-000001',
    name: 'Back to School',
    description: null,
    type: 'DISCOUNT',
    status: 'DRAFT',
    startDate: new Date('2026-09-01T00:00:00.000Z'),
    endDate: new Date('2026-09-30T00:00:00.000Z'),
    discountPercent: null,
    discountAmount: null,
    marketingSpend: null,
    budget: null,
    notes: null,
    productIds: [],
    locationIds: [],
    customerIds: [],
    channelIds: [],
    liftFactors: [],
    productTargets: [],
    locationTargets: [],
    customerTargets: [],
    channelTargets: [],
    ...overrides,
  };
}

function createServiceContext() {
  const service = new ManufacturingService({} as any, {} as any, {} as any, {} as any, {} as any, {} as any);
  const tx = {
    promotion: {
      create: jest.fn(),
      update: jest.fn(),
    },
    promotionProductTarget: {
      deleteMany: jest.fn(),
      createMany: jest.fn(),
    },
    promotionLocationTarget: {
      deleteMany: jest.fn(),
      createMany: jest.fn(),
    },
    promotionCustomerTarget: {
      deleteMany: jest.fn(),
      createMany: jest.fn(),
    },
    promotionChannelTarget: {
      deleteMany: jest.fn(),
      createMany: jest.fn(),
    },
  } as any;
  const prisma = {
    promotion: {
      count: jest.fn(),
      findFirst: jest.fn(),
    },
    product: {
      findMany: jest.fn(),
    },
    location: {
      findMany: jest.fn(),
    },
    customer: {
      findMany: jest.fn(),
    },
    channel: {
      findFirst: jest.fn(),
      create: jest.fn(),
    },
    $transaction: jest.fn(async (callback: (client: typeof tx) => unknown) => callback(tx)),
  } as any;

  (service as any).prisma = prisma;

  return { service, prisma, tx };
}

describe('ManufacturingService promotion target normalization', () => {
  it('persists validated promotion targets into canonical relation tables on create', async () => {
    const context = createServiceContext();
    context.prisma.promotion.count.mockResolvedValue(0);
    context.prisma.product.findMany.mockResolvedValue([{ id: PRODUCT_ID }]);
    context.prisma.location.findMany.mockResolvedValue([{ id: LOCATION_ID }]);
    context.prisma.customer.findMany.mockResolvedValue([{ id: CUSTOMER_ID }]);
    context.prisma.channel.findFirst.mockResolvedValue(null);
    context.prisma.channel.create.mockResolvedValue({ id: CHANNEL_ID });
    context.tx.promotion.create.mockResolvedValue({ id: PROMOTION_ID });
    context.prisma.promotion.findFirst.mockResolvedValue(
      buildPromotion({
        productTargets: [{ productId: PRODUCT_ID }],
        locationTargets: [{ locationId: LOCATION_ID }],
        customerTargets: [{ customerId: CUSTOMER_ID }],
        channelTargets: [{ channelId: CHANNEL_ID }],
      }),
    );

    const result = await context.service.createPromotion('tenant-1', {
      name: 'Back to School',
      type: 'DISCOUNT',
      startDate: '2026-09-01',
      endDate: '2026-09-30',
      productIds: [PRODUCT_ID],
      locationIds: [LOCATION_ID],
      customerIds: [CUSTOMER_ID],
      channelIds: ['Modern Trade'],
    });

    expect(context.prisma.product.findMany).toHaveBeenCalledWith({
      where: {
        tenantId: 'tenant-1',
        id: { in: [PRODUCT_ID] },
      },
      select: { id: true },
    });
    expect(context.prisma.location.findMany).toHaveBeenCalledWith({
      where: {
        tenantId: 'tenant-1',
        id: { in: [LOCATION_ID] },
      },
      select: { id: true },
    });
    expect(context.prisma.customer.findMany).toHaveBeenCalledWith({
      where: {
        tenantId: 'tenant-1',
        id: { in: [CUSTOMER_ID] },
      },
      select: { id: true },
    });
    expect(context.tx.promotion.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          productIds: [PRODUCT_ID],
          locationIds: [LOCATION_ID],
          customerIds: [CUSTOMER_ID],
        }),
      }),
    );
    expect(context.tx.promotionProductTarget.createMany).toHaveBeenCalledWith({
      data: [{ promotionId: PROMOTION_ID, productId: PRODUCT_ID }],
      skipDuplicates: true,
    });
    expect(context.tx.promotionLocationTarget.createMany).toHaveBeenCalledWith({
      data: [{ promotionId: PROMOTION_ID, locationId: LOCATION_ID }],
      skipDuplicates: true,
    });
    expect(context.tx.promotionCustomerTarget.createMany).toHaveBeenCalledWith({
      data: [{ promotionId: PROMOTION_ID, customerId: CUSTOMER_ID }],
      skipDuplicates: true,
    });
    expect(context.prisma.channel.create).toHaveBeenCalledWith({
      data: {
        tenantId: 'tenant-1',
        code: expect.any(String),
        name: 'Modern Trade',
      },
      select: { id: true },
    });
    expect(context.tx.promotionChannelTarget.createMany).toHaveBeenCalledWith({
      data: [{ promotionId: PROMOTION_ID, channelId: CHANNEL_ID }],
      skipDuplicates: true,
    });
    expect(result.productIds).toEqual([PRODUCT_ID]);
    expect(result.locationIds).toEqual([LOCATION_ID]);
    expect(result.customerIds).toEqual([CUSTOMER_ID]);
    expect(result.channelIds).toEqual([CHANNEL_ID]);
  });

  it('rejects promotion targets that do not belong to the tenant', async () => {
    const context = createServiceContext();
    context.prisma.promotion.count.mockResolvedValue(0);
    context.prisma.product.findMany.mockResolvedValue([]);
    context.prisma.location.findMany.mockResolvedValue([]);
    context.prisma.customer.findMany.mockResolvedValue([]);

    await expect(
      context.service.createPromotion('tenant-1', {
        name: 'Back to School',
        type: 'DISCOUNT',
        startDate: '2026-09-01',
        endDate: '2026-09-30',
        productIds: [PRODUCT_ID],
      }),
    ).rejects.toThrow(
      `Promotion product targets were not found for this tenant: ${PRODUCT_ID}`,
    );

    expect(context.prisma.$transaction).not.toHaveBeenCalled();
  });

  it('serializes relation-backed promotion targets back to array fields', async () => {
    const context = createServiceContext();
    context.prisma.promotion.findFirst.mockResolvedValue(
      buildPromotion({
        productIds: ['stale-product-id'],
        locationIds: ['stale-location-id'],
        customerIds: ['stale-customer-id'],
        channelIds: ['stale-channel-id'],
        productTargets: [{ productId: PRODUCT_ID }],
        locationTargets: [{ locationId: LOCATION_ID }],
        customerTargets: [{ customerId: CUSTOMER_ID }],
        channelTargets: [{ channelId: CHANNEL_ID }],
      }),
    );

    const result = await context.service.getPromotion('tenant-1', PROMOTION_ID);

    expect(result.productIds).toEqual([PRODUCT_ID]);
    expect(result.locationIds).toEqual([LOCATION_ID]);
    expect(result.customerIds).toEqual([CUSTOMER_ID]);
    expect(result.channelIds).toEqual([CHANNEL_ID]);
    expect(result).not.toHaveProperty('productTargets');
    expect(result).not.toHaveProperty('locationTargets');
    expect(result).not.toHaveProperty('customerTargets');
    expect(result).not.toHaveProperty('channelTargets');
  });

  it('clears canonical promotion targets when an update sends empty arrays', async () => {
    const context = createServiceContext();
    context.prisma.promotion.findFirst
      .mockResolvedValueOnce({ id: PROMOTION_ID, tenantId: 'tenant-1' })
      .mockResolvedValueOnce(buildPromotion());
    context.tx.promotion.update.mockResolvedValue({ id: PROMOTION_ID });

    const result = await context.service.updatePromotion('tenant-1', PROMOTION_ID, {
      productIds: [],
      customerIds: [],
      channelIds: [],
    });

    expect(context.tx.promotion.update).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          productIds: [],
          customerIds: [],
          channelIds: [],
        }),
      }),
    );
    expect(context.tx.promotionProductTarget.deleteMany).toHaveBeenCalledWith({
      where: { promotionId: PROMOTION_ID },
    });
    expect(context.tx.promotionCustomerTarget.deleteMany).toHaveBeenCalledWith({
      where: { promotionId: PROMOTION_ID },
    });
    expect(context.tx.promotionChannelTarget.deleteMany).toHaveBeenCalledWith({
      where: { promotionId: PROMOTION_ID },
    });
    expect(context.tx.promotionProductTarget.createMany).not.toHaveBeenCalled();
    expect(context.tx.promotionCustomerTarget.createMany).not.toHaveBeenCalled();
    expect(context.tx.promotionChannelTarget.createMany).not.toHaveBeenCalled();
    expect(result.productIds).toEqual([]);
    expect(result.customerIds).toEqual([]);
    expect(result.channelIds).toEqual([]);
  });
});