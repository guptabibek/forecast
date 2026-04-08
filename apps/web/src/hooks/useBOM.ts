import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { BillOfMaterial, BOMComponent, bomService } from '../services/api/bom.service';

// ============================================================================
// Query Keys
// ============================================================================

export const bomKeys = {
  all: ['manufacturing', 'boms'] as const,
  lists: () => [...bomKeys.all, 'list'] as const,
  list: (params: Parameters<typeof bomService.getBOMs>[0]) => [...bomKeys.lists(), params] as const,
  details: () => [...bomKeys.all, 'detail'] as const,
  detail: (id: string) => [...bomKeys.details(), id] as const,
  components: (bomId: string) => [...bomKeys.all, 'components', bomId] as const,
  explosion: (bomId: string) => [...bomKeys.all, 'explosion', bomId] as const,
  whereUsed: (productId: string) => [...bomKeys.all, 'where-used', productId] as const,
  comparison: (bomIds: string[]) => [...bomKeys.all, 'comparison', bomIds] as const,
};

// ============================================================================
// Hooks
// ============================================================================

export function useBOMs(params?: Parameters<typeof bomService.getBOMs>[0]) {
  return useQuery({
    queryKey: bomKeys.list(params),
    queryFn: () => bomService.getBOMs(params),
  });
}

export function useBOM(bomId: string) {
  return useQuery({
    queryKey: bomKeys.detail(bomId),
    queryFn: () => bomService.getBOM(bomId),
    enabled: !!bomId,
  });
}

export function useBOMComponents(bomId: string) {
  return useQuery({
    queryKey: bomKeys.components(bomId),
    queryFn: () => bomService.getComponents(bomId),
    enabled: !!bomId,
  });
}

export function useBOMExplosion(bomId: string, options?: { levels?: number; includeInactive?: boolean }) {
  return useQuery({
    queryKey: [...bomKeys.explosion(bomId), options],
    queryFn: () => bomService.explodeBOM(bomId, options?.levels, options?.includeInactive),
    enabled: !!bomId,
  });
}

export function useBOMWhereUsed(productId: string, options?: { levels?: number }) {
  return useQuery({
    queryKey: [...bomKeys.whereUsed(productId), options],
    queryFn: () => bomService.getWhereUsed(productId, options?.levels),
    enabled: !!productId,
  });
}

export function useBOMComparison(bomIds: string[]) {
  return useQuery({
    queryKey: bomKeys.comparison(bomIds),
    queryFn: () => bomService.compareBOMs(bomIds),
    enabled: bomIds.length >= 2,
  });
}

export function useCreateBOM() {
  const queryClient = useQueryClient();
  
  return useMutation({
    mutationFn: (dto: Parameters<typeof bomService.createBOM>[0]) => bomService.createBOM(dto),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: bomKeys.lists() });
    },
  });
}

export function useUpdateBOM() {
  const queryClient = useQueryClient();
  
  return useMutation({
    mutationFn: ({ bomId, dto }: { bomId: string; dto: Partial<BillOfMaterial> }) =>
      bomService.updateBOM(bomId, dto),
    onSuccess: (_, { bomId }) => {
      queryClient.invalidateQueries({ queryKey: bomKeys.detail(bomId) });
      queryClient.invalidateQueries({ queryKey: bomKeys.lists() });
    },
  });
}

export function useUpdateBOMStatus() {
  const queryClient = useQueryClient();
  
  return useMutation({
    mutationFn: ({ bomId, status }: { bomId: string; status: string }) =>
      bomService.updateBOMStatus(bomId, status),
    onSuccess: (_, { bomId }) => {
      queryClient.invalidateQueries({ queryKey: bomKeys.detail(bomId) });
      queryClient.invalidateQueries({ queryKey: bomKeys.lists() });
    },
  });
}

export function useDeleteBOM() {
  const queryClient = useQueryClient();
  
  return useMutation({
    mutationFn: (bomId: string) => bomService.deleteBOM(bomId),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: bomKeys.lists() });
    },
  });
}

export function useAddBOMComponent() {
  const queryClient = useQueryClient();
  
  return useMutation({
    mutationFn: ({ bomId, dto }: { bomId: string; dto: Parameters<typeof bomService.addComponent>[1] }) =>
      bomService.addComponent(bomId, dto),
    onSuccess: (_, { bomId }) => {
      queryClient.invalidateQueries({ queryKey: bomKeys.components(bomId) });
      queryClient.invalidateQueries({ queryKey: bomKeys.detail(bomId) });
    },
  });
}

export function useUpdateBOMComponent() {
  const queryClient = useQueryClient();
  
  return useMutation({
    mutationFn: (variables: { componentId: string; dto: Partial<BOMComponent>; bomId: string }) =>
      bomService.updateComponent(variables.componentId, variables.dto),
    onSuccess: (_, { bomId }) => {
      queryClient.invalidateQueries({ queryKey: bomKeys.components(bomId) });
      queryClient.invalidateQueries({ queryKey: bomKeys.detail(bomId) });
    },
  });
}

export function useRemoveBOMComponent() {
  const queryClient = useQueryClient();
  
  return useMutation({
    mutationFn: (variables: { componentId: string; bomId: string }) =>
      bomService.removeComponent(variables.componentId),
    onSuccess: (_, { bomId }) => {
      queryClient.invalidateQueries({ queryKey: bomKeys.components(bomId) });
      queryClient.invalidateQueries({ queryKey: bomKeys.detail(bomId) });
    },
  });
}

export function useCopyBOM() {
  const queryClient = useQueryClient();
  
  return useMutation({
    mutationFn: ({ sourceBomId, dto }: { sourceBomId: string; dto: Parameters<typeof bomService.copyBOM>[1] }) =>
      bomService.copyBOM(sourceBomId, dto),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: bomKeys.lists() });
    },
  });
}

export function useCostRollup() {
  return useMutation({
    mutationFn: (bomId: string) => bomService.costRollup(bomId),
  });
}
