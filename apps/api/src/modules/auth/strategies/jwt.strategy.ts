import { Injectable, UnauthorizedException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { PassportStrategy } from '@nestjs/passport';
import { ClsService } from 'nestjs-cls';
import { ExtractJwt, Strategy } from 'passport-jwt';
import { PrismaService } from '../../../core/database/prisma.service';
import { SUPER_ADMIN_STATIC_ID } from '../../platform/platform.constants';

export interface JwtPayload {
  sub: string;
  email: string;
  tenantId: string;
  tenantSlug: string;
  role: string;
  permissions: string[];
  moduleAccess?: Record<string, boolean>;
  roleId?: string | null;
  roleName?: string;
  iat: number;
  exp: number;
}

@Injectable()
export class JwtStrategy extends PassportStrategy(Strategy) {
  constructor(
    private readonly configService: ConfigService,
    private readonly prisma: PrismaService,
    private readonly cls: ClsService,
  ) {
    super({
      jwtFromRequest: ExtractJwt.fromAuthHeaderAsBearerToken(),
      ignoreExpiration: false,
      secretOrKey: configService.get<string>('JWT_SECRET'),
    });
  }

  async validate(payload: JwtPayload) {
    // Set tenant context early so Prisma middleware doesn't warn about
    // tenant-scoped models (User, Tenant) accessed without CLS context.
    if (payload.tenantId && this.cls.isActive()) {
      this.cls.set('tenantId', payload.tenantId);
    }

    // Static super-admin — no DB row exists
    if (payload.sub === SUPER_ADMIN_STATIC_ID) {
      return {
        id: SUPER_ADMIN_STATIC_ID,
        sub: SUPER_ADMIN_STATIC_ID,
        email: payload.email,
        tenantId: payload.tenantId,
        tenantSlug: payload.tenantSlug,
        role: 'SUPER_ADMIN',
        permissions: payload.permissions,
      };
    }

    // Verify user still exists and is active
    const user = await this.prisma.user.findUnique({
      where: { id: payload.sub },
      select: { id: true, status: true, tenantId: true, role: true },
    });

    if (!user) {
      throw new UnauthorizedException('User not found');
    }

    if (user.status !== 'ACTIVE') {
      throw new UnauthorizedException('User is not active');
    }

    // Verify tenant still matches and is active (SUPER_ADMIN can access any tenant state)
    if (user.tenantId !== payload.tenantId) {
      throw new UnauthorizedException('Invalid tenant');
    }

    if (user.role !== 'SUPER_ADMIN') {
      const tenant = await this.prisma.tenant.findUnique({
        where: { id: payload.tenantId },
        select: { status: true },
      });

      if (!tenant || (tenant.status !== 'ACTIVE' && tenant.status !== 'TRIAL')) {
        throw new UnauthorizedException('Tenant is not active');
      }
    }

    // Return user object with 'id' field (mapped from 'sub') for service compatibility
    return {
      id: payload.sub, // Map sub to id for service layer
      sub: payload.sub,
      email: payload.email,
      tenantId: payload.tenantId,
      tenantSlug: payload.tenantSlug,
      role: payload.role,
      permissions: payload.permissions,
      moduleAccess: payload.moduleAccess ?? {},
      roleId: payload.roleId ?? null,
      roleName: payload.roleName ?? payload.role,
    };
  }
}
