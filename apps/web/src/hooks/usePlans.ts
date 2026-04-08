import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { planService } from '../services/api';
import type { CreatePlanRequest, PlanVersion } from '../types';

// Type alias for update DTO  
type UpdatePlanDto = Partial<Omit<PlanVersion, 'id' | 'createdAt' | 'updatedAt' | 'createdBy' | 'approvedBy'>>;

export const planKeys = {
  all: ['plans'] as const,
  lists: () => [...planKeys.all, 'list'] as const,
  list: (filters: Record<string, unknown>) => [...planKeys.lists(), filters] as const,
  details: () => [...planKeys.all, 'detail'] as const,
  detail: (id: string) => [...planKeys.details(), id] as const,
  versions: (id: string) => [...planKeys.all, 'versions', id] as const,
};

export function usePlans(params?: { status?: string; page?: number; limit?: number }) {
  return useQuery({
    queryKey: planKeys.list(params || {}),
    queryFn: () => planService.getAll(params),
    staleTime: 30000, // 30 seconds
  });
}

export function usePlan(id: string) {
  return useQuery({
    queryKey: planKeys.detail(id),
    queryFn: () => planService.getById(id),
    enabled: !!id,
    staleTime: 0, // Always fetch fresh for detail view
    refetchOnWindowFocus: true,
  });
}

export function useCreatePlan() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: (dto: CreatePlanRequest) => planService.create(dto),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: planKeys.lists() });
    },
  });
}

export function useUpdatePlan() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: ({ id, dto }: { id: string; dto: UpdatePlanDto }) => planService.update(id, dto),
    onSuccess: (data, { id }) => {
      queryClient.invalidateQueries({ queryKey: planKeys.lists() });
      queryClient.setQueryData(planKeys.detail(id), data);
    },
  });
}

export function useDeletePlan() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: (id: string) => planService.delete(id),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: planKeys.lists() });
    },
  });
}

export function useClonePlan() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: ({ id, name }: { id: string; name: string }) => planService.clone(id, name),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: planKeys.lists() });
    },
  });
}

export function useSubmitPlan() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: (id: string) => planService.submitForReview(id),
    onSuccess: (data, id) => {
      queryClient.invalidateQueries({ queryKey: planKeys.lists() });
      queryClient.setQueryData(planKeys.detail(id), data);
    },
  });
}

export function useApprovePlan() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: (id: string) => planService.approve(id),
    onSuccess: (data, id) => {
      queryClient.invalidateQueries({ queryKey: planKeys.lists() });
      queryClient.setQueryData(planKeys.detail(id), data);
    },
  });
}

export function useRejectPlan() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: ({ id, reason }: { id: string; reason: string }) =>
      planService.reject(id, reason),
    onSuccess: (data, { id }) => {
      queryClient.invalidateQueries({ queryKey: planKeys.lists() });
      queryClient.setQueryData(planKeys.detail(id), data);
    },
  });
}

export function useArchivePlan() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: (id: string) => planService.archive(id),
    onSuccess: (data, id) => {
      queryClient.invalidateQueries({ queryKey: planKeys.lists() });
      queryClient.setQueryData(planKeys.detail(id), data);
    },
  });
}
