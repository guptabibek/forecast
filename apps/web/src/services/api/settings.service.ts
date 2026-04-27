import { apiClient } from './client';

export interface TenantSettings {
  id: string;
  name: string;
  slug: string;
  domain: string | null;
  subdomain: string | null;
  logoUrl: string | null;
  primaryColor: string;
  timezone: string;
  defaultCurrency: string;
  fiscalYearStart: number;
  dataRetentionDays: number;
  status: string;
  tier: string;
  dateFormat: string;
  defaultForecastModel: string;
  emailNotifications: boolean;
  slackWebhookUrl: string | null;
  ssoEnabled: boolean;
  ssoProvider: string | null;
  createdAt: string;
  updatedAt: string;
  // Branding & Appearance
  faviconUrl: string | null;
  brandTagline: string | null;
  accentColor: string;
  sidebarBg: string | null;
  sidebarText: string | null;
  headerBg: string | null;
  headerText: string | null;
  // Typography
  headingFont: string;
  bodyFont: string;
  baseFontSize: number;
  headingWeight: number;
  // Theme & Layout
  defaultTheme: string;
  borderRadius: number;
  compactMode: boolean;
  loginBgUrl: string | null;
  customCss: string | null;
  // Module feature flags
  enabledModules?: {
    planning: boolean;
    forecasting: boolean;
    manufacturing: boolean;
    reports: boolean;
    data: boolean;
    'marg-ede'?: boolean;
  };
}

export interface UpdateSettingsDto {
  name?: string;
  domain?: string;
  subdomain?: string;
  logoUrl?: string;
  primaryColor?: string;
  timezone?: string;
  defaultCurrency?: string;
  dateFormat?: string;
  fiscalYearStart?: number;
  defaultForecastModel?: string;
  emailNotifications?: boolean;
  slackWebhookUrl?: string;
  ssoEnabled?: boolean;
  ssoProvider?: string;
  dataRetentionDays?: number;
  // Branding & Appearance
  faviconUrl?: string;
  brandTagline?: string;
  accentColor?: string;
  sidebarBg?: string;
  sidebarText?: string;
  headerBg?: string;
  headerText?: string;
  // Typography
  headingFont?: string;
  bodyFont?: string;
  baseFontSize?: number;
  headingWeight?: number;
  // Theme & Layout
  defaultTheme?: string;
  borderRadius?: number;
  compactMode?: boolean;
  loginBgUrl?: string;
  customCss?: string;
}

export interface ApiKey {
  id: string;
  name: string;
  keyPrefix: string;
  permissions: string[];
  expiresAt?: string;
  lastUsedAt?: string;
  createdAt: string;
}

export interface CreateApiKeyDto {
  name: string;
  permissions: string[];
  expiresIn?: number; // days
}

export interface CreateApiKeyResponse {
  apiKey: ApiKey;
  secret: string; // Only returned once on creation
}

export interface QuickCreateApiKeyResponse {
  data?: {
    secret?: string;
    apiKey?: string;
  };
  secret?: string;
  apiKey?: string;
}

export interface AuditLog {
  id: string;
  userId: string;
  userEmail: string;
  action: string;
  resource: string;
  resourceId: string;
  oldValue?: Record<string, unknown>;
  newValue?: Record<string, unknown>;
  ipAddress: string;
  userAgent: string;
  createdAt: string;
}

export const settingsService = {
  async getSettings(): Promise<TenantSettings> {
    const { data } = await apiClient.get<{ data: TenantSettings }>('/settings');
    return data.data;
  },

  async updateSettings(dto: UpdateSettingsDto): Promise<TenantSettings> {
    const { data } = await apiClient.patch<{ data: TenantSettings }>('/settings', dto);
    return data.data;
  },

  async getApiKeys(): Promise<ApiKey[]> {
    const { data } = await apiClient.get<{ data: ApiKey[] }>('/settings/api-keys');
    return data.data;
  },

  async createApiKey(dto: CreateApiKeyDto): Promise<CreateApiKeyResponse> {
    const { data } = await apiClient.post<{ data: CreateApiKeyResponse }>('/settings/api-keys', dto);
    return data.data;
  },

  async revokeApiKey(id: string): Promise<void> {
    await apiClient.delete(`/settings/api-keys/${id}`);
  },

  async getAuditLogs(params?: {
    page?: number;
    limit?: number;
    userId?: string;
    action?: string;
    resource?: string;
    startDate?: string;
    endDate?: string;
  }): Promise<{ data: AuditLog[]; total: number }> {
    const { data } = await apiClient.get<{ data: AuditLog[]; meta: { total: number } }>('/settings/audit-logs', { params });
    return { data: data.data, total: data.meta.total };
  },

  async exportAuditLogs(params: {
    startDate: string;
    endDate: string;
    format: 'csv' | 'json';
  }): Promise<Blob> {
    const { data } = await apiClient.get('/settings/audit-logs/export', {
      params,
      responseType: 'blob',
    });
    return data;
  },

  async getIntegrations(): Promise<Integration[]> {
    const { data } = await apiClient.get<{ data: Integration[] }>('/settings/integrations');
    return data.data;
  },

  async updateIntegration(id: string, dto: UpdateIntegrationDto): Promise<Integration> {
    const { data } = await apiClient.patch<{ data: Integration }>(`/settings/integrations/${id}`, dto);
    return data.data;
  },

  async testIntegration(id: string): Promise<{ success: boolean; message: string }> {
    const { data } = await apiClient.post<{ data: { success: boolean; message: string } }>(`/settings/integrations/${id}/test`);
    return data.data;
  },

  // Direct-response methods for page components
  async fetchSettings(): Promise<TenantSettings> {
    const { data } = await apiClient.get<TenantSettings>('/settings');
    return data;
  },

  async patchSettings(payload: Record<string, unknown>): Promise<TenantSettings> {
    const { data } = await apiClient.patch('/settings', payload);
    return data;
  },

  async quickCreateApiKey(name: string): Promise<QuickCreateApiKeyResponse> {
    const { data } = await apiClient.post<QuickCreateApiKeyResponse>('/settings/api-keys', { name });
    return data;
  },
};

export interface Integration {
  id: string;
  type: 'erp' | 'crm' | 'bi' | 'notification';
  name: string;
  provider: string;
  isEnabled: boolean;
  config: Record<string, unknown>;
  lastSyncAt?: string;
  status: 'connected' | 'disconnected' | 'error';
  createdAt: string;
  updatedAt: string;
}

export interface UpdateIntegrationDto {
  isEnabled?: boolean;
  config?: Record<string, unknown>;
}
