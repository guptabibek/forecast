import {
    CanActivate,
    ExecutionContext,
    ForbiddenException,
    Injectable,
} from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { Request } from 'express';
import { ClsService } from 'nestjs-cls';
import { SUPER_ADMIN_TENANT } from '../../modules/platform/platform.constants';
import { PrismaService } from '../database/prisma.service';
import { TenantAccessService } from '../database/tenant-access.service';

export const SKIP_TENANT_CHECK = 'skipTenantCheck';

/**
 * Global guard that enforces tenant context on every request.
 * Routes without a resolved tenantId in CLS are rejected with 403.
 *
 * Controllers/handlers can skip this check by applying:
 *   @SetMetadata(SKIP_TENANT_CHECK, true)
 */
@Injectable()
export class TenantGuard implements CanActivate {
  private readonly uuidRegex = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

  constructor(
    private readonly cls: ClsService,
    private readonly reflector: Reflector,
    private readonly prisma: PrismaService,
    private readonly tenantAccessService: TenantAccessService,
  ) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const skip = this.reflector.getAllAndOverride<boolean>(SKIP_TENANT_CHECK, [
      context.getHandler(),
      context.getClass(),
    ]);
    if (skip) return true;

    const request = context.switchToHttp().getRequest<Request>();
    const user = (request as any).user;
    const isSuperAdmin = user?.role === 'SUPER_ADMIN';

    let tenantId = this.cls.get('tenantId');

    if (!tenantId) {
      // SUPER_ADMIN can target any tenant via x-tenant-id (even SUSPENDED ones)
      if (isSuperAdmin) {
        tenantId = await this.resolveSuperAdminTenantId(request, user);
      } else {
        tenantId = await this.resolveTenantIdFromRequest(request);
      }
      if (tenantId && this.cls.isActive()) {
        this.cls.set('tenantId', tenantId);
      }
    }

    if (!tenantId) {
      throw new ForbiddenException(
        'Tenant context could not be resolved. Ensure a valid tenant is set via JWT, X-Tenant-ID header, or subdomain.',
      );
    }

    return true;
  }

  /**
   * SUPER_ADMIN can target any tenant (including SUSPENDED) via x-tenant-id header.
   * Falls back to the super admin's own tenant if no header is provided.
   */
  private async resolveSuperAdminTenantId(req: Request, user: any): Promise<string | undefined> {
    const headerTenant = req.headers['x-tenant-id'] as string | undefined;
    if (headerTenant) {
      // Super admin can access any tenant regardless of status
      if (this.uuidRegex.test(headerTenant)) {
        const tenant = await this.prisma.tenant.findFirst({
          where: { id: headerTenant },
          select: { id: true },
        });
        return tenant?.id;
      }
      const tenantBySlug = await this.prisma.tenant.findFirst({
        where: { slug: headerTenant },
        select: { id: true },
      });
      return tenantBySlug?.id;
    }
    // Fall back to super admin's synthetic tenant (no DB row)
    return user?.tenantId || SUPER_ADMIN_TENANT.id;
  }

  private async resolveTenantIdFromRequest(req: Request): Promise<string | undefined> {
    const userTenantId = (req as any).user?.tenantId as string | undefined;
    if (userTenantId) {
      return this.resolveAccessibleTenantId(userTenantId);
    }

    const headerTenant = req.headers['x-tenant-id'] as string | undefined;
    if (headerTenant) {
      if (this.uuidRegex.test(headerTenant)) {
        return this.resolveAccessibleTenantId(headerTenant);
      }

      const tenantBySlug = await this.prisma.tenant.findFirst({
        where: { slug: headerTenant },
        select: { id: true },
      });

      if (tenantBySlug) {
        return this.resolveAccessibleTenantId(tenantBySlug.id);
      }
    }

    const authHeader = req.headers.authorization;
    if (authHeader?.startsWith('Bearer ')) {
      try {
        const token = authHeader.slice(7);
        const payloadBase64 = token.split('.')[1];
        if (payloadBase64) {
          const payload = JSON.parse(Buffer.from(payloadBase64, 'base64url').toString('utf8')) as {
            tenantId?: unknown;
            role?: unknown;
          };

          if (typeof payload.tenantId === 'string' && payload.tenantId) {
            // Super-admin uses a synthetic tenant with no DB row
            if (payload.role === 'SUPER_ADMIN') {
              return payload.tenantId;
            }
            return this.resolveAccessibleTenantId(payload.tenantId);
          }
        }
      } catch {
        return undefined;
      }
    }

    return undefined;
  }

  private async resolveAccessibleTenantId(tenantId: string): Promise<string | undefined> {
    const tenant = await this.tenantAccessService.getTenantSnapshot(tenantId);
    if (!tenant) {
      return undefined;
    }

    this.tenantAccessService.assertTenantAccess(tenant);
    return tenant.id;
  }
}
