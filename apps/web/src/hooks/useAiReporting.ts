import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { aiReportingService, type AiProviderSettingsUpdate, type AiReportRequest } from '../services/api/ai-reporting.service';

export const aiReportingKeys = {
  all: ['ai-reporting'] as const,
  catalog: () => [...aiReportingKeys.all, 'catalog'] as const,
  history: () => [...aiReportingKeys.all, 'history'] as const,
  settings: () => [...aiReportingKeys.all, 'settings'] as const,
  usage: () => [...aiReportingKeys.all, 'usage'] as const,
};

export function useAiReportingCatalog(enabled = true) {
  return useQuery({
    queryKey: aiReportingKeys.catalog(),
    queryFn: () => aiReportingService.catalog(),
    enabled,
    staleTime: 10 * 60 * 1000,
    retry: false,
  });
}

export function useAiReportingHistory(limit = 25, enabled = true) {
  return useQuery({
    queryKey: [...aiReportingKeys.history(), limit],
    queryFn: () => aiReportingService.history(limit),
    enabled,
    retry: false,
  });
}

export function useAiReportQuery() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (request: AiReportRequest) => aiReportingService.query(request),
    onSettled: () => {
      void queryClient.invalidateQueries({ queryKey: aiReportingKeys.history() });
    },
  });
}

export function useAiDashboardQuery() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (request: AiReportRequest) => aiReportingService.dashboard(request),
    onSettled: () => {
      void queryClient.invalidateQueries({ queryKey: aiReportingKeys.history() });
    },
  });
}

export function useAiProviderSettings(enabled = true) {
  return useQuery({
    queryKey: aiReportingKeys.settings(),
    queryFn: () => aiReportingService.settings(),
    enabled,
    retry: false,
  });
}

export function useUpdateAiProviderSettings() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (request: AiProviderSettingsUpdate) => aiReportingService.updateSettings(request),
    onSuccess: (data) => {
      queryClient.setQueryData(aiReportingKeys.settings(), data);
    },
  });
}

export function useTestAiProviderSettings() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: () => aiReportingService.testSettings(),
    onSettled: () => {
      void queryClient.invalidateQueries({ queryKey: aiReportingKeys.settings() });
      void queryClient.invalidateQueries({ queryKey: aiReportingKeys.usage() });
    },
  });
}

export function useAiProviderUsage(enabled = true) {
  return useQuery({
    queryKey: aiReportingKeys.usage(),
    queryFn: () => aiReportingService.usage(),
    enabled,
    retry: false,
  });
}
