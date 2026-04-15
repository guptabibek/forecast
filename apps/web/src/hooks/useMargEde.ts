import {
    CreateMargConfigDto,
    margEdeService,
    MargStagedBranch,
    MargStagedParty,
    MargStagedProduct,
    MargStagedStock,
    MargStagedTransaction,
    UpdateMargConfigDto,
} from '@services/api/marg-ede.service';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';

export const margEdeKeys = {
  all: ['marg-ede'] as const,
  overview: () => [...margEdeKeys.all, 'overview'] as const,
  configs: () => [...margEdeKeys.all, 'configs'] as const,
  config: (configId: string) => [...margEdeKeys.configs(), configId] as const,
  logs: (configId: string) => [...margEdeKeys.all, 'logs', configId] as const,
  stagedBranches: (page: number, pageSize: number) => [...margEdeKeys.all, 'staged', 'branches', page, pageSize] as const,
  stagedProducts: (page: number, pageSize: number) => [...margEdeKeys.all, 'staged', 'products', page, pageSize] as const,
  stagedParties: (page: number, pageSize: number) => [...margEdeKeys.all, 'staged', 'parties', page, pageSize] as const,
  stagedTransactions: (page: number, pageSize: number) => [...margEdeKeys.all, 'staged', 'transactions', page, pageSize] as const,
  stagedStock: (page: number, pageSize: number) => [...margEdeKeys.all, 'staged', 'stock', page, pageSize] as const,
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
    mutationFn: (configId: string) => margEdeService.triggerSync(configId),
    onSuccess: () => {
      invalidateAllMargQueries(queryClient);
    },
  });
}

export type MargAnyStagedRow =
  | MargStagedBranch
  | MargStagedProduct
  | MargStagedParty
  | MargStagedTransaction
  | MargStagedStock;

export type {
    CreateMargConfigDto,
    MargStagedBranch,
    MargStagedParty,
    MargStagedProduct,
    MargStagedStock,
    MargStagedTransaction, MargSyncConfig,
    MargSyncLog,
    MargSyncStatus, UpdateMargConfigDto
} from '@services/api/marg-ede.service';

