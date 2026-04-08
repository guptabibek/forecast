import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { InventoryPolicy, inventoryService } from '../services/api/inventory.service';

// ============================================================================
// Query Keys
// ============================================================================

export const inventoryKeys = {
  all: ['manufacturing', 'inventory'] as const,
  policies: () => [...inventoryKeys.all, 'policies'] as const,
  policyList: (params: Parameters<typeof inventoryService.getPolicies>[0]) => [...inventoryKeys.policies(), params] as const,
  policyDetail: (id: string) => [...inventoryKeys.policies(), 'detail', id] as const,
  levels: () => [...inventoryKeys.all, 'levels'] as const,
  levelList: (params: Parameters<typeof inventoryService.getLevels>[0]) => [...inventoryKeys.levels(), params] as const,
  levelDetail: (id: string) => [...inventoryKeys.levels(), 'detail', id] as const,
  levelHistory: (productId: string, locationId?: string) => [...inventoryKeys.levels(), 'history', productId, locationId] as const,
  abcAnalysis: (params: Parameters<typeof inventoryService.getABCAnalysis>[0]) => [...inventoryKeys.all, 'abc', params] as const,
  xyzAnalysis: (params: Parameters<typeof inventoryService.getXYZAnalysis>[0]) => [...inventoryKeys.all, 'xyz', params] as const,
  turnover: (params: Parameters<typeof inventoryService.getTurnoverAnalysis>[0]) => [...inventoryKeys.all, 'turnover', params] as const,
};

// ============================================================================
// Policy Hooks
// ============================================================================

export function useInventoryPolicies(params?: Parameters<typeof inventoryService.getPolicies>[0]) {
  return useQuery({
    queryKey: inventoryKeys.policyList(params),
    queryFn: () => inventoryService.getPolicies(params),
  });
}

export function useInventoryPolicy(productId: string, locationId: string) {
  return useQuery({
    queryKey: inventoryKeys.policyDetail(`${productId}-${locationId}`),
    queryFn: () => inventoryService.getPolicy(productId, locationId),
    enabled: !!productId && !!locationId,
  });
}

export function useCreateInventoryPolicy() {
  const queryClient = useQueryClient();
  
  return useMutation({
    mutationFn: (dto: Parameters<typeof inventoryService.createPolicy>[0]) =>
      inventoryService.createPolicy(dto),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: inventoryKeys.policies() });
    },
  });
}

export function useUpdateInventoryPolicy() {
  const queryClient = useQueryClient();
  
  return useMutation({
    mutationFn: ({ policyId, dto }: { policyId: string; dto: Partial<InventoryPolicy> }) =>
      inventoryService.updatePolicy(policyId, dto),
    onSuccess: (_, { policyId }) => {
      queryClient.invalidateQueries({ queryKey: inventoryKeys.policyDetail(policyId) });
      queryClient.invalidateQueries({ queryKey: inventoryKeys.policies() });
    },
  });
}

export function useDeleteInventoryPolicy() {
  const queryClient = useQueryClient();
  
  return useMutation({
    mutationFn: ({ productId, locationId }: { productId: string; locationId: string }) =>
      inventoryService.deletePolicy(productId, locationId),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: inventoryKeys.policies() });
    },
  });
}

// ============================================================================
// Level Hooks
// ============================================================================

export function useInventoryLevels(params?: Parameters<typeof inventoryService.getLevels>[0]) {
  return useQuery({
    queryKey: inventoryKeys.levelList(params),
    queryFn: () => inventoryService.getLevels(params),
  });
}

export function useInventoryLevel(productId: string, locationId: string) {
  return useQuery({
    queryKey: inventoryKeys.levelDetail(`${productId}-${locationId}`),
    queryFn: () => inventoryService.getLevel(productId, locationId),
    enabled: !!productId && !!locationId,
  });
}

export function useCurrentInventoryLevel(productId: string, locationId?: string) {
  return useQuery({
    queryKey: [...inventoryKeys.levelDetail(`current-${productId}-${locationId}`)],
    queryFn: () => inventoryService.getCurrentLevel(productId, locationId),
    enabled: !!productId,
  });
}

export function useInventoryLevelHistory(productId: string, locationId?: string, params?: { days?: number }) {
  return useQuery({
    queryKey: [...inventoryKeys.levelHistory(productId, locationId), params],
    queryFn: () => inventoryService.getLevelHistory(productId, locationId, params?.days),
    enabled: !!productId,
  });
}

export function useUpsertInventoryLevel() {
  const queryClient = useQueryClient();
  
  return useMutation({
    mutationFn: (dto: Parameters<typeof inventoryService.upsertLevel>[0]) =>
      inventoryService.upsertLevel(dto),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: inventoryKeys.levels() });
    },
  });
}

export function useBulkUpsertInventoryLevels() {
  const queryClient = useQueryClient();
  
  return useMutation({
    mutationFn: (levels: Parameters<typeof inventoryService.bulkUpsertLevels>[0]) =>
      inventoryService.bulkUpsertLevels(levels),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: inventoryKeys.levels() });
    },
  });
}

export function useDeleteInventoryLevel() {
  const queryClient = useQueryClient();
  
  return useMutation({
    mutationFn: (levelId: string) => inventoryService.deleteLevel(levelId),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: inventoryKeys.levels() });
    },
  });
}

// ============================================================================
// Calculation Hooks
// ============================================================================

export function useCalculateSafetyStock() {
  return useMutation({
    mutationFn: ({ productId, locationId }: { productId: string; locationId: string }) =>
      inventoryService.calculateSafetyStock(productId, locationId),
  });
}

export function useCalculateReorderPoint() {
  return useMutation({
    mutationFn: ({ productId, locationId }: { productId: string; locationId: string }) =>
      inventoryService.calculateReorderPoint(productId, locationId),
  });
}

export function useCalculateEOQ() {
  return useMutation({
    mutationFn: ({ productId, locationId, params }: { productId: string; locationId: string; params?: { annualDemand?: number; orderCost?: number; holdingCostPercent?: number } }) =>
      inventoryService.calculateEOQ(productId, locationId, params),
  });
}

// ============================================================================
// Analysis Hooks
// ============================================================================

export function useABCAnalysis(params?: Parameters<typeof inventoryService.getABCAnalysis>[0]) {
  return useQuery({
    queryKey: inventoryKeys.abcAnalysis(params),
    queryFn: () => inventoryService.getABCAnalysis(params),
  });
}

export function useXYZAnalysis(params?: Parameters<typeof inventoryService.getXYZAnalysis>[0]) {
  return useQuery({
    queryKey: inventoryKeys.xyzAnalysis(params),
    queryFn: () => inventoryService.getXYZAnalysis(params),
  });
}

export function useTurnoverAnalysis(params?: Parameters<typeof inventoryService.getTurnoverAnalysis>[0]) {
  return useQuery({
    queryKey: inventoryKeys.turnover(params),
    queryFn: () => inventoryService.getTurnoverAnalysis(params),
  });
}
