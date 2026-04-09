import {
    BadRequestException,
    ConflictException,
    Injectable,
    NotFoundException,
    ServiceUnavailableException,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Prisma, UserRole, UserStatus } from '@prisma/client';
import * as bcrypt from 'bcrypt';
import { randomBytes } from 'crypto';
import { PrismaService } from '../../core/database/prisma.service';
import { EmailService } from '../../core/notification/email.service';
import { CreateUserDto } from './dto/create-user.dto';
import { UpdateUserDto } from './dto/update-user.dto';
import { UserQueryDto } from './dto/user-query.dto';

@Injectable()
export class UsersService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly emailService: EmailService,
    private readonly configService: ConfigService,
  ) {}

  async invite(createUserDto: CreateUserDto, currentUser: any) {
    this.ensureInvitationEmailConfigured();

    // Check if user already exists in this tenant
    const existingUser = await this.prisma.user.findFirst({
      where: {
        email: createUserDto.email,
        tenantId: currentUser.tenantId,
      },
    });

    if (existingUser) {
      throw new ConflictException('User with this email already exists');
    }

    // Generate temporary password
    const tempPassword = this.generateTemporaryPassword();
    const hashedPassword = await bcrypt.hash(tempPassword, 12);

    return this.prisma.$transaction(async (tx) => {
      const tenant = await tx.tenant.findUnique({
        where: { id: currentUser.tenantId },
        select: { id: true, name: true, slug: true, subdomain: true, domain: true },
      });

      if (!tenant) {
        throw new NotFoundException('Tenant not found');
      }

      const user = await tx.user.create({
        data: {
          email: createUserDto.email.toLowerCase(),
          firstName: createUserDto.firstName,
          lastName: createUserDto.lastName,
          passwordHash: hashedPassword,
          role: createUserDto.role as UserRole,
          tenant: { connect: { id: currentUser.tenantId } },
          status: UserStatus.PENDING,
        },
        select: {
          id: true,
          email: true,
          firstName: true,
          lastName: true,
          role: true,
          status: true,
          createdAt: true,
        },
      });

      await tx.auditLog.create({
        data: {
          tenantId: currentUser.tenantId,
          userId: currentUser.id,
          action: 'CREATE',
          entityType: 'User',
          entityId: user.id,
          metadata: {
            operation: 'invite-user',
            targetUserId: user.id,
            targetEmail: user.email,
            role: user.role,
          },
        },
      });

      await this.emailService.sendInvitation({
        to: user.email,
        firstName: user.firstName,
        workspaceName: tenant.name,
        workspaceUrl: this.buildWorkspaceUrl(tenant),
        temporaryPassword: tempPassword,
        invitedBy: currentUser.email,
      });

      return user;
    });
  }

  async findAll(query: UserQueryDto, currentUser: any) {
    const { search, role, status } = query;

    const where: Prisma.UserWhereInput = {
      tenantId: currentUser.tenantId,
      ...(search && {
        OR: [
          { email: { contains: search, mode: 'insensitive' } },
          { firstName: { contains: search, mode: 'insensitive' } },
          { lastName: { contains: search, mode: 'insensitive' } },
        ],
      }),
      ...(role && { role: role as UserRole }),
      ...(status && { status: status as UserStatus }),
    };

    const users = await this.prisma.user.findMany({
      where,
      orderBy: { createdAt: 'desc' },
      select: {
        id: true,
        email: true,
        firstName: true,
        lastName: true,
        role: true,
        status: true,
        lastLoginAt: true,
        createdAt: true,
        avatarUrl: true,
      },
    });

    return users;
  }

  async findOne(id: string, currentUser: any) {
    const user = await this.prisma.user.findFirst({
      where: {
        id,
        tenantId: currentUser.tenantId,
      },
      select: {
        id: true,
        email: true,
        firstName: true,
        lastName: true,
        role: true,
        status: true,
        avatarUrl: true,
        lastLoginAt: true,
        mfaEnabled: true,
        createdAt: true,
        updatedAt: true,
      },
    });

    if (!user) {
      throw new NotFoundException('User not found');
    }

    return user;
  }

  async update(id: string, updateUserDto: UpdateUserDto, currentUser: any) {
    await this.findOne(id, currentUser);

    // Prevent changing own role
    if (id === currentUser.id && updateUserDto.role) {
      throw new BadRequestException('Cannot change your own role');
    }

    const updateData: Prisma.UserUpdateInput = {};
    if (updateUserDto.firstName) updateData.firstName = updateUserDto.firstName;
    if (updateUserDto.lastName) updateData.lastName = updateUserDto.lastName;
    if (updateUserDto.role) updateData.role = updateUserDto.role as UserRole;
    if (updateUserDto.avatarUrl !== undefined) updateData.avatarUrl = updateUserDto.avatarUrl;

    return this.prisma.user.update({
      where: { id },
      data: updateData,
      select: {
        id: true,
        email: true,
        firstName: true,
        lastName: true,
        role: true,
        status: true,
        avatarUrl: true,
      },
    });
  }

  async updateProfile(id: string, updateUserDto: UpdateUserDto) {
    // Users can only update their own profile fields
    const { firstName, lastName, avatarUrl } = updateUserDto;

    return this.prisma.user.update({
      where: { id },
      data: { 
        ...(firstName && { firstName }),
        ...(lastName && { lastName }),
        ...(avatarUrl !== undefined && { avatarUrl }),
      },
      select: {
        id: true,
        email: true,
        firstName: true,
        lastName: true,
        role: true,
        avatarUrl: true,
      },
    });
  }

  async remove(id: string, currentUser: any) {
    if (id === currentUser.id) {
      throw new BadRequestException('Cannot delete your own account');
    }

    await this.findOne(id, currentUser);

    // Soft delete by setting status to INACTIVE
    await this.prisma.user.update({
      where: { id },
      data: {
        status: UserStatus.INACTIVE,
      },
    });
  }

  async deactivate(id: string, currentUser: any) {
    if (id === currentUser.id) {
      throw new BadRequestException('Cannot deactivate your own account');
    }

    await this.findOne(id, currentUser);

    return this.prisma.user.update({
      where: { id },
      data: { status: UserStatus.INACTIVE },
      select: {
        id: true,
        email: true,
        status: true,
      },
    });
  }

  async activate(id: string, currentUser: any) {
    await this.findOne(id, currentUser);

    return this.prisma.user.update({
      where: { id },
      data: { status: UserStatus.ACTIVE },
      select: {
        id: true,
        email: true,
        status: true,
      },
    });
  }

  async resendInvite(id: string, currentUser: any) {
    this.ensureInvitationEmailConfigured();

    const tempPassword = this.generateTemporaryPassword();
    const hashedPassword = await bcrypt.hash(tempPassword, 12);

    return this.prisma.$transaction(async (tx) => {
      const tenant = await tx.tenant.findUnique({
        where: { id: currentUser.tenantId },
        select: { id: true, name: true, slug: true, subdomain: true, domain: true },
      });

      if (!tenant) {
        throw new NotFoundException('Tenant not found');
      }

      const user = await tx.user.findFirst({
        where: {
          id,
          tenantId: currentUser.tenantId,
        },
        select: {
          id: true,
          email: true,
          firstName: true,
          status: true,
        },
      });

      if (!user) {
        throw new NotFoundException('User not found');
      }

      if (user.status !== UserStatus.PENDING) {
        throw new BadRequestException('Invitation can only be resent for users in pending status');
      }

      await tx.user.update({
        where: { id },
        data: { passwordHash: hashedPassword },
      });

      await tx.auditLog.create({
        data: {
          tenantId: currentUser.tenantId,
          userId: currentUser.id,
          action: 'UPDATE',
          entityType: 'UserInvitation',
          entityId: id,
          changedFields: ['passwordHash'],
          metadata: {
            operation: 'resend-invite',
            targetUserId: id,
            targetEmail: user.email,
            resentAt: new Date().toISOString(),
          },
        },
      });

      await this.emailService.sendInvitation({
        to: user.email,
        firstName: user.firstName,
        workspaceName: tenant.name,
        workspaceUrl: this.buildWorkspaceUrl(tenant),
        temporaryPassword: tempPassword,
        invitedBy: currentUser.email,
      });

      return { message: 'Invitation resent successfully', userId: id };
    });
  }

  async getActivity(
    id: string,
    page: number,
    limit: number,
    currentUser: any,
  ) {
    await this.findOne(id, currentUser);

    const safePage = Number.isFinite(page) && page > 0 ? page : 1;
    const safeLimit = Number.isFinite(limit) && limit > 0 ? Math.min(limit, 200) : 50;
    const skip = (safePage - 1) * safeLimit;

    const [logs, total] = await Promise.all([
      this.prisma.auditLog.findMany({
        where: {
          tenantId: currentUser.tenantId,
          userId: id,
        },
        skip,
        take: safeLimit,
        orderBy: { createdAt: 'desc' },
      }),
      this.prisma.auditLog.count({
        where: {
          tenantId: currentUser.tenantId,
          userId: id,
        },
      }),
    ]);

    const data = logs.map((log) => ({
      id: log.id,
      action: log.action,
      resource: log.entityType,
      resourceId: log.entityId,
      metadata: log.metadata || {},
      createdAt: log.createdAt,
    }));

    return {
      data,
      total,
      page: safePage,
      limit: safeLimit,
      userId: id,
    };
  }

  async updateAvatar(userId: string, avatarUrl: string | undefined, currentUser: any) {
    await this.findOne(userId, currentUser);

    if (typeof avatarUrl === 'string' && avatarUrl.trim().length > 0) {
      const normalizedUrl = avatarUrl.trim();
      if (!normalizedUrl.startsWith('/')) {
        try {
          const parsed = new URL(normalizedUrl);
          if (!['http:', 'https:'].includes(parsed.protocol)) {
            throw new BadRequestException('Avatar URL must use http or https');
          }
        } catch {
          throw new BadRequestException('Avatar URL must be a valid absolute URL');
        }
      }
    }

    const fallbackAvatar = `https://ui-avatars.com/api/?name=${encodeURIComponent(currentUser.firstName || 'U')}+${encodeURIComponent(currentUser.lastName || '')}&background=random`;
    const normalizedAvatarUrl = typeof avatarUrl === 'string' && avatarUrl.trim().length > 0
      ? avatarUrl.trim()
      : fallbackAvatar;

    const updated = await this.prisma.user.update({
      where: { id: userId },
      data: { avatarUrl: normalizedAvatarUrl },
      select: { avatarUrl: true },
    });

    return { data: { url: updated.avatarUrl } };
  }

  async findByEmail(email: string, tenantId: string) {
    return this.prisma.user.findFirst({
      where: { email, tenantId },
    });
  }

  private ensureInvitationEmailConfigured() {
    if (!this.emailService.isConfigured()) {
      throw new ServiceUnavailableException(
        'SMTP is not configured. Configure email delivery before inviting users.',
      );
    }
  }

  private generateTemporaryPassword(): string {
    return randomBytes(12).toString('hex');
  }

  private buildWorkspaceUrl(tenant: {
    slug: string;
    subdomain?: string | null;
    domain?: string | null;
  }): string {
    const configuredFrontendUrl = this.configService.get<string>('FRONTEND_URL') || 'http://localhost:5173';

    try {
      const parsed = new URL(configuredFrontendUrl);
      const protocol = parsed.protocol || 'https:';
      const port = parsed.port ? `:${parsed.port}` : '';

      if (tenant.domain?.trim()) {
        const host = tenant.domain.trim();
        const includePort = host === 'localhost' || host.endsWith('.localhost');
        return `${protocol}//${host}${includePort ? port : ''}`;
      }

      const workspaceSlug = tenant.subdomain?.trim() || tenant.slug;
      const configuredMainDomain = (this.configService.get<string>('MAIN_DOMAIN') || '').trim();

      if (configuredMainDomain) {
        return `${protocol}//${workspaceSlug}.${configuredMainDomain}`;
      }

      const hostname = parsed.hostname.toLowerCase();
      if (hostname === 'localhost' || hostname.endsWith('.localhost')) {
        return `${protocol}//${workspaceSlug}.localhost${port}`;
      }

      const parts = hostname.split('.');
      if (parts.length >= 3) {
        return `${protocol}//${workspaceSlug}.${parts.slice(1).join('.')}${port}`;
      }

      return `${protocol}//${hostname}${port}`;
    } catch {
      return configuredFrontendUrl;
    }
  }

  async updateLastLogin(id: string) {
    return this.prisma.user.update({
      where: { id },
      data: { 
        lastLoginAt: new Date(),
        failedLoginCount: 0,
        lockedUntil: null,
      },
    });
  }

  async incrementFailedLogin(id: string) {
    const user = await this.prisma.user.findUnique({ where: { id } });
    if (!user) return;

    const failedCount = user.failedLoginCount + 1;
    const updateData: Prisma.UserUpdateInput = {
      failedLoginCount: failedCount,
    };

    // Lock account after 5 failed attempts
    if (failedCount >= 5) {
      updateData.status = UserStatus.LOCKED;
      updateData.lockedUntil = new Date(Date.now() + 30 * 60 * 1000); // Lock for 30 minutes
    }

    return this.prisma.user.update({
      where: { id },
      data: updateData,
    });
  }

  async changePassword(id: string, oldPassword: string, newPassword: string) {
    const user = await this.prisma.user.findUnique({ where: { id } });
    if (!user) {
      throw new NotFoundException('User not found');
    }

    const isValid = await bcrypt.compare(oldPassword, user.passwordHash);
    if (!isValid) {
      throw new BadRequestException('Current password is incorrect');
    }

    const hashedPassword = await bcrypt.hash(newPassword, 12);

    await this.prisma.user.update({
      where: { id },
      data: {
        passwordHash: hashedPassword,
        passwordChangedAt: new Date(),
      },
    });

    return { message: 'Password changed successfully' };
  }
}
