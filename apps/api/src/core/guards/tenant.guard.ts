import {
  CanActivate,
  ExecutionContext,
  ForbiddenException,
  Injectable,
  Logger,
} from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { Request } from 'express';
import { ClsService } from 'nestjs-cls';
import { PrismaService } from '../database/prisma.service';

export const SKIP_TENANT_CHECK = 'skipTenantCheck';

/**
 * Global guard that enforces tenant context on every request.
 * Routes without a resolved tenantId in CLS are rejected with 403.
 *
 * In non-production environments, may fall back to the "demo" tenant
 * only when ALLOW_DEMO_TENANT_FALLBACK is explicitly enabled.
 *
 * Controllers/handlers can skip this check by applying:
 *   @SetMetadata(SKIP_TENANT_CHECK, true)
 */
@Injectable()
export class TenantGuard implements CanActivate {
  private readonly logger = new Logger(TenantGuard.name);
  private readonly uuidRegex = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
  /** Cached default tenant id so we only query once */
  private defaultTenantId: string | undefined;

  private isDemoTenantFallbackEnabled(): boolean {
    const raw = (process.env.ALLOW_DEMO_TENANT_FALLBACK || '').trim().toLowerCase();
    const enabled = raw === 'true' || raw === '1' || raw === 'yes' || raw === 'on';
    return process.env.NODE_ENV !== 'production' && enabled;
  }

  constructor(
    private readonly cls: ClsService,
    private readonly reflector: Reflector,
    private readonly prisma: PrismaService,
  ) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const skip = this.reflector.getAllAndOverride<boolean>(SKIP_TENANT_CHECK, [
      context.getHandler(),
      context.getClass(),
    ]);
    if (skip) return true;

    let tenantId = this.cls.get('tenantId');

    if (!tenantId) {
      const request = context.switchToHttp().getRequest<Request>();
      tenantId = await this.resolveTenantIdFromRequest(request);
      if (tenantId && this.cls.isActive()) {
        this.cls.set('tenantId', tenantId);
      }
    }

    // Fallback: only when explicitly enabled in non-production
    if (!tenantId && this.isDemoTenantFallbackEnabled()) {
      tenantId = await this.resolveDefaultTenant();
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

  private async resolveTenantIdFromRequest(req: Request): Promise<string | undefined> {
    const userTenantId = (req as any).user?.tenantId as string | undefined;
    if (userTenantId) {
      return this.resolveActiveTenantId(userTenantId);
    }

    const headerTenant = req.headers['x-tenant-id'] as string | undefined;
    if (headerTenant) {
      if (this.uuidRegex.test(headerTenant)) {
        return this.resolveActiveTenantId(headerTenant);
      }

      const tenantBySlug = await this.prisma.tenant.findFirst({
        where: {
          slug: headerTenant,
          status: { in: ['ACTIVE', 'TRIAL'] },
        },
        select: { id: true },
      });

      if (tenantBySlug) {
        return tenantBySlug.id;
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
          };

          if (typeof payload.tenantId === 'string' && payload.tenantId) {
            return this.resolveActiveTenantId(payload.tenantId);
          }
        }
      } catch {
        return undefined;
      }
    }

    return undefined;
  }

  private async resolveActiveTenantId(tenantId: string): Promise<string | undefined> {
    const tenant = await this.prisma.tenant.findFirst({
      where: {
        id: tenantId,
        status: { in: ['ACTIVE', 'TRIAL'] },
      },
      select: { id: true },
    });

    return tenant?.id;
  }

  private async resolveDefaultTenant(): Promise<string | undefined> {
    if (this.defaultTenantId !== undefined) return this.defaultTenantId;

    try {
      const demo = await this.prisma.tenant.findFirst({
        where: { slug: 'demo', status: 'ACTIVE' },
        select: { id: true },
      });
      this.defaultTenantId = demo?.id ?? undefined;
      if (this.defaultTenantId) {
        this.logger.log(`Default tenant resolved: ${this.defaultTenantId}`);
      }
    } catch {
      this.defaultTenantId = undefined;
    }

    return this.defaultTenantId;
  }
}
