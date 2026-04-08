import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { scenarioService } from '../services/api';
import type { CreateScenarioDto, UpdateScenarioDto } from '../services/api/scenario.service';

export const scenarioKeys = {
  all: ['scenarios'] as const,
  lists: () => [...scenarioKeys.all, 'list'] as const,
  list: (filters: Record<string, unknown>) => [...scenarioKeys.lists(), filters] as const,
  details: () => [...scenarioKeys.all, 'detail'] as const,
  detail: (id: string) => [...scenarioKeys.details(), id] as const,
  compare: (ids: string[]) => [...scenarioKeys.all, 'compare', ids] as const,
};

export function useScenarios(params?: { planVersionId?: string }) {
  return useQuery({
    queryKey: scenarioKeys.list(params || {}),
    queryFn: () => scenarioService.getAll(params),
  });
}

export function useScenario(id: string) {
  return useQuery({
    queryKey: scenarioKeys.detail(id),
    queryFn: () => scenarioService.getById(id),
    enabled: !!id,
  });
}

export function useCompareScenarios(scenarioIds: string[]) {
  return useQuery({
    queryKey: scenarioKeys.compare(scenarioIds),
    queryFn: () => scenarioService.compare(scenarioIds),
    enabled: scenarioIds.length > 0,
  });
}

export function useCreateScenario() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: (dto: CreateScenarioDto) => scenarioService.create(dto),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: scenarioKeys.lists() });
    },
  });
}

export function useUpdateScenario() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: ({ id, dto }: { id: string; dto: UpdateScenarioDto }) =>
      scenarioService.update(id, dto),
    onSuccess: (data, { id }) => {
      queryClient.invalidateQueries({ queryKey: scenarioKeys.lists() });
      queryClient.setQueryData(scenarioKeys.detail(id), data);
    },
  });
}

export function useDeleteScenario() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: (id: string) => scenarioService.delete(id),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: scenarioKeys.lists() });
    },
  });
}

export function useCloneScenario() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: ({ id, name }: { id: string; name: string }) => scenarioService.clone(id, name),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: scenarioKeys.lists() });
    },
  });
}

export function useSetBaseline() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: (id: string) => scenarioService.setBaseline(id),
    onSuccess: (data, id) => {
      queryClient.invalidateQueries({ queryKey: scenarioKeys.lists() });
      queryClient.setQueryData(scenarioKeys.detail(id), data);
    },
  });
}
