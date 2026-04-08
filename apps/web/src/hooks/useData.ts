import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { dataService } from '../services/api';
import type { Dimension, DimensionType, ImportType } from '../types';

export const dataKeys = {
  all: ['data'] as const,
  actuals: () => [...dataKeys.all, 'actuals'] as const,
  actualsList: (filters: Record<string, unknown>) => [...dataKeys.actuals(), filters] as const,
  imports: () => [...dataKeys.all, 'imports'] as const,
  importsList: (filters: Record<string, unknown>) => [...dataKeys.imports(), filters] as const,
  import: (id: string) => [...dataKeys.imports(), id] as const,
  dimensions: () => [...dataKeys.all, 'dimensions'] as const,
  dimensionsByType: (type: DimensionType) => [...dataKeys.dimensions(), type] as const,
  dimension: (id: string) => [...dataKeys.dimensions(), 'detail', id] as const,
  dimensionHierarchy: (type: DimensionType) => [...dataKeys.dimensions(), 'hierarchy', type] as const,
};

export function useActuals(params?: {
  dimensionType?: DimensionType;
  dimensionId?: string;
  startDate?: string;
  endDate?: string;
  page?: number;
  limit?: number;
}) {
  return useQuery({
    queryKey: dataKeys.actualsList(params || {}),
    queryFn: () => dataService.getActuals(params as Record<string, unknown>),
  });
}

export function useImports(params?: { page?: number; limit?: number; status?: string }) {
  return useQuery({
    queryKey: dataKeys.importsList(params || {}),
    queryFn: () => dataService.getImports(params as Record<string, unknown>),
  });
}

export function useImport(id: string) {
  const query = useQuery({
    queryKey: dataKeys.import(id),
    queryFn: () => dataService.getImportById(id),
    enabled: !!id,
  });

  // Manual refetch interval based on status
  const shouldRefetch = query.data && 
    (query.data.status === 'PROCESSING' || query.data.status === 'PENDING');

  return {
    ...query,
    shouldRefetch,
  };
}

export function useDimensions(type: DimensionType) {
  return useQuery({
    queryKey: dataKeys.dimensionsByType(type),
    queryFn: () => dataService.getDimensions(type),
  });
}

export function useDimensionHierarchy(type: DimensionType) {
  return useQuery({
    queryKey: dataKeys.dimensionHierarchy(type),
    queryFn: () => dataService.getDimensionHierarchy(type),
  });
}

export function useUploadData() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: ({ file, type }: { file: File; type: ImportType }) =>
      dataService.uploadFile(type, file),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: dataKeys.imports() });
      queryClient.invalidateQueries({ queryKey: dataKeys.actuals() });
    },
  });
}

export function useCreateDimension() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: ({ type, data }: { type: DimensionType; data: Partial<Dimension> }) =>
      dataService.createDimension(type, data),
    onSuccess: (_, { type }) => {
      queryClient.invalidateQueries({ queryKey: dataKeys.dimensionsByType(type) });
    },
  });
}

export function useUpdateDimension() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: ({ type, id, data }: { type: DimensionType; id: string; data: Partial<Dimension> }) =>
      dataService.updateDimension(type, id, data),
    onSuccess: (_, { type }) => {
      queryClient.invalidateQueries({ queryKey: dataKeys.dimensionsByType(type) });
      queryClient.invalidateQueries({ queryKey: dataKeys.dimensions() });
    },
  });
}

export function useDeleteDimension() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: ({ type, id }: { type: DimensionType; id: string }) =>
      dataService.deleteDimension(type, id),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: dataKeys.dimensions() });
    },
  });
}

export function useDownloadTemplate() {
  return useMutation({
    mutationFn: (type: ImportType) => dataService.downloadTemplate(type),
    onSuccess: (blob, type) => {
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = `${type.toLowerCase()}_template.csv`;
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);
      URL.revokeObjectURL(url);
    },
  });
}
