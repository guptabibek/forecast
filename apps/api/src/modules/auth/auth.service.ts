import {
    BadRequestException,
    Injectable,
    UnauthorizedException,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { JwtService } from '@nestjs/jwt';
import * as bcrypt from 'bcrypt';
import { createHash, randomBytes } from 'crypto';
import { ClsService } from 'nestjs-cls';
import { v4 as uuidv4 } from 'uuid';
import { PrismaService } from '../../core/database/prisma.service';
import { TenantAccessService } from '../../core/database/tenant-access.service';
import { EmailService } from '../../core/notification/email.service';
import {
    SUPER_ADMIN_STATIC_ID,
    SUPER_ADMIN_TENANT,
} from '../platform/platform.constants';
import { RolesService } from '../roles/roles.service';
import {
    ForgotPasswordDto,
    LoginDto,
    RefreshTokenDto,
    ResetPasswordDto,
    TokenResponse,
} from './dto/auth.dto';

@Injectable()
export class AuthService {
  private readonly logger = new (require('@nestjs/common').Logger)(AuthService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly jwtService: JwtService,
    private readonly configService: ConfigService,
    private readonly emailService: EmailService,
    private readonly rolesService: RolesService,
    private readonly tenantAccessService: TenantAccessService,
    private readonly cls: ClsService,
  ) {}

  async login(dto: LoginDto): Promise<TokenResponse> {
    // ── Static super-admin: credentials live outside the DB ──
    const saEmail = (this.configService.get<string>('SUPER_ADMIN_EMAIL') || 'admin@rabbittech.in').toLowerCase();
    const saPassword = this.configService.get<string>('SUPER_ADMIN_PASSWORD') || 'RabbitTech@2026!';

    if (dto.email.toLowerCase() === saEmail) {
      if (dto.password !== saPassword) {
        throw new UnauthorizedException('Invalid credentials');
      }
      return this.generateStaticSuperAdminTokens();
    }

    const tenant = await this.findTenantByWorkspace(dto.tenantSlug);

    if (!tenant) {
      throw new UnauthorizedException('Invalid credentials');
    }

    // Set CLS tenant context so subsequent Prisma calls don't warn about
    // tenant-scoped models (User, RefreshToken, AuditLog) accessed without context.
    if (this.cls.isActive()) {
      this.cls.set('tenantId', tenant.id);
    }

    const tenantAccessBlock = this.tenantAccessService.getAccessBlockMessage(tenant);
    if (tenantAccessBlock) {
      throw new UnauthorizedException(tenantAccessBlock);
    }


    // Find user
    const user = await this.prisma.user.findUnique({
      where: {
        tenantId_email: {
          tenantId: tenant.id,
          email: dto.email.toLowerCase(),
        },
      },
    });

    if (!user) {
      throw new UnauthorizedException('Invalid credentials');
    }

    const isPendingInvitation = user.status === 'PENDING';

    // Check account status
    if (user.status !== 'ACTIVE' && !isPendingInvitation) {
      throw new UnauthorizedException('Account is not active');
    }

    // Check if account is locked
    if (user.lockedUntil && user.lockedUntil > new Date()) {
      throw new UnauthorizedException('Account is locked. Please try again later.');
    }

    // Verify password
    const isPasswordValid = await bcrypt.compare(dto.password, user.passwordHash);

    if (!isPasswordValid) {
      // Increment failed login count
      await this.handleFailedLogin(user.id);
      throw new UnauthorizedException('Invalid credentials');
    }

    // Reset failed login count and update last login
    await this.prisma.user.update({
      where: { id: user.id },
      data: {
        failedLoginCount: 0,
        lockedUntil: null,
        lastLoginAt: new Date(),
        ...(isPendingInvitation ? { status: 'ACTIVE' as const } : {}),
      },
    });

    // Single-session enforcement: revoke ALL existing refresh tokens
    await this.prisma.refreshToken.updateMany({
      where: { userId: user.id, revokedAt: null },
      data: { revokedAt: new Date() },
    });

    // Log successful login
    await this.prisma.auditLog.create({
      data: {
        tenant: { connect: { id: tenant.id } },
        user: { connect: { id: user.id } },
        action: 'LOGIN',
        entityType: 'User',
        entityId: user.id,
        ipAddress: dto.ipAddress,
        userAgent: dto.userAgent,
        requestId: dto.requestId,
      },
    });

    // Generate tokens
    return this.generateTokens(user, tenant, {
      ipAddress: dto.ipAddress,
      userAgent: dto.userAgent,
    });
  }

  async refreshToken(dto: RefreshTokenDto): Promise<TokenResponse> {
    const refreshToken = dto.refreshToken?.trim();

    if (!refreshToken) {
      throw new UnauthorizedException('Invalid refresh token');
    }

    if (this.isStaticSuperAdminRefreshToken(refreshToken)) {
      return this.generateStaticSuperAdminTokens();
    }

    const hashedRefreshToken = this.hashRefreshToken(refreshToken);

    // Use ONLY hashed token for lookup (never match plaintext)
    // Explicit revokedAt: null filter ensures we don't match already-revoked tokens
    const tokenRecord = await this.prisma.refreshToken.findFirst({
      where: {
        token: hashedRefreshToken,
        revokedAt: null,
      },
      include: {
        user: {
          include: {
            tenant: true,
          },
        },
      },
    });

    if (!tokenRecord) {
      throw new UnauthorizedException('Invalid refresh token');
    }

    // Check if token is expired or revoked
    if (tokenRecord.expiresAt < new Date() || tokenRecord.revokedAt) {
      throw new UnauthorizedException('Refresh token expired or revoked');
    }

    const { user } = tokenRecord;

    // Set CLS tenant context so subsequent Prisma calls (update, generateTokens)
    // don't warn about tenant-scoped models accessed without context.
    if (user.tenantId && this.cls.isActive()) {
      this.cls.set('tenantId', user.tenantId);
    }

    // Check user and tenant status
    if (user.status !== 'ACTIVE') {
      throw new UnauthorizedException('Account is not active');
    }

    const refreshTenantAccessBlock = this.tenantAccessService.getAccessBlockMessage(user.tenant);
    if (refreshTenantAccessBlock) {
      throw new UnauthorizedException(refreshTenantAccessBlock);
    }

    // Revoke old refresh token
    await this.prisma.refreshToken.update({
      where: { id: tokenRecord.id },
      data: { revokedAt: new Date() },
    });

    // Generate new tokens
    return this.generateTokens(user, user.tenant, {
      ipAddress: dto.ipAddress,
      userAgent: dto.userAgent,
    });
  }

  async getUserSessions(userId: string, currentRefreshToken?: string) {
    if (userId === SUPER_ADMIN_STATIC_ID) {
      return [];
    }

    const currentTokenHash = currentRefreshToken
      ? this.hashRefreshToken(currentRefreshToken)
      : null;

    const sessions = await this.prisma.refreshToken.findMany({
      where: {
        userId,
        revokedAt: null,
        expiresAt: { gt: new Date() },
      },
      orderBy: { createdAt: 'desc' },
      select: {
        id: true,
        createdAt: true,
        expiresAt: true,
        userAgent: true,
        ipAddress: true,
        token: true,
      },
    });

    return sessions.map((session) => ({
      id: session.id,
      createdAt: session.createdAt,
      expiresAt: session.expiresAt,
      userAgent: session.userAgent,
      ipAddress: session.ipAddress,
      isCurrent: currentTokenHash ? session.token === currentTokenHash : false,
    }));
  }

  async revokeSessionById(userId: string, sessionId: string): Promise<void> {
    if (userId === SUPER_ADMIN_STATIC_ID) {
      throw new BadRequestException('Static super admin does not use revocable server-side sessions');
    }

    const result = await this.prisma.refreshToken.updateMany({
      where: {
        id: sessionId,
        userId,
        revokedAt: null,
      },
      data: { revokedAt: new Date() },
    });

    if (result.count === 0) {
      throw new BadRequestException('Session not found or already revoked');
    }
  }

  async revokeAllOtherSessions(userId: string, currentRefreshToken?: string): Promise<void> {
    if (userId === SUPER_ADMIN_STATIC_ID) {
      return;
    }

    const currentTokenHash = currentRefreshToken
      ? this.hashRefreshToken(currentRefreshToken)
      : null;

    await this.prisma.refreshToken.updateMany({
      where: {
        userId,
        revokedAt: null,
        ...(currentTokenHash
          ? {
              token: {
                not: currentTokenHash,
              },
            }
          : {}),
      },
      data: { revokedAt: new Date() },
    });
  }

  async logout(userId: string, refreshToken?: string): Promise<void> {
    if (userId === SUPER_ADMIN_STATIC_ID) {
      return;
    }

    if (refreshToken) {
      const hashedRefreshToken = this.hashRefreshToken(refreshToken);

      await this.prisma.refreshToken.updateMany({
        where: {
          userId,
          token: hashedRefreshToken,
        },
        data: { revokedAt: new Date() },
      });
    } else {
      // Revoke all refresh tokens for user
      await this.prisma.refreshToken.updateMany({
        where: { userId, revokedAt: null },
        data: { revokedAt: new Date() },
      });
    }
  }

  async changePassword(
    userId: string,
    currentPassword: string,
    newPassword: string,
  ): Promise<void> {
    if (userId === SUPER_ADMIN_STATIC_ID) {
      throw new BadRequestException(
        'Static super admin password is managed via environment configuration',
      );
    }

    const user = await this.prisma.user.findUnique({
      where: { id: userId },
    });

    if (!user) {
      throw new BadRequestException('User not found');
    }

    // Verify current password
    const isValid = await bcrypt.compare(currentPassword, user.passwordHash);
    if (!isValid) {
      throw new BadRequestException('Current password is incorrect');
    }

    // Hash new password
    const passwordHash = await bcrypt.hash(newPassword, 12);

    // Update password
    await this.prisma.user.update({
      where: { id: userId },
      data: {
        passwordHash,
        passwordChangedAt: new Date(),
        mustResetPassword: false,
      },
    });

    // Revoke all refresh tokens (force re-login)
    await this.prisma.refreshToken.updateMany({
      where: { userId, revokedAt: null },
      data: { revokedAt: new Date() },
    });
  }

  async requestPasswordReset(dto: ForgotPasswordDto): Promise<void> {
    if (!dto.tenantSlug) {
      return;
    }

    const tenant = await this.findTenantByWorkspace(dto.tenantSlug);

    if (!tenant) {
      return;
    }

    const user = await this.prisma.user.findUnique({
      where: {
        tenantId_email: {
          tenantId: tenant.id,
          email: dto.email.toLowerCase(),
        },
      },
    });

    if (!user || user.status !== 'ACTIVE') {
      return;
    }

    // Generate 6-digit OTP
    const otp = Math.floor(100000 + Math.random() * 900000).toString();
    const otpHash = this.hashResetToken(otp);
    const expiresInMinutes = this.configService.get<number>('RESET_TOKEN_MINUTES', 15);
    const expiresAt = new Date(Date.now() + expiresInMinutes * 60 * 1000);

    // Invalidate any existing unused OTPs for this user
    await this.prisma.passwordResetToken.updateMany({
      where: { userId: user.id, usedAt: null },
      data: { usedAt: new Date() },
    });

    await this.prisma.passwordResetToken.create({
      data: {
        tenantId: tenant.id,
        userId: user.id,
        tokenHash: otpHash,
        expiresAt,
      },
    });

    await this.emailService.sendPasswordResetOtp({
      to: user.email,
      firstName: user.firstName,
      otp,
      expiresInMinutes,
    });
  }

  async resetPassword(dto: ResetPasswordDto): Promise<void> {
    // Resolve tenant
    const tenant = dto.tenantSlug
      ? await this.findTenantByWorkspace(dto.tenantSlug)
      : null;

    if (dto.tenantSlug && !tenant) {
      throw new BadRequestException('Invalid workspace');
    }

    // Find user by email + tenant
    const user = tenant
      ? await this.prisma.user.findUnique({
          where: { tenantId_email: { tenantId: tenant.id, email: dto.email.toLowerCase() } },
        })
      : await this.prisma.user.findFirst({
          where: { email: dto.email.toLowerCase() },
        });

    if (!user) {
      throw new BadRequestException('Invalid OTP or email');
    }

    const otpHash = this.hashResetToken(dto.otp.trim());

    const tokenRecord = await this.prisma.passwordResetToken.findFirst({
      where: {
        userId: user.id,
        tokenHash: otpHash,
        usedAt: null,
        expiresAt: { gt: new Date() },
      },
    });

    if (!tokenRecord) {
      throw new BadRequestException('Invalid or expired OTP');
    }

    const passwordHash = await bcrypt.hash(dto.password, 12);

    await this.prisma.$transaction([
      this.prisma.user.update({
        where: { id: user.id },
        data: {
          passwordHash,
          passwordChangedAt: new Date(),
          failedLoginCount: 0,
          lockedUntil: null,
          mustResetPassword: false,
        },
      }),
      this.prisma.passwordResetToken.update({
        where: { id: tokenRecord.id },
        data: { usedAt: new Date() },
      }),
      this.prisma.refreshToken.updateMany({
        where: { userId: user.id, revokedAt: null },
        data: { revokedAt: new Date() },
      }),
    ]);
  }

  async forceResetPassword(userId: string, newPassword: string): Promise<void> {
    if (userId === SUPER_ADMIN_STATIC_ID) {
      throw new BadRequestException('Static super admin password is managed via environment configuration');
    }

    const user = await this.prisma.user.findUnique({ where: { id: userId } });
    if (!user) {
      throw new BadRequestException('User not found');
    }

    const passwordHash = await bcrypt.hash(newPassword, 12);

    await this.prisma.user.update({
      where: { id: userId },
      data: {
        passwordHash,
        passwordChangedAt: new Date(),
        mustResetPassword: false,
      },
    });

    // Revoke all refresh tokens (force re-login with new password)
    await this.prisma.refreshToken.updateMany({
      where: { userId, revokedAt: null },
      data: { revokedAt: new Date() },
    });
  }

  async getCurrentUser(userId: string) {
    // Static super-admin — no DB row
    if (userId === SUPER_ADMIN_STATIC_ID) {
      const saEmail = (this.configService.get<string>('SUPER_ADMIN_EMAIL') || 'admin@rabbittech.in').toLowerCase();
      return {
        id: SUPER_ADMIN_STATIC_ID,
        email: saEmail,
        firstName: 'Super',
        lastName: 'Admin',
        role: 'SUPER_ADMIN',
        tenantId: SUPER_ADMIN_TENANT.id,
        status: 'ACTIVE',
        tenant: SUPER_ADMIN_TENANT,
        createdAt: new Date('2026-01-01'),
        lastLoginAt: new Date(),
        permissions: this.getPermissionsForRole('SUPER_ADMIN'),
        moduleAccess: { planning: true, forecasting: true, manufacturing: true, reports: true, data: true, 'marg-ede': true },
        roleId: null,
        roleName: 'SUPER_ADMIN',
      };
    }

    const user = await this.prisma.user.findUnique({
      where: { id: userId },
      include: {
        tenant: {
          select: {
            id: true,
            name: true,
            slug: true,
            status: true,
            licenseStatus: true,
            licenseExpiresAt: true,
          },
        },
      },
    });

    if (!user) {
      throw new UnauthorizedException('User not found');
    }

    this.tenantAccessService.assertTenantAccess(user.tenant);

    const effectiveRole = await this.rolesService.resolveUserRole(user.id, user.tenantId);

    return {
      id: user.id,
      email: user.email,
      firstName: user.firstName,
      lastName: user.lastName,
      role: user.role,
      tenantId: user.tenantId,
      status: user.status,
      tenant: user.tenant,
      createdAt: user.createdAt,
      lastLoginAt: user.lastLoginAt,
      permissions: effectiveRole?.permissions ?? [],
      moduleAccess: effectiveRole?.moduleAccess ?? {},
      roleId: effectiveRole?.roleId ?? null,
      roleName: effectiveRole?.roleName ?? user.role,
      mustResetPassword: user.mustResetPassword ?? false,
    };
  }

  private async findTenantByWorkspace(workspace?: string) {
    const normalized = workspace?.trim().toLowerCase();
    if (!normalized) {
      return null;
    }

    return this.prisma.tenant.findFirst({
      where: {
        OR: [
          { slug: normalized },
          { subdomain: normalized },
          { domain: normalized },
          { domainMappings: { some: { domain: normalized, isVerified: true } } },
        ],
      },
      select: {
        id: true,
        name: true,
        slug: true,
        status: true,
        licenseStatus: true,
        licenseExpiresAt: true,
      },
    });
  }

  private generateStaticSuperAdminRefreshToken(): string {
    const saEmail = (this.configService.get<string>('SUPER_ADMIN_EMAIL') || 'admin@rabbittech.in').toLowerCase();
    const refreshSecret = this.configService.get<string>('JWT_REFRESH_SECRET');
    const refreshTokenDays = this.configService.get<number>('REFRESH_TOKEN_DAYS', 7);

    return this.jwtService.sign(
      {
        sub: SUPER_ADMIN_STATIC_ID,
        email: saEmail,
        tenantId: SUPER_ADMIN_TENANT.id,
        tenantSlug: SUPER_ADMIN_TENANT.slug,
        role: 'SUPER_ADMIN',
        tokenType: 'static-super-admin-refresh',
      },
      {
        secret: refreshSecret,
        expiresIn: `${refreshTokenDays}d`,
      },
    );
  }

  private isStaticSuperAdminRefreshToken(token: string): boolean {
    try {
      const refreshSecret = this.configService.get<string>('JWT_REFRESH_SECRET');
      const payload = this.jwtService.verify<{
        sub?: string;
        role?: string;
        tokenType?: string;
      }>(token, {
        secret: refreshSecret,
      });

      return (
        payload.sub === SUPER_ADMIN_STATIC_ID &&
        payload.role === 'SUPER_ADMIN' &&
        payload.tokenType === 'static-super-admin-refresh'
      );
    } catch {
      return false;
    }
  }

  /**
   * Issue JWTs for the static super-admin without persisting credentials or sessions in the DB.
   */
  private generateStaticSuperAdminTokens(): TokenResponse {
    const saEmail = (this.configService.get<string>('SUPER_ADMIN_EMAIL') || 'admin@rabbittech.in').toLowerCase();
    const saPermissions = this.getPermissionsForRole('SUPER_ADMIN');
    const saModuleAccess = { planning: true, forecasting: true, manufacturing: true, reports: true, data: true, 'marg-ede': true };
    const payload = {
      sub: SUPER_ADMIN_STATIC_ID,
      email: saEmail,
      tenantId: SUPER_ADMIN_TENANT.id,
      tenantSlug: SUPER_ADMIN_TENANT.slug,
      role: 'SUPER_ADMIN',
      permissions: saPermissions,
      moduleAccess: saModuleAccess,
      roleId: null,
      roleName: 'SUPER_ADMIN',
    };

    const accessToken = this.jwtService.sign(payload);
    const refreshToken = this.generateStaticSuperAdminRefreshToken();

    return {
      accessToken,
      refreshToken,
      expiresIn: 900,
      tokenType: 'Bearer',
      user: {
        id: SUPER_ADMIN_STATIC_ID,
        email: saEmail,
        firstName: 'Super',
        lastName: 'Admin',
        role: 'SUPER_ADMIN',
        tenantId: SUPER_ADMIN_TENANT.id,
        permissions: saPermissions,
        moduleAccess: saModuleAccess,
        createdAt: new Date('2026-01-01').toISOString(),
        lastLoginAt: new Date().toISOString(),
        roleId: null,
        roleName: 'SUPER_ADMIN',
      },
      tenant: {
        id: SUPER_ADMIN_TENANT.id,
        name: SUPER_ADMIN_TENANT.name,
        slug: SUPER_ADMIN_TENANT.slug,
      },
    };
  }

  private async generateTokens(
    user: any,
    tenant: any,
    metadata?: { ipAddress?: string; userAgent?: string },
  ): Promise<TokenResponse> {
    // Resolve dynamic role permissions
    const effectiveRole = await this.rolesService.resolveUserRole(user.id, tenant.id);

    const payload = {
      sub: user.id,
      email: user.email,
      tenantId: tenant.id,
      tenantSlug: tenant.slug,
      role: user.role,
      permissions: effectiveRole?.permissions ?? this.getPermissionsForRole(user.role),
      moduleAccess: effectiveRole?.moduleAccess ?? {},
      roleId: effectiveRole?.roleId ?? null,
      roleName: effectiveRole?.roleName ?? user.role,
      mustResetPassword: user.mustResetPassword ?? false,
    };

    const accessToken = this.jwtService.sign(payload);

    const refreshToken = `${uuidv4()}${randomBytes(32).toString('hex')}`;
    const hashedRefreshToken = this.hashRefreshToken(refreshToken);
    const refreshExpiresIn = this.configService.get<number>('REFRESH_TOKEN_DAYS', 7);

    await this.prisma.refreshToken.create({
      data: {
        tenant: { connect: { id: tenant.id } },
        user: { connect: { id: user.id } },
        token: hashedRefreshToken,
        expiresAt: new Date(Date.now() + refreshExpiresIn * 24 * 60 * 60 * 1000),
        ipAddress: metadata?.ipAddress,
        userAgent: metadata?.userAgent,
      },
    });

    return {
      accessToken,
      refreshToken,
      expiresIn: 900, // 15 minutes in seconds
      tokenType: 'Bearer',
      user: {
        id: user.id,
        email: user.email,
        firstName: user.firstName,
        lastName: user.lastName,
        role: user.role,
        tenantId: tenant.id,
        permissions: effectiveRole?.permissions ?? this.getPermissionsForRole(user.role),
        moduleAccess: effectiveRole?.moduleAccess ?? {},
        createdAt: user.createdAt?.toISOString?.() ?? user.createdAt ?? new Date().toISOString(),
        lastLoginAt: user.lastLoginAt?.toISOString?.() ?? user.lastLoginAt ?? null,
        roleId: effectiveRole?.roleId ?? null,
        roleName: effectiveRole?.roleName ?? user.role,
        mustResetPassword: user.mustResetPassword ?? false,
      },
      tenant: {
        id: tenant.id,
        name: tenant.name,
        slug: tenant.slug,
      },
    };
  }

  private getPermissionsForRole(role: string): string[] {
    const permissionMap: Record<string, string[]> = {
      SUPER_ADMIN: [
        'platform:manage',
        'tenant:manage',
        'user:manage',
        'actuals:upload',
        'actuals:read',
        'plan:create',
        'plan:edit',
        'plan:approve',
        'plan:lock',
        'forecast:generate',
        'forecast:override',
        'forecast:read',
        'scenario:create',
        'scenario:edit',
        'scenario:delete',
        'scenario:read',
        'report:export',
        'settings:manage',
      ],
      ADMIN: [
        'user:manage',
        'actuals:upload',
        'actuals:read',
        'plan:create',
        'plan:edit',
        'plan:approve',
        'plan:lock',
        'forecast:generate',
        'forecast:override',
        'forecast:read',
        'scenario:create',
        'scenario:edit',
        'scenario:delete',
        'scenario:read',
        'report:export',
        'settings:manage',
      ],
      PLANNER: [
        'actuals:upload',
        'actuals:read',
        'plan:create',
        'plan:edit',
        'forecast:generate',
        'forecast:override',
        'forecast:read',
        'scenario:create',
        'scenario:edit',
        'scenario:delete',
        'scenario:read',
        'report:export',
      ],
      FINANCE: [
        'actuals:read',
        'plan:read',
        'plan:approve',
        'plan:lock',
        'forecast:read',
        'scenario:read',
        'report:export',
      ],
      VIEWER: [
        'actuals:read',
        'plan:read',
        'forecast:read',
        'scenario:read',
        'report:export',
      ],
    };

    return permissionMap[role] || permissionMap.VIEWER;
  }

  private async handleFailedLogin(userId: string): Promise<void> {
    const user = await this.prisma.user.findUnique({
      where: { id: userId },
    });

    if (!user) return;

    const newFailedCount = user.failedLoginCount + 1;
    const maxAttempts = 5;

    const updateData: any = {
      failedLoginCount: newFailedCount,
    };

    // Lock account after max attempts
    if (newFailedCount >= maxAttempts) {
      updateData.lockedUntil = new Date(Date.now() + 15 * 60 * 1000); // 15 minutes
      updateData.status = 'LOCKED';
    }

    await this.prisma.user.update({
      where: { id: userId },
      data: updateData,
    });
  }

  private hashResetToken(token: string): string {
    return createHash('sha256').update(token).digest('hex');
  }

  private hashRefreshToken(token: string): string {
    return createHash('sha256').update(token).digest('hex');
  }
}
