import { apiClient } from './client';

export interface PlatformStats {
  tenants: { total: number; active: number; trial: number };
  users: { total: number };
}

export type TenantLicenseStatus = 'ACTIVE' | 'SUSPENDED';

export interface TenantDomainMapping {
  id: string;
  domain: string;
  isVerified: boolean;
  verifiedAt: string | null;
  sslEnabled: boolean;
  createdAt: string;
}

export interface TenantSummary {
  id: string;
  name: string;
  slug: string;
  domain: string | null;
  subdomain: string | null;
  status: string;
  licenseStatus: TenantLicenseStatus;
  licenseExpiresAt: string | null;
  tier: string;
  timezone: string;
  defaultCurrency: string;
  logoUrl: string | null;
  createdAt: string;
  updatedAt: string;
  _count: { users: number };
}

export interface TenantDetail extends TenantSummary {
  domainMappings: TenantDomainMapping[];
  tenantModules: Array<{
    id: string;
    module: string;
    enabled: boolean;
    config: Record<string, unknown>;
    createdAt: string;
    updatedAt: string;
  }>;
  _count: { users: number; products: number; actuals: number };
}

export interface TenantModuleConfig {
  module: string;
  enabled: boolean;
  config: Record<string, unknown>;
  updatedAt: string | null;
}

export interface TenantUser {
  id: string;
  email: string;
  firstName: string;
  lastName: string;
  role: string;
  status: string;
  lastLoginAt: string | null;
  createdAt: string;
}

export interface PaginatedResponse<T> {
  data: T[];
  meta: { total: number; page: number; limit: number; totalPages: number };
}

export interface TenantResetResult {
  tenantId: string;
  tenantName: string;
  tenantSlug: string;
  preservedAdminEmails: string[];
  deletedTables: string[];
  deletedNonAdminUsers: number;
  totalRowsDeleted: number;
}

export interface TenantDomainResetResult {
  tenantId: string;
  tenantSlug: string;
  subdomain: string | null;
  domain: string | null;
  deletedDomainMappings: number;
}

export const platformService = {
  // ─── Stats ──────────────────────────────────────────
  async getStats(): Promise<PlatformStats> {
    const { data } = await apiClient.get<{ data: PlatformStats }>('/platform/stats');
    return data.data;
  },

  // ─── Tenants ────────────────────────────────────────
  async listTenants(params?: {
    status?: string;
    tier?: string;
    search?: string;
    page?: number;
    limit?: number;
  }): Promise<PaginatedResponse<TenantSummary>> {
    const { data } = await apiClient.get<PaginatedResponse<TenantSummary>>(
      '/platform/tenants',
      { params },
    );
    return data;
  },

  async getTenant(id: string): Promise<TenantDetail> {
    const { data } = await apiClient.get<{ data: TenantDetail }>(`/platform/tenants/${id}`);
    return data.data;
  },

  async updateTenant(
    id: string,
    payload: Partial<{
      name: string;
      status: string;
      tier: string;
      domain: string;
      subdomain: string;
      timezone: string;
      defaultCurrency: string;
      dataRetentionDays: number;
      licenseStatus: TenantLicenseStatus;
      licenseExpiresAt: string | null;
    }>,
  ): Promise<TenantDetail> {
    const { data } = await apiClient.patch<{ data: TenantDetail }>(
      `/platform/tenants/${id}`,
      payload,
    );
    return data.data;
  },

  async createTenant(payload: {
    name: string;
    slug: string;
    adminEmail: string;
    adminPassword: string;
    adminFirstName?: string;
    adminLastName?: string;
    status?: string;
    tier?: string;
    domain?: string;
    timezone?: string;
    defaultCurrency?: string;
  }): Promise<TenantDetail> {
    const { data } = await apiClient.post<{ data: TenantDetail }>(
      '/platform/tenants',
      payload,
    );
    return data.data;
  },

  async resetTenantData(tenantId: string): Promise<TenantResetResult> {
    const { data } = await apiClient.post<{ data: TenantResetResult }>(
      `/platform/tenants/${tenantId}/reset-data`,
    );
    return data.data;
  },

  async resetTenantDomains(tenantId: string): Promise<TenantDomainResetResult> {
    const { data } = await apiClient.post<{ data: TenantDomainResetResult }>(
      `/platform/tenants/${tenantId}/reset-domains`,
    );
    return data.data;
  },

  // ─── Modules ────────────────────────────────────────
  async getModules(tenantId: string): Promise<TenantModuleConfig[]> {
    const { data } = await apiClient.get<{ data: TenantModuleConfig[] }>(
      `/platform/tenants/${tenantId}/modules`,
    );
    return data.data;
  },

  async setModules(
    tenantId: string,
    modules: Array<{ module: string; enabled: boolean }>,
  ): Promise<TenantModuleConfig[]> {
    const { data } = await apiClient.post<{ data: TenantModuleConfig[] }>(
      `/platform/tenants/${tenantId}/modules`,
      { modules },
    );
    return data.data;
  },

  async toggleModule(
    tenantId: string,
    module: string,
    enabled: boolean,
  ): Promise<TenantModuleConfig[]> {
    const { data } = await apiClient.patch<{ data: TenantModuleConfig[] }>(
      `/platform/tenants/${tenantId}/modules/${module}`,
      { enabled },
    );
    return data.data;
  },

  // ─── Tenant Users ──────────────────────────────────
  async listTenantUsers(
    tenantId: string,
    params?: { page?: number; limit?: number },
  ): Promise<PaginatedResponse<TenantUser>> {
    const { data } = await apiClient.get<PaginatedResponse<TenantUser>>(
      `/platform/tenants/${tenantId}/users`,
      { params },
    );
    return data;
  },

  // ─── My Modules (for current tenant sidebar) ──────
  async getMyModules(): Promise<Record<string, boolean>> {
    const { data } = await apiClient.get<{ data: Record<string, boolean> }>(
      '/platform/modules/me',
    );
    return data.data;
  },
};
