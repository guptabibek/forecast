import {
    BadRequestException,
    ConflictException,
    Injectable,
    Logger,
    NotFoundException
} from '@nestjs/common';
import { Prisma, TenantLicenseStatus, TenantStatus, TenantTier } from '@prisma/client';
import { PrismaService } from '../../core/database/prisma.service';
import { TenantAccessService } from '../../core/database/tenant-access.service';
import { RolesService } from '../roles/roles.service';
import { ModuleGuard } from './module.guard';
import {
    DEFAULT_ENABLED_MODULES,
    PLATFORM_MODULES,
    PlatformModuleKey,
} from './platform.constants';

const RESET_PRESERVED_TABLES = new Set([
  'domain_mappings',
  'marg_sync_configs',
  'tenant_modules',
  'tenant_roles',
  'tenants',
  'users',
]);

const RESET_PRESERVED_ROLES = ['ADMIN', 'SUPER_ADMIN'] as const;

@Injectable()
export class PlatformService {
  private readonly logger = new Logger(PlatformService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly moduleGuard: ModuleGuard,
    private readonly rolesService: RolesService,
    private readonly tenantAccessService: TenantAccessService,
  ) {}

  // ─── Tenant CRUD ──────────────────────────────────────────────

  async listTenants(params?: {
    status?: TenantStatus;
    tier?: TenantTier;
    search?: string;
    page?: number;
    limit?: number;
  }) {
    const { status, tier, search, page = 1, limit = 50 } = params || {};
    const where: Prisma.TenantWhereInput = {};

    if (status) where.status = status;
    if (tier) where.tier = tier;
    if (search) {
      where.OR = [
        { name: { contains: search, mode: 'insensitive' } },
        { slug: { contains: search, mode: 'insensitive' } },
        { domain: { contains: search, mode: 'insensitive' } },
      ];
    }

    const [tenants, total] = await Promise.all([
      this.prisma.tenant.findMany({
        where,
        select: {
          id: true,
          name: true,
          slug: true,
          domain: true,
          subdomain: true,
          status: true,
          licenseStatus: true,
          licenseExpiresAt: true,
          tier: true,
          timezone: true,
          defaultCurrency: true,
          logoUrl: true,
          createdAt: true,
          updatedAt: true,
          _count: { select: { users: true } },
        },
        orderBy: { createdAt: 'desc' },
        skip: (page - 1) * limit,
        take: limit,
      }),
      this.prisma.tenant.count({ where }),
    ]);

    return {
      data: tenants,
      meta: { total, page, limit, totalPages: Math.ceil(total / limit) },
    };
  }

  async getTenant(tenantId: string) {
    const tenant = await this.prisma.tenant.findUnique({
      where: { id: tenantId },
      include: {
        tenantModules: { orderBy: { module: 'asc' } },
        domainMappings: { orderBy: { createdAt: 'desc' } },
        _count: { select: { users: true, products: true, actuals: true } },
      },
    });

    if (!tenant) throw new NotFoundException('Tenant not found');
    return tenant;
  }

  async updateTenant(
    tenantId: string,
    data: {
      name?: string;
      status?: TenantStatus;
      tier?: TenantTier;
      domain?: string;
      subdomain?: string;
      timezone?: string;
      defaultCurrency?: string;
      dataRetentionDays?: number;
      licenseStatus?: TenantLicenseStatus;
      licenseExpiresAt?: string | null;
    },
  ) {
    const tenant = await this.prisma.tenant.findUnique({
      where: { id: tenantId },
      select: { id: true },
    });
    if (!tenant) throw new NotFoundException('Tenant not found');

    const updatedTenant = await this.prisma.tenant.update({
      where: { id: tenantId },
      data: {
        ...data,
        ...(data.licenseExpiresAt !== undefined
          ? {
              licenseExpiresAt: data.licenseExpiresAt ? new Date(data.licenseExpiresAt) : null,
            }
          : {}),
      },
    });

    this.tenantAccessService.invalidateTenant(tenantId);
    return updatedTenant;
  }

  /** Create a new tenant with an initial admin user */
  async createTenant(data: {
    name: string;
    slug: string;
    adminEmail: string;
    adminPassword: string;
    adminFirstName?: string;
    adminLastName?: string;
    status?: TenantStatus;
    tier?: TenantTier;
    domain?: string;
    timezone?: string;
    defaultCurrency?: string;
  }) {
    const slug = data.slug.trim().toLowerCase();

    const existing = await this.prisma.tenant.findUnique({ where: { slug } });
    if (existing) throw new ConflictException('Tenant slug is already in use');

    const bcrypt = await import('bcrypt');
    const passwordHash = await bcrypt.hash(data.adminPassword, 12);

    const tenant = await this.prisma.$transaction(async (tx) => {
      const created = await tx.tenant.create({
        data: {
          name: data.name.trim(),
          slug,
          subdomain: slug,
          status: data.status ?? 'ACTIVE',
          tier: data.tier ?? 'STARTER',
          domain: data.domain?.trim() || undefined,
          timezone: data.timezone ?? 'UTC',
          defaultCurrency: data.defaultCurrency ?? 'USD',
        },
      });

      const adminRole = await this.rolesService.ensureDefaultAdminRole(created.id, tx);

      await tx.user.create({
        data: {
          tenant: { connect: { id: created.id } },
          email: data.adminEmail.toLowerCase().trim(),
          passwordHash,
          firstName: data.adminFirstName?.trim() || 'Admin',
          lastName: data.adminLastName?.trim() || '',
          role: 'ADMIN',
          customRole: { connect: { id: adminRole.id } },
          status: 'ACTIVE',
          mustResetPassword: true,
        },
      });

      return created;
    });

    // Initialize default modules
    await this.initializeDefaultModules(tenant.id);

    return this.getTenant(tenant.id);
  }

  async resetTenantDomains(tenantId: string) {
    const tenant = await this.prisma.tenant.findUnique({
      where: { id: tenantId },
      select: { id: true, slug: true },
    });

    if (!tenant) {
      throw new NotFoundException('Tenant not found');
    }

    const result = await this.prisma.$transaction(async (tx) => {
      const deletedDomainMappings = await tx.domainMapping.deleteMany({
        where: { tenantId },
      });

      const updatedTenant = await tx.tenant.update({
        where: { id: tenantId },
        data: {
          domain: null,
          subdomain: tenant.slug,
        },
        select: {
          id: true,
          slug: true,
          subdomain: true,
          domain: true,
        },
      });

      return {
        ...updatedTenant,
        deletedDomainMappings: deletedDomainMappings.count,
      };
    });

    this.tenantAccessService.invalidateTenant(tenantId);

    return {
      tenantId: result.id,
      tenantSlug: result.slug,
      subdomain: result.subdomain,
      domain: result.domain,
      deletedDomainMappings: result.deletedDomainMappings,
    };
  }

  async resetTenantData(tenantId: string) {
    const tenant = await this.prisma.tenant.findUnique({
      where: { id: tenantId },
      select: { id: true, name: true, slug: true },
    });

    if (!tenant) {
      throw new NotFoundException('Tenant not found');
    }

    const preservedAdmins = await this.prisma.user.findMany({
      where: {
        tenantId,
        role: { in: [...RESET_PRESERVED_ROLES] },
      },
      select: { id: true, email: true },
      orderBy: { email: 'asc' },
    });

    if (preservedAdmins.length === 0) {
      throw new BadRequestException('Tenant reset requires at least one admin login to preserve');
    }

    const tenantScopedTables = await this.listTenantScopedTables();
    const tablesToReset = tenantScopedTables.filter((table) => !RESET_PRESERVED_TABLES.has(table));

    const deleteSummary = await this.deleteTenantScopedRows(tenantId, tablesToReset);

    if (deleteSummary.remainingTables.length > 0) {
      throw new BadRequestException(
        `Tenant reset is blocked by dependent records in: ${deleteSummary.remainingTables
          .map(({ table }) => table)
          .join(', ')}`,
      );
    }

    const deletedNonAdminUsers = await this.prisma.user.deleteMany({
      where: {
        tenantId,
        role: { notIn: [...RESET_PRESERVED_ROLES] },
      },
    });

    const result = {
      ...deleteSummary,
      deletedNonAdminUsers: deletedNonAdminUsers.count,
    };

    this.logger.warn(
      `Tenant ${tenant.slug} data reset by super admin; preserved ${preservedAdmins.length} admin login(s), deleted ${result.totalRowsDeleted + result.deletedNonAdminUsers} row(s)`,
    );

    return {
      tenantId: tenant.id,
      tenantName: tenant.name,
      tenantSlug: tenant.slug,
      preservedAdminEmails: preservedAdmins.map((admin) => admin.email),
      deletedTables: result.deletedTables,
      deletedNonAdminUsers: result.deletedNonAdminUsers,
      totalRowsDeleted: result.totalRowsDeleted + result.deletedNonAdminUsers,
    };
  }

  // ─── Module Management ────────────────────────────────────────

  async getModulesForTenant(tenantId: string) {
    const tenant = await this.prisma.tenant.findUnique({
      where: { id: tenantId },
      select: { id: true },
    });
    if (!tenant) throw new NotFoundException('Tenant not found');

    const records = await this.prisma.tenantModule.findMany({
      where: { tenantId },
      orderBy: { module: 'asc' },
    });

    // Return all platform modules with their enabled state
    const moduleMap = new Map(records.map((r) => [r.module, r]));

    return PLATFORM_MODULES.map((mod) => {
      const record = moduleMap.get(mod);
      return {
        module: mod,
        enabled: record ? record.enabled : true, // default enabled if no record
        config: record?.config || {},
        updatedAt: record?.updatedAt || null,
      };
    });
  }

  async setModulesForTenant(
    tenantId: string,
    modules: Array<{ module: PlatformModuleKey; enabled: boolean; config?: Record<string, unknown> }>,
  ) {
    const tenant = await this.prisma.tenant.findUnique({
      where: { id: tenantId },
      select: { id: true },
    });
    if (!tenant) throw new NotFoundException('Tenant not found');

    // Validate module keys
    for (const m of modules) {
      if (!PLATFORM_MODULES.includes(m.module)) {
        throw new BadRequestException(`Invalid module: ${m.module}`);
      }
    }

    // Upsert each module in a transaction
    await this.prisma.$transaction(
      modules.map((m) =>
        this.prisma.tenantModule.upsert({
          where: { tenantId_module: { tenantId, module: m.module } },
          create: {
            tenantId,
            module: m.module,
            enabled: m.enabled,
            config: (m.config ?? {}) as Prisma.InputJsonValue,
          },
          update: {
            enabled: m.enabled,
            ...(m.config !== undefined ? { config: m.config as Prisma.InputJsonValue } : {}),
          },
        }),
      ),
    );

    // Invalidate module guard cache
    this.moduleGuard.invalidateCache(tenantId);

    return this.getModulesForTenant(tenantId);
  }

  async toggleModule(tenantId: string, module: PlatformModuleKey, enabled: boolean) {
    return this.setModulesForTenant(tenantId, [{ module, enabled }]);
  }

  /** Initialize default modules for a new tenant */
  async initializeDefaultModules(tenantId: string) {
    const existing = await this.prisma.tenantModule.count({ where: { tenantId } });
    if (existing > 0) return; // Already initialized

    await this.prisma.tenantModule.createMany({
      data: PLATFORM_MODULES.map((mod) => ({
        tenantId,
        module: mod,
        enabled: DEFAULT_ENABLED_MODULES.includes(mod),
      })),
    });
  }

  // ─── Tenant Users (cross-tenant view) ─────────────────────────

  async listTenantUsers(tenantId: string, params?: { page?: number; limit?: number }) {
    const { page = 1, limit = 50 } = params || {};

    const tenant = await this.prisma.tenant.findUnique({
      where: { id: tenantId },
      select: { id: true },
    });
    if (!tenant) throw new NotFoundException('Tenant not found');

    const [users, total] = await Promise.all([
      this.prisma.user.findMany({
        where: { tenantId },
        select: {
          id: true,
          email: true,
          firstName: true,
          lastName: true,
          role: true,
          status: true,
          lastLoginAt: true,
          createdAt: true,
        },
        orderBy: { createdAt: 'desc' },
        skip: (page - 1) * limit,
        take: limit,
      }),
      this.prisma.user.count({ where: { tenantId } }),
    ]);

    return {
      data: users,
      meta: { total, page, limit, totalPages: Math.ceil(total / limit) },
    };
  }

  // ─── Platform Stats ───────────────────────────────────────────

  async getStats() {
    const [tenantCount, userCount, activeTenants, trialTenants] = await Promise.all([
      this.prisma.tenant.count(),
      this.prisma.user.count(),
      this.prisma.tenant.count({ where: { status: 'ACTIVE' } }),
      this.prisma.tenant.count({ where: { status: 'TRIAL' } }),
    ]);

    return {
      tenants: { total: tenantCount, active: activeTenants, trial: trialTenants },
      users: { total: userCount },
    };
  }

  // ─── Enabled Modules for Current Tenant (used by frontend) ───

  async getEnabledModulesForTenant(tenantId: string): Promise<Record<string, boolean>> {
    const records = await this.prisma.tenantModule.findMany({
      where: { tenantId },
      select: { module: true, enabled: true },
    });

    const result: Record<string, boolean> = {};
    for (const mod of PLATFORM_MODULES) {
      const record = records.find((r) => r.module === mod);
      result[mod] = record ? record.enabled : true; // default enabled
    }
    return result;
  }

  private async listTenantScopedTables(): Promise<string[]> {
    const rows = await this.prisma.$queryRaw<Array<{ table_name: string }>>(Prisma.sql`
      SELECT table_name
      FROM information_schema.columns
      WHERE table_schema = 'public'
        AND column_name = 'tenant_id'
      ORDER BY table_name ASC
    `);

    return rows.map((row) => row.table_name);
  }

  private async deleteTenantScopedRows(
    tenantId: string,
    tables: string[],
  ): Promise<{
    deletedTables: string[];
    remainingTables: Array<{ table: string; reason: string }>;
    totalRowsDeleted: number;
  }> {
    const deletedTables = new Set<string>();
    const failureReasons = new Map<string, string>();
    let remainingTables = [...tables];
    let totalRowsDeleted = 0;
    const maxPasses = Math.max(remainingTables.length, 1);

    for (let pass = 0; pass < maxPasses && remainingTables.length > 0; pass += 1) {
      const failedThisPass: string[] = [];
      let successfulDeletes = 0;

      for (const table of remainingTables) {
        try {
          const deletedCount = Number(
            await this.prisma.$executeRawUnsafe(
              `DELETE FROM "${table}" WHERE "tenant_id" = $1::uuid`,
              tenantId,
            ),
          );
          totalRowsDeleted += Number.isFinite(deletedCount) ? deletedCount : 0;
          deletedTables.add(table);
          failureReasons.delete(table);
          successfulDeletes += 1;
        } catch (error) {
          failedThisPass.push(table);
          failureReasons.set(table, this.getResetErrorMessage(error));
        }
      }

      remainingTables = failedThisPass;
      if (failedThisPass.length === 0 || successfulDeletes === 0) {
        break;
      }
    }

    return {
      deletedTables: [...deletedTables].sort(),
      remainingTables: remainingTables.map((table) => ({
        table,
        reason: failureReasons.get(table) ?? 'Unknown error',
      })),
      totalRowsDeleted,
    };
  }

  private getResetErrorMessage(error: unknown): string {
    if (error instanceof Error) {
      return error.message;
    }
    return 'Unknown error';
  }
}
