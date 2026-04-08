import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { capacityService, WorkCenter, WorkCenterCapacity, WorkCenterShift } from '../services/api/capacity.service';

// ============================================================================
// Query Keys
// ============================================================================

export const capacityKeys = {
  all: ['manufacturing', 'capacity'] as const,
  workCenters: () => [...capacityKeys.all, 'work-centers'] as const,
  workCenterList: (params: Parameters<typeof capacityService.getWorkCenters>[0]) => [...capacityKeys.workCenters(), params] as const,
  workCenterDetail: (id: string) => [...capacityKeys.workCenters(), 'detail', id] as const,
  capacities: (workCenterId: string) => [...capacityKeys.all, 'capacities', workCenterId] as const,
  shifts: (workCenterId: string) => [...capacityKeys.all, 'shifts', workCenterId] as const,
  utilization: (params: Parameters<typeof capacityService.getUtilization>[0]) => [...capacityKeys.all, 'utilization', params] as const,
  bottlenecks: (params: Parameters<typeof capacityService.detectBottlenecks>[0]) => [...capacityKeys.all, 'bottlenecks', params] as const,
  plan: (workCenterId: string, params: Parameters<typeof capacityService.getCapacityPlan>[1]) => [...capacityKeys.all, 'plan', workCenterId, params] as const,
  aggregatePlan: (params: Parameters<typeof capacityService.getAggregateCapacityPlan>[0]) => [...capacityKeys.all, 'aggregate-plan', params] as const,
};

// ============================================================================
// Work Center Hooks
// ============================================================================

export function useWorkCenters(params?: Parameters<typeof capacityService.getWorkCenters>[0]) {
  return useQuery({
    queryKey: capacityKeys.workCenterList(params),
    queryFn: () => capacityService.getWorkCenters(params),
  });
}

export function useWorkCenter(workCenterId: string) {
  return useQuery({
    queryKey: capacityKeys.workCenterDetail(workCenterId),
    queryFn: () => capacityService.getWorkCenter(workCenterId),
    enabled: !!workCenterId,
  });
}

export function useCreateWorkCenter() {
  const queryClient = useQueryClient();
  
  return useMutation({
    mutationFn: (dto: Parameters<typeof capacityService.createWorkCenter>[0]) =>
      capacityService.createWorkCenter(dto),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: capacityKeys.workCenters() });
    },
  });
}

export function useUpdateWorkCenter() {
  const queryClient = useQueryClient();
  
  return useMutation({
    mutationFn: ({ workCenterId, dto }: { workCenterId: string; dto: Partial<WorkCenter> }) =>
      capacityService.updateWorkCenter(workCenterId, dto),
    onSuccess: (_, { workCenterId }) => {
      queryClient.invalidateQueries({ queryKey: capacityKeys.workCenterDetail(workCenterId) });
      queryClient.invalidateQueries({ queryKey: capacityKeys.workCenters() });
    },
  });
}

export function useToggleWorkCenterStatus() {
  const queryClient = useQueryClient();
  
  return useMutation({
    mutationFn: (workCenterId: string) => capacityService.toggleWorkCenterStatus(workCenterId),
    onSuccess: (_, workCenterId) => {
      queryClient.invalidateQueries({ queryKey: capacityKeys.workCenterDetail(workCenterId) });
      queryClient.invalidateQueries({ queryKey: capacityKeys.workCenters() });
    },
  });
}

export function useDeleteWorkCenter() {
  const queryClient = useQueryClient();
  
  return useMutation({
    mutationFn: (workCenterId: string) => capacityService.deleteWorkCenter(workCenterId),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: capacityKeys.workCenters() });
    },
  });
}

// ============================================================================
// Capacity Hooks
// ============================================================================

export function useWorkCenterCapacities(workCenterId: string, params?: Parameters<typeof capacityService.getCapacities>[1]) {
  return useQuery({
    queryKey: [...capacityKeys.capacities(workCenterId), params],
    queryFn: () => capacityService.getCapacities(workCenterId, params),
    enabled: !!workCenterId,
  });
}

export function useCurrentCapacity(workCenterId: string) {
  return useQuery({
    queryKey: [...capacityKeys.capacities(workCenterId), 'current'],
    queryFn: () => capacityService.getCurrentCapacity(workCenterId),
    enabled: !!workCenterId,
  });
}

export function useCreateCapacity() {
  const queryClient = useQueryClient();
  
  return useMutation({
    mutationFn: (variables: { workCenterId: string; dto: Parameters<typeof capacityService.createCapacity>[1] }) =>
      capacityService.createCapacity(variables.workCenterId, variables.dto),
    onSuccess: (_, { workCenterId }) => {
      queryClient.invalidateQueries({ queryKey: capacityKeys.capacities(workCenterId) });
    },
  });
}

export function useUpdateCapacity() {
  const queryClient = useQueryClient();
  
  return useMutation({
    mutationFn: (variables: { capacityId: string; dto: Partial<WorkCenterCapacity>; workCenterId: string }) =>
      capacityService.updateCapacity(variables.capacityId, variables.dto),
    onSuccess: (_, { workCenterId }) => {
      queryClient.invalidateQueries({ queryKey: capacityKeys.capacities(workCenterId) });
    },
  });
}

export function useDeleteCapacity() {
  const queryClient = useQueryClient();
  
  return useMutation({
    mutationFn: (variables: { capacityId: string; workCenterId: string }) =>
      capacityService.deleteCapacity(variables.capacityId),
    onSuccess: (_, { workCenterId }) => {
      queryClient.invalidateQueries({ queryKey: capacityKeys.capacities(workCenterId) });
    },
  });
}

// ============================================================================
// Shift Hooks
// ============================================================================

export function useWorkCenterShifts(workCenterId: string, params?: Parameters<typeof capacityService.getShifts>[1]) {
  return useQuery({
    queryKey: [...capacityKeys.shifts(workCenterId), params],
    queryFn: () => capacityService.getShifts(workCenterId, params),
    enabled: !!workCenterId,
  });
}

export function useCreateShift() {
  const queryClient = useQueryClient();
  
  return useMutation({
    mutationFn: (variables: { workCenterId: string; dto: Parameters<typeof capacityService.createShift>[1] }) =>
      capacityService.createShift(variables.workCenterId, variables.dto),
    onSuccess: (_, { workCenterId }) => {
      queryClient.invalidateQueries({ queryKey: capacityKeys.shifts(workCenterId) });
    },
  });
}

export function useUpdateShift() {
  const queryClient = useQueryClient();
  
  return useMutation({
    mutationFn: (variables: { shiftId: string; dto: Partial<WorkCenterShift>; workCenterId: string }) =>
      capacityService.updateShift(variables.shiftId, variables.dto),
    onSuccess: (_, { workCenterId }) => {
      queryClient.invalidateQueries({ queryKey: capacityKeys.shifts(workCenterId) });
    },
  });
}

export function useDeleteShift() {
  const queryClient = useQueryClient();
  
  return useMutation({
    mutationFn: (variables: { shiftId: string; workCenterId: string }) =>
      capacityService.deleteShift(variables.shiftId),
    onSuccess: (_, { workCenterId }) => {
      queryClient.invalidateQueries({ queryKey: capacityKeys.shifts(workCenterId) });
    },
  });
}

// ============================================================================
// Utilization & Analysis Hooks
// ============================================================================

export function useCapacityUtilization(params: Parameters<typeof capacityService.getUtilization>[0]) {
  return useQuery({
    queryKey: capacityKeys.utilization(params),
    queryFn: () => capacityService.getUtilization(params),
    enabled: !!params.startDate && !!params.endDate,
  });
}

export function useWorkCenterUtilization(workCenterId: string, params: Parameters<typeof capacityService.getUtilizationByWorkCenter>[1]) {
  return useQuery({
    queryKey: ['capacity', 'utilization', workCenterId, params],
    queryFn: () => capacityService.getUtilizationByWorkCenter(workCenterId, params),
    enabled: !!workCenterId && !!params.startDate && !!params.endDate,
  });
}

export function useCapacityBottlenecks(params: Parameters<typeof capacityService.detectBottlenecks>[0]) {
  return useQuery({
    queryKey: capacityKeys.bottlenecks(params),
    queryFn: () => capacityService.detectBottlenecks(params),
    enabled: !!params.startDate && !!params.endDate,
  });
}

export function useCapacityPlan(workCenterId: string, params: Parameters<typeof capacityService.getCapacityPlan>[1]) {
  return useQuery({
    queryKey: capacityKeys.plan(workCenterId, params),
    queryFn: () => capacityService.getCapacityPlan(workCenterId, params),
    enabled: !!workCenterId && !!params.startDate && !!params.endDate,
  });
}

export function useAggregateCapacityPlan(params: Parameters<typeof capacityService.getAggregateCapacityPlan>[0]) {
  return useQuery({
    queryKey: capacityKeys.aggregatePlan(params),
    queryFn: () => capacityService.getAggregateCapacityPlan(params),
    enabled: !!params.startDate && !!params.endDate,
  });
}

export function useSimulateLoadBalancing() {
  return useMutation({
    mutationFn: (params: Parameters<typeof capacityService.simulateLoadBalancing>[0]) =>
      capacityService.simulateLoadBalancing(params),
  });
}
