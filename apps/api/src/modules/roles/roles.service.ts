import {
    BadRequestException,
    ConflictException,
    Injectable,
    Logger,
    NotFoundException,
} from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { PrismaService } from '../../core/database/prisma.service';
import { PLATFORM_MODULES } from '../platform/platform.constants';
import { CreateRoleDto, UpdateRoleDto } from './dto/role.dto';
import { ALL_PERMISSION_KEYS, SYSTEM_ROLE_TEMPLATES } from './rbac.constants';

@Injectable()
export class RolesService {
  private readonly logger = new Logger(RolesService.name);

  constructor(private readonly prisma: PrismaService) {}

  async ensureDefaultAdminRole(
    tenantId: string,
    client: Prisma.TransactionClient | PrismaService = this.prisma,
  ) {
    const existing = await client.tenantRole.findFirst({
      where: { tenantId, slug: 'admin', isSystem: true },
      select: { id: true, name: true, slug: true },
    });

    if (existing) {
      return existing;
    }

    const template = this.getSystemRoleTemplateByLegacyRole('ADMIN');

    return client.tenantRole.create({
      data: {
        tenantId,
        name: template.name,
        slug: template.slug,
        description: template.description,
        moduleAccess: template.moduleAccess as Prisma.InputJsonValue,
        permissions: template.permissions as Prisma.InputJsonValue,
        isSystem: true,
        isDefault: true,
      },
      select: { id: true, name: true, slug: true },
    });
  }

  /** List all roles for a tenant */
  async listRoles(tenantId: string) {
    const [roles, enabledModules] = await Promise.all([
      this.prisma.tenantRole.findMany({
        where: { tenantId },
        orderBy: [{ isSystem: 'desc' }, { name: 'asc' }],
        include: { _count: { select: { users: true } } },
      }),
      this.getEnabledModuleMap(tenantId),
    ]);

    return roles.map((r) => ({
      id: r.id,
      name: r.name,
      slug: r.slug,
      description: r.description,
      moduleAccess: this.applyEnabledModuleConstraints(
        r.moduleAccess as Record<string, boolean>,
        enabledModules,
      ),
      permissions: r.permissions,
      isSystem: r.isSystem,
      isDefault: r.isDefault,
      userCount: r._count.users,
      createdAt: r.createdAt,
      updatedAt: r.updatedAt,
    }));
  }

  /** Get a single role by ID */
  async getRole(tenantId: string, roleId: string) {
    const role = await this.prisma.tenantRole.findFirst({
      where: { id: roleId, tenantId },
      include: { _count: { select: { users: true } } },
    });
    if (!role) throw new NotFoundException('Role not found');

    const enabledModules = await this.getEnabledModuleMap(tenantId);
    return {
      ...role,
      moduleAccess: this.applyEnabledModuleConstraints(
        role.moduleAccess as Record<string, boolean>,
        enabledModules,
      ),
    };
  }

  /** Create a new custom role */
  async createRole(tenantId: string, dto: CreateRoleDto) {
    // Validate permissions
    if (dto.permissions?.length) {
      const invalid = dto.permissions.filter((p) => !ALL_PERMISSION_KEYS.includes(p));
      if (invalid.length) {
        throw new BadRequestException(`Invalid permissions: ${invalid.join(', ')}`);
      }
    }

    this.validateModuleAccessKeys(dto.moduleAccess);

    const enabledModules = await this.getEnabledModuleMap(tenantId);

    const slug = this.slugify(dto.name);

    // Check slug uniqueness within tenant
    const existing = await this.prisma.tenantRole.findFirst({
      where: { tenantId, slug },
    });
    if (existing) {
      throw new ConflictException(`A role with a similar name already exists`);
    }

    return this.prisma.tenantRole.create({
      data: {
        tenantId,
        name: dto.name,
        slug,
        description: dto.description ?? null,
        moduleAccess: this.applyEnabledModuleConstraints(
          dto.moduleAccess,
          enabledModules,
        ) as Prisma.InputJsonValue,
        permissions: (dto.permissions ?? []) as Prisma.InputJsonValue,
        isSystem: false,
        isDefault: false,
      },
    });
  }

  /** Update a role (system roles: only permissions/moduleAccess editable) */
  async updateRole(tenantId: string, roleId: string, dto: UpdateRoleDto) {
    const role = await this.prisma.tenantRole.findFirst({
      where: { id: roleId, tenantId },
    });
    if (!role) throw new NotFoundException('Role not found');

    // Validate permissions
    if (dto.permissions?.length) {
      const invalid = dto.permissions.filter((p) => !ALL_PERMISSION_KEYS.includes(p));
      if (invalid.length) {
        throw new BadRequestException(`Invalid permissions: ${invalid.join(', ')}`);
      }
    }

    this.validateModuleAccessKeys(dto.moduleAccess);

    const data: Prisma.TenantRoleUpdateInput = {};

    if (dto.moduleAccess !== undefined) {
      const enabledModules = await this.getEnabledModuleMap(tenantId);
      data.moduleAccess = this.applyEnabledModuleConstraints(
        dto.moduleAccess,
        enabledModules,
      ) as Prisma.InputJsonValue;
    }
    if (dto.permissions !== undefined) {
      data.permissions = dto.permissions as Prisma.InputJsonValue;
    }

    // System roles: name/slug cannot change
    if (!role.isSystem) {
      if (dto.name !== undefined) {
        data.name = dto.name;
        data.slug = this.slugify(dto.name);
        // Check uniqueness of new slug
        const dup = await this.prisma.tenantRole.findFirst({
          where: { tenantId, slug: data.slug as string, id: { not: roleId } },
        });
        if (dup) throw new ConflictException('A role with a similar name already exists');
      }
      if (dto.description !== undefined) {
        data.description = dto.description;
      }
    }

    // Handle isDefault toggle
    if (dto.isDefault === true) {
      // Unset all other defaults in this tenant
      await this.prisma.tenantRole.updateMany({
        where: { tenantId, isDefault: true, id: { not: roleId } },
        data: { isDefault: false },
      });
      data.isDefault = true;
    } else if (dto.isDefault === false) {
      data.isDefault = false;
    }

    return this.prisma.tenantRole.update({
      where: { id: roleId },
      data,
    });
  }

  /** Delete a custom role (system roles cannot be deleted) */
  async deleteRole(tenantId: string, roleId: string) {
    const role = await this.prisma.tenantRole.findFirst({
      where: { id: roleId, tenantId },
      include: { _count: { select: { users: true } } },
    });
    if (!role) throw new NotFoundException('Role not found');
    if (role.isSystem) throw new BadRequestException('System roles cannot be deleted');
    if (role._count.users > 0) {
      throw new BadRequestException(
        `Cannot delete role "${role.name}" — it is assigned to ${role._count.users} user(s). Reassign them first.`,
      );
    }

    await this.prisma.tenantRole.delete({ where: { id: roleId } });
    return { deleted: true };
  }

  /** Seed system roles for a tenant (idempotent) */
  async seedSystemRoles(tenantId: string) {
    const existing = await this.prisma.tenantRole.count({
      where: { tenantId, isSystem: true },
    });
    if (existing > 0) return;

    this.logger.log(`Seeding system roles for tenant ${tenantId}`);

    await this.prisma.tenantRole.createMany({
      data: SYSTEM_ROLE_TEMPLATES.map((tmpl) => ({
        tenantId,
        name: tmpl.name,
        slug: tmpl.slug,
        description: tmpl.description,
        moduleAccess: tmpl.moduleAccess as Prisma.InputJsonValue,
        permissions: tmpl.permissions as Prisma.InputJsonValue,
        isSystem: true,
        isDefault: tmpl.isDefault ?? false,
      })),
      skipDuplicates: true,
    });
  }

  /** Get all permission definitions (for the frontend permission picker) */
  getPermissionDefinitions() {
    // imported from constants; re-export for the controller
    const { PERMISSION_DEFINITIONS } = require('./rbac.constants');
    return PERMISSION_DEFINITIONS;
  }

  /** Resolve a user's effective role data (permissions + moduleAccess) */
  async resolveUserRole(userId: string, tenantId: string) {
    const user = await this.prisma.user.findFirst({
      where: { id: userId, tenantId },
      select: {
        role: true,
        customRoleId: true,
        customRole: {
          select: {
            id: true,
            name: true,
            slug: true,
            permissions: true,
            moduleAccess: true,
          },
        },
      },
    });

    if (!user) return null;

    const enabledModules = await this.getEnabledModuleMap(tenantId);

    // If user has a custom role assigned, use it
    if (user.customRole) {
      return {
        roleId: user.customRole.id,
        roleName: user.customRole.name,
        roleSlug: user.customRole.slug,
        permissions: user.customRole.permissions as string[],
        moduleAccess: this.applyEnabledModuleConstraints(
          user.customRole.moduleAccess as Record<string, boolean>,
          enabledModules,
        ),
      };
    }

    // Fallback: find system role matching the legacy UserRole enum
    const legacyTemplate = this.getSystemRoleTemplateByLegacyRole(user.role);
    const legacySlug = legacyTemplate?.slug ?? this.legacyRoleToSlug(user.role);
    if (legacySlug) {
      const systemRole = await this.prisma.tenantRole.findFirst({
        where: { tenantId, slug: legacySlug, isSystem: true },
        select: {
          id: true,
          name: true,
          slug: true,
          permissions: true,
          moduleAccess: true,
        },
      });
      if (systemRole) {
        return {
          roleId: systemRole.id,
          roleName: systemRole.name,
          roleSlug: systemRole.slug,
          permissions: systemRole.permissions as string[],
          moduleAccess: this.applyEnabledModuleConstraints(
            systemRole.moduleAccess as Record<string, boolean>,
            enabledModules,
          ),
        };
      }
    }

    if (legacyTemplate) {
      return {
        roleId: null,
        roleName: legacyTemplate.name,
        roleSlug: legacyTemplate.slug,
        permissions: legacyTemplate.permissions,
        moduleAccess: this.applyEnabledModuleConstraints(
          legacyTemplate.moduleAccess,
          enabledModules,
        ),
      };
    }

    // Ultimate fallback: viewer permissions
    return {
      roleId: null,
      roleName: user.role,
      roleSlug: user.role.toLowerCase(),
      permissions: ['dashboard:read', 'plan:read', 'forecast:read', 'scenario:read', 'report:read'],
      moduleAccess: this.applyEnabledModuleConstraints(
        { planning: true, forecasting: true, reports: true },
        enabledModules,
      ),
    };
  }

  private legacyRoleToSlug(role: string): string | null {
    const map: Record<string, string> = {
      ADMIN: 'admin',
      PLANNER: 'planner',
      FORECAST_PLANNER: 'forecast-planner',
      FINANCE: 'finance',
      VIEWER: 'viewer',
      FORECAST_VIEWER: 'forecast-viewer',
    };
    return map[role] || null;
  }

  private getSystemRoleTemplateByLegacyRole(role: string) {
    const template = SYSTEM_ROLE_TEMPLATES.find((candidate) => candidate.legacyRole === role);
    if (!template) {
      throw new BadRequestException(`Unsupported system role: ${role}`);
    }
    return template;
  }

  private slugify(name: string): string {
    return name
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, '-')
      .replace(/^-|-$/g, '')
      .substring(0, 100);
  }

  private validateModuleAccessKeys(moduleAccess?: Record<string, boolean>) {
    if (!moduleAccess) {
      return;
    }

    const invalidKeys = Object.keys(moduleAccess).filter(
      (key) => !PLATFORM_MODULES.includes(key as (typeof PLATFORM_MODULES)[number]),
    );

    if (invalidKeys.length > 0) {
      throw new BadRequestException(`Invalid modules: ${invalidKeys.join(', ')}`);
    }
  }

  private async getEnabledModuleMap(tenantId: string): Promise<Record<string, boolean>> {
    const rows = await this.prisma.tenantModule.findMany({
      where: { tenantId },
      select: { module: true, enabled: true },
    });

    const enabledModules = Object.fromEntries(
      PLATFORM_MODULES.map((module) => [module, true]),
    ) as Record<string, boolean>;

    for (const row of rows) {
      if (PLATFORM_MODULES.includes(row.module as (typeof PLATFORM_MODULES)[number])) {
        enabledModules[row.module] = row.enabled;
      }
    }

    return enabledModules;
  }

  private applyEnabledModuleConstraints(
    moduleAccess: Record<string, boolean> | null | undefined,
    enabledModules: Record<string, boolean>,
  ): Record<string, boolean> {
    const source = moduleAccess ?? {};

    return Object.fromEntries(
      PLATFORM_MODULES.flatMap((module) => {
        if (enabledModules[module] === false) {
          return [];
        }

        return [[module, source[module] === true] as const];
      }),
    ) as Record<string, boolean>;
  }
}
