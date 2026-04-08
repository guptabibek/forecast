import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { workflowService, WorkflowStep, WorkflowTemplate } from '../services/api/workflow.service';

// ============================================================================
// Query Keys
// ============================================================================

export const workflowKeys = {
  all: ['manufacturing', 'workflow'] as const,
  templates: () => [...workflowKeys.all, 'templates'] as const,
  templateList: (params: Parameters<typeof workflowService.getTemplates>[0]) => [...workflowKeys.templates(), params] as const,
  templateDetail: (id: string) => [...workflowKeys.templates(), 'detail', id] as const,
  templateSteps: (templateId: string) => [...workflowKeys.templates(), 'steps', templateId] as const,
  instances: () => [...workflowKeys.all, 'instances'] as const,
  instanceList: (params: Parameters<typeof workflowService.getInstances>[0]) => [...workflowKeys.instances(), params] as const,
  instanceDetail: (id: string) => [...workflowKeys.instances(), 'detail', id] as const,
  instanceActions: (instanceId: string) => [...workflowKeys.instances(), 'actions', instanceId] as const,
  myPendingApprovals: () => [...workflowKeys.all, 'my-pending-approvals'] as const,
  approverWorkload: () => [...workflowKeys.all, 'approver-workload'] as const,
  metrics: (params: Parameters<typeof workflowService.getMetrics>[0]) => [...workflowKeys.all, 'metrics', params] as const,
};

// ============================================================================
// Template Hooks
// ============================================================================

export function useWorkflowTemplates(params?: Parameters<typeof workflowService.getTemplates>[0]) {
  return useQuery({
    queryKey: workflowKeys.templateList(params),
    queryFn: () => workflowService.getTemplates(params),
  });
}

export function useWorkflowTemplate(templateId: string) {
  return useQuery({
    queryKey: workflowKeys.templateDetail(templateId),
    queryFn: () => workflowService.getTemplate(templateId),
    enabled: !!templateId,
  });
}

export function useTemplateSteps(templateId: string) {
  return useQuery({
    queryKey: workflowKeys.templateSteps(templateId),
    queryFn: () => workflowService.getSteps(templateId),
    enabled: !!templateId,
  });
}

export function useCreateWorkflowTemplate() {
  const queryClient = useQueryClient();
  
  return useMutation({
    mutationFn: (dto: Parameters<typeof workflowService.createTemplate>[0]) =>
      workflowService.createTemplate(dto),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: workflowKeys.templates() });
    },
  });
}

export function useUpdateWorkflowTemplate() {
  const queryClient = useQueryClient();
  
  return useMutation({
    mutationFn: ({ templateId, dto }: { templateId: string; dto: Partial<WorkflowTemplate> }) =>
      workflowService.updateTemplate(templateId, dto),
    onSuccess: (_, { templateId }) => {
      queryClient.invalidateQueries({ queryKey: workflowKeys.templateDetail(templateId) });
      queryClient.invalidateQueries({ queryKey: workflowKeys.templates() });
    },
  });
}

export function useToggleWorkflowTemplateStatus() {
  const queryClient = useQueryClient();
  
  return useMutation({
    mutationFn: (templateId: string) => workflowService.toggleTemplateStatus(templateId),
    onSuccess: (_, templateId) => {
      queryClient.invalidateQueries({ queryKey: workflowKeys.templateDetail(templateId) });
      queryClient.invalidateQueries({ queryKey: workflowKeys.templates() });
    },
  });
}

export function useDeleteWorkflowTemplate() {
  const queryClient = useQueryClient();
  
  return useMutation({
    mutationFn: (templateId: string) => workflowService.deleteTemplate(templateId),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: workflowKeys.templates() });
    },
  });
}

// ============================================================================
// Step Hooks
// ============================================================================

export function useCreateWorkflowStep() {
  const queryClient = useQueryClient();
  
  return useMutation({
    mutationFn: ({ templateId, dto }: { templateId: string; dto: Parameters<typeof workflowService.createStep>[1] }) =>
      workflowService.createStep(templateId, dto),
    onSuccess: (_, { templateId }) => {
      queryClient.invalidateQueries({ queryKey: workflowKeys.templateSteps(templateId) });
      queryClient.invalidateQueries({ queryKey: workflowKeys.templateDetail(templateId) });
    },
  });
}

export function useUpdateWorkflowStep() {
  const queryClient = useQueryClient();
  
  return useMutation({
    mutationFn: (variables: { stepId: string; dto: Partial<WorkflowStep>; templateId: string }) =>
      workflowService.updateStep(variables.stepId, variables.dto),
    onSuccess: (_, { templateId }) => {
      queryClient.invalidateQueries({ queryKey: workflowKeys.templateSteps(templateId) });
      queryClient.invalidateQueries({ queryKey: workflowKeys.templateDetail(templateId) });
    },
  });
}

export function useDeleteWorkflowStep() {
  const queryClient = useQueryClient();
  
  return useMutation({
    mutationFn: (variables: { stepId: string; templateId: string }) =>
      workflowService.deleteStep(variables.stepId),
    onSuccess: (_, { templateId }) => {
      queryClient.invalidateQueries({ queryKey: workflowKeys.templateSteps(templateId) });
      queryClient.invalidateQueries({ queryKey: workflowKeys.templateDetail(templateId) });
    },
  });
}

// ============================================================================
// Instance Hooks
// ============================================================================

export function useWorkflowInstances(params?: Parameters<typeof workflowService.getInstances>[0]) {
  return useQuery({
    queryKey: workflowKeys.instanceList(params),
    queryFn: () => workflowService.getInstances(params),
  });
}

export function useWorkflowInstance(instanceId: string) {
  return useQuery({
    queryKey: workflowKeys.instanceDetail(instanceId),
    queryFn: () => workflowService.getInstance(instanceId),
    enabled: !!instanceId,
  });
}

export function useInstanceActions(instanceId: string) {
  return useQuery({
    queryKey: workflowKeys.instanceActions(instanceId),
    queryFn: () => workflowService.getInstanceActions(instanceId),
    enabled: !!instanceId,
  });
}

export function useMyPendingApprovals() {
  return useQuery({
    queryKey: workflowKeys.myPendingApprovals(),
    queryFn: () => workflowService.getMyPendingApprovals(),
  });
}

export function useStartWorkflow() {
  const queryClient = useQueryClient();
  
  return useMutation({
    mutationFn: (dto: Parameters<typeof workflowService.startWorkflow>[0]) =>
      workflowService.startWorkflow(dto),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: workflowKeys.instances() });
    },
  });
}

export function useApproveWorkflow() {
  const queryClient = useQueryClient();
  
  return useMutation({
    mutationFn: ({ instanceId, dto }: { instanceId: string; dto?: Parameters<typeof workflowService.approve>[1] }) =>
      workflowService.approve(instanceId, dto),
    onSuccess: (_, { instanceId }) => {
      queryClient.invalidateQueries({ queryKey: workflowKeys.instanceDetail(instanceId) });
      queryClient.invalidateQueries({ queryKey: workflowKeys.instances() });
      queryClient.invalidateQueries({ queryKey: workflowKeys.myPendingApprovals() });
    },
  });
}

export function useRejectWorkflow() {
  const queryClient = useQueryClient();
  
  return useMutation({
    mutationFn: ({ instanceId, dto }: { instanceId: string; dto: Parameters<typeof workflowService.reject>[1] }) =>
      workflowService.reject(instanceId, dto),
    onSuccess: (_, { instanceId }) => {
      queryClient.invalidateQueries({ queryKey: workflowKeys.instanceDetail(instanceId) });
      queryClient.invalidateQueries({ queryKey: workflowKeys.instances() });
      queryClient.invalidateQueries({ queryKey: workflowKeys.myPendingApprovals() });
    },
  });
}

export function useRequestChangesWorkflow() {
  const queryClient = useQueryClient();
  
  return useMutation({
    mutationFn: ({ instanceId, dto }: { instanceId: string; dto: Parameters<typeof workflowService.requestChanges>[1] }) =>
      workflowService.requestChanges(instanceId, dto),
    onSuccess: (_, { instanceId }) => {
      queryClient.invalidateQueries({ queryKey: workflowKeys.instanceDetail(instanceId) });
      queryClient.invalidateQueries({ queryKey: workflowKeys.instances() });
      queryClient.invalidateQueries({ queryKey: workflowKeys.myPendingApprovals() });
    },
  });
}

export function useCancelWorkflow() {
  const queryClient = useQueryClient();
  
  return useMutation({
    mutationFn: ({ instanceId, reason }: { instanceId: string; reason?: string }) =>
      workflowService.cancel(instanceId, reason),
    onSuccess: (_, { instanceId }) => {
      queryClient.invalidateQueries({ queryKey: workflowKeys.instanceDetail(instanceId) });
      queryClient.invalidateQueries({ queryKey: workflowKeys.instances() });
    },
  });
}

export function useResubmitWorkflow() {
  const queryClient = useQueryClient();
  
  return useMutation({
    mutationFn: ({ instanceId, comments }: { instanceId: string; comments?: string }) =>
      workflowService.resubmit(instanceId, comments),
    onSuccess: (_, { instanceId }) => {
      queryClient.invalidateQueries({ queryKey: workflowKeys.instanceDetail(instanceId) });
      queryClient.invalidateQueries({ queryKey: workflowKeys.instances() });
      queryClient.invalidateQueries({ queryKey: workflowKeys.myPendingApprovals() });
    },
  });
}

// ============================================================================
// Analytics Hooks
// ============================================================================

export function useApproverWorkload() {
  return useQuery({
    queryKey: workflowKeys.approverWorkload(),
    queryFn: () => workflowService.getApproverWorkload(),
  });
}

export function useWorkflowMetrics(params?: Parameters<typeof workflowService.getMetrics>[0]) {
  return useQuery({
    queryKey: workflowKeys.metrics(params),
    queryFn: () => workflowService.getMetrics(params),
  });
}
