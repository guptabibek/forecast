import {
  BadRequestException,
  ConflictException,
  Injectable,
  UnauthorizedException,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { JwtService } from '@nestjs/jwt';
import * as bcrypt from 'bcrypt';
import { createHash, randomBytes } from 'crypto';
import { v4 as uuidv4 } from 'uuid';
import { PrismaService } from '../../core/database/prisma.service';
import { EmailService } from '../../core/notification/email.service';
import {
  ForgotPasswordDto,
  LoginDto,
  RefreshTokenDto,
  RegisterDto,
  ResetPasswordDto,
  TokenResponse,
} from './dto/auth.dto';

@Injectable()
export class AuthService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly jwtService: JwtService,
    private readonly configService: ConfigService,
    private readonly emailService: EmailService,
  ) {}

  async register(dto: RegisterDto): Promise<TokenResponse> {
    const tenantSlug = dto.tenantSlug.trim().toLowerCase();
    const tenantName = dto.tenantName.trim();
    const email = dto.email.toLowerCase();

    const existingTenant = await this.prisma.tenant.findUnique({
      where: { slug: tenantSlug },
    });

    if (existingTenant) {
      throw new ConflictException('Workspace URL is already in use');
    }

    const passwordHash = await bcrypt.hash(dto.password, 12);

    const { tenant, user } = await this.prisma.$transaction(async (tx) => {
      const createdTenant = await tx.tenant.create({
        data: {
          name: tenantName,
          slug: tenantSlug,
          subdomain: tenantSlug,
          status: 'TRIAL',
        },
      });

      const createdUser = await tx.user.create({
        data: {
          tenant: { connect: { id: createdTenant.id } },
          email,
          passwordHash,
          firstName: dto.firstName,
          lastName: dto.lastName,
          role: 'ADMIN',
          status: 'ACTIVE',
        },
      });

      await tx.auditLog.create({
        data: {
          tenant: { connect: { id: createdTenant.id } },
          user: { connect: { id: createdUser.id } },
          action: 'CREATE',
          entityType: 'User',
          entityId: createdUser.id,
        },
      });

      return { tenant: createdTenant, user: createdUser };
    });

    return this.generateTokens(user, tenant);
  }

  async login(dto: LoginDto): Promise<TokenResponse> {
    // Find tenant by slug or domain
    let tenant = await this.prisma.tenant.findUnique({
      where: { slug: dto.tenantSlug },
    });


    if (!tenant) {
      throw new UnauthorizedException('Invalid credentials');
    }

    if (tenant.status !== 'ACTIVE' && tenant.status !== 'TRIAL') {
      throw new UnauthorizedException('Tenant is not active');
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

    // Check account status
    if (user.status !== 'ACTIVE') {
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
      },
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
    const hashedRefreshToken = this.hashRefreshToken(dto.refreshToken);

    const tokenRecord = await this.prisma.refreshToken.findFirst({
      where: {
        token: {
          in: [hashedRefreshToken, dto.refreshToken],
        },
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

    // Check user and tenant status
    if (user.status !== 'ACTIVE') {
      throw new UnauthorizedException('Account is not active');
    }

    if (user.tenant.status !== 'ACTIVE' && user.tenant.status !== 'TRIAL') {
      throw new UnauthorizedException('Tenant is not active');
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
    if (refreshToken) {
      const hashedRefreshToken = this.hashRefreshToken(refreshToken);

      await this.prisma.refreshToken.updateMany({
        where: {
          userId,
          token: {
            in: [hashedRefreshToken, refreshToken],
          },
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

    const tenant = await this.prisma.tenant.findUnique({
      where: { slug: dto.tenantSlug },
    });

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

    const resetToken = randomBytes(32).toString('hex');
    const tokenHash = this.hashResetToken(resetToken);
    const expiresInMinutes = this.configService.get<number>('RESET_TOKEN_MINUTES', 60);
    const expiresAt = new Date(Date.now() + expiresInMinutes * 60 * 1000);

    await this.prisma.passwordResetToken.create({
      data: {
        tenantId: tenant.id,
        userId: user.id,
        tokenHash,
        expiresAt,
      },
    });

    const frontendUrl = this.configService.get<string>('FRONTEND_URL') || 'http://localhost:5173';
    const resetLink = `${frontendUrl}/reset-password?token=${resetToken}`;

    await this.emailService.sendPasswordReset({
      to: user.email,
      firstName: user.firstName,
      resetLink,
      expiresInMinutes,
    });
  }

  async resetPassword(dto: ResetPasswordDto): Promise<void> {
    const tokenHash = this.hashResetToken(dto.token);

    const tokenRecord = await this.prisma.passwordResetToken.findUnique({
      where: { tokenHash },
      include: { user: true, tenant: true },
    });

    if (!tokenRecord) {
      throw new BadRequestException('Invalid or expired reset token');
    }

    if (tokenRecord.usedAt || tokenRecord.expiresAt < new Date()) {
      throw new BadRequestException('Invalid or expired reset token');
    }

    const passwordHash = await bcrypt.hash(dto.password, 12);

    await this.prisma.$transaction([
      this.prisma.user.update({
        where: { id: tokenRecord.userId },
        data: {
          passwordHash,
          passwordChangedAt: new Date(),
          failedLoginCount: 0,
          lockedUntil: null,
        },
      }),
      this.prisma.passwordResetToken.update({
        where: { id: tokenRecord.id },
        data: { usedAt: new Date() },
      }),
      this.prisma.refreshToken.updateMany({
        where: { userId: tokenRecord.userId, revokedAt: null },
        data: { revokedAt: new Date() },
      }),
    ]);
  }

  async getCurrentUser(userId: string) {
    const user = await this.prisma.user.findUnique({
      where: { id: userId },
      include: {
        tenant: {
          select: {
            id: true,
            name: true,
            slug: true,
            status: true,
          },
        },
      },
    });

    if (!user) {
      throw new UnauthorizedException('User not found');
    }

    return {
      id: user.id,
      email: user.email,
      firstName: user.firstName,
      lastName: user.lastName,
      role: user.role,
      status: user.status,
      tenant: user.tenant,
      createdAt: user.createdAt,
      lastLoginAt: user.lastLoginAt,
    };
  }

  private async generateTokens(
    user: any,
    tenant: any,
    metadata?: { ipAddress?: string; userAgent?: string },
  ): Promise<TokenResponse> {
    const payload = {
      sub: user.id,
      email: user.email,
      tenantId: tenant.id,
      tenantSlug: tenant.slug,
      role: user.role,
      permissions: this.getPermissionsForRole(user.role),
    };

    const accessToken = this.jwtService.sign(payload);

    const refreshToken = `${uuidv4()}${randomBytes(32).toString('hex')}`;
    const hashedRefreshToken = this.hashRefreshToken(refreshToken);
    const refreshExpiresIn = this.configService.get<number>('REFRESH_TOKEN_DAYS', 7);

    await this.prisma.refreshToken.create({
      data: {
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
