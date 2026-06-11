import { BadRequestException, ForbiddenException, NotFoundException } from '@nestjs/common';
import { DashboardService } from './dashboard.service';

describe('DashboardService', () => {
  const user = {
    id: '22222222-2222-4222-8222-222222222222',
    tenantId: '11111111-1111-4111-8111-111111111111',
    role: 'MEMBER',
    permissions: ['reports.ai.view'],
  };
  const requestId = '33333333-3333-4333-8333-333333333333';

  function buildPrismaMock() {
    return {
      $queryRawUnsafe: jest.fn().mockResolvedValue([]),
      $transaction: jest.fn(async (arg: any) => (typeof arg === 'function' ? arg(prismaPlaceholder) : Promise.all(arg))),
      aiDashboard: {
        findMany: jest.fn().mockResolvedValue([]),
        findFirst: jest.fn().mockResolvedValue(null),
        count: jest.fn().mockResolvedValue(0),
        create: jest.fn().mockResolvedValue(dashboardRow()),
        update: jest.fn(),
        updateMany: jest.fn(),
        delete: jest.fn(),
      },
      aiDashboardWidget: {
        findMany: jest.fn().mockResolvedValue([]),
        findFirst: jest.fn().mockResolvedValue(null),
        count: jest.fn().mockResolvedValue(0),
        create: jest.fn().mockResolvedValue(widgetRow()),
        update: jest.fn(),
        delete: jest.fn(),
      },
    } as any;
  }
  const prismaPlaceholder: any = {};

  function dashboardRow() {
    return {
      id: 'dash-1',
      tenantId: user.tenantId,
      userId: user.id,
      name: 'My Dashboard',
      description: null,
      isDefault: true,
      createdAt: new Date(),
      updatedAt: new Date(),
    };
  }

  function widgetRow() {
    return {
      id: 'widget-1',
      dashboardId: 'dash-1',
      tenantId: user.tenantId,
      userId: user.id,
      widgetType: 'pinned_report',
      title: 'Top products',
      question: 'Top selling products this month',
      vizType: null,
      size: 'medium',
      position: 0,
      refreshIntervalSec: null,
      createdAt: new Date(),
      updatedAt: new Date(),
    };
  }

  it('rejects users without AI reporting permissions', () => {
    const service = new DashboardService(buildPrismaMock());
    expect(() => service.assertViewPermission({ ...user, permissions: [] })).toThrow(ForbiddenException);
  });

  it('allows admins without explicit permissions', () => {
    const service = new DashboardService(buildPrismaMock());
    expect(() => service.assertViewPermission({ ...user, role: 'ADMIN', permissions: [] })).not.toThrow();
  });

  it('refuses to pin when no successful audited request exists', async () => {
    const prisma = buildPrismaMock();
    prisma.$queryRawUnsafe.mockResolvedValue([]);
    const service = new DashboardService(prisma);

    await expect(service.pinReport(user, { requestId })).rejects.toThrow(NotFoundException);
  });

  it('refuses to pin dashboard-kind queries', async () => {
    const prisma = buildPrismaMock();
    prisma.$queryRawUnsafe.mockResolvedValue([
      { question: 'sales dashboard', query_kind: 'dashboard', semantic_query: { queryKind: 'dashboard' }, status: 'success' },
    ]);
    const service = new DashboardService(prisma);

    await expect(service.pinReport(user, { requestId })).rejects.toThrow(BadRequestException);
  });

  it('pins the audited semantic query into a widget on the default dashboard', async () => {
    const prisma = buildPrismaMock();
    const semanticQuery = { queryKind: 'single_report', title: 'Top Products', datasetId: 'sales_items', metrics: ['net_sales'], dimensions: [] };
    prisma.$queryRawUnsafe.mockResolvedValue([
      { question: 'Top selling products this month', query_kind: 'single_report', semantic_query: semanticQuery, status: 'success' },
    ]);
    prisma.aiDashboard.findFirst.mockResolvedValue(dashboardRow());
    const service = new DashboardService(prisma);

    await service.pinReport(user, { requestId, refreshIntervalSec: 30 });

    expect(prisma.aiDashboardWidget.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          tenantId: user.tenantId,
          userId: user.id,
          dashboardId: 'dash-1',
          semanticQuery,
          sourceRequestId: requestId,
          // 30s requested → floored to the 60s minimum
          refreshIntervalSec: 60,
        }),
      }),
    );
  });

  it('enforces the per-dashboard widget cap', async () => {
    const prisma = buildPrismaMock();
    prisma.$queryRawUnsafe.mockResolvedValue([
      { question: 'q', query_kind: 'single_report', semantic_query: { queryKind: 'single_report' }, status: 'success' },
    ]);
    prisma.aiDashboard.findFirst.mockResolvedValue(dashboardRow());
    prisma.aiDashboardWidget.count.mockResolvedValue(30);
    const service = new DashboardService(prisma);

    await expect(service.pinReport(user, { requestId })).rejects.toThrow(BadRequestException);
  });
});
