import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { settingsService } from '../services/api';
import type { UpdateSettingsDto, CreateApiKeyDto } from '../services/api/settings.service';

export const settingsKeys = {
  all: ['settings'] as const,
  tenant: () => [...settingsKeys.all, 'tenant'] as const,
  apiKeys: () => [...settingsKeys.all, 'apiKeys'] as const,
  auditLogs: () => [...settingsKeys.all, 'auditLogs'] as const,
  auditLogsList: (filters: Record<string, unknown>) => [...settingsKeys.auditLogs(), filters] as const,
  integrations: () => [...settingsKeys.all, 'integrations'] as const,
};

export function useSettings() {
  return useQuery({
    queryKey: settingsKeys.tenant(),
    queryFn: () => settingsService.getSettings(),
  });
}

export function useUpdateSettings() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: (dto: UpdateSettingsDto) => settingsService.updateSettings(dto),
    onSuccess: (data) => {
      queryClient.setQueryData(settingsKeys.tenant(), data);
    },
  });
}

export function useApiKeys() {
  return useQuery({
    queryKey: settingsKeys.apiKeys(),
    queryFn: () => settingsService.getApiKeys(),
  });
}

export function useCreateApiKey() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: (dto: CreateApiKeyDto) => settingsService.createApiKey(dto),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: settingsKeys.apiKeys() });
    },
  });
}

export function useRevokeApiKey() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: (id: string) => settingsService.revokeApiKey(id),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: settingsKeys.apiKeys() });
    },
  });
}

export function useAuditLogs(params?: {
  page?: number;
  limit?: number;
  userId?: string;
  action?: string;
  resource?: string;
  startDate?: string;
  endDate?: string;
}) {
  return useQuery({
    queryKey: settingsKeys.auditLogsList(params || {}),
    queryFn: () => settingsService.getAuditLogs(params),
  });
}

export function useExportAuditLogs() {
  return useMutation({
    mutationFn: (params: { startDate: string; endDate: string; format: 'csv' | 'json' }) =>
      settingsService.exportAuditLogs(params),
    onSuccess: (blob, { format }) => {
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = `audit_logs.${format}`;
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);
      URL.revokeObjectURL(url);
    },
  });
}

export function useIntegrations() {
  return useQuery({
    queryKey: settingsKeys.integrations(),
    queryFn: () => settingsService.getIntegrations(),
  });
}

export function useUpdateIntegration() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: ({ id, dto }: { id: string; dto: { isEnabled?: boolean; config?: Record<string, unknown> } }) =>
      settingsService.updateIntegration(id, dto),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: settingsKeys.integrations() });
    },
  });
}

export function useTestIntegration() {
  return useMutation({
    mutationFn: (id: string) => settingsService.testIntegration(id),
  });
}
