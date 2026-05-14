import type {
    CreateMargConfigDto,
    CreateMargGlMappingRuleDto,
    MargStagedAccountGroup,
    MargStagedAccountGroupBalance,
    MargStagedAccountPosting,
    MargStagedBranch,
    MargStagedOutstanding,
    MargStagedParty,
    MargStagedPartyBalance,
    MargStagedProduct,
    MargStagedStock,
    MargStagedTransaction,
    TriggerSyncParams,
    UpdateMargConfigDto,
    UpdateMargGlMappingRuleDto,
} from '@services/api/marg-ede.service';
import { margEdeService } from '@services/api/marg-ede.service';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';

export const margEdeKeys = {
  all: ['marg-ede'] as const,
  overview: () => [...margEdeKeys.all, 'overview'] as const,
  configs: () => [...margEdeKeys.all, 'configs'] as const,
  config: (configId: string) => [...margEdeKeys.configs(), configId] as const,
  logs: (configId: string) => [...margEdeKeys.all, 'logs', configId] as const,
  glAccounts: () => [...margEdeKeys.all, 'gl-accounts'] as const,
  glMappingRules: (companyId?: number, isActive?: boolean) => [...margEdeKeys.all, 'gl-mapping-rules', companyId ?? 'all', isActive ?? 'all'] as const,
  reconciliationResults: (configId?: string, syncLogId?: string) => [...margEdeKeys.all, 'reconciliation-results', configId ?? 'all', syncLogId ?? 'latest'] as const,
  stagedBranches: (page: number, pageSize: number) => [...margEdeKeys.all, 'staged', 'branches', page, pageSize] as const,
  stagedProducts: (page: number, pageSize: number) => [...margEdeKeys.all, 'staged', 'products', page, pageSize] as const,
  stagedParties: (page: number, pageSize: number) => [...margEdeKeys.all, 'staged', 'parties', page, pageSize] as const,
  stagedTransactions: (page: number, pageSize: number) => [...margEdeKeys.all, 'staged', 'transactions', page, pageSize] as const,
  stagedStock: (page: number, pageSize: number) => [...margEdeKeys.all, 'staged', 'stock', page, pageSize] as const,
  stagedAccountPostings: (page: number, pageSize: number) => [...margEdeKeys.all, 'staged', 'account-postings', page, pageSize] as const,
  stagedAccountGroups: (page: number, pageSize: number) => [...margEdeKeys.all, 'staged', 'account-groups', page, pageSize] as const,
  stagedAccountGroupBalances: (page: number, pageSize: number) => [...margEdeKeys.all, 'staged', 'account-group-balances', page, pageSize] as const,
  stagedPartyBalances: (page: number, pageSize: number) => [...margEdeKeys.all, 'staged', 'party-balances', page, pageSize] as const,
  stagedOutstandings: (page: number, pageSize: number) => [...margEdeKeys.all, 'staged', 'outstandings', page, pageSize] as const,
};

export function useMargOverview() {
  return useQuery({
    queryKey: margEdeKeys.overview(),
    queryFn: () => margEdeService.getOverview(),
  });
}

export function useMargConfigs() {
  return useQuery({
    queryKey: margEdeKeys.configs(),
    queryFn: () => margEdeService.getConfigs(),
  });
}

export function useMargConfig(configId?: string) {
  return useQuery({
    queryKey: margEdeKeys.config(configId || 'unknown'),
    queryFn: () => margEdeService.getConfig(configId as string),
    enabled: Boolean(configId),
  });
}

export function useMargSyncLogs(configId?: string) {
  return useQuery({
    queryKey: margEdeKeys.logs(configId || 'unknown'),
    queryFn: () => margEdeService.getSyncLogs(configId as string),
    enabled: Boolean(configId),
  });
}

export function useMargGlAccounts(enabled = true) {
  return useQuery({
    queryKey: margEdeKeys.glAccounts(),
    queryFn: () => margEdeService.getGlAccounts(),
    enabled,
  });
}

export function useMargGlMappingRules(filters?: { companyId?: number; isActive?: boolean }, enabled = true) {
  return useQuery({
    queryKey: margEdeKeys.glMappingRules(filters?.companyId, filters?.isActive),
    queryFn: () => margEdeService.getGlMappingRules(filters),
    enabled,
  });
}

export function useMargReconciliationResults(filters?: { configId?: string; syncLogId?: string; take?: number }, enabled = true) {
  return useQuery({
    queryKey: margEdeKeys.reconciliationResults(filters?.configId, filters?.syncLogId),
    queryFn: () => margEdeService.getReconciliationResults(filters),
    enabled,
  });
}

export function useMargStagedBranches(page: number, pageSize: number, enabled = true) {
  return useQuery({
    queryKey: margEdeKeys.stagedBranches(page, pageSize),
    queryFn: () => margEdeService.getStagedBranches({ page, pageSize }),
    enabled,
  });
}

export function useMargStagedProducts(page: number, pageSize: number, enabled = true) {
  return useQuery({
    queryKey: margEdeKeys.stagedProducts(page, pageSize),
    queryFn: () => margEdeService.getStagedProducts({ page, pageSize }),
    enabled,
  });
}

export function useMargStagedParties(page: number, pageSize: number, enabled = true) {
  return useQuery({
    queryKey: margEdeKeys.stagedParties(page, pageSize),
    queryFn: () => margEdeService.getStagedParties({ page, pageSize }),
    enabled,
  });
}

export function useMargStagedTransactions(page: number, pageSize: number, enabled = true) {
  return useQuery({
    queryKey: margEdeKeys.stagedTransactions(page, pageSize),
    queryFn: () => margEdeService.getStagedTransactions({ page, pageSize }),
    enabled,
  });
}

export function useMargStagedStock(page: number, pageSize: number, enabled = true) {
  return useQuery({
    queryKey: margEdeKeys.stagedStock(page, pageSize),
    queryFn: () => margEdeService.getStagedStock({ page, pageSize }),
    enabled,
  });
}

export function useMargStagedAccountPostings(page: number, pageSize: number, enabled = true) {
  return useQuery({
    queryKey: margEdeKeys.stagedAccountPostings(page, pageSize),
    queryFn: () => margEdeService.getStagedAccountPostings({ page, pageSize }),
    enabled,
  });
}

export function useMargStagedAccountGroups(page: number, pageSize: number, enabled = true) {
  return useQuery({
    queryKey: margEdeKeys.stagedAccountGroups(page, pageSize),
    queryFn: () => margEdeService.getStagedAccountGroups({ page, pageSize }),
    enabled,
  });
}

export function useMargStagedAccountGroupBalances(page: number, pageSize: number, enabled = true) {
  return useQuery({
    queryKey: margEdeKeys.stagedAccountGroupBalances(page, pageSize),
    queryFn: () => margEdeService.getStagedAccountGroupBalances({ page, pageSize }),
    enabled,
  });
}

export function useMargStagedPartyBalances(page: number, pageSize: number, enabled = true) {
  return useQuery({
    queryKey: margEdeKeys.stagedPartyBalances(page, pageSize),
    queryFn: () => margEdeService.getStagedPartyBalances({ page, pageSize }),
    enabled,
  });
}

export function useMargStagedOutstandings(page: number, pageSize: number, enabled = true) {
  return useQuery({
    queryKey: margEdeKeys.stagedOutstandings(page, pageSize),
    queryFn: () => margEdeService.getStagedOutstandings({ page, pageSize }),
    enabled,
  });
}

function invalidateAllMargQueries(queryClient: ReturnType<typeof useQueryClient>) {
  queryClient.invalidateQueries({ queryKey: margEdeKeys.all });
}

export function useCreateMargConfig() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (dto: CreateMargConfigDto) => margEdeService.createConfig(dto),
    onSuccess: () => invalidateAllMargQueries(queryClient),
  });
}

export function useUpdateMargConfig() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: ({ configId, dto }: { configId: string; dto: UpdateMargConfigDto }) => margEdeService.updateConfig(configId, dto),
    onSuccess: (_, variables) => {
      queryClient.invalidateQueries({ queryKey: margEdeKeys.config(variables.configId) });
      invalidateAllMargQueries(queryClient);
    },
  });
}

export function useDeleteMargConfig() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (configId: string) => margEdeService.deleteConfig(configId),
    onSuccess: () => invalidateAllMargQueries(queryClient),
  });
}

export function useTestMargConnection() {
  return useMutation({
    mutationFn: (configId: string) => margEdeService.testConnection(configId),
  });
}

export function useTriggerMargSync() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: ({ configId, params }: { configId: string; params?: TriggerSyncParams }) =>
      margEdeService.triggerSync(configId, params),
    onSuccess: () => {
      invalidateAllMargQueries(queryClient);
    },
  });
}

export function useTriggerMargAccountingSync() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: ({ configId, params }: { configId: string; params?: TriggerSyncParams }) =>
      margEdeService.triggerAccountingSync(configId, params),
    onSuccess: () => {
      invalidateAllMargQueries(queryClient);
    },
  });
}

export function useCreateMargGlMappingRule() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (dto: CreateMargGlMappingRuleDto) => margEdeService.createGlMappingRule(dto),
    onSuccess: () => invalidateAllMargQueries(queryClient),
  });
}

export function useUpdateMargGlMappingRule() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: ({ ruleId, dto }: { ruleId: string; dto: UpdateMargGlMappingRuleDto }) =>
      margEdeService.updateGlMappingRule(ruleId, dto),
    onSuccess: () => invalidateAllMargQueries(queryClient),
  });
}

export function useDeleteMargGlMappingRule() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (ruleId: string) => margEdeService.deleteGlMappingRule(ruleId),
    onSuccess: () => invalidateAllMargQueries(queryClient),
  });
}

export type MargAnyStagedRow =
  | MargStagedAccountGroup
  | MargStagedAccountGroupBalance
  | MargStagedBranch
  | MargStagedOutstanding
  | MargStagedProduct
  | MargStagedParty
  | MargStagedPartyBalance
  | MargStagedTransaction
  | MargStagedStock
  | MargStagedAccountPosting;

export type {
    CreateMargConfigDto,
    CreateMargGlMappingRuleDto,
    MargGlAccount,
    MargGlMappingRule,
    MargReconciliationResult,
    MargReconciliationStatus,
    MargReconciliationType,
    MargStagedAccountGroup,
    MargStagedAccountGroupBalance,
    MargStagedAccountPosting,
    MargStagedBranch,
    MargStagedOutstanding,
    MargStagedParty,
    MargStagedPartyBalance,
    MargStagedProduct,
    MargStagedStock,
    MargStagedTransaction,
    MargSyncConfig,
    MargSyncLog,
    MargSyncScope,
    MargSyncStatus,
    TriggerSyncParams,
    UpdateMargConfigDto,
    UpdateMargGlMappingRuleDto
} from '@services/api/marg-ede.service';

