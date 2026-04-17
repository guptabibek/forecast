import { Injectable, NotFoundException } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { createHash, randomBytes, randomUUID } from 'crypto';
import { PrismaService } from '../../core/database/prisma.service';
import { UpdateSettingsDto } from './dto/update-settings.dto';

type StoredApiKey = {
  id: string;
  name: string;
  keyPrefix: string;
  keyHash: string;
  permissions: string[];
  createdAt: string;
  expiresAt?: string;
  lastUsedAt?: string;
  revokedAt?: string;
};

type StoredIntegration = {
  id: string;
  type: 'erp' | 'crm' | 'bi' | 'notification';
  name: string;
  provider: string;
  isEnabled: boolean;
  config: Record<string, unknown>;
  status: 'connected' | 'disconnected' | 'error';
  lastSyncAt?: string;
  createdAt: string;
  updatedAt: string;
};

@Injectable()
export class SettingsService {
  constructor(private readonly prisma: PrismaService) {}

  private async getTenantSettings(tenantId: string) {
    const tenant = await this.prisma.tenant.findUnique({
      where: { id: tenantId },
      select: { id: true, settings: true },
    });

    if (!tenant) {
      throw new NotFoundException('Tenant not found');
    }

    return {
      tenant,
      settings: ((tenant.settings as Record<string, unknown>) || {}) as Record<string, unknown>,
    };
  }

  private async saveTenantSettings(tenantId: string, settings: Record<string, unknown>) {
    await this.prisma.tenant.update({
      where: { id: tenantId },
      data: { settings: settings as Prisma.InputJsonValue },
    });
  }

  private getDefaultIntegrations(): StoredIntegration[] {
    const now = new Date().toISOString();
    return [
      {
        id: 'sap-s4hana',
        type: 'erp',
        name: 'SAP S/4HANA',
        provider: 'SAP',
        isEnabled: false,
        config: {},
        status: 'disconnected',
        createdAt: now,
        updatedAt: now,
      },
      {
        id: 'salesforce',
        type: 'crm',
        name: 'Salesforce',
        provider: 'Salesforce',
        isEnabled: false,
        config: {},
        status: 'disconnected',
        createdAt: now,
        updatedAt: now,
      },
      {
        id: 'snowflake',
        type: 'bi',
        name: 'Snowflake',
        provider: 'Snowflake',
        isEnabled: false,
        config: {},
        status: 'disconnected',
        createdAt: now,
        updatedAt: now,
      },
      {
        id: 'slack',
        type: 'notification',
        name: 'Slack',
        provider: 'Slack',
        isEnabled: false,
        config: {},
        status: 'disconnected',
        createdAt: now,
        updatedAt: now,
      },
    ];
  }

  private normalizeIntegrations(value: unknown): StoredIntegration[] {
    if (!Array.isArray(value) || value.length === 0) {
      return this.getDefaultIntegrations();
    }
    return value as StoredIntegration[];
  }

  async getSettings(user: any) {
    const tenant = await this.prisma.tenant.findUnique({
      where: { id: user.tenantId },
      select: {
        id: true,
        name: true,
        slug: true,
        domain: true,
        subdomain: true,
        logoUrl: true,
        primaryColor: true,
        timezone: true,
        defaultCurrency: true,
        fiscalYearStart: true,
        dataRetentionDays: true,
        status: true,
        tier: true,
        settings: true,
        createdAt: true,
        updatedAt: true,
      },
    });

    if (!tenant) {
      throw new NotFoundException('Tenant not found');
    }

    const settings = (tenant.settings as Record<string, any>) || {};

    return {
      id: tenant.id,
      name: tenant.name,
      slug: tenant.slug,
      domain: tenant.domain,
      subdomain: tenant.subdomain,
      logoUrl: tenant.logoUrl,
      primaryColor: tenant.primaryColor || '#3B82F6',
      timezone: tenant.timezone || 'UTC',
      defaultCurrency: tenant.defaultCurrency || 'USD',
      fiscalYearStart: tenant.fiscalYearStart || 1,
      dataRetentionDays: tenant.dataRetentionDays || 2555,
      status: tenant.status,
      tier: tenant.tier,
      // Custom settings from JSON field
      dateFormat: settings.dateFormat || 'MM/DD/YYYY',
      defaultForecastModel: settings.defaultForecastModel || 'MOVING_AVERAGE',
      emailNotifications: settings.emailNotifications ?? true,
      slackWebhookUrl: settings.slackWebhookUrl || null,
      ssoEnabled: settings.ssoEnabled ?? false,
      ssoProvider: settings.ssoProvider || null,
      // Branding & Appearance
      faviconUrl: settings.faviconUrl || null,
      brandTagline: settings.brandTagline || null,
      accentColor: settings.accentColor || '#10B981',
      sidebarBg: settings.sidebarBg || null,
      sidebarText: settings.sidebarText || null,
      headerBg: settings.headerBg || null,
      headerText: settings.headerText || null,
      // Typography
      headingFont: settings.headingFont || 'Inter',
      bodyFont: settings.bodyFont || 'Inter',
      baseFontSize: settings.baseFontSize ?? 14,
      headingWeight: settings.headingWeight ?? 700,
      // Theme & Layout
      defaultTheme: settings.defaultTheme || 'light',
      borderRadius: settings.borderRadius ?? 8,
      compactMode: settings.compactMode ?? false,
      loginBgUrl: settings.loginBgUrl || null,
      customCss: settings.customCss || null,
      // Module feature flags – TenantModule rows (managed by SA) override
      // the JSON-based enabledModules stored in tenant.settings.
      enabledModules: await this.resolveEnabledModules(tenant.id, settings),
    };
  }

  /**
   * Resolve the canonical enabled-modules map for a tenant.
   * TenantModule rows (set by SA) take precedence over the JSON settings column.
   */
  private async resolveEnabledModules(
    tenantId: string,
    settings: Record<string, any>,
  ): Promise<Record<string, boolean>> {
    const rows = await this.prisma.tenantModule.findMany({
      where: { tenantId },
      select: { module: true, enabled: true },
    });

    if (rows.length > 0) {
      // SA-managed modules take precedence
      const result: Record<string, boolean> = {};
      for (const key of ['planning', 'forecasting', 'manufacturing', 'reports', 'data', 'marg-ede']) {
        const row = rows.find((r) => r.module === key);
        result[key] = row ? row.enabled : true;
      }
      return result;
    }

    // Fallback: legacy JSON settings
    return {
      planning: settings.enabledModules?.planning ?? true,
      forecasting: settings.enabledModules?.forecasting ?? true,
      manufacturing: settings.enabledModules?.manufacturing ?? true,
      reports: settings.enabledModules?.reports ?? true,
      data: settings.enabledModules?.data ?? true,
    };
  }

  async updateSettings(updateSettingsDto: UpdateSettingsDto, user: any) {
    const tenant = await this.prisma.tenant.findUnique({
      where: { id: user.tenantId },
    });

    if (!tenant) {
      throw new NotFoundException('Tenant not found');
    }

    const currentSettings = (tenant.settings as Record<string, any>) || {};
    
    // Extract fields that go into the settings JSON
    const { 
      dateFormat, 
      defaultForecastModel, 
      emailNotifications,
      slackWebhookUrl,
      ssoEnabled,
      ssoProvider,
      // Branding & Appearance
      faviconUrl,
      brandTagline,
      accentColor,
      sidebarBg,
      sidebarText,
      headerBg,
      headerText,
      // Typography
      headingFont,
      bodyFont,
      baseFontSize,
      headingWeight,
      // Theme & Layout
      defaultTheme,
      borderRadius,
      compactMode,
      loginBgUrl,
      customCss,
      enabledModules,
      ...directFields 
    } = updateSettingsDto;

    // Merge custom settings
    const updatedSettings = {
      ...currentSettings,
      ...(dateFormat !== undefined && { dateFormat }),
      ...(defaultForecastModel !== undefined && { defaultForecastModel }),
      ...(emailNotifications !== undefined && { emailNotifications }),
      ...(slackWebhookUrl !== undefined && { slackWebhookUrl }),
      ...(ssoEnabled !== undefined && { ssoEnabled }),
      ...(ssoProvider !== undefined && { ssoProvider }),
      // Branding & Appearance
      ...(faviconUrl !== undefined && { faviconUrl }),
      ...(brandTagline !== undefined && { brandTagline }),
      ...(accentColor !== undefined && { accentColor }),
      ...(sidebarBg !== undefined && { sidebarBg }),
      ...(sidebarText !== undefined && { sidebarText }),
      ...(headerBg !== undefined && { headerBg }),
      ...(headerText !== undefined && { headerText }),
      // Typography
      ...(headingFont !== undefined && { headingFont }),
      ...(bodyFont !== undefined && { bodyFont }),
      ...(baseFontSize !== undefined && { baseFontSize }),
      ...(headingWeight !== undefined && { headingWeight }),
      // Theme & Layout
      ...(defaultTheme !== undefined && { defaultTheme }),
      ...(borderRadius !== undefined && { borderRadius }),
      ...(compactMode !== undefined && { compactMode }),
      ...(loginBgUrl !== undefined && { loginBgUrl }),
      ...(customCss !== undefined && { customCss }),
      ...(enabledModules !== undefined && { enabledModules: { ...currentSettings.enabledModules, ...enabledModules } }),
    };

    await this.prisma.tenant.update({
      where: { id: user.tenantId },
      data: {
        ...(directFields.name && { name: directFields.name }),
        ...(directFields.domain !== undefined && { domain: directFields.domain }),
        ...(directFields.subdomain !== undefined && { subdomain: directFields.subdomain }),
        ...(directFields.logoUrl !== undefined && { logoUrl: directFields.logoUrl }),
        ...(directFields.primaryColor !== undefined && { primaryColor: directFields.primaryColor }),
        ...(directFields.timezone && { timezone: directFields.timezone }),
        ...(directFields.defaultCurrency && { defaultCurrency: directFields.defaultCurrency }),
        ...(directFields.fiscalYearStart !== undefined && { fiscalYearStart: directFields.fiscalYearStart }),
        ...(directFields.dataRetentionDays !== undefined && { dataRetentionDays: directFields.dataRetentionDays }),
        settings: updatedSettings,
      },
    });

    return this.getSettings(user);
  }

  async getDomainMappings(user: any) {
    return this.prisma.domainMapping.findMany({
      where: { tenantId: user.tenantId },
      orderBy: { createdAt: 'desc' },
    });
  }

  async addDomainMapping(domain: string, user: any) {
    return this.prisma.domainMapping.create({
      data: {
        tenant: { connect: { id: user.tenantId } },
        domain,
        isVerified: false,
      },
    });
  }

  async removeDomainMapping(id: string, user: any) {
    const mapping = await this.prisma.domainMapping.findFirst({
      where: { id, tenantId: user.tenantId },
    });

    if (!mapping) {
      throw new NotFoundException('Domain mapping not found');
    }

    await this.prisma.domainMapping.delete({ where: { id } });
    return { message: 'Domain mapping removed successfully' };
  }

  async verifyDomain(id: string, user: any) {
    const mapping = await this.prisma.domainMapping.findFirst({
      where: { id, tenantId: user.tenantId },
    });

    if (!mapping) {
      throw new NotFoundException('Domain mapping not found');
    }

    // In a real implementation, you would verify DNS records here
    // For now, we'll just mark it as verified
    return this.prisma.domainMapping.update({
      where: { id },
      data: {
        isVerified: true,
        verifiedAt: new Date(),
      },
    });
  }

  async getApiKeys(user: any) {
    const { settings } = await this.getTenantSettings(user.tenantId);
    const storedKeys = Array.isArray(settings.apiKeys)
      ? (settings.apiKeys as StoredApiKey[])
      : [];

    const activeKeys = storedKeys
      .filter((key) => !key.revokedAt)
      .map(({ keyHash, ...publicKey }) => publicKey);

    return {
      data: activeKeys,
      total: activeKeys.length,
    };
  }

  async createApiKey(
    dto: { name?: string; permissions?: string[]; expiresIn?: number },
    user: any,
  ) {
    const { settings } = await this.getTenantSettings(user.tenantId);
    const storedKeys = Array.isArray(settings.apiKeys)
      ? (settings.apiKeys as StoredApiKey[])
      : [];

    const secret = `fsk_${randomBytes(24).toString('hex')}`;
    const keyHash = createHash('sha256').update(secret).digest('hex');
    const createdAt = new Date().toISOString();
    const expiresInDays = typeof dto?.expiresIn === 'number' ? dto.expiresIn : undefined;
    const expiresAt = expiresInDays && expiresInDays > 0
      ? new Date(Date.now() + expiresInDays * 24 * 60 * 60 * 1000).toISOString()
      : undefined;

    const apiKey: StoredApiKey = {
      id: randomUUID(),
      name: dto?.name?.trim() || 'Unnamed Key',
      keyPrefix: secret.slice(0, 12),
      keyHash,
      permissions: Array.isArray(dto?.permissions) ? dto.permissions : [],
      createdAt,
      ...(expiresAt ? { expiresAt } : {}),
    };

    settings.apiKeys = [...storedKeys, apiKey];
    await this.saveTenantSettings(user.tenantId, settings);

    const { keyHash: _omit, ...publicApiKey } = apiKey;
    return {
      data: {
        apiKey: publicApiKey,
        secret,
      },
    };
  }

  async revokeApiKey(id: string, user: any) {
    const { settings } = await this.getTenantSettings(user.tenantId);
    const storedKeys = Array.isArray(settings.apiKeys)
      ? (settings.apiKeys as StoredApiKey[])
      : [];

    const keyIndex = storedKeys.findIndex((key) => key.id === id && !key.revokedAt);
    if (keyIndex === -1) {
      throw new NotFoundException('API key not found');
    }

    storedKeys[keyIndex] = {
      ...storedKeys[keyIndex],
      revokedAt: new Date().toISOString(),
    };

    settings.apiKeys = storedKeys;
    await this.saveTenantSettings(user.tenantId, settings);
    return { message: 'API key revoked', id };
  }

  async getIntegrations(user: any) {
    const { settings } = await this.getTenantSettings(user.tenantId);
    const integrations = this.normalizeIntegrations(settings.integrations);

    if (!Array.isArray(settings.integrations) || settings.integrations.length === 0) {
      settings.integrations = integrations;
      await this.saveTenantSettings(user.tenantId, settings);
    }

    return {
      data: integrations,
      total: integrations.length,
    };
  }

  async updateIntegration(id: string, dto: any, user: any) {
    const { settings } = await this.getTenantSettings(user.tenantId);
    const integrations = this.normalizeIntegrations(settings.integrations);
    const now = new Date().toISOString();
    const index = integrations.findIndex((integration) => integration.id === id);

    const config = dto?.config && typeof dto.config === 'object' ? dto.config : undefined;
    const patch: Partial<StoredIntegration> = {
      ...(dto?.type ? { type: dto.type } : {}),
      ...(dto?.name ? { name: dto.name } : {}),
      ...(dto?.provider ? { provider: dto.provider } : {}),
      ...(dto?.isEnabled !== undefined ? { isEnabled: Boolean(dto.isEnabled) } : {}),
      ...(config ? { config } : {}),
      updatedAt: now,
    };

    let updated: StoredIntegration;
    if (index >= 0) {
      updated = {
        ...integrations[index],
        ...patch,
        status: patch.isEnabled === false
          ? 'disconnected'
          : integrations[index].status,
      };
      integrations[index] = updated;
    } else {
      const isEnabled = Boolean(dto?.isEnabled);
      updated = {
        id,
        type: dto?.type || 'erp',
        name: dto?.name || id,
        provider: dto?.provider || id,
        isEnabled,
        config: config || {},
        status: isEnabled ? 'connected' : 'disconnected',
        createdAt: now,
        updatedAt: now,
      };
      integrations.push(updated);
    }

    settings.integrations = integrations;
    await this.saveTenantSettings(user.tenantId, settings);
    return { data: updated };
  }

  async testIntegration(id: string, user: any) {
    const { settings } = await this.getTenantSettings(user.tenantId);
    const integrations = this.normalizeIntegrations(settings.integrations);
    const index = integrations.findIndex((integration) => integration.id === id);

    if (index === -1) {
      throw new NotFoundException('Integration not found');
    }

    const integration = integrations[index];
    const hasConfig = integration.config && Object.keys(integration.config).length > 0;
    const success = integration.isEnabled && hasConfig;
    const now = new Date().toISOString();

    integrations[index] = {
      ...integration,
      status: success ? 'connected' : (integration.isEnabled ? 'error' : 'disconnected'),
      lastSyncAt: now,
      updatedAt: now,
    };

    settings.integrations = integrations;
    await this.saveTenantSettings(user.tenantId, settings);

    return {
      data: {
        success,
        message: success
          ? `Connection test successful for ${integration.name}`
          : integration.isEnabled
            ? `Integration ${integration.name} is enabled but missing configuration`
            : `Integration ${integration.name} is disabled`,
        testedAt: now,
      },
    };
  }

  async getAuditLogs(user: any, page = 1, pageSize = 50) {
    const skip = (page - 1) * pageSize;

    const [logs, total] = await Promise.all([
      this.prisma.auditLog.findMany({
        where: { tenantId: user.tenantId },
        skip,
        take: pageSize,
        orderBy: { createdAt: 'desc' },
        include: {
          user: {
            select: { id: true, firstName: true, lastName: true, email: true },
          },
        },
      }),
      this.prisma.auditLog.count({ where: { tenantId: user.tenantId } }),
    ]);

    return {
      data: logs,
      meta: {
        total,
        page,
        pageSize,
        totalPages: Math.ceil(total / pageSize),
      },
    };
  }
}
