import type {
    Actual,
    ActualSummary,
    DataImport,
    Dimension,
    DimensionType,
    ImportTemplate,
    ImportType,
    PaginatedResponse,
} from '@/types';
import { api, apiClient } from './client';

// Helper to safely cast params
const toQueryParams = (params?: Record<string, unknown>): Record<string, unknown> | undefined => params;

export const dataService = {
  // Actuals
  getActuals: (params?: Record<string, unknown>): Promise<PaginatedResponse<Actual>> =>
    api.get<PaginatedResponse<Actual>>('/data/actuals', toQueryParams(params)),

  getActualsSummary: (): Promise<ActualSummary> =>
    api.get<ActualSummary>('/data/actuals/summary'),

  deleteActuals: (filters: {
    startDate?: string;
    endDate?: string;
    source?: string;
  }): Promise<{ deleted: number }> => {
    const params = new URLSearchParams();
    if (filters.startDate) params.append('startDate', filters.startDate);
    if (filters.endDate) params.append('endDate', filters.endDate);
    if (filters.source) params.append('source', filters.source);
    const queryString = params.toString();
    return api.delete(`/data/actuals${queryString ? `?${queryString}` : ''}`);
  },

  // Imports
  uploadFile: (
    type: ImportType,
    file: File,
    onProgress?: (progress: number) => void,
  ): Promise<{ id: string; status: string; message: string }> => {
    const formData = new FormData();
    const typeMap: Record<ImportType, string> = {
      ACTUALS: 'actuals',
      PRODUCTS: 'products',
      LOCATIONS: 'locations',
      CUSTOMERS: 'customers',
      ACCOUNTS: 'accounts',
    };

    formData.append('file', file);
    formData.append('type', typeMap[type]);

    return apiClient
      .post<{ id: string; status: string; message: string }>(
        '/data/import',
        formData,
        {
          headers: { 'Content-Type': 'multipart/form-data' },
          onUploadProgress: (progressEvent) => {
            if (onProgress && progressEvent.total) {
              const progress = Math.round(
                (progressEvent.loaded * 100) / progressEvent.total,
              );
              onProgress(progress);
            }
          },
        },
      )
      .then((res) => res.data);
  },

  getImports: (params?: Record<string, unknown>): Promise<DataImport[]> =>
    api.get<DataImport[]>('/data/imports', toQueryParams(params)),

  getImportById: (id: string): Promise<DataImport> =>
    api.get<DataImport>(`/data/imports/${id}`),

  cancelImport: (id: string): Promise<void> => api.delete(`/data/imports/${id}`),

  // Get structured template info for UI display
  getImportTemplate: (type: ImportType): Promise<ImportTemplate> =>
    api.get<ImportTemplate>(`/data/templates/${type.toLowerCase()}/info`),

  // Download CSV template file
  downloadTemplate: async (type: ImportType): Promise<Blob> => {
    const response = await apiClient.get(`/data/templates/${type.toLowerCase()}`, {
      responseType: 'blob',
    });
    return response.data;
  },

  // Dimensions - Generic
  getDimensions: (type: DimensionType, params?: Record<string, unknown>): Promise<Dimension[]> =>
    api.get<Dimension[]>(`/data/dimensions/${type}`, toQueryParams(params)),

  getDimensionHierarchy: (type: DimensionType): Promise<Dimension[]> =>
    api.get<Dimension[]>(`/data/dimensions/${type}/hierarchy`),

  createDimension: (type: DimensionType, data: Partial<Dimension>): Promise<Dimension> =>
    api.post<Dimension>(`/data/dimensions/${type}`, data),

  updateDimension: (type: DimensionType, id: string, data: Partial<Dimension>): Promise<Dimension> =>
    api.patch<Dimension>(`/data/dimensions/${type}/${id}`, data),

  deleteDimension: (type: DimensionType, id: string): Promise<void> =>
    api.delete(`/data/dimensions/${type}/${id}`),

  // Dimension shortcuts
  getProducts: (params?: Record<string, unknown>) =>
    api.get<Dimension[]>('/data/dimensions/product', toQueryParams(params)),

  getLocations: (params?: Record<string, unknown>) =>
    api.get<Dimension[]>('/data/dimensions/location', toQueryParams(params)),

  getCustomers: (params?: Record<string, unknown>) =>
    api.get<Dimension[]>('/data/dimensions/customer', toQueryParams(params)),

  getAccounts: (params?: Record<string, unknown>) =>
    api.get<Dimension[]>('/data/dimensions/account', toQueryParams(params)),

  // Sync status
  getSyncStatus: (): Promise<{
    lastSyncAt: string | null;
    status: 'idle' | 'syncing' | 'error';
    error?: string;
    pendingRecords: number;
  }> => api.get('/data/sync-status'),

  triggerSync: (): Promise<{ jobId: string }> => api.post('/data/sync'),
};
