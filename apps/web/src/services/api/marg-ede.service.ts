import { apiClient } from './client';

export type MargSyncFrequency = 'HOURLY' | 'DAILY' | 'WEEKLY';
export type MargSyncStatus = 'IDLE' | 'RUNNING' | 'COMPLETED' | 'FAILED';

export interface MargSyncLog {
  id: string;
  tenantId: string;
  configId: string;
  status: MargSyncStatus;
  startedAt: string;
  completedAt?: string | null;
  productsSynced: number;
  partiesSynced: number;
  transactionsSynced: number;
  stockSynced: number;
  branchesSynced: number;
  errors: unknown;
  syncIndex?: number | null;
  syncDatetime?: string | null;
  createdAt: string;
}

export interface MargSyncConfig {
  id: string;
  tenantId: string;
  companyCode: string;
  apiBaseUrl: string;
  companyId: number;
  isActive: boolean;
  syncFrequency: MargSyncFrequency;
  lastSyncAt?: string | null;
  lastSyncStatus: MargSyncStatus;
  lastSyncIndex: number;
  lastSyncDatetime?: string | null;
  createdAt: string;
  updatedAt: string;
  margKeyMasked: string;
  decryptionKeyMasked: string;
  syncLogs?: MargSyncLog[];
}

export interface CreateMargConfigDto {
  companyCode: string;
  margKey: string;
  decryptionKey: string;
  apiBaseUrl?: string;
  companyId?: number;
  syncFrequency?: MargSyncFrequency;
}

export interface UpdateMargConfigDto {
  companyCode?: string;
  margKey?: string;
  decryptionKey?: string;
  apiBaseUrl?: string;
  companyId?: number;
  syncFrequency?: MargSyncFrequency;
  isActive?: boolean;
}

export interface MargSyncOverviewConfig {
  id: string;
  companyCode: string;
  isActive: boolean;
  lastSyncAt?: string | null;
  lastSyncStatus: MargSyncStatus;
  syncFrequency: MargSyncFrequency;
}

export interface MargSyncOverview {
  configs: MargSyncOverviewConfig[];
  stagedData: {
    branches: number;
    products: number;
    parties: number;
    transactions: number;
    stock: number;
  };
}

export interface PaginatedResponse<T> {
  items: T[];
  total: number;
  page: number;
  pageSize: number;
}

export interface MargStagedBranch {
  id: string;
  companyId: number;
  name: string;
  storeId?: string | null;
  licence?: string | null;
  branch?: string | null;
  locationId?: string | null;
  updatedAt: string;
  [key: string]: unknown;
}

export interface MargStagedProduct {
  id: string;
  companyId: number;
  pid: string;
  code: string;
  name: string;
  unit?: string | null;
  gst?: number | null;
  updatedAt: string;
  [key: string]: unknown;
}

export interface MargStagedParty {
  id: string;
  companyId: number;
  cid: string;
  parName: string;
  gstnNo?: string | null;
  phone1?: string | null;
  area?: string | null;
  updatedAt: string;
  [key: string]: unknown;
}

export interface MargStagedTransaction {
  id: string;
  companyId: number;
  voucher: string;
  type: string;
  date: string;
  cid?: string | null;
  pid?: string | null;
  qty?: number | null;
  amount?: number | null;
  updatedAt: string;
  [key: string]: unknown;
}

export interface MargStagedStock {
  id: string;
  companyId: number;
  pid: string;
  batch: string;
  stock?: number | null;
  mrp?: number | null;
  expiry?: string | null;
  updatedAt: string;
  [key: string]: unknown;
}

export interface TriggerSyncResponse {
  jobId: string | number;
  status: 'queued' | string;
  message: string;
}

export interface TestConnectionResponse {
  success: boolean;
  message: string;
  branches: unknown[];
}

const BASE_PATH = '/marg-ede';

export const margEdeService = {
  async getConfigs(): Promise<MargSyncConfig[]> {
    const { data } = await apiClient.get<MargSyncConfig[]>(`${BASE_PATH}/configs`);
    return data;
  },

  async getConfig(configId: string): Promise<MargSyncConfig> {
    const { data } = await apiClient.get<MargSyncConfig>(`${BASE_PATH}/configs/${configId}`);
    return data;
  },

  async createConfig(dto: CreateMargConfigDto): Promise<MargSyncConfig> {
    const { data } = await apiClient.post<MargSyncConfig>(`${BASE_PATH}/configs`, dto);
    return data;
  },

  async updateConfig(configId: string, dto: UpdateMargConfigDto): Promise<MargSyncConfig> {
    const { data } = await apiClient.patch<MargSyncConfig>(`${BASE_PATH}/configs/${configId}`, dto);
    return data;
  },

  async deleteConfig(configId: string): Promise<void> {
    await apiClient.delete(`${BASE_PATH}/configs/${configId}`);
  },

  async testConnection(configId: string): Promise<TestConnectionResponse> {
    const { data } = await apiClient.post<TestConnectionResponse>(`${BASE_PATH}/configs/${configId}/test`);
    return data;
  },

  async triggerSync(configId: string): Promise<TriggerSyncResponse> {
    const { data } = await apiClient.post<TriggerSyncResponse>(`${BASE_PATH}/configs/${configId}/sync`);
    return data;
  },

  async getSyncLogs(configId: string): Promise<MargSyncLog[]> {
    const { data } = await apiClient.get<MargSyncLog[]>(`${BASE_PATH}/configs/${configId}/logs`);
    return data;
  },

  async getOverview(): Promise<MargSyncOverview> {
    const { data } = await apiClient.get<MargSyncOverview>(`${BASE_PATH}/overview`);
    return data;
  },

  async getStagedBranches(params?: { page?: number; pageSize?: number }): Promise<PaginatedResponse<MargStagedBranch>> {
    const { data } = await apiClient.get<PaginatedResponse<MargStagedBranch>>(`${BASE_PATH}/staged/branches`, { params });
    return data;
  },

  async getStagedProducts(params?: { page?: number; pageSize?: number }): Promise<PaginatedResponse<MargStagedProduct>> {
    const { data } = await apiClient.get<PaginatedResponse<MargStagedProduct>>(`${BASE_PATH}/staged/products`, { params });
    return data;
  },

  async getStagedParties(params?: { page?: number; pageSize?: number }): Promise<PaginatedResponse<MargStagedParty>> {
    const { data } = await apiClient.get<PaginatedResponse<MargStagedParty>>(`${BASE_PATH}/staged/parties`, { params });
    return data;
  },

  async getStagedTransactions(params?: { page?: number; pageSize?: number }): Promise<PaginatedResponse<MargStagedTransaction>> {
    const { data } = await apiClient.get<PaginatedResponse<MargStagedTransaction>>(`${BASE_PATH}/staged/transactions`, { params });
    return data;
  },

  async getStagedStock(params?: { page?: number; pageSize?: number }): Promise<PaginatedResponse<MargStagedStock>> {
    const { data } = await apiClient.get<PaginatedResponse<MargStagedStock>>(`${BASE_PATH}/staged/stock`, { params });
    return data;
  },
};

export default margEdeService;
