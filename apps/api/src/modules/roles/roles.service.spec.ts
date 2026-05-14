import { RolesService } from './roles.service';

describe('RolesService', () => {
  function service(overrides: Record<string, unknown> = {}) {
    const prisma = {
      tenantRole: {
        findFirst: jest.fn(),
        findMany: jest.fn(),
        update: jest.fn(),
        create: jest.fn(),
        count: jest.fn(),
        createMany: jest.fn(),
        ...overrides,
      },
      tenantModule: {
        findMany: jest.fn().mockResolvedValue([]),
      },
    };
    return { prisma, rolesService: new RolesService(prisma as any) };
  }

  it('merges AI report permissions into an existing tenant admin system role', async () => {
    const { prisma, rolesService } = service();
    prisma.tenantRole.findFirst.mockResolvedValue({
      id: 'role-admin',
      name: 'Admin',
      slug: 'admin',
      permissions: ['report:read', 'reports.sales.view'],
      moduleAccess: { reports: false, planning: true },
    });

    await expect(rolesService.ensureDefaultAdminRole('tenant-1')).resolves.toEqual({
      id: 'role-admin',
      name: 'Admin',
      slug: 'admin',
    });

    expect(prisma.tenantRole.update).toHaveBeenCalledWith({
      where: { id: 'role-admin' },
      data: {
        permissions: expect.arrayContaining([
          'report:read',
          'reports.sales.view',
          'reports.purchase.view',
          'reports.inventory.view',
          'reports.outstanding.view',
          'reports.accounting.view',
          'reports.tax.view',
          'reports.ai.view',
          'reports.ai.execute',
          'reports.ai.dashboard',
        ]),
        moduleAccess: { reports: true, planning: true },
      },
    });
  });

  it('keeps existing custom permissions when system roles are reseeded', async () => {
    const { prisma, rolesService } = service();
    prisma.tenantRole.findMany.mockResolvedValue([
      {
        id: 'role-viewer',
        name: 'Viewer',
        slug: 'viewer',
        permissions: ['report:read', 'custom:keep'],
        moduleAccess: { reports: true },
      },
    ]);

    await rolesService.seedSystemRoles('tenant-1');

    expect(prisma.tenantRole.update).toHaveBeenCalledWith({
      where: { id: 'role-viewer' },
      data: {
        permissions: expect.arrayContaining([
          'report:read',
          'custom:keep',
          'reports.sales.view',
          'reports.purchase.view',
          'reports.inventory.view',
          'reports.ai.view',
          'reports.ai.execute',
        ]),
      },
    });
    expect(prisma.tenantRole.create).toHaveBeenCalled();
  });
});
