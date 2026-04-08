import type { User, UserRole } from '../../types';
import { apiClient } from './client';

export interface InviteUserDto {
  email: string;
  role: UserRole;
  firstName?: string;
  lastName?: string;
}

export interface UpdateUserDto {
  firstName?: string;
  lastName?: string;
  role?: UserRole;
  isActive?: boolean;
}

export interface UpdateProfileDto {
  firstName?: string;
  lastName?: string;
  avatar?: string;
}

export interface ChangePasswordDto {
  currentPassword: string;
  newPassword: string;
}

export interface UserActivity {
  id: string;
  action: string;
  resource: string;
  resourceId: string;
  metadata: Record<string, unknown>;
  createdAt: string;
}

export const userService = {
  async getAll(params?: { page?: number; limit?: number; search?: string; role?: string }): Promise<{ data: User[]; total: number }> {
    const { data } = await apiClient.get<{ data: User[]; meta: { total: number } }>('/users', { params });
    return { data: data.data, total: data.meta.total };
  },

  async getById(id: string): Promise<User> {
    const { data } = await apiClient.get<{ data: User }>(`/users/${id}`);
    return data.data;
  },

  async invite(dto: InviteUserDto): Promise<User> {
    const { data } = await apiClient.post<{ data: User }>('/users/invite', dto);
    return data.data;
  },

  async update(id: string, dto: UpdateUserDto): Promise<User> {
    const { data } = await apiClient.patch<{ data: User }>(`/users/${id}`, dto);
    return data.data;
  },

  async delete(id: string): Promise<void> {
    await apiClient.delete(`/users/${id}`);
  },

  async activate(id: string): Promise<User> {
    const { data } = await apiClient.post<{ data: User }>(`/users/${id}/activate`);
    return data.data;
  },

  async deactivate(id: string): Promise<User> {
    const { data } = await apiClient.post<{ data: User }>(`/users/${id}/deactivate`);
    return data.data;
  },

  async resendInvite(id: string): Promise<void> {
    await apiClient.post(`/users/${id}/resend-invite`);
  },

  async getProfile(): Promise<User> {
    const { data } = await apiClient.get<{ data: User }>('/users/me');
    return data.data;
  },

  async updateProfile(dto: UpdateProfileDto): Promise<User> {
    const { data } = await apiClient.patch<{ data: User }>('/users/me', dto);
    return data.data;
  },

  async changePassword(dto: ChangePasswordDto): Promise<void> {
    await apiClient.post('/users/profile/change-password', dto);
  },

  async getActivity(userId: string, params?: { page?: number; limit?: number }): Promise<{ data: UserActivity[]; total: number }> {
    const { data } = await apiClient.get<{ data: UserActivity[]; meta: { total: number } }>(`/users/${userId}/activity`, { params });
    return { data: data.data, total: data.meta.total };
  },

  async uploadAvatar(file: File): Promise<{ url: string }> {
    const formData = new FormData();
    formData.append('avatar', file);
    const { data } = await apiClient.post<{ data: { url: string } }>('/users/profile/avatar', formData, {
      headers: { 'Content-Type': 'multipart/form-data' },
    });
    return data.data;
  },

  async searchUsers(params?: { search?: string }): Promise<User[]> {
    const { data } = await apiClient.get<User[]>('/users', { params });
    return data;
  },
};
