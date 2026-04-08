import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { mrpService, PlannedOrder } from '../services/api/mrp.service';

// ============================================================================
// Query Keys
// ============================================================================

export const mrpKeys = {
  all: ['manufacturing', 'mrp'] as const,
  runs: () => [...mrpKeys.all, 'runs'] as const,
  runList: (params: Parameters<typeof mrpService.getRuns>[0]) => [...mrpKeys.runs(), params] as const,
  runDetail: (id: string) => [...mrpKeys.runs(), 'detail', id] as const,
  plannedOrders: () => [...mrpKeys.all, 'planned-orders'] as const,
  plannedOrderList: (params: Parameters<typeof mrpService.getPlannedOrders>[0]) => [...mrpKeys.plannedOrders(), params] as const,
  plannedOrderDetail: (id: string) => [...mrpKeys.plannedOrders(), 'detail', id] as const,
  exceptions: () => [...mrpKeys.all, 'exceptions'] as const,
  exceptionList: (params: Parameters<typeof mrpService.getExceptions>[0]) => [...mrpKeys.exceptions(), params] as const,
  requirements: (runId: string) => [...mrpKeys.all, 'requirements', runId] as const,
};

// ============================================================================
// MRP Run Hooks
// ============================================================================

export function useMRPRuns(params?: Parameters<typeof mrpService.getRuns>[0]) {
  return useQuery({
    queryKey: mrpKeys.runList(params),
    queryFn: () => mrpService.getRuns(params),
  });
}

export function useMRPRun(runId: string) {
  return useQuery({
    queryKey: mrpKeys.runDetail(runId),
    queryFn: () => mrpService.getRun(runId),
    enabled: !!runId,
  });
}

export function useMRPRunSummary(runId: string) {
  return useQuery({
    queryKey: [...mrpKeys.runDetail(runId), 'summary'],
    queryFn: () => mrpService.getRunSummary(runId),
    enabled: !!runId,
  });
}

export function useRunMRP() {
  const queryClient = useQueryClient();
  
  return useMutation({
    mutationFn: (dto: Parameters<typeof mrpService.runMRP>[0]) => mrpService.runMRP(dto),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: mrpKeys.runs() });
      queryClient.invalidateQueries({ queryKey: mrpKeys.plannedOrders() });
      queryClient.invalidateQueries({ queryKey: mrpKeys.exceptions() });
    },
  });
}

export function useDeleteMRPRun() {
  const queryClient = useQueryClient();
  
  return useMutation({
    mutationFn: (runId: string) => mrpService.deleteRun(runId),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: mrpKeys.runs() });
    },
  });
}

// ============================================================================
// Planned Order Hooks
// ============================================================================

export function usePlannedOrders(params?: Parameters<typeof mrpService.getPlannedOrders>[0]) {
  return useQuery({
    queryKey: mrpKeys.plannedOrderList(params),
    queryFn: () => mrpService.getPlannedOrders(params),
  });
}

export function usePlannedOrder(orderId: string) {
  return useQuery({
    queryKey: mrpKeys.plannedOrderDetail(orderId),
    queryFn: () => mrpService.getPlannedOrder(orderId),
    enabled: !!orderId,
  });
}

export function useCreatePlannedOrder() {
  const queryClient = useQueryClient();
  
  return useMutation({
    mutationFn: (dto: Parameters<typeof mrpService.createPlannedOrder>[0]) =>
      mrpService.createPlannedOrder(dto),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: mrpKeys.plannedOrders() });
    },
  });
}

export function useUpdatePlannedOrder() {
  const queryClient = useQueryClient();
  
  return useMutation({
    mutationFn: ({ orderId, dto }: { orderId: string; dto: Partial<PlannedOrder> }) =>
      mrpService.updatePlannedOrder(orderId, dto),
    onSuccess: (_, { orderId }) => {
      queryClient.invalidateQueries({ queryKey: mrpKeys.plannedOrderDetail(orderId) });
      queryClient.invalidateQueries({ queryKey: mrpKeys.plannedOrders() });
    },
  });
}

export function useFirmPlannedOrder() {
  const queryClient = useQueryClient();
  
  return useMutation({
    mutationFn: (orderId: string) => mrpService.firmPlannedOrder(orderId),
    onSuccess: (_, orderId) => {
      queryClient.invalidateQueries({ queryKey: mrpKeys.plannedOrderDetail(orderId) });
      queryClient.invalidateQueries({ queryKey: mrpKeys.plannedOrders() });
    },
  });
}

export function useReleasePlannedOrder() {
  const queryClient = useQueryClient();
  
  return useMutation({
    mutationFn: (orderId: string) => mrpService.releasePlannedOrder(orderId),
    onSuccess: (_, orderId) => {
      queryClient.invalidateQueries({ queryKey: mrpKeys.plannedOrderDetail(orderId) });
      queryClient.invalidateQueries({ queryKey: mrpKeys.plannedOrders() });
    },
  });
}

export function useCancelPlannedOrder() {
  const queryClient = useQueryClient();
  
  return useMutation({
    mutationFn: (orderId: string) => mrpService.cancelPlannedOrder(orderId),
    onSuccess: (_, orderId) => {
      queryClient.invalidateQueries({ queryKey: mrpKeys.plannedOrderDetail(orderId) });
      queryClient.invalidateQueries({ queryKey: mrpKeys.plannedOrders() });
    },
  });
}

export function useBulkFirmPlannedOrders() {
  const queryClient = useQueryClient();
  
  return useMutation({
    mutationFn: (orderIds: string[]) => mrpService.bulkFirmOrders(orderIds),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: mrpKeys.plannedOrders() });
    },
  });
}

export function useBulkReleasePlannedOrders() {
  const queryClient = useQueryClient();
  
  return useMutation({
    mutationFn: (orderIds: string[]) => mrpService.bulkReleaseOrders(orderIds),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: mrpKeys.plannedOrders() });
    },
  });
}

export function useDeletePlannedOrder() {
  const queryClient = useQueryClient();
  
  return useMutation({
    mutationFn: (orderId: string) => mrpService.deletePlannedOrder(orderId),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: mrpKeys.plannedOrders() });
    },
  });
}

// ============================================================================
// Exception Hooks
// ============================================================================

export function useMRPExceptions(params?: Parameters<typeof mrpService.getExceptions>[0]) {
  return useQuery({
    queryKey: mrpKeys.exceptionList(params),
    queryFn: () => mrpService.getExceptions(params),
  });
}

export function useResolveMRPException() {
  const queryClient = useQueryClient();
  
  return useMutation({
    mutationFn: ({ exceptionId, dto }: { exceptionId: string; dto: Parameters<typeof mrpService.resolveException>[1] }) =>
      mrpService.resolveException(exceptionId, dto),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: mrpKeys.exceptions() });
    },
  });
}

export function useDismissMRPException() {
  const queryClient = useQueryClient();
  
  return useMutation({
    mutationFn: ({ exceptionId, reason }: { exceptionId: string; reason?: string }) =>
      mrpService.dismissException(exceptionId, reason),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: mrpKeys.exceptions() });
    },
  });
}

export function useBulkResolveMRPExceptions() {
  const queryClient = useQueryClient();
  
  return useMutation({
    mutationFn: (dto: Parameters<typeof mrpService.bulkResolveExceptions>[0]) =>
      mrpService.bulkResolveExceptions(dto),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: mrpKeys.exceptions() });
    },
  });
}

// ============================================================================
// Requirement Hooks
// ============================================================================

export function useMRPRequirements(runId: string, params?: Parameters<typeof mrpService.getRequirements>[1]) {
  return useQuery({
    queryKey: [...mrpKeys.requirements(runId), params],
    queryFn: () => mrpService.getRequirements(runId, params),
    enabled: !!runId,
  });
}
