import type { AuthTokens, LoginRequest, User } from '@/types';
import { api } from './client';

interface AuthResponse extends AuthTokens {
  user: User;
}

interface RefreshResponse extends AuthTokens {
  user: User;
}

interface SessionInfo {
  id: string;
  createdAt: string;
  expiresAt: string;
  userAgent?: string;
  ipAddress?: string;
  isCurrent: boolean;
}

export const authService = {
  login: (data: LoginRequest): Promise<AuthResponse> =>
    api.post<AuthResponse>('/auth/login', data),

  logout: (): Promise<void> =>
    api.post('/auth/logout'),

  refreshToken: (): Promise<RefreshResponse> =>
    api.post<RefreshResponse>('/auth/refresh'),

  getCurrentUser: (): Promise<User> => api.get<User>('/auth/me'),

  changePassword: (data: {
    currentPassword: string;
    newPassword: string;
  }): Promise<void> => api.post('/auth/change-password', data),

  forgotPassword: (email: string): Promise<void> =>
    api.post('/auth/forgot-password', { email }),

  resetPassword: (data: { email: string; otp: string; password: string }): Promise<void> =>
    api.post('/auth/reset-password', data),

  forceResetPassword: (newPassword: string): Promise<void> =>
    api.post('/auth/force-reset-password', { newPassword }),

  revokeSession: (sessionId: string): Promise<void> =>
    api.delete(`/auth/sessions/${sessionId}`),

  revokeAllSessions: (): Promise<void> =>
    api.post('/auth/sessions/revoke-all'),

  getSessions: (): Promise<SessionInfo[]> =>
    api.get<SessionInfo[]>('/auth/sessions'),
};
