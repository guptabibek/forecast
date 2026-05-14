import { ForbiddenException, Injectable } from '@nestjs/common';
import { TenantLicenseStatus, TenantStatus } from '@prisma/client';
import { PrismaService } from './prisma.service';

type TenantAccessSnapshot = {
  id: string;
  slug: string;
  tier: string;
  status: TenantStatus;
  licenseStatus: TenantLicenseStatus;
  licenseExpiresAt: Date | null;
};

type CachedTenantAccessSnapshot = TenantAccessSnapshot & {
  expiresAt: number;
};

const TENANT_ACCESS_CACHE_TTL_MS = 60_000;

@Injectable()
export class TenantAccessService {
  private readonly tenantCache = new Map<string, CachedTenantAccessSnapshot>();

  constructor(private readonly prisma: PrismaService) {}

  async getTenantSnapshot(tenantId: string): Promise<TenantAccessSnapshot | null> {
    const cached = this.tenantCache.get(tenantId);
    if (cached && cached.expiresAt > Date.now()) {
      return cached;
    }

    const tenant = await this.prisma.tenant.findUnique({
      where: { id: tenantId },
      select: {
        id: true,
        slug: true,
        tier: true,
        status: true,
        licenseStatus: true,
        licenseExpiresAt: true,
      },
    });

    if (!tenant) {
      this.tenantCache.delete(tenantId);
      return null;
    }

    const snapshot: CachedTenantAccessSnapshot = {
      ...tenant,
      expiresAt: Date.now() + TENANT_ACCESS_CACHE_TTL_MS,
    };

    this.tenantCache.set(tenantId, snapshot);
    this.pruneExpiredEntries();

    return tenant;
  }

  invalidateTenant(tenantId: string): void {
    this.tenantCache.delete(tenantId);
  }

  getAccessBlockMessage(
    tenant:
      | Pick<TenantAccessSnapshot, 'status' | 'licenseStatus' | 'licenseExpiresAt'>
      | null
      | undefined,
  ): string | null {
    if (!tenant) {
      return 'Tenant not found';
    }

    if (tenant.status !== 'ACTIVE' && tenant.status !== 'TRIAL') {
      return 'Tenant is not active';
    }

    if (tenant.licenseStatus !== 'ACTIVE') {
      return 'Tenant license is suspended';
    }

    if (tenant.licenseExpiresAt && tenant.licenseExpiresAt.getTime() <= Date.now()) {
      return 'Tenant license has expired';
    }

    return null;
  }

  assertTenantAccess(
    tenant:
      | Pick<TenantAccessSnapshot, 'status' | 'licenseStatus' | 'licenseExpiresAt'>
      | null
      | undefined,
  ): void {
    const blockMessage = this.getAccessBlockMessage(tenant);
    if (blockMessage) {
      throw new ForbiddenException(blockMessage);
    }
  }

  private pruneExpiredEntries(): void {
    if (this.tenantCache.size < 1000) {
      return;
    }

    const now = Date.now();
    for (const [key, value] of this.tenantCache.entries()) {
      if (value.expiresAt <= now) {
        this.tenantCache.delete(key);
      }
    }
  }
}