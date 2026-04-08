import { Injectable, NestMiddleware } from '@nestjs/common';
import { NextFunction, Request, Response } from 'express';
import { ClsService } from 'nestjs-cls';
import { PrismaService } from '../database/prisma.service';

export interface TenantContext {
  tenantId: string;
  tenantSlug: string;
  tenantTier: string;
}

@Injectable()
export class TenantMiddleware implements NestMiddleware {
  constructor(
    private readonly cls: ClsService,
    private readonly prisma: PrismaService,
  ) {}

  private isDemoTenantFallbackEnabled(): boolean {
    const raw = (process.env.ALLOW_DEMO_TENANT_FALLBACK || '').trim().toLowerCase();
    const enabled = raw === 'true' || raw === '1' || raw === 'yes' || raw === 'on';
    return process.env.NODE_ENV !== 'production' && enabled;
  }

  async use(req: Request, res: Response, next: NextFunction) {
    // Extract tenant from various sources
    let tenantId = await this.resolveTenantId(req);

    // Optional local fallback for development only when explicitly enabled
    if (!tenantId && this.isDemoTenantFallbackEnabled()) {
      const host = req.headers.host || '';
      if (host.startsWith('localhost') || host.startsWith('127.0.0.1')) {
        const demoTenant = await this.prisma.tenant.findUnique({
          where: { slug: 'demo' },
          select: { id: true },
        });
        if (demoTenant) {
          tenantId = demoTenant.id;
        }
      }
    }

    if (!tenantId) {
      // Don't throw error - let the auth guard handle it
      // Just proceed without tenant context
      next();
      return;
    }

    // Validate tenant exists and is active
    const tenant = await this.prisma.tenant.findUnique({
      where: { id: tenantId },
      select: { id: true, slug: true, tier: true, status: true },
    });

    if (!tenant) {
      // Don't throw - proceed without tenant
      next();
      return;
    }

    if (tenant.status !== 'ACTIVE' && tenant.status !== 'TRIAL') {
      // Don't throw - proceed without tenant
      next();
      return;
    }

    // Store tenant context in CLS (only if CLS is active)
    if (this.cls.isActive()) {
      this.cls.set('tenantId', tenant.id);
      this.cls.set('tenantSlug', tenant.slug);
      this.cls.set('tenantTier', tenant.tier);
    }

    // Add tenant ID to request for easy access
    (req as any).tenantId = tenant.id;
    (req as any).tenant = tenant;

    next();
  }

  private async resolveTenantId(req: Request): Promise<string | null> {
    const authHeader = req.headers.authorization;
    if (authHeader?.startsWith('Bearer ')) {
      try {
        const token = authHeader.slice(7);
        const payloadBase64 = token.split('.')[1];
        if (payloadBase64) {
          const json = Buffer.from(payloadBase64, 'base64url').toString('utf8');
          const payload = JSON.parse(json) as { tenantId?: unknown };
          if (typeof payload.tenantId === 'string' && payload.tenantId) {
            return payload.tenantId;
          }
        }
      } catch {
        // Ignore malformed token payload and continue with next resolution strategies
      }
    }

    // Priority 1: JWT token contains tenant_id (set by auth guard)
    if ((req as any).user?.tenantId) {
      return (req as any).user.tenantId;
    }

    // Priority 2: X-Tenant-ID header (for API key auth)
    const headerTenantId = req.headers['x-tenant-id'] as string;
    if (headerTenantId) {
      // Check if the value is a UUID or a slug
      const uuidRegex = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
      if (uuidRegex.test(headerTenantId)) {
        return headerTenantId;
      }
      // Treat as a slug and look up the tenant
      const tenantBySlug = await this.prisma.tenant.findUnique({
        where: { slug: headerTenantId },
        select: { id: true },
      });
      if (tenantBySlug) return tenantBySlug.id;
      return null;
    }

    // Priority 3: Subdomain-based tenant resolution
    const host = req.headers.host || '';
    const subdomain = this.extractSubdomain(host);
    if (subdomain) {
      const tenant = await this.prisma.tenant.findUnique({
        where: { subdomain },
        select: { id: true },
      });
      if (tenant) return tenant.id;
    }

    // Priority 4: Custom domain mapping
    const domain = host.split(':')[0]; // Remove port
    const domainMapping = await this.prisma.domainMapping.findUnique({
      where: { domain, isVerified: true },
      select: { tenantId: true },
    });
    if (domainMapping) return domainMapping.tenantId;

    return null;
  }

  private extractSubdomain(host: string): string | null {
    // Remove port if present
    const hostname = host.split(':')[0];

    if (!hostname || hostname === 'localhost' || hostname === '127.0.0.1') {
      return null;
    }

    // Support local subdomains like demo.localhost
    if (hostname.endsWith('.localhost')) {
      const subdomain = hostname.replace('.localhost', '');
      if (subdomain && !['www', 'api', 'app'].includes(subdomain)) {
        return subdomain;
      }
    }
    
    // Check if it's a subdomain of our main domain
    const mainDomain = process.env.MAIN_DOMAIN || 'forecasthub.com';
    
    if (hostname.endsWith(`.${mainDomain}`)) {
      const subdomain = hostname.replace(`.${mainDomain}`, '');
      // Exclude www and other reserved subdomains
      if (subdomain && !['www', 'api', 'app'].includes(subdomain)) {
        return subdomain;
      }
    }

    return null;
  }
}

// Helper service to access tenant context anywhere
@Injectable()
export class TenantContextService {
  constructor(private readonly cls: ClsService) {}

  getTenantId(): string {
    const tenantId = this.cls.get('tenantId');
    if (!tenantId) {
      throw new Error('Tenant context not set');
    }
    return tenantId;
  }

  getTenantSlug(): string {
    return this.cls.get('tenantSlug');
  }

  getTenantTier(): string {
    return this.cls.get('tenantTier');
  }

  getContext(): TenantContext {
    return {
      tenantId: this.getTenantId(),
      tenantSlug: this.getTenantSlug(),
      tenantTier: this.getTenantTier(),
    };
  }
}
