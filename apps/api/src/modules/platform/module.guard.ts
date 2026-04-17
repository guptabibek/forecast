import {
    CanActivate,
    ExecutionContext,
    ForbiddenException,
    Injectable,
    Logger,
} from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { ClsService } from 'nestjs-cls';
import { PrismaService } from '../../core/database/prisma.service';
import { PlatformModuleKey, REQUIRE_MODULE_KEY } from './platform.constants';

/**
 * Guard that checks if the required module is enabled for the current tenant.
 * Used with @RequireModule() decorator.
 * SUPER_ADMIN always bypasses module checks.
 */
@Injectable()
export class ModuleGuard implements CanActivate {
  private readonly logger = new Logger(ModuleGuard.name);
  /** Cache: tenantId -> { module -> enabled, expiresAt } */
  private cache = new Map<string, { modules: Record<string, boolean>; expiresAt: number }>();
  private readonly CACHE_TTL_MS = 60_000; // 1 minute

  constructor(
    private readonly reflector: Reflector,
    private readonly cls: ClsService,
    private readonly prisma: PrismaService,
  ) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const requiredModule = this.reflector.getAllAndOverride<PlatformModuleKey>(
      REQUIRE_MODULE_KEY,
      [context.getHandler(), context.getClass()],
    );

    // No module requirement → allow
    if (!requiredModule) return true;

    const request = context.switchToHttp().getRequest();
    const user = request.user;

    // SUPER_ADMIN bypasses module checks
    if (user?.role === 'SUPER_ADMIN') return true;

    const tenantId = this.cls.get('tenantId') || user?.tenantId;
    if (!tenantId) {
      throw new ForbiddenException('Tenant context not resolved');
    }

    const enabled = await this.isModuleEnabled(tenantId, requiredModule);
    if (!enabled) {
      throw new ForbiddenException(
        `Module '${requiredModule}' is not enabled for your organization. Contact your administrator.`,
      );
    }

    return true;
  }

  async isModuleEnabled(tenantId: string, module: string): Promise<boolean> {
    const now = Date.now();
    const cached = this.cache.get(tenantId);

    if (cached && cached.expiresAt > now) {
      // If module not in the cache map, it's not configured → default enabled
      return cached.modules[module] !== false;
    }

    const records = await this.prisma.tenantModule.findMany({
      where: { tenantId },
      select: { module: true, enabled: true },
    });

    const modules: Record<string, boolean> = {};
    for (const r of records) {
      modules[r.module] = r.enabled;
    }

    this.cache.set(tenantId, { modules, expiresAt: now + this.CACHE_TTL_MS });

    // If no record exists for this module, default to enabled
    return modules[module] !== false;
  }

  /** Call after updating tenant modules to invalidate cache */
  invalidateCache(tenantId?: string) {
    if (tenantId) {
      this.cache.delete(tenantId);
    } else {
      this.cache.clear();
    }
  }
}
