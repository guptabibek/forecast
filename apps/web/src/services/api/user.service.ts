import type { User, UserRole } from '../../types';
import { apiClient } from './client';

type MaybeWrapped<T> = T | { data: T };

type UserListResponse =
  | User[]
  | {
      data?: User[];
      total?: number;
      meta?: {
        total?: number;
      };
    };

type UserActivityResponse =
  | {
      data?: UserActivity[];
      total?: number;
      meta?: {
        total?: number;
      };
    }
  | UserActivity[];

function unwrapData<T>(payload: MaybeWrapped<T>): T {
  if (
    payload &&
    typeof payload === 'object' &&
    !Array.isArray(payload) &&
    'data' in payload
  ) {
    return payload.data;
  }

  return payload as T;
}

function normalizeUserListResponse(payload: UserListResponse): { data: User[]; total: number } {
  if (Array.isArray(payload)) {
    return { data: payload, total: payload.length };
  }

  const data = Array.isArray(payload?.data) ? payload.data : [];
  const total = payload?.meta?.total ?? payload?.total ?? data.length;

  return { data, total };
}

function normalizeUserActivityResponse(payload: UserActivityResponse): { data: UserActivity[]; total: number } {
  if (Array.isArray(payload)) {
    return { data: payload, total: payload.length };
  }

  const data = Array.isArray(payload?.data) ? payload.data : [];
  const total = payload?.meta?.total ?? payload?.total ?? data.length;

  return { data, total };
}

export interface InviteUserDto {
  email: string;
  role: UserRole;
  firstName?: string;
  lastName?: string;
  customRoleId?: string | null;
}

export interface UpdateUserDto {
  firstName?: string;
  lastName?: string;
  role?: UserRole;
  customRoleId?: string | null;
  isActive?: boolean;
}

export interface UpdateProfileDto {
  firstName?: string;
  lastName?: string;
  avatarUrl?: string;
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
  async getAll(params?: { page?: number; limit?: number; search?: string; role?: string; status?: string }): Promise<{ data: User[]; total: number }> {
    const response = await apiClient.get<UserListResponse>('/users', { params });
    return normalizeUserListResponse(response.data);
  },

  async getById(id: string): Promise<User> {
    const response = await apiClient.get<MaybeWrapped<User>>(`/users/${id}`);
    return unwrapData(response.data);
  },

  async invite(dto: InviteUserDto): Promise<User> {
    const response = await apiClient.post<MaybeWrapped<User>>('/users/invite', dto);
    return unwrapData(response.data);
  },

  async update(id: string, dto: UpdateUserDto): Promise<User> {
    const response = await apiClient.patch<MaybeWrapped<User>>(`/users/${id}`, dto);
    return unwrapData(response.data);
  },

  async delete(id: string): Promise<void> {
    await apiClient.delete(`/users/${id}`);
  },

  async activate(id: string): Promise<User> {
    const response = await apiClient.post<MaybeWrapped<User>>(`/users/${id}/activate`);
    return unwrapData(response.data);
  },

  async deactivate(id: string): Promise<User> {
    const response = await apiClient.post<MaybeWrapped<User>>(`/users/${id}/deactivate`);
    return unwrapData(response.data);
  },

  async resendInvite(id: string): Promise<void> {
    await apiClient.post(`/users/${id}/resend-invite`);
  },

  async getProfile(): Promise<User> {
    const response = await apiClient.get<MaybeWrapped<User>>('/users/me');
    return unwrapData(response.data);
  },

  async updateProfile(dto: UpdateProfileDto): Promise<User> {
    const response = await apiClient.patch<MaybeWrapped<User>>('/users/me', dto);
    return unwrapData(response.data);
  },

  async changePassword(dto: ChangePasswordDto): Promise<void> {
    await apiClient.post('/users/profile/change-password', dto);
  },

  async getActivity(userId: string, params?: { page?: number; limit?: number }): Promise<{ data: UserActivity[]; total: number }> {
    const response = await apiClient.get<UserActivityResponse>(`/users/${userId}/activity`, { params });
    return normalizeUserActivityResponse(response.data);
  },

  async uploadAvatar(avatarUrl?: string): Promise<{ url: string }> {
    const { data } = await apiClient.post<{ data: { url: string } }>('/users/profile/avatar', {
      avatarUrl,
    });
    return data.data;
  },

  async searchUsers(params?: { search?: string }): Promise<User[]> {
    const response = await apiClient.get<UserListResponse>('/users', { params });
    return normalizeUserListResponse(response.data).data;
  },
};
