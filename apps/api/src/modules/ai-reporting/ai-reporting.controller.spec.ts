import { GUARDS_METADATA } from '@nestjs/common/constants';
import { AiReportingController } from './ai-reporting.controller';
import { AiReportingService } from './ai-reporting.service';
import { PERMISSIONS_KEY } from '../auth/decorators/permissions.decorator';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { RolesGuard } from '../auth/guards/roles.guard';
import { REQUIRE_MODULE_KEY } from '../platform/platform.constants';

describe('AiReportingController', () => {
  let service: jest.Mocked<Pick<AiReportingService, 'query' | 'dashboard' | 'getCatalogMetadata' | 'history'>>;
  let aiProvider: any;
  let controller: AiReportingController;

  beforeEach(() => {
    service = {
      query: jest.fn(),
      dashboard: jest.fn(),
      getCatalogMetadata: jest.fn(),
      history: jest.fn(),
    };
    aiProvider = {
      getPublicTenantProviderSettings: jest.fn(),
      saveTenantProviderSettings: jest.fn(),
      testTenantProviderSettings: jest.fn(),
      getTenantUsageSummary: jest.fn(),
    };
    controller = new AiReportingController(service as any, aiProvider);
  });

  it('requires authentication, AI reporting module, and base report permission at controller level', () => {
    const guards = Reflect.getMetadata(GUARDS_METADATA, AiReportingController);

    expect(guards).toEqual(expect.arrayContaining([JwtAuthGuard, RolesGuard]));
    expect(Reflect.getMetadata(REQUIRE_MODULE_KEY, AiReportingController)).toBe('ai-reporting');
    expect(Reflect.getMetadata(PERMISSIONS_KEY, AiReportingController)).toEqual(['report:read']);
  });

  it('requires base report permission for query endpoint and delegates AI authorization to the service', async () => {
    service.query.mockResolvedValueOnce({ status: 'success', rows: [] } as any);

    const permissions = Reflect.getMetadata(PERMISSIONS_KEY, controller.query);
    const result = await controller.query({ id: 'user-1' }, {
      question: 'Show top selling products this month',
      outputMode: 'auto',
      includeSummary: true,
      companyId: 11093,
      branchIds: ['33333333-3333-4333-8333-333333333333'],
    });

    expect(permissions).toEqual(['report:read']);
    expect(service.query).toHaveBeenCalledWith({ id: 'user-1' }, {
      question: 'Show top selling products this month',
      outputMode: 'auto',
      includeSummary: true,
      companyId: 11093,
      branchIds: ['33333333-3333-4333-8333-333333333333'],
    });
    expect(result).toEqual({ status: 'success', rows: [] });
  });

  it('requires base report permission for dashboard endpoint and delegates AI authorization to the service', async () => {
    service.dashboard.mockResolvedValueOnce({ status: 'success', widgets: [] } as any);

    await controller.dashboard({ id: 'user-1' }, { question: 'Generate sales dashboard', includeSummary: false });

    expect(Reflect.getMetadata(PERMISSIONS_KEY, controller.dashboard)).toEqual(['report:read']);
    expect(service.dashboard).toHaveBeenCalledWith({ id: 'user-1' }, {
      question: 'Generate sales dashboard',
      outputMode: 'auto',
      includeSummary: false,
      companyId: undefined,
      branchIds: undefined,
    });
  });

  it('exposes catalog and history through base report permission and delegates AI authorization to the service', async () => {
    service.getCatalogMetadata.mockReturnValueOnce({ catalogVersion: '1.0' } as any);
    service.history.mockResolvedValueOnce([]);

    expect(await controller.catalog({ id: 'user-1' })).toEqual({ catalogVersion: '1.0' });
    expect(await controller.history({ id: 'user-1' }, { limit: 10 })).toEqual([]);
    expect(Reflect.getMetadata(PERMISSIONS_KEY, controller.catalog)).toEqual(['report:read']);
    expect(Reflect.getMetadata(PERMISSIONS_KEY, controller.history)).toEqual(['report:read']);
    expect(service.getCatalogMetadata).toHaveBeenCalledWith({ id: 'user-1' });
    expect(service.history).toHaveBeenCalledWith({ id: 'user-1' }, 10);
  });

  it('exposes tenant AI provider settings through admin-only handlers', async () => {
    aiProvider.getPublicTenantProviderSettings.mockResolvedValueOnce({ provider: 'openai' });
    aiProvider.saveTenantProviderSettings.mockResolvedValueOnce({ provider: 'openai', model: 'gpt-5.4-mini' });
    aiProvider.testTenantProviderSettings.mockResolvedValueOnce({ success: true });
    aiProvider.getTenantUsageSummary.mockResolvedValueOnce({ totalCalls: 1 });

    expect(await controller.providerSettings({ tenantId: 'tenant-1' })).toEqual({ provider: 'openai' });
    expect(await controller.updateProviderSettings({ tenantId: 'tenant-1', id: 'user-1' }, { model: 'gpt-5.4-mini' })).toEqual({ provider: 'openai', model: 'gpt-5.4-mini' });
    expect(await controller.testProviderSettings({ tenantId: 'tenant-1', id: 'user-1' })).toEqual({ success: true });
    expect(await controller.usage({ tenantId: 'tenant-1' })).toEqual({ totalCalls: 1 });
    expect(Reflect.getMetadata(PERMISSIONS_KEY, controller.providerSettings)).toEqual([]);
    expect(Reflect.getMetadata(PERMISSIONS_KEY, controller.updateProviderSettings)).toEqual([]);
  });
});
