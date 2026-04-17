import { Badge, Button, Card, CardHeader, Column, DataTable, Modal, QueryErrorBanner } from '@components/ui';
import { CheckIcon, EyeIcon, PencilIcon, PlusIcon, TrashIcon, XMarkIcon } from '@heroicons/react/24/outline';
import { workflowService, type WorkflowAction, type WorkflowInstance, type WorkflowStep, type WorkflowTemplate } from '@services/api';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { format } from 'date-fns';
import { useState } from 'react';
import toast from 'react-hot-toast';

const safeFormat = (dateVal: any, fmt: string, fallback = '—') => {
  try {
    if (!dateVal) return fallback;
    const d = new Date(dateVal);
    if (isNaN(d.getTime())) return fallback;
    return format(d, fmt);
  } catch { return fallback; }
};

const ENTITY_TYPES = ['FORECAST', 'PLAN', 'SCENARIO', 'PURCHASE_ORDER', 'BOM', 'PROMOTION'];
const APPROVER_TYPES = ['SPECIFIC_USER', 'ROLE', 'MANAGER', 'DEPARTMENT_HEAD'];
const USER_ROLES = ['ADMIN'];
const statusVariant: Record<string, any> = { PENDING: 'secondary', IN_PROGRESS: 'warning', APPROVED: 'success', REJECTED: 'error', CANCELLED: 'error' };

const emptyTemplate = { name: '', description: '', entityType: 'FORECAST', thresholdAmount: 0, isActive: true };
const emptyStep = { stepOrder: 1, name: '', approverType: 'ROLE', approverRole: '', timeoutHours: 48 };

type Tab = 'templates' | 'instances' | 'pending';

export default function WorkflowPage() {
  const queryClient = useQueryClient();
  const [tab, setTab] = useState<Tab>('templates');
  const [showCreateTemplate, setShowCreateTemplate] = useState(false);
  const [showEditTemplate, setShowEditTemplate] = useState(false);
  const [showTemplateDetail, setShowTemplateDetail] = useState(false);
  const [showAddStep, setShowAddStep] = useState(false);
  const [showInstanceDetail, setShowInstanceDetail] = useState(false);
  const [showActionModal, setShowActionModal] = useState(false);
  const [selectedTemplate, setSelectedTemplate] = useState<WorkflowTemplate | null>(null);
  const [selectedInstance, setSelectedInstance] = useState<WorkflowInstance | null>(null);
  const [actionType, setActionType] = useState<'approve' | 'reject' | 'cancel'>('approve');
  const [actionComments, setActionComments] = useState('');
  const [templateForm, setTemplateForm] = useState<typeof emptyTemplate>(emptyTemplate);
  const [stepForm, setStepForm] = useState<typeof emptyStep>(emptyStep);
  const [statusFilter, setStatusFilter] = useState('');

  // Queries
  const { data: templateData, isLoading: templateLoading, isError: isTemplateError, error: templateError } = useQuery({
    queryKey: ['manufacturing', 'workflow', 'templates'],
    queryFn: () => workflowService.getTemplates({ pageSize: 100 }),
  });

  const { data: instanceData, isLoading: instanceLoading, isError: isInstanceError, error: instanceError } = useQuery({
    queryKey: ['manufacturing', 'workflow', 'instances', statusFilter],
    queryFn: () => workflowService.getInstances({ status: statusFilter || undefined, pageSize: 100 }),
    enabled: tab === 'instances',
  });

  const { data: pendingData, isLoading: pendingLoading, isError: isPendingError, error: pendingError } = useQuery({
    queryKey: ['manufacturing', 'workflow', 'my-pending'],
    queryFn: () => workflowService.getMyPendingApprovals(),
    enabled: tab === 'pending',
  });

  const { data: templateDetail } = useQuery({
    queryKey: ['manufacturing', 'workflow', 'template', selectedTemplate?.id],
    queryFn: () => selectedTemplate ? workflowService.getTemplate(selectedTemplate.id) : null,
    enabled: !!selectedTemplate && showTemplateDetail,
  });

  const { data: instanceDetail } = useQuery({
    queryKey: ['manufacturing', 'workflow', 'instance', selectedInstance?.id],
    queryFn: () => selectedInstance ? workflowService.getInstance(selectedInstance.id) : null,
    enabled: !!selectedInstance && showInstanceDetail,
  });

  const { data: metrics } = useQuery({
    queryKey: ['manufacturing', 'workflow', 'metrics'],
    queryFn: () => workflowService.getMetrics(),
  });

  const templates: WorkflowTemplate[] = Array.isArray(templateData?.items) ? templateData.items : Array.isArray(templateData) ? templateData : [];
  const instances: WorkflowInstance[] = Array.isArray(instanceData?.items) ? instanceData.items : Array.isArray(instanceData) ? instanceData : [];
  const pendingItems: WorkflowInstance[] = Array.isArray(pendingData?.items) ? pendingData.items : Array.isArray(pendingData) ? pendingData : [];
  const steps: WorkflowStep[] = (templateDetail as any)?.steps || [];
  const actions: WorkflowAction[] = (instanceDetail as any)?.actions || [];

  const hasError = isTemplateError || isInstanceError || isPendingError;
  const firstError = templateError || instanceError || pendingError;

  // Mutations
  const createTemplate = useMutation({
    mutationFn: (d: typeof emptyTemplate) => workflowService.createTemplate({
      name: d.name, description: d.description, entityType: d.entityType,
      thresholdAmount: Number(d.thresholdAmount) || undefined, isActive: d.isActive,
    }),
    onSuccess: () => { queryClient.invalidateQueries({ queryKey: ['manufacturing', 'workflow'] }); setShowCreateTemplate(false); setTemplateForm(emptyTemplate); toast.success('Template created'); },
    onError: (err: any) => { toast.error(err?.response?.data?.message || 'Failed to create template'); },
  });

  const updateTemplate = useMutation({
    mutationFn: ({ id, dto }: { id: string; dto: Partial<WorkflowTemplate> }) => workflowService.updateTemplate(id, dto),
    onSuccess: () => { queryClient.invalidateQueries({ queryKey: ['manufacturing', 'workflow'] }); setShowEditTemplate(false); toast.success('Template updated'); },
    onError: (err: any) => { toast.error(err?.response?.data?.message || 'Failed to update template'); },
  });

  const deleteTemplate = useMutation({
    mutationFn: (id: string) => workflowService.deleteTemplate(id),
    onSuccess: () => { queryClient.invalidateQueries({ queryKey: ['manufacturing', 'workflow'] }); toast.success('Template deleted'); },
    onError: (err: any) => { toast.error(err?.response?.data?.message || 'Failed to delete template'); },
  });

  const toggleTemplate = useMutation({
    mutationFn: (id: string) => workflowService.toggleTemplateStatus(id),
    onSuccess: () => { queryClient.invalidateQueries({ queryKey: ['manufacturing', 'workflow'] }); toast.success('Template status toggled'); },
    onError: (err: any) => { toast.error(err?.response?.data?.message || 'Failed to toggle template status'); },
  });

  const addStepMut = useMutation({
    mutationFn: ({ templateId, dto }: { templateId: string; dto: typeof emptyStep }) =>
      workflowService.addStep(templateId, {
        stepOrder: Number(dto.stepOrder), name: dto.name, approverType: dto.approverType,
        approverRole: dto.approverType === 'ROLE' ? dto.approverRole || undefined : undefined,
        timeoutHours: Number(dto.timeoutHours) || undefined,
      }),
    onSuccess: () => { queryClient.invalidateQueries({ queryKey: ['manufacturing', 'workflow'] }); setShowAddStep(false); setStepForm(emptyStep); toast.success('Step added'); },
    onError: (err: any) => { toast.error(err?.response?.data?.message || 'Failed to add step'); },
  });

  const deleteStepMut = useMutation({
    mutationFn: (id: string) => workflowService.deleteStep(id),
    onSuccess: () => { queryClient.invalidateQueries({ queryKey: ['manufacturing', 'workflow'] }); toast.success('Step deleted'); },
    onError: (err: any) => { toast.error(err?.response?.data?.message || 'Failed to delete step'); },
  });

  const approveMut = useMutation({
    mutationFn: ({ id, comments }: { id: string; comments?: string }) => workflowService.approveStep(id, comments),
    onSuccess: () => { queryClient.invalidateQueries({ queryKey: ['manufacturing', 'workflow'] }); setShowActionModal(false); setActionComments(''); toast.success('Approved'); },
    onError: (err: any) => { toast.error(err?.response?.data?.message || 'Failed to approve'); },
  });

  const rejectMut = useMutation({
    mutationFn: ({ id, comments }: { id: string; comments?: string }) => workflowService.rejectStep(id, comments),
    onSuccess: () => { queryClient.invalidateQueries({ queryKey: ['manufacturing', 'workflow'] }); setShowActionModal(false); setActionComments(''); toast.success('Rejected'); },
    onError: (err: any) => { toast.error(err?.response?.data?.message || 'Failed to reject'); },
  });

  const cancelMut = useMutation({
    mutationFn: ({ id, reason }: { id: string; reason?: string }) => workflowService.cancelWorkflow(id, reason),
    onSuccess: () => { queryClient.invalidateQueries({ queryKey: ['manufacturing', 'workflow'] }); setShowActionModal(false); setActionComments(''); toast.success('Workflow cancelled'); },
    onError: (err: any) => { toast.error(err?.response?.data?.message || 'Failed to cancel workflow'); },
  });

  // Template Columns
  const templateColumns: Column<WorkflowTemplate>[] = [
    { key: 'name', header: 'Template', accessor: 'name' },
    { key: 'entityType', header: 'Entity', accessor: 'entityType' },
    { key: 'threshold', header: 'Threshold', accessor: (r) => r.thresholdAmount ? `$${r.thresholdAmount.toLocaleString()}` : '—', align: 'right' },
    { key: 'steps', header: 'Steps', accessor: (r) => r.steps?.length ?? '—', align: 'right' },
    {
      key: 'status', header: 'Status',
      accessor: (r) => <Badge variant={r.isActive ? 'success' : 'secondary'} size="sm">{r.isActive ? 'ACTIVE' : 'INACTIVE'}</Badge>,
    },
    {
      key: 'actions', header: 'Actions',
      accessor: (r) => (
        <div className="flex gap-1">
          <button onClick={() => { setSelectedTemplate(r); setShowTemplateDetail(true); }} className="p-1 text-blue-600 hover:text-blue-800"><EyeIcon className="h-4 w-4" /></button>
          <button onClick={() => {
            setSelectedTemplate(r); setTemplateForm({ name: r.name, description: r.description || '', entityType: r.entityType, thresholdAmount: r.thresholdAmount || 0, isActive: r.isActive });
            setShowEditTemplate(true);
          }} className="p-1 text-amber-600 hover:text-amber-800"><PencilIcon className="h-4 w-4" /></button>
          <button onClick={() => toggleTemplate.mutate(r.id)} className="p-1 text-indigo-600 hover:text-indigo-800">
            <Badge variant={r.isActive ? 'warning' : 'success'} size="sm">{r.isActive ? 'Off' : 'On'}</Badge>
          </button>
          <button onClick={() => { if (confirm('Delete?')) deleteTemplate.mutate(r.id); }} className="p-1 text-red-600 hover:text-red-800"><TrashIcon className="h-4 w-4" /></button>
        </div>
      ),
    },
  ];

  // Instance Columns
  const instanceColumns: Column<WorkflowInstance>[] = [
    { key: 'template', header: 'Template', accessor: (r) => r.template?.name || '—' },
    { key: 'entity', header: 'Entity', accessor: (r) => r.entityId?.substring(0, 8) + '...' },
    { key: 'requestedBy', header: 'Requested By', accessor: (r) => r.requestedBy?.name || '—' },
    { key: 'step', header: 'Step', accessor: (r) => `${r.currentStep} / ${r.template?.steps?.length ?? '?'}`, align: 'right' },
    { key: 'amount', header: 'Amount', accessor: (r) => r.totalAmount ? `$${r.totalAmount.toLocaleString()}` : '—', align: 'right' },
    {
      key: 'status', header: 'Status',
      accessor: (r) => <Badge variant={statusVariant[r.status] || 'secondary'} size="sm">{r.status}</Badge>,
    },
    { key: 'created', header: 'Created', accessor: (r) => safeFormat(r.createdAt, 'MMM d, yyyy') },
    {
      key: 'actions', header: 'Actions',
      accessor: (r) => (
        <div className="flex gap-1">
          <button onClick={() => { setSelectedInstance(r); setShowInstanceDetail(true); }} className="p-1 text-blue-600 hover:text-blue-800"><EyeIcon className="h-4 w-4" /></button>
          {(r.status === 'PENDING' || r.status === 'IN_PROGRESS') && (
            <>
              <button onClick={() => { setSelectedInstance(r); setActionType('approve'); setActionComments(''); setShowActionModal(true); }} className="p-1 text-green-600 hover:text-green-800" title="Approve"><CheckIcon className="h-4 w-4" /></button>
              <button onClick={() => { setSelectedInstance(r); setActionType('reject'); setActionComments(''); setShowActionModal(true); }} className="p-1 text-red-600 hover:text-red-800" title="Reject"><XMarkIcon className="h-4 w-4" /></button>
            </>
          )}
        </div>
      ),
    },
  ];

  const TabBtn = ({ id, label, count }: { id: Tab; label: string; count?: number }) => (
    <button className={`px-4 py-2 text-sm font-medium rounded-t-lg border-b-2 ${tab === id ? 'border-primary-500 text-primary-600 bg-white' : 'border-transparent text-gray-500 hover:text-gray-700'}`} onClick={() => setTab(id)}>
      {label}{count != null && <span className="ml-1 text-xs bg-gray-200 px-1.5 py-0.5 rounded-full">{count}</span>}
    </button>
  );

  return (
    <div className="space-y-6">
      <div className="flex justify-between items-start">
        <div>
          <h1 className="text-2xl font-bold">Workflow & Approvals</h1>
          <p className="text-secondary-500 mt-1">Templates, approval chains, and active workflows</p>
        </div>
        <Button onClick={() => { setTemplateForm(emptyTemplate); setShowCreateTemplate(true); }} leftIcon={<PlusIcon className="h-4 w-4" />}>New Template</Button>
      </div>

      {hasError && <QueryErrorBanner error={firstError} />}

      {/* Metrics */}
      {metrics && (
        <div className="grid grid-cols-4 gap-4">
          {[
            { label: 'Total Pending', val: (metrics as any).totalPending ?? 0 },
            { label: 'Approved (30d)', val: (metrics as any).approved30d ?? 0 },
            { label: 'Rejected (30d)', val: (metrics as any).rejected30d ?? 0 },
            { label: 'Avg Days', val: (metrics as any).avgDaysToApprove?.toFixed(1) ?? '—' },
          ].map((m, i) => (
            <Card key={i}><div className="p-4 text-center"><div className="text-2xl font-bold">{m.val}</div><div className="text-xs text-gray-500">{m.label}</div></div></Card>
          ))}
        </div>
      )}

      <div className="flex gap-1 border-b">
        <TabBtn id="templates" label="Templates" count={templates.length} />
        <TabBtn id="instances" label="All Instances" />
        <TabBtn id="pending" label="My Pending" count={pendingItems.length} />
      </div>

      {tab === 'templates' && (
        <Card>
          <CardHeader title="Workflow Templates" description="Configured approval policies" />
          <DataTable data={templates} columns={templateColumns} keyExtractor={(r) => r.id} isLoading={templateLoading} emptyMessage="No templates" />
        </Card>
      )}

      {tab === 'instances' && (
        <>
          <div className="flex gap-2 items-center">
            <label className="text-sm text-gray-600">Status:</label>
            <select className="rounded-md border-gray-300 shadow-sm text-sm" value={statusFilter} onChange={(e) => setStatusFilter(e.target.value)}>
              <option value="">All</option>
              {['PENDING','IN_PROGRESS','APPROVED','REJECTED','CANCELLED'].map(s => <option key={s} value={s}>{s}</option>)}
            </select>
          </div>
          <Card>
            <CardHeader title="Workflow Instances" description="All approval requests" />
            <DataTable data={instances} columns={instanceColumns} keyExtractor={(r) => r.id} isLoading={instanceLoading} emptyMessage="No instances" />
          </Card>
        </>
      )}

      {tab === 'pending' && (
        <Card>
          <CardHeader title="My Pending Approvals" description="Items awaiting your review" />
          <DataTable data={pendingItems} columns={instanceColumns} keyExtractor={(r) => r.id} isLoading={pendingLoading} emptyMessage="No pending approvals" />
        </Card>
      )}

      {/* Create Template */}
      <Modal isOpen={showCreateTemplate} onClose={() => setShowCreateTemplate(false)} title="Create Workflow Template" size="md">
        <div className="space-y-4">
          <div><label className="block text-sm font-medium text-gray-700 mb-1">Name *</label><input type="text" className="w-full rounded-md border-gray-300 shadow-sm focus:border-primary-500 focus:ring-primary-500" value={templateForm.name} onChange={(e) => setTemplateForm({ ...templateForm, name: e.target.value })} /></div>
          <div><label className="block text-sm font-medium text-gray-700 mb-1">Description</label><textarea className="w-full rounded-md border-gray-300 shadow-sm focus:border-primary-500 focus:ring-primary-500" value={templateForm.description} onChange={(e) => setTemplateForm({ ...templateForm, description: e.target.value })} rows={2} /></div>
          <div className="grid grid-cols-2 gap-4">
            <div><label className="block text-sm font-medium text-gray-700 mb-1">Entity Type *</label><select className="w-full rounded-md border-gray-300 shadow-sm focus:border-primary-500 focus:ring-primary-500" value={templateForm.entityType} onChange={(e) => setTemplateForm({ ...templateForm, entityType: e.target.value })}>{ENTITY_TYPES.map(t => <option key={t} value={t}>{t}</option>)}</select></div>
            <div><label className="block text-sm font-medium text-gray-700 mb-1">Threshold ($)</label><input type="number" className="w-full rounded-md border-gray-300 shadow-sm focus:border-primary-500 focus:ring-primary-500" value={templateForm.thresholdAmount} onChange={(e) => setTemplateForm({ ...templateForm, thresholdAmount: +e.target.value })} /></div>
          </div>
          <div className="flex justify-end gap-3 pt-4 border-t">
            <Button variant="secondary" onClick={() => setShowCreateTemplate(false)}>Cancel</Button>
            <Button onClick={() => createTemplate.mutate(templateForm)} isLoading={createTemplate.isPending} disabled={!templateForm.name}>Create</Button>
          </div>
        </div>
      </Modal>

      {/* Edit Template */}
      <Modal isOpen={showEditTemplate} onClose={() => setShowEditTemplate(false)} title="Edit Template" size="md">
        <div className="space-y-4">
          <div><label className="block text-sm font-medium text-gray-700 mb-1">Name *</label><input type="text" className="w-full rounded-md border-gray-300 shadow-sm focus:border-primary-500 focus:ring-primary-500" value={templateForm.name} onChange={(e) => setTemplateForm({ ...templateForm, name: e.target.value })} /></div>
          <div><label className="block text-sm font-medium text-gray-700 mb-1">Description</label><textarea className="w-full rounded-md border-gray-300 shadow-sm focus:border-primary-500 focus:ring-primary-500" value={templateForm.description} onChange={(e) => setTemplateForm({ ...templateForm, description: e.target.value })} rows={2} /></div>
          <div className="grid grid-cols-2 gap-4">
            <div><label className="block text-sm font-medium text-gray-700 mb-1">Entity Type</label><select className="w-full rounded-md border-gray-300 shadow-sm focus:border-primary-500 focus:ring-primary-500" value={templateForm.entityType} onChange={(e) => setTemplateForm({ ...templateForm, entityType: e.target.value })}>{ENTITY_TYPES.map(t => <option key={t} value={t}>{t}</option>)}</select></div>
            <div><label className="block text-sm font-medium text-gray-700 mb-1">Threshold ($)</label><input type="number" className="w-full rounded-md border-gray-300 shadow-sm focus:border-primary-500 focus:ring-primary-500" value={templateForm.thresholdAmount} onChange={(e) => setTemplateForm({ ...templateForm, thresholdAmount: +e.target.value })} /></div>
          </div>
          <div className="flex justify-end gap-3 pt-4 border-t">
            <Button variant="secondary" onClick={() => setShowEditTemplate(false)}>Cancel</Button>
            <Button onClick={() => selectedTemplate && updateTemplate.mutate({ id: selectedTemplate.id, dto: { name: templateForm.name, description: templateForm.description, entityType: templateForm.entityType as any, thresholdAmount: Number(templateForm.thresholdAmount) } })} isLoading={updateTemplate.isPending}>Save</Button>
          </div>
        </div>
      </Modal>

      {/* Template Detail (with steps) */}
      <Modal isOpen={showTemplateDetail} onClose={() => { setShowTemplateDetail(false); setSelectedTemplate(null); }} title={selectedTemplate ? selectedTemplate.name : 'Template'} size="lg">
        {selectedTemplate && (
          <div className="space-y-6">
            <div className="grid grid-cols-3 gap-4 text-sm">
              <div><span className="font-medium text-gray-500">Entity:</span> {selectedTemplate.entityType}</div>
              <div><span className="font-medium text-gray-500">Threshold:</span> {selectedTemplate.thresholdAmount ? `$${selectedTemplate.thresholdAmount.toLocaleString()}` : '—'}</div>
              <div><span className="font-medium text-gray-500">Status:</span> <Badge variant={selectedTemplate.isActive ? 'success' : 'secondary'} size="sm">{selectedTemplate.isActive ? 'ACTIVE' : 'INACTIVE'}</Badge></div>
            </div>
            {selectedTemplate.description && <p className="text-sm text-gray-600">{selectedTemplate.description}</p>}

            <div>
              <div className="flex justify-between items-center mb-2">
                <h3 className="text-base font-semibold">Approval Steps ({steps.length})</h3>
                <Button size="sm" onClick={() => { setStepForm({ ...emptyStep, stepOrder: steps.length + 1 }); setShowAddStep(true); }} leftIcon={<PlusIcon className="h-3 w-3" />}>Add Step</Button>
              </div>
              <div className="overflow-x-auto">
                <table className="min-w-full text-sm border">
                  <thead className="bg-gray-50"><tr>
                    <th className="px-3 py-2 text-right">#</th><th className="px-3 py-2 text-left">Name</th>
                    <th className="px-3 py-2 text-left">Approver Type</th><th className="px-3 py-2 text-left">Role</th>
                    <th className="px-3 py-2 text-right">Timeout (hrs)</th><th className="px-3 py-2"></th>
                  </tr></thead>
                  <tbody>
                    {steps.length === 0 && <tr><td colSpan={6} className="px-3 py-4 text-center text-gray-400">No steps</td></tr>}
                    {steps.sort((a, b) => a.stepOrder - b.stepOrder).map((s) => (
                      <tr key={s.id} className="border-t">
                        <td className="px-3 py-2 text-right">{s.stepOrder}</td>
                        <td className="px-3 py-2">{s.name}</td>
                        <td className="px-3 py-2">{s.approverType}</td>
                        <td className="px-3 py-2">{s.approverRole || '—'}</td>
                        <td className="px-3 py-2 text-right">{s.timeoutHours ?? '—'}</td>
                        <td className="px-3 py-2"><button onClick={() => { if (confirm('Delete this step?')) deleteStepMut.mutate(s.id); }} className="text-red-600 hover:text-red-800"><TrashIcon className="h-4 w-4" /></button></td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>
          </div>
        )}
      </Modal>

      {/* Add Step */}
      <Modal isOpen={showAddStep} onClose={() => setShowAddStep(false)} title="Add Approval Step" size="md">
        <div className="space-y-4">
          <div className="grid grid-cols-2 gap-4">
            <div><label className="block text-sm font-medium text-gray-700 mb-1">Order #</label><input type="number" className="w-full rounded-md border-gray-300 shadow-sm focus:border-primary-500 focus:ring-primary-500" value={stepForm.stepOrder} onChange={(e) => setStepForm({ ...stepForm, stepOrder: +e.target.value })} /></div>
            <div><label className="block text-sm font-medium text-gray-700 mb-1">Name *</label><input type="text" className="w-full rounded-md border-gray-300 shadow-sm focus:border-primary-500 focus:ring-primary-500" value={stepForm.name} onChange={(e) => setStepForm({ ...stepForm, name: e.target.value })} placeholder="Manager Approval" /></div>
          </div>
          <div className="grid grid-cols-2 gap-4">
            <div><label className="block text-sm font-medium text-gray-700 mb-1">Approver Type *</label><select className="w-full rounded-md border-gray-300 shadow-sm focus:border-primary-500 focus:ring-primary-500" value={stepForm.approverType} onChange={(e) => setStepForm({ ...stepForm, approverType: e.target.value, approverRole: e.target.value === 'ROLE' ? stepForm.approverRole : '' })}>{APPROVER_TYPES.map(t => <option key={t} value={t}>{t}</option>)}</select></div>
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">System Role</label>
              <select className="w-full rounded-md border-gray-300 shadow-sm focus:border-primary-500 focus:ring-primary-500 disabled:bg-gray-50 disabled:text-gray-400" value={stepForm.approverRole} disabled={stepForm.approverType !== 'ROLE'} onChange={(e) => setStepForm({ ...stepForm, approverRole: e.target.value })}>
                <option value="">{stepForm.approverType === 'ROLE' ? 'Select system role...' : 'Select ROLE approver type first'}</option>
                {USER_ROLES.map(r => <option key={r} value={r}>{r}</option>)}
              </select>
              <p className="mt-1 text-xs text-gray-500">Non-admin approvals should use specific-user or manager routing instead of legacy system roles.</p>
            </div>
          </div>
          <div><label className="block text-sm font-medium text-gray-700 mb-1">Timeout (hrs)</label><input type="number" className="w-full rounded-md border-gray-300 shadow-sm focus:border-primary-500 focus:ring-primary-500" value={stepForm.timeoutHours} onChange={(e) => setStepForm({ ...stepForm, timeoutHours: +e.target.value })} /></div>
          <div className="flex justify-end gap-3 pt-4 border-t">
            <Button variant="secondary" onClick={() => setShowAddStep(false)}>Cancel</Button>
            <Button onClick={() => selectedTemplate && addStepMut.mutate({ templateId: selectedTemplate.id, dto: stepForm })} isLoading={addStepMut.isPending} disabled={!stepForm.name}>Add Step</Button>
          </div>
        </div>
      </Modal>

      {/* Instance Detail */}
      <Modal isOpen={showInstanceDetail} onClose={() => { setShowInstanceDetail(false); setSelectedInstance(null); }} title="Workflow Instance" size="lg">
        {selectedInstance && (
          <div className="space-y-6">
            <div className="grid grid-cols-4 gap-4 text-sm">
              <div><span className="font-medium text-gray-500">Template:</span> {selectedInstance.template?.name || '—'}</div>
              <div><span className="font-medium text-gray-500">Status:</span> <Badge variant={statusVariant[selectedInstance.status] || 'secondary'} size="sm">{selectedInstance.status}</Badge></div>
              <div><span className="font-medium text-gray-500">Step:</span> {selectedInstance.currentStep}</div>
              <div><span className="font-medium text-gray-500">Created:</span> {safeFormat(selectedInstance.createdAt, 'MMM d, yyyy')}</div>
            </div>
            <div className="grid grid-cols-3 gap-4 text-sm">
              <div><span className="font-medium text-gray-500">Requested By:</span> {selectedInstance.requestedBy?.name || '—'}</div>
              <div><span className="font-medium text-gray-500">Amount:</span> {selectedInstance.totalAmount ? `$${selectedInstance.totalAmount.toLocaleString()}` : '—'}</div>
              <div><span className="font-medium text-gray-500">Completed:</span> {safeFormat(selectedInstance.completedAt, 'MMM d, yyyy')}</div>
            </div>

            {(selectedInstance.status === 'PENDING' || selectedInstance.status === 'IN_PROGRESS') && (
              <div className="flex gap-2">
                <Button onClick={() => { setActionType('approve'); setActionComments(''); setShowActionModal(true); }} variant="primary" leftIcon={<CheckIcon className="h-4 w-4" />}>Approve</Button>
                <Button onClick={() => { setActionType('reject'); setActionComments(''); setShowActionModal(true); }} variant="secondary" leftIcon={<XMarkIcon className="h-4 w-4" />}>Reject</Button>
                <Button onClick={() => { setActionType('cancel'); setActionComments(''); setShowActionModal(true); }} variant="secondary">Cancel Workflow</Button>
              </div>
            )}

            <div>
              <h3 className="text-base font-semibold mb-2">Action History ({actions.length})</h3>
              <div className="overflow-x-auto">
                <table className="min-w-full text-sm border">
                  <thead className="bg-gray-50"><tr>
                    <th className="px-3 py-2 text-left">Action</th><th className="px-3 py-2 text-left">User</th>
                    <th className="px-3 py-2 text-left">Comments</th><th className="px-3 py-2 text-left">Date</th>
                  </tr></thead>
                  <tbody>
                    {actions.length === 0 && <tr><td colSpan={4} className="px-3 py-4 text-center text-gray-400">No actions yet</td></tr>}
                    {actions.map((a) => (
                      <tr key={a.id} className="border-t">
                        <td className="px-3 py-2"><Badge variant={a.actionType === 'APPROVE' ? 'success' : a.actionType === 'REJECT' ? 'error' : 'secondary'} size="sm">{a.actionType}</Badge></td>
                        <td className="px-3 py-2">{a.user?.name || '—'}</td>
                        <td className="px-3 py-2 max-w-xs truncate">{a.comments || '—'}</td>
                        <td className="px-3 py-2">{safeFormat(a.createdAt, 'MMM d, HH:mm')}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>
          </div>
        )}
      </Modal>

      {/* Approve/Reject/Cancel Action Modal */}
      <Modal isOpen={showActionModal} onClose={() => setShowActionModal(false)} title={actionType === 'approve' ? 'Approve' : actionType === 'reject' ? 'Reject' : 'Cancel Workflow'} size="sm">
        <div className="space-y-4">
          <div><label className="block text-sm font-medium text-gray-700 mb-1">Comments</label><textarea className="w-full rounded-md border-gray-300 shadow-sm focus:border-primary-500 focus:ring-primary-500" value={actionComments} onChange={(e) => setActionComments(e.target.value)} rows={3} placeholder={actionType === 'reject' ? 'Reason for rejection (required)' : 'Optional comments'} /></div>
          <div className="flex justify-end gap-3 pt-4 border-t">
            <Button variant="secondary" onClick={() => setShowActionModal(false)}>Cancel</Button>
            <Button
              variant={actionType === 'approve' ? 'primary' : 'secondary'}
              onClick={() => {
                if (!selectedInstance) return;
                if (actionType === 'approve') approveMut.mutate({ id: selectedInstance.id, comments: actionComments });
                else if (actionType === 'reject') rejectMut.mutate({ id: selectedInstance.id, comments: actionComments });
                else cancelMut.mutate({ id: selectedInstance.id, reason: actionComments });
              }}
              isLoading={approveMut.isPending || rejectMut.isPending || cancelMut.isPending}
              disabled={actionType === 'reject' && !actionComments}
            >
              {actionType === 'approve' ? 'Approve' : actionType === 'reject' ? 'Reject' : 'Cancel Workflow'}
            </Button>
          </div>
        </div>
      </Modal>
    </div>
  );
}
