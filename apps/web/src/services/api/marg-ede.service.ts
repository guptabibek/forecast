import { apiClient } from './client';

export type MargSyncFrequency = 'HOURLY' | 'DAILY' | 'WEEKLY';
export type MargSyncStatus = 'IDLE' | 'RUNNING' | 'COMPLETED' | 'FAILED';
export type MargSyncScope = 'full' | 'accounting';
export type MargReconciliationType = 'STOCK' | 'AR_AGING' | 'ACCOUNTING_BALANCE';
export type MargReconciliationStatus = 'PASSED' | 'WARNING' | 'FAILED';

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
  vouchersSynced?: number;
  saleTypesSynced?: number;
  accountGroupsSynced?: number;
  accountPostingsSynced?: number;
  accountGroupBalancesSynced?: number;
  partyBalancesSynced?: number;
  outstandingsSynced?: number;
  journalEntriesSynced?: number;
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
  lastAccountingSyncAt?: string | null;
  lastAccountingSyncStatus: MargSyncStatus;
  lastAccountingSyncIndex?: number | null;
  lastAccountingSyncDatetime?: string | null;
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
  lastAccountingSyncAt?: string | null;
  lastAccountingSyncStatus: MargSyncStatus;
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
    deletedStock: number;
    accountGroups: number;
    accountPostings: number;
    accountGroupBalances: number;
    partyBalances: number;
    outstandings: number;
    glMappingRules: number;
    reconciliationResults: number;
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
  sourceDeleted?: boolean;
  updatedAt: string;
  [key: string]: unknown;
}

export interface MargStagedAccountPosting {
  id: string;
  tenantId: string;
  companyId: number;
  margId: string;
  date: string;
  book?: string | null;
  voucher?: string | null;
  gCode?: string | null;
  code?: string | null;
  code1?: string | null;
  amount?: number | null;
  remark?: string | null;
  createdAt?: string;
  updatedAt: string;
  [key: string]: unknown;
}

export interface MargStagedAccountGroup {
  id: string;
  tenantId: string;
  companyId: number;
  margId: string;
  aid: string;
  name?: string | null;
  parentCode?: string | null;
  updatedAt: string;
  [key: string]: unknown;
}

export interface MargStagedAccountGroupBalance {
  id: string;
  tenantId: string;
  companyId: number;
  margId: string;
  aid: string;
  opening?: number | null;
  balance?: number | null;
  updatedAt: string;
  [key: string]: unknown;
}

export interface MargStagedPartyBalance {
  id: string;
  tenantId: string;
  companyId: number;
  margId: string;
  cid: string;
  opening?: number | null;
  balance?: number | null;
  updatedAt: string;
  [key: string]: unknown;
}

export interface MargStagedOutstanding {
  id: string;
  tenantId: string;
  companyId: number;
  margId: string;
  ord: string;
  date: string;
  days: number;
  voucher?: string | null;
  sVoucher?: string | null;
  balance?: number | null;
  finalAmt?: number | null;
  groupCode?: string | null;
  updatedAt: string;
  [key: string]: unknown;
}

export interface MargGlAccount {
  id: string;
  accountNumber: string;
  name: string;
  accountType: string;
  normalBalance: string;
}

export interface MargGlMappingRule {
  id: string;
  tenantId: string;
  ruleName: string;
  companyId?: number | null;
  bookCode?: string | null;
  groupCode?: string | null;
  partyCode?: string | null;
  counterpartyCode?: string | null;
  remarkContains?: string | null;
  glAccountId: string;
  isReceivableControl: boolean;
  priority: number;
  description?: string | null;
  isActive: boolean;
  createdAt: string;
  updatedAt: string;
  glAccount?: {
    id: string;
    accountNumber: string;
    name: string;
    accountType: string;
  };
}

export interface CreateMargGlMappingRuleDto {
  ruleName: string;
  companyId?: number;
  bookCode?: string;
  groupCode?: string;
  partyCode?: string;
  counterpartyCode?: string;
  remarkContains?: string;
  glAccountId: string;
  isReceivableControl?: boolean;
  priority?: number;
  description?: string;
}

export interface UpdateMargGlMappingRuleDto extends Partial<CreateMargGlMappingRuleDto> {}

export interface MargReconciliationResult {
  id: string;
  tenantId: string;
  syncLogId: string;
  reconciliationType: MargReconciliationType;
  status: MargReconciliationStatus;
  issueCount: number;
  summary?: Record<string, unknown> | null;
  issues?: unknown;
  createdAt: string;
  updatedAt: string;
}

export interface TriggerSyncParams {
  fromDate?: string;
  endDate?: string;
}

export interface TriggerSyncResponse {
  jobId?: string | number;
  syncLogId?: string;
  scope?: MargSyncScope;
  status: 'queued' | 'completed' | string;
  message: string;
}

export interface MargConnectionProbeSummary {
  apiType: '1' | '2';
  index: number;
  dataStatus: number;
  dateTime: string;
  rowCounts: {
    details: number;
    masters: number;
    vouchers: number;
    parties: number;
    products: number;
    saleTypes: number;
    stock: number;
    accountGroups: number;
    accounts: number;
    accountGroupBalances: number;
    partyBalances: number;
    outstandings: number;
  };
}

export interface TestConnectionResponse {
  success: boolean;
  message: string;
  branches: unknown[];
  inventoryProbe?: MargConnectionProbeSummary;
  accountingProbe?: MargConnectionProbeSummary;
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

  async triggerSync(configId: string, params?: TriggerSyncParams): Promise<TriggerSyncResponse> {
    const { data } = await apiClient.post<TriggerSyncResponse>(`${BASE_PATH}/configs/${configId}/sync`, undefined, {
      params,
    });
    return data;
  },

  async triggerAccountingSync(configId: string, params?: TriggerSyncParams): Promise<TriggerSyncResponse> {
    const { data } = await apiClient.post<TriggerSyncResponse>(`${BASE_PATH}/configs/${configId}/sync/accounting`, undefined, {
      params,
    });
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

  async getGlAccounts(): Promise<MargGlAccount[]> {
    const { data } = await apiClient.get<MargGlAccount[]>(`${BASE_PATH}/gl-accounts`);
    return data;
  },

  async getGlMappingRules(params?: { companyId?: number; isActive?: boolean }): Promise<MargGlMappingRule[]> {
    const { data } = await apiClient.get<MargGlMappingRule[]>(`${BASE_PATH}/gl-mapping-rules`, { params });
    return data;
  },

  async createGlMappingRule(dto: CreateMargGlMappingRuleDto): Promise<MargGlMappingRule> {
    const { data } = await apiClient.post<MargGlMappingRule>(`${BASE_PATH}/gl-mapping-rules`, dto);
    return data;
  },

  async updateGlMappingRule(ruleId: string, dto: UpdateMargGlMappingRuleDto): Promise<MargGlMappingRule> {
    const { data } = await apiClient.patch<MargGlMappingRule>(`${BASE_PATH}/gl-mapping-rules/${ruleId}`, dto);
    return data;
  },

  async deleteGlMappingRule(ruleId: string): Promise<void> {
    await apiClient.delete(`${BASE_PATH}/gl-mapping-rules/${ruleId}`);
  },

  async getReconciliationResults(params?: {
    configId?: string;
    syncLogId?: string;
    type?: MargReconciliationType;
    status?: MargReconciliationStatus;
    take?: number;
  }): Promise<MargReconciliationResult[]> {
    const { data } = await apiClient.get<MargReconciliationResult[]>(`${BASE_PATH}/reconciliation-results`, { params });
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

  async getStagedAccountPostings(params?: { page?: number; pageSize?: number }): Promise<PaginatedResponse<MargStagedAccountPosting>> {
    const { data } = await apiClient.get<PaginatedResponse<MargStagedAccountPosting>>(`${BASE_PATH}/staged/account-postings`, { params });
    return data;
  },

  async getStagedAccountGroups(params?: { page?: number; pageSize?: number }): Promise<PaginatedResponse<MargStagedAccountGroup>> {
    const { data } = await apiClient.get<PaginatedResponse<MargStagedAccountGroup>>(`${BASE_PATH}/staged/account-groups`, { params });
    return data;
  },

  async getStagedAccountGroupBalances(params?: { page?: number; pageSize?: number }): Promise<PaginatedResponse<MargStagedAccountGroupBalance>> {
    const { data } = await apiClient.get<PaginatedResponse<MargStagedAccountGroupBalance>>(`${BASE_PATH}/staged/account-group-balances`, { params });
    return data;
  },

  async getStagedPartyBalances(params?: { page?: number; pageSize?: number }): Promise<PaginatedResponse<MargStagedPartyBalance>> {
    const { data } = await apiClient.get<PaginatedResponse<MargStagedPartyBalance>>(`${BASE_PATH}/staged/party-balances`, { params });
    return data;
  },

  async getStagedOutstandings(params?: { page?: number; pageSize?: number }): Promise<PaginatedResponse<MargStagedOutstanding>> {
    const { data } = await apiClient.get<PaginatedResponse<MargStagedOutstanding>>(`${BASE_PATH}/staged/outstandings`, { params });
    return data;
  },
};

export default margEdeService;
