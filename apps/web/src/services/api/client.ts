import { reportApiError } from '@services/error-reporting';
import { useApiLoadingStore } from '@stores/api-loading.store';
import { useAuthStore } from '@stores/auth.store';
import axios, { AxiosError, AxiosInstance, InternalAxiosRequestConfig } from 'axios';

const MUTATION_METHODS = new Set(['post', 'put', 'patch', 'delete']);

function isMutation(config?: InternalAxiosRequestConfig): boolean {
  return MUTATION_METHODS.has((config?.method ?? '').toLowerCase());
}

const API_BASE_URL = import.meta.env.VITE_API_URL || '/api';

// Create axios instance
const apiClient: AxiosInstance = axios.create({
  baseURL: API_BASE_URL,
  withCredentials: true,
  headers: {
    'Content-Type': 'application/json',
  },
  timeout: 30000,
});

const AUTH_PATHS = [
  '/auth/login',
  '/auth/refresh',
  '/auth/logout',
  '/auth/forgot-password',
  '/auth/reset-password',
];

function shouldSkipRefresh(path?: string): boolean {
  if (!path) return false;
  return AUTH_PATHS.some((authPath) => path.includes(authPath));
}

// Decode JWT exp without a library — returns epoch seconds or null
function getTokenExp(token: string): number | null {
  try {
    const payload = token.split('.')[1];
    if (!payload) return null;
    const decoded = JSON.parse(atob(payload.replace(/-/g, '+').replace(/_/g, '/')));
    return typeof decoded.exp === 'number' ? decoded.exp : null;
  } catch {
    return null;
  }
}

function isIpv4Host(hostname: string): boolean {
  return /^\d{1,3}(?:\.\d{1,3}){3}$/.test(hostname);
}

function isReservedWorkspaceLabel(label: string): boolean {
  return ['localhost', 'www', 'api', 'app'].includes(label);
}

function resolveTenantHeader(userTenantId?: string): string | undefined {
  if (userTenantId) {
    return userTenantId;
  }

  if (typeof window === 'undefined') {
    return undefined;
  }

  const persistedTenantId = window.localStorage.getItem('fh:last-tenant-id')?.trim();
  if (persistedTenantId) {
    return persistedTenantId;
  }

  const hostname = window.location.hostname.trim().toLowerCase();
  if (!hostname || hostname === 'localhost' || isIpv4Host(hostname)) {
    return undefined;
  }

  if (hostname.endsWith('.localhost')) {
    const localSubdomain = hostname.replace(/\.localhost$/, '');
    return localSubdomain && !isReservedWorkspaceLabel(localSubdomain)
      ? localSubdomain
      : undefined;
  }

  const parts = hostname.split('.').filter(Boolean);
  if (parts.length >= 3) {
    const candidate = parts[0];
    return !isReservedWorkspaceLabel(candidate) ? candidate : undefined;
  }

  return undefined;
}

// Request interceptor - add auth token + track mutations
apiClient.interceptors.request.use(
  async (config: InternalAxiosRequestConfig) => {
    const { tokens, user } = useAuthStore.getState();

    // Proactive token refresh — if the token expires within 60 seconds,
    // refresh it BEFORE the request to avoid a 401 round-trip.
    if (tokens?.accessToken && !shouldSkipRefresh(config.url)) {
      const exp = getTokenExp(tokens.accessToken);
      if (exp && exp - Date.now() / 1000 < 60) {
        try {
          await useAuthStore.getState().refreshToken();
        } catch {
          // Refresh failed — let the request proceed with the old token;
          // the response interceptor will handle the resulting 401.
        }
      }
    }

    // Re-read tokens after potential refresh
    const currentTokens = useAuthStore.getState().tokens;
    if (currentTokens?.accessToken) {
      config.headers.Authorization = `Bearer ${currentTokens.accessToken}`;
    }

    const tenantHeader = resolveTenantHeader(user?.tenantId);
    if (tenantHeader) {
      config.headers['X-Tenant-ID'] = tenantHeader;
    }

    if (isMutation(config)) {
      useApiLoadingStore.getState()._increment();
    }

    return config;
  },
  (error) => {
    return Promise.reject(error);
  },
);

// Response interceptor - handle errors and token refresh
let isRefreshing = false;
let failedQueue: Array<{
  resolve: (value?: unknown) => void;
  reject: (reason?: unknown) => void;
}> = [];

const processQueue = (error: AxiosError | null) => {
  failedQueue.forEach((promise) => {
    if (error) {
      promise.reject(error);
    } else {
      promise.resolve();
    }
  });
  failedQueue = [];
};

apiClient.interceptors.response.use(
  (response) => {
    if (isMutation(response.config)) {
      useApiLoadingStore.getState()._decrement();
    }
    return response;
  },
  async (error: AxiosError) => {
    reportApiError(error);

    const originalRequest = error.config as InternalAxiosRequestConfig & {
      _retry?: boolean;
    };
    const requestPath = originalRequest?.url;
    const responseData = error.response?.data as { message?: string | string[] } | undefined;
    const responseMessage = Array.isArray(responseData?.message)
      ? responseData?.message.join(' ')
      : responseData?.message;
    const isTenantContext403 =
      error.response?.status === 403 &&
      typeof responseMessage === 'string' &&
      responseMessage.includes('Tenant context could not be resolved');

    // Handle 401 and tenant-context 403 errors with refresh flow
    if (
      (error.response?.status === 401 || isTenantContext403) &&
      !originalRequest?._retry &&
      !shouldSkipRefresh(requestPath)
    ) {
      if (isRefreshing) {
        // Queue requests while refreshing
        return new Promise((resolve, reject) => {
          failedQueue.push({ resolve, reject });
        })
          .then(() => apiClient(originalRequest))
          .catch((err) => Promise.reject(err));
      }

      originalRequest._retry = true;
      isRefreshing = true;

      try {
        await useAuthStore.getState().refreshToken();
        processQueue(null);
        return apiClient(originalRequest);
      } catch (refreshError) {
        processQueue(refreshError as AxiosError);
        const currentPath = window.location.pathname;
        useAuthStore.getState().logout();
        // Do not redirect away from public auth pages – those pages are
        // intentionally accessible without a session (forgot-password,
        // reset-password). Only redirect to /login when the user is on a
        // protected route.
        const publicAuthPaths = ['/login', '/forgot-password', '/reset-password'];
        const isPublicPath = publicAuthPaths.some((p) => currentPath.startsWith(p));
        if (!isPublicPath) {
          window.location.href = '/login';
        }
        return Promise.reject(refreshError);
      } finally {
        isRefreshing = false;
      }
    }

    // Error handling — provide user-friendly messages for common errors
    const status = error.response?.status;
    const data = error.response?.data as Record<string, unknown> | undefined;

    if (status === 409) {
      // Optimistic lock conflict or duplicate — prompt user to retry
      const msg =
        (data?.message as string) ||
        'This record was modified by another user. Please refresh and try again.';
      console.warn('[API] 409 Conflict:', msg);
      // Attach a typed flag so callers can detect conflicts programmatically
      (error as AxiosError & { isConflict: boolean }).isConflict = true;
    }

    if (status === 403) {
      console.warn('[API] 403 Forbidden — insufficient role/permissions');
    }

    if (status === 429) {
      console.warn('[API] 429 Too Many Requests — rate limited');
    }

    if (isMutation(error.config)) {
      useApiLoadingStore.getState()._decrement();
    }

    return Promise.reject(error);
  },
);

// Named export for services that import { apiClient }
export { apiClient };

// Default export
export default apiClient;

// Helper methods
export const api = {
  get: <T>(url: string, params?: Record<string, unknown>) =>
    apiClient.get<T>(url, { params }).then((res) => res.data),

  post: <T>(url: string, data?: unknown) =>
    apiClient.post<T>(url, data).then((res) => res.data),

  put: <T>(url: string, data?: unknown) =>
    apiClient.put<T>(url, data).then((res) => res.data),

  patch: <T>(url: string, data?: unknown) =>
    apiClient.patch<T>(url, data).then((res) => res.data),

  delete: <T>(url: string) => apiClient.delete<T>(url).then((res) => res.data),

  upload: <T>(url: string, file: File, onProgress?: (progress: number) => void) => {
    const formData = new FormData();
    formData.append('file', file);

    return apiClient
      .post<T>(url, formData, {
        headers: {
          'Content-Type': 'multipart/form-data',
        },
        onUploadProgress: (progressEvent) => {
          if (onProgress && progressEvent.total) {
            const progress = Math.round(
              (progressEvent.loaded * 100) / progressEvent.total,
            );
            onProgress(progress);
          }
        },
      })
      .then((res) => res.data);
  },
};
