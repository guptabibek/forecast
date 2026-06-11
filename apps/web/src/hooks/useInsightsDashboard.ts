import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import {
  insightsDashboardService,
  type LayoutItem,
  type PinReportRequest,
  type WidgetSize,
} from '../services/api/insights-dashboard.service';

export const insightsDashboardKeys = {
  all: ['insights-dashboard'] as const,
  dashboards: () => [...insightsDashboardKeys.all, 'dashboards'] as const,
  widgets: (dashboardId: string) => [...insightsDashboardKeys.all, 'widgets', dashboardId] as const,
  widgetData: (widgetId: string) => [...insightsDashboardKeys.all, 'widget-data', widgetId] as const,
  insights: (filters: Record<string, unknown>) => [...insightsDashboardKeys.all, 'insights', filters] as const,
  insightSummary: () => [...insightsDashboardKeys.all, 'insight-summary'] as const,
  providers: () => [...insightsDashboardKeys.all, 'providers'] as const,
};

export function useDashboards(enabled = true) {
  return useQuery({
    queryKey: insightsDashboardKeys.dashboards(),
    queryFn: () => insightsDashboardService.listDashboards(),
    enabled,
    staleTime: 60_000,
    retry: false,
  });
}

export function useDashboardWidgets(dashboardId: string | null) {
  return useQuery({
    queryKey: insightsDashboardKeys.widgets(dashboardId ?? 'none'),
    queryFn: () => insightsDashboardService.getWidgets(dashboardId!),
    enabled: Boolean(dashboardId),
    staleTime: 30_000,
    retry: false,
  });
}

export function useWidgetData(widgetId: string, refreshIntervalSec: number | null) {
  return useQuery({
    queryKey: insightsDashboardKeys.widgetData(widgetId),
    queryFn: () => insightsDashboardService.executeWidget(widgetId),
    staleTime: (refreshIntervalSec ?? 300) * 1000,
    refetchInterval: refreshIntervalSec ? refreshIntervalSec * 1000 : false,
    retry: false,
  });
}

export function useInsights(
  filters: { status?: string[]; severity?: string[]; category?: string; page?: number; pageSize?: number },
  enabled = true,
) {
  return useQuery({
    queryKey: insightsDashboardKeys.insights(filters),
    queryFn: () => insightsDashboardService.listInsights(filters),
    enabled,
    staleTime: 60_000,
    refetchInterval: 120_000,
    retry: false,
  });
}

export function useInsightSummary(enabled = true) {
  return useQuery({
    queryKey: insightsDashboardKeys.insightSummary(),
    queryFn: () => insightsDashboardService.insightSummary(),
    enabled,
    staleTime: 60_000,
    refetchInterval: 120_000,
    retry: false,
  });
}

export function useInsightProviders(enabled = true) {
  return useQuery({
    queryKey: insightsDashboardKeys.providers(),
    queryFn: () => insightsDashboardService.listProviders(),
    enabled,
    retry: false,
  });
}

function useInvalidate() {
  const queryClient = useQueryClient();
  return {
    dashboards: () => queryClient.invalidateQueries({ queryKey: insightsDashboardKeys.dashboards() }),
    widgets: (dashboardId?: string) =>
      queryClient.invalidateQueries({
        queryKey: dashboardId ? insightsDashboardKeys.widgets(dashboardId) : [...insightsDashboardKeys.all, 'widgets'],
      }),
    insights: () => {
      void queryClient.invalidateQueries({ queryKey: [...insightsDashboardKeys.all, 'insights'] });
      void queryClient.invalidateQueries({ queryKey: insightsDashboardKeys.insightSummary() });
    },
  };
}

export function useCreateDashboard() {
  const invalidate = useInvalidate();
  return useMutation({
    mutationFn: (input: { name: string; description?: string }) => insightsDashboardService.createDashboard(input),
    onSettled: () => void invalidate.dashboards(),
  });
}

export function useUpdateDashboard() {
  const invalidate = useInvalidate();
  return useMutation({
    mutationFn: ({ dashboardId, ...input }: { dashboardId: string; name?: string; isDefault?: boolean }) =>
      insightsDashboardService.updateDashboard(dashboardId, input),
    onSettled: () => void invalidate.dashboards(),
  });
}

export function useDeleteDashboard() {
  const invalidate = useInvalidate();
  return useMutation({
    mutationFn: (dashboardId: string) => insightsDashboardService.deleteDashboard(dashboardId),
    onSettled: () => void invalidate.dashboards(),
  });
}

export function useCloneDashboard() {
  const invalidate = useInvalidate();
  return useMutation({
    mutationFn: ({ dashboardId, name }: { dashboardId: string; name?: string }) =>
      insightsDashboardService.cloneDashboard(dashboardId, name),
    onSettled: () => void invalidate.dashboards(),
  });
}

export function usePinReport() {
  const invalidate = useInvalidate();
  return useMutation({
    mutationFn: (input: PinReportRequest) => insightsDashboardService.pinReport(input),
    onSettled: (widget) => {
      void invalidate.dashboards();
      void invalidate.widgets(widget?.dashboardId);
    },
  });
}

export function useUpdateWidget() {
  const invalidate = useInvalidate();
  return useMutation({
    mutationFn: ({
      widgetId,
      ...input
    }: {
      widgetId: string;
      title?: string;
      size?: WidgetSize;
      vizType?: string | null;
      refreshIntervalSec?: number | null;
    }) => insightsDashboardService.updateWidget(widgetId, input),
    onSettled: (widget) => void invalidate.widgets(widget?.dashboardId),
  });
}

export function useDuplicateWidget() {
  const invalidate = useInvalidate();
  return useMutation({
    mutationFn: (widgetId: string) => insightsDashboardService.duplicateWidget(widgetId),
    onSettled: (widget) => {
      void invalidate.dashboards();
      void invalidate.widgets(widget?.dashboardId);
    },
  });
}

export function useUnpinWidget() {
  const invalidate = useInvalidate();
  return useMutation({
    mutationFn: (widgetId: string) => insightsDashboardService.unpinWidget(widgetId),
    onSettled: () => {
      void invalidate.dashboards();
      void invalidate.widgets();
    },
  });
}

export function useUpdateLayout() {
  const invalidate = useInvalidate();
  return useMutation({
    mutationFn: ({ dashboardId, items }: { dashboardId: string; items: LayoutItem[] }) =>
      insightsDashboardService.updateLayout(dashboardId, items),
    onSettled: (_data, _error, variables) => void invalidate.widgets(variables.dashboardId),
  });
}

export function useRefreshWidget() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (widgetId: string) => insightsDashboardService.executeWidget(widgetId, true),
    onSuccess: (data, widgetId) => {
      queryClient.setQueryData(insightsDashboardKeys.widgetData(widgetId), data);
    },
  });
}

export function useInsightAction(action: 'acknowledge' | 'resolve' | 'archive' | 'reopen') {
  const invalidate = useInvalidate();
  const fn = {
    acknowledge: insightsDashboardService.acknowledgeInsight,
    resolve: insightsDashboardService.resolveInsight,
    archive: insightsDashboardService.archiveInsight,
    reopen: insightsDashboardService.reopenInsight,
  }[action];
  return useMutation({
    mutationFn: ({ insightId, note }: { insightId: string; note?: string }) => fn(insightId, note),
    onSettled: () => invalidate.insights(),
  });
}

export function useGenerateInsights() {
  const invalidate = useInvalidate();
  return useMutation({
    mutationFn: () => insightsDashboardService.generateInsights(),
    onSettled: () => invalidate.insights(),
  });
}

export function useUpdateInsightProvider() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: ({ providerId, enabled }: { providerId: string; enabled: boolean }) =>
      insightsDashboardService.updateProvider(providerId, enabled),
    onSuccess: (data) => queryClient.setQueryData(insightsDashboardKeys.providers(), data),
  });
}
