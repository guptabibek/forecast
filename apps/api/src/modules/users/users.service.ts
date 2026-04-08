import {
    BadRequestException,
    ConflictException,
    Injectable,
    NotFoundException,
} from '@nestjs/common';
import { Prisma, UserRole, UserStatus } from '@prisma/client';
import * as bcrypt from 'bcrypt';
import { randomBytes } from 'crypto';
import { PrismaService } from '../../core/database/prisma.service';
import { CreateUserDto } from './dto/create-user.dto';
import { UpdateUserDto } from './dto/update-user.dto';
import { UserQueryDto } from './dto/user-query.dto';

@Injectable()
export class UsersService {
  constructor(private readonly prisma: PrismaService) {}

  async invite(createUserDto: CreateUserDto, currentUser: any) {
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
    const tempPassword = randomBytes(16).toString('hex');
    const hashedPassword = await bcrypt.hash(tempPassword, 12);

    const user = await this.prisma.user.create({
      data: {
        email: createUserDto.email,
        firstName: createUserDto.firstName,
        lastName: createUserDto.lastName,
        passwordHash: hashedPassword,
        role: createUserDto.role as UserRole,
        tenant: { connect: { id: currentUser.tenantId } },
        status: UserStatus.PENDING, // User needs to accept invite
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

    // TODO: Send invitation email
    // await this.emailService.sendInvitation(user.email, tempPassword);

    return user;
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
    const user = await this.findOne(id, currentUser);
    if (user.status !== UserStatus.PENDING) {
      throw new BadRequestException('Invitation can only be resent for users in pending status');
    }

    await this.prisma.auditLog.create({
      data: {
        tenantId: currentUser.tenantId,
        userId: currentUser.id,
        action: 'UPDATE',
        entityType: 'UserInvitation',
        entityId: id,
        changedFields: ['status'],
        metadata: {
          operation: 'resend-invite',
          targetUserId: id,
          targetEmail: user.email,
          resentAt: new Date().toISOString(),
        },
      },
    });

    return { message: 'Invitation resent successfully', userId: id };
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
