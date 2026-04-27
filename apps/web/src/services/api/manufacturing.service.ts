import { apiClient } from './client';

export interface ManufacturingDashboardMetrics {
  boms: {
    total: number;
    pendingApproval: number;
  };
  workCenters: {
    active: number;
  };
  inventoryPolicies: {
    total: number;
    belowSafetyStock: number;
  };
  plannedOrders: {
    pending: number;
  };
  sopCycles: {
    active: number;
    currentCycle: string | null;
    currentStatus: string | null;
  };
  pendingApprovals: number;
  activeWorkflows: number;
  suppliers: {
    active: number;
    avgLeadTimeDays: number;
  };
  npi: {
    inDevelopment: number;
    preLaunch: number;
  };
  promotions: {
    active: number;
    upcoming: number;
  };
  fiscalCalendar: {
    type: string | null;
  };
}

export type GLAccountType = 'ASSET' | 'LIABILITY' | 'EQUITY' | 'REVENUE' | 'EXPENSE' | 'CONTRA_ASSET';
export type NormalBalance = 'DEBIT' | 'CREDIT';
export type JournalEntryStatus = 'POSTED' | 'REVERSED';

export interface ManufacturingGlAccount {
  id: string;
  accountNumber: string;
  name: string;
  accountType: GLAccountType;
  normalBalance: NormalBalance;
  description?: string | null;
  isActive: boolean;
  isSystem: boolean;
  parentId?: string | null;
  children?: ManufacturingGlAccount[];
  createdAt: string;
  updatedAt: string;
}

export interface ManufacturingJournalEntryLine {
  id: string;
  glAccountId: string;
  debitAmount: number | string;
  creditAmount: number | string;
  description?: string | null;
  glAccount?: Pick<ManufacturingGlAccount, 'id' | 'accountNumber' | 'name' | 'accountType'>;
}

export interface ManufacturingJournalEntry {
  id: string;
  entryDate: string;
  referenceType?: string | null;
  referenceId?: string | null;
  description?: string | null;
  status: JournalEntryStatus;
  currency?: string | null;
  createdAt: string;
  lines: ManufacturingJournalEntryLine[];
}

export interface ManufacturingJournalEntriesResponse {
  entries: ManufacturingJournalEntry[];
  total: number;
}

export interface ManufacturingTrialBalanceRow {
  id: string;
  account_number: string;
  name: string;
  account_type: GLAccountType;
  normal_balance: NormalBalance;
  total_debits: number | string;
  total_credits: number | string;
  net_balance: number | string;
}

export interface ManufacturingGlAccountFilters {
  accountType?: GLAccountType;
  isActive?: boolean;
}

export interface ManufacturingJournalEntryFilters {
  status?: JournalEntryStatus;
  startDate?: string;
  endDate?: string;
}

export interface ManufacturingTrialBalanceFilters {
  startDate?: string;
  endDate?: string;
}

export const manufacturingService = {
  async getDashboard(): Promise<ManufacturingDashboardMetrics> {
    const { data } = await apiClient.get<ManufacturingDashboardMetrics>('/manufacturing/dashboard');
    return data;
  },

  async getGLAccounts(filters?: ManufacturingGlAccountFilters): Promise<ManufacturingGlAccount[]> {
    const { data } = await apiClient.get<ManufacturingGlAccount[]>('/manufacturing/gl-accounts', {
      params: filters,
    });
    return data;
  },

  async getJournalEntries(filters?: ManufacturingJournalEntryFilters): Promise<ManufacturingJournalEntriesResponse> {
    const { data } = await apiClient.get<ManufacturingJournalEntriesResponse>('/manufacturing/journal-entries', {
      params: filters,
    });
    return data;
  },

  async getTrialBalance(filters?: ManufacturingTrialBalanceFilters): Promise<ManufacturingTrialBalanceRow[]> {
    const { data } = await apiClient.get<ManufacturingTrialBalanceRow[]>('/manufacturing/trial-balance', {
      params: filters,
    });
    return data;
  },
};
