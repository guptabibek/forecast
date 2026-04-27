import type { AuthTokens, User } from '@/types';
import { authService } from '@services/api/auth.service';
import { create } from 'zustand';

let refreshInFlight: Promise<void> | null = null;

const LAST_TENANT_STORAGE_KEY = 'fh:last-tenant-id';

function persistLastTenantId(tenantId?: string | null) {
  if (typeof window === 'undefined') {
    return;
  }

  if (tenantId) {
    window.localStorage.setItem(LAST_TENANT_STORAGE_KEY, tenantId);
    return;
  }

  window.localStorage.removeItem(LAST_TENANT_STORAGE_KEY);
}

interface AuthState {
  user: User | null;
  tokens: AuthTokens | null;
  isAuthenticated: boolean;
  isLoading: boolean;
  error: string | null;

  // Actions
  login: (email: string, password: string) => Promise<void>;
  logout: () => Promise<void>;
  refreshToken: () => Promise<void>;
  updateUser: (user: Partial<User>) => void;
  setLoading: (loading: boolean) => void;
  clearError: () => void;
  checkAuth: () => Promise<void>;
}

const getApiErrorMessage = (error: unknown, fallback: string): string => {
  if (error && typeof error === 'object') {
    const maybeResponse = error as { response?: { data?: { message?: string } } };
    return maybeResponse.response?.data?.message || fallback;
  }
  return fallback;
};

export const useAuthStore = create<AuthState>()(
    (set, get) => ({
      user: null,
      tokens: null,
      isAuthenticated: false,
      isLoading: true,
      error: null,

      login: async (email: string, password: string) => {
        set({ isLoading: true, error: null });
        try {
          const response = await authService.login({ email, password });
          persistLastTenantId(response.user?.tenantId);
          set({
            user: response.user,
            tokens: {
              accessToken: response.accessToken,
              expiresIn: response.expiresIn,
            },
            isAuthenticated: true,
            isLoading: false,
          });
        } catch (error: unknown) {
          set({
            error: getApiErrorMessage(error, 'Login failed'),
            isLoading: false,
          });
          throw error;
        }
      },

      logout: async () => {
        try {
          await authService.logout();
        } catch {
          // Logout failed - clear local state anyway
        } finally {
          persistLastTenantId(null);
          set({
            user: null,
            tokens: null,
            isAuthenticated: false,
            error: null,
          });
        }
      },

      refreshToken: async () => {
        if (refreshInFlight) {
          return refreshInFlight;
        }

        refreshInFlight = (async () => {
          try {
            const response = await authService.refreshToken();
            persistLastTenantId(response.user?.tenantId ?? get().user?.tenantId);
            set((state) => ({
              user: response.user ?? state.user,
              tokens: {
                accessToken: response.accessToken,
                expiresIn: response.expiresIn,
              },
              isAuthenticated: true,
            }));
          } catch (error) {
            // Refresh failed, log out
            persistLastTenantId(null);
            set({
              user: null,
              tokens: null,
              isAuthenticated: false,
            });
            throw error;
          } finally {
            refreshInFlight = null;
          }
        })();

        return refreshInFlight;
      },

      updateUser: (userData) => {
        const { user } = get();
        if (user) {
          persistLastTenantId(userData.tenantId ?? user.tenantId);
          set({ user: { ...user, ...userData } });
        }
      },

      setLoading: (loading) => set({ isLoading: loading }),

      clearError: () => set({ error: null }),

      checkAuth: async () => {
        set({ isLoading: true });
        try {
          if (!get().tokens?.accessToken) {
            await get().refreshToken();
          }

          const user = await authService.getCurrentUser();
          persistLastTenantId(user.tenantId);
          set({ user, isAuthenticated: true, isLoading: false });
        } catch {
          persistLastTenantId(null);
          set({
            user: null,
            tokens: null,
            isAuthenticated: false,
            isLoading: false,
          });
        }
      },
    }),
);

// Initialize auth check on app load
if (typeof window !== 'undefined') {
  useAuthStore.getState().checkAuth();
}
