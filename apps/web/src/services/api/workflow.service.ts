import { apiClient } from './client';

// ============================================================================
// Types
// ============================================================================

export interface WorkflowTemplate {
  id: string;
  name: string;
  description?: string;
  entityType: 'FORECAST' | 'PLAN' | 'SCENARIO' | 'PURCHASE_ORDER' | 'BOM' | 'PROMOTION';
  thresholdAmount?: number;
  isActive: boolean;
  steps?: WorkflowStep[];
}

export interface WorkflowStep {
  id: string;
  templateId: string;
  stepOrder: number;
  name: string;
  approverType: 'SPECIFIC_USER' | 'ROLE' | 'MANAGER' | 'DEPARTMENT_HEAD';
  approverRole?: string;
  approverId?: string;
  autoApproveBelow?: number;
  timeoutHours?: number;
}

export interface WorkflowInstance {
  id: string;
  templateId: string;
  template?: WorkflowTemplate;
  entityId: string;
  requestedById: string;
  requestedBy?: { id: string; name: string; email: string };
  status: 'PENDING' | 'IN_PROGRESS' | 'APPROVED' | 'REJECTED' | 'CANCELLED';
  currentStep: number;
  totalAmount?: number;
  createdAt: string;
  completedAt?: string;
  actions?: WorkflowAction[];
}

export interface WorkflowAction {
  id: string;
  instanceId: string;
  stepId: string;
  userId: string;
  user?: { id: string; name: string; email: string };
  actionType: 'APPROVE' | 'REJECT' | 'REQUEST_CHANGES' | 'CANCEL' | 'RESUBMIT';
  comments?: string;
  createdAt: string;
}

// ============================================================================
// Workflow Service
// ============================================================================

export const workflowService = {
  // Templates
  async getTemplates(params?: {
    entityType?: string;
    isActive?: boolean;
    page?: number;
    pageSize?: number;
  }) {
    const response = await apiClient.get('/manufacturing/workflows/templates', { params });
    return response.data;
  },

  async getTemplate(templateId: string) {
    const response = await apiClient.get(`/manufacturing/workflows/templates/${templateId}`);
    return response.data;
  },

  async createTemplate(dto: {
    name: string;
    description?: string;
    entityType: string;
    thresholdAmount?: number;
    isActive?: boolean;
    steps?: Array<{
      stepOrder: number;
      name: string;
      approverType: string;
      approverRole?: string;
      approverId?: string;
      autoApproveBelow?: number;
      timeoutHours?: number;
    }>;
  }) {
    const response = await apiClient.post('/manufacturing/workflows/templates', dto);
    return response.data;
  },

  async updateTemplate(templateId: string, dto: Partial<WorkflowTemplate>) {
    const response = await apiClient.put(`/manufacturing/workflows/templates/${templateId}`, dto);
    return response.data;
  },

  async deleteTemplate(templateId: string) {
    await apiClient.delete(`/manufacturing/workflows/templates/${templateId}`);
  },

  // Steps
  async addStep(templateId: string, dto: {
    stepOrder: number;
    name: string;
    approverType: string;
    approverRole?: string;
    approverId?: string;
    autoApproveBelow?: number;
    timeoutHours?: number;
  }) {
    const response = await apiClient.post(`/manufacturing/workflows/templates/${templateId}/steps`, dto);
    return response.data;
  },

  async updateStep(stepId: string, dto: Partial<WorkflowStep>) {
    const response = await apiClient.put(`/manufacturing/workflows/steps/${stepId}`, dto);
    return response.data;
  },

  async deleteStep(stepId: string) {
    await apiClient.delete(`/manufacturing/workflows/steps/${stepId}`);
  },

  // Instances
  async getInstances(params?: {
    status?: string;
    entityType?: string;
    requestedById?: string;
    page?: number;
    pageSize?: number;
  }) {
    const response = await apiClient.get('/manufacturing/workflows/instances', { params });
    return response.data;
  },

  async getInstance(instanceId: string) {
    const response = await apiClient.get(`/manufacturing/workflows/instances/${instanceId}`);
    return response.data;
  },

  async getMyPendingApprovals() {
    const response = await apiClient.get('/manufacturing/workflows/instances/my-pending');
    return response.data;
  },

  async startWorkflow(dto: {
    templateId: string;
    entityId: string;
    totalAmount?: number;
    notes?: string;
  }) {
    const response = await apiClient.post('/manufacturing/workflows/instances', dto);
    return response.data;
  },

  async approveStep(instanceId: string, comments?: string) {
    const response = await apiClient.post(`/manufacturing/workflows/instances/${instanceId}/approve`, { comments });
    return response.data;
  },

  async rejectStep(instanceId: string, comments?: string) {
    const response = await apiClient.post(`/manufacturing/workflows/instances/${instanceId}/reject`, { comments });
    return response.data;
  },

  async requestChanges(instanceId: string, comments?: string) {
    const response = await apiClient.post(`/manufacturing/workflows/instances/${instanceId}/request-changes`, { comments });
    return response.data;
  },

  async cancelWorkflow(instanceId: string, reason?: string) {
    const response = await apiClient.post(`/manufacturing/workflows/instances/${instanceId}/cancel`, { reason });
    return response.data;
  },

  async resubmitWorkflow(instanceId: string, notes?: string) {
    const response = await apiClient.post(`/manufacturing/workflows/instances/${instanceId}/resubmit`, { notes });
    return response.data;
  },

  // Analytics
  async getMetrics(params?: {
    entityType?: string;
    startDate?: string;
    endDate?: string;
  }) {
    const response = await apiClient.get('/manufacturing/workflows/metrics', { params });
    return response.data;
  },

  async getApproverWorkload() {
    const response = await apiClient.get('/manufacturing/workflows/approver-workload');
    return response.data;
  },

  // Aliases for hook compatibility
  async getSteps(templateId: string) {
    const response = await apiClient.get(`/manufacturing/workflows/templates/${templateId}`);
    return response.data.steps || [];
  },

  async toggleTemplateStatus(templateId: string) {
    const response = await apiClient.get(`/manufacturing/workflows/templates/${templateId}`);
    const template = response.data;
    const updated = await apiClient.put(`/manufacturing/workflows/templates/${templateId}`, {
      isActive: !template.isActive,
    });
    return updated.data;
  },

  async createStep(templateId: string, dto: {
    stepOrder: number;
    name: string;
    approverType: string;
    approverRole?: string;
    approverId?: string;
    autoApproveBelow?: number;
    timeoutHours?: number;
  }) {
    const response = await apiClient.post(`/manufacturing/workflows/templates/${templateId}/steps`, dto);
    return response.data;
  },

  async getInstanceActions(instanceId: string) {
    const response = await apiClient.get(`/manufacturing/workflows/instances/${instanceId}`);
    return response.data.actions || [];
  },

  async approve(instanceId: string, dto?: { comments?: string }) {
    const response = await apiClient.post(`/manufacturing/workflows/instances/${instanceId}/approve`, {
      comments: dto?.comments,
    });
    return response.data;
  },

  async reject(instanceId: string, dto?: { comments?: string }) {
    const response = await apiClient.post(`/manufacturing/workflows/instances/${instanceId}/reject`, {
      comments: dto?.comments,
    });
    return response.data;
  },

  async cancel(instanceId: string, reason?: string) {
    const response = await apiClient.post(`/manufacturing/workflows/instances/${instanceId}/cancel`, { reason });
    return response.data;
  },

  async resubmit(instanceId: string, comments?: string) {
    const response = await apiClient.post(`/manufacturing/workflows/instances/${instanceId}/resubmit`, { notes: comments });
    return response.data;
  },
};

export default workflowService;
