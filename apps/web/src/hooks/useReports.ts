import { useQuery, useMutation } from '@tanstack/react-query';
import { reportService } from '../services/api';
import type { ReportConfig } from '../services/api/report.service';

export const reportKeys = {
  all: ['reports'] as const,
  variance: (config: ReportConfig) => [...reportKeys.all, 'variance', config] as const,
  trend: (config: ReportConfig) => [...reportKeys.all, 'trend', config] as const,
  comparison: (config: ReportConfig) => [...reportKeys.all, 'comparison', config] as const,
  summary: () => [...reportKeys.all, 'summary'] as const,
  accuracy: (config: ReportConfig) => [...reportKeys.all, 'accuracy', config] as const,
  saved: () => [...reportKeys.all, 'saved'] as const,
};

export function useVarianceReport(config: ReportConfig, enabled = true) {
  return useQuery({
    queryKey: reportKeys.variance(config),
    queryFn: () => reportService.generateVarianceReport(config),
    enabled: enabled && !!config.planId,
  });
}

export function useTrendReport(config: ReportConfig, enabled = true) {
  return useQuery({
    queryKey: reportKeys.trend(config),
    queryFn: () => reportService.generateTrendReport(config),
    enabled,
  });
}

export function useComparisonReport(config: ReportConfig, enabled = true) {
  return useQuery({
    queryKey: reportKeys.comparison(config),
    queryFn: () => reportService.generateComparisonReport(config),
    enabled: enabled && (config.forecastIds?.length ?? 0) >= 2,
  });
}

export function useSummaryReport() {
  return useQuery({
    queryKey: reportKeys.summary(),
    queryFn: () => reportService.generateSummaryReport(),
  });
}

export function useAccuracyReport(config: ReportConfig, enabled = true) {
  return useQuery({
    queryKey: reportKeys.accuracy(config),
    queryFn: () => reportService.generateAccuracyReport(config),
    enabled,
  });
}

export function useExportReport() {
  return useMutation({
    mutationFn: ({ config, format }: { config: ReportConfig; format: 'csv' | 'xlsx' | 'pdf' }) =>
      reportService.exportReport(config, format),
    onSuccess: (blob, { config, format }) => {
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = `report_${config.type}.${format}`;
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);
      URL.revokeObjectURL(url);
    },
  });
}

export function useSavedReports() {
  return useQuery({
    queryKey: reportKeys.saved(),
    queryFn: () => reportService.getSavedReports(),
  });
}

export function useSaveReport() {
  return useMutation({
    mutationFn: (report: { name: string; config: ReportConfig }) =>
      reportService.saveReport(report),
  });
}

export function useDeleteSavedReport() {
  return useMutation({
    mutationFn: (id: string) => reportService.deleteSavedReport(id),
  });
}

export function useScheduleReport() {
  return useMutation({
    mutationFn: (schedule: {
      reportId: string;
      frequency: 'daily' | 'weekly' | 'monthly';
      recipients: string[];
      format: 'csv' | 'xlsx' | 'pdf';
    }) => reportService.scheduleReport(schedule),
  });
}
