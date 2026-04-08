import { Badge, Button, Card, CardHeader, Column, ConfirmModal, DataTable, Modal, ProductSelector, QueryErrorBanner } from '@components/ui';
import { CheckIcon, ClockIcon, PlayIcon, PlusIcon, XMarkIcon } from '@heroicons/react/24/outline';
import { useAuth, useConfirmAction } from '@hooks/index';
import { laborEntryService, productionCompletionService, userService, workOrderService, type WorkOrder, type WorkOrderOperation } from '@services/api';
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
  } catch {
    return fallback;
  }
};

const statusVariant: Record<string, 'default' | 'primary' | 'secondary' | 'success' | 'warning' | 'error'> = {
  PLANNED: 'secondary',
  RELEASED: 'primary',
  IN_PROGRESS: 'warning',
  COMPLETED: 'success',
  CANCELLED: 'error',
  PENDING: 'secondary',
};

const priorityLabels: Record<number, string> = {
  1: 'Critical',
  2: 'High',
  3: 'Medium-High',
  4: 'Medium',
  5: 'Normal',
  6: 'Low',
};

export default function WorkOrdersPage() {
  const queryClient = useQueryClient();
  const { canMutate } = useAuth();
  const [showCreateModal, setShowCreateModal] = useState(false);
  const [showCompletionModal, setShowCompletionModal] = useState(false);
  const [showLaborModal, setShowLaborModal] = useState(false);
  const [showDetailModal, setShowDetailModal] = useState(false);
  const [selectedWO, setSelectedWO] = useState<WorkOrder | null>(null);
  const [selectedOperation, setSelectedOperation] = useState<WorkOrderOperation | null>(null);
  const [statusFilter, setStatusFilter] = useState<string>('');
  const [createProductId, setCreateProductId] = useState<string>('');

  const confirmComplete = useConfirmAction({
    title: 'Complete Work Order',
    message: 'This will finalize all costs, release remaining reservations, and close the work order. This action cannot be undone.',
    variant: 'warning',
    confirmText: 'Complete',
  });

  const confirmCancel = useConfirmAction({
    title: 'Cancel Work Order',
    message: 'This will cancel the work order and release all reserved materials. Open material issues will remain on record.',
    variant: 'danger',
    confirmText: 'Cancel Work Order',
  });

  const { data: workOrders, isLoading, isError, error, refetch } = useQuery({
    queryKey: ['manufacturing', 'work-orders', statusFilter],
    queryFn: () => workOrderService.getAll({ status: statusFilter || undefined }),
  });

  const { data: usersData } = useQuery({
    queryKey: ['users'],
    queryFn: () => userService.getAll(),
  });

  const users: any[] = usersData?.data || [];

  const { data: woDetail } = useQuery({
    queryKey: ['manufacturing', 'work-orders', selectedWO?.id],
    queryFn: () => selectedWO ? workOrderService.getById(selectedWO.id) : null,
    enabled: !!selectedWO && showDetailModal,
  });

  const createMutation = useMutation({
    mutationFn: workOrderService.create,
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['manufacturing', 'work-orders'] });
      setShowCreateModal(false);
      setCreateProductId('');
      toast.success('Work order created');
    },
    onError: (err: any) => { toast.error(err?.response?.data?.message || 'Failed to create work order'); },
  });

  const releaseMutation = useMutation({
    mutationFn: (id: string) => workOrderService.release(id),
    onSuccess: () => { queryClient.invalidateQueries({ queryKey: ['manufacturing', 'work-orders'] }); toast.success('Work order released'); },
    onError: (err: any) => { toast.error(err?.response?.data?.message || 'Failed to release work order'); },
  });

  const startMutation = useMutation({
    mutationFn: (id: string) => workOrderService.start(id),
    onSuccess: () => { queryClient.invalidateQueries({ queryKey: ['manufacturing', 'work-orders'] }); toast.success('Work order started'); },
    onError: (err: any) => { toast.error(err?.response?.data?.message || 'Failed to start work order'); },
  });

  const completeMutation = useMutation({
    mutationFn: (id: string) => workOrderService.complete(id),
    onSuccess: () => { queryClient.invalidateQueries({ queryKey: ['manufacturing', 'work-orders'] }); toast.success('Work order completed'); },
    onError: (err: any) => { toast.error(err?.response?.data?.message || 'Failed to complete work order'); },
  });

  const cancelMutation = useMutation({
    mutationFn: ({ id, reason }: { id: string; reason?: string }) => workOrderService.cancel(id, reason),
    onSuccess: () => { queryClient.invalidateQueries({ queryKey: ['manufacturing', 'work-orders'] }); toast.success('Work order cancelled'); },
    onError: (err: any) => { toast.error(err?.response?.data?.message || 'Failed to cancel work order'); },
  });

  const reportCompletionMutation = useMutation({
    mutationFn: productionCompletionService.report,
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['manufacturing', 'work-orders'] });
      setShowCompletionModal(false);
      toast.success('Production completion reported');
    },
    onError: (err: any) => { toast.error(err?.response?.data?.message || 'Failed to report completion'); },
  });

  const recordLaborMutation = useMutation({
    mutationFn: laborEntryService.record,
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['manufacturing', 'work-orders'] });
      setShowLaborModal(false);
      toast.success('Labor recorded');
    },
    onError: (err: any) => { toast.error(err?.response?.data?.message || 'Failed to record labor'); },
  });

  const items: WorkOrder[] = workOrders || [];

  const handleCreate = (e: React.FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    const form = e.currentTarget;
    const formData = new FormData(form);
    createMutation.mutate({
      productId: createProductId,
      quantity: parseInt(formData.get('quantity') as string),
      scheduledStart: formData.get('scheduledStart') as string,
      scheduledEnd: formData.get('scheduledEnd') as string,
      priority: parseInt(formData.get('priority') as string) || 5,
      notes: formData.get('notes') as string || undefined,
    });
  };

  const handleReportCompletion = (e: React.FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    if (!selectedWO) return;
    const form = e.currentTarget;
    const formData = new FormData(form);
    reportCompletionMutation.mutate({
      workOrderId: selectedWO.id,
      quantity: parseInt(formData.get('quantity') as string),
      scrapQuantity: parseInt(formData.get('scrapQuantity') as string) || 0,
      lotNumber: formData.get('lotNumber') as string || undefined,
      notes: formData.get('notes') as string || undefined,
    });
  };

  const handleRecordLabor = (e: React.FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    if (!selectedOperation) return;
    const form = e.currentTarget;
    const formData = new FormData(form);
    recordLaborMutation.mutate({
      operationId: selectedOperation.id,
      laborType: formData.get('laborType') as 'SETUP' | 'RUN' | 'TEARDOWN' | 'REWORK',
      startTime: formData.get('startTime') as string,
      endTime: formData.get('endTime') as string,
      employeeId: formData.get('employeeId') as string || undefined,
      notes: formData.get('notes') as string || undefined,
    });
  };

  const handleCancel = (wo: WorkOrder) => {
    confirmCancel.confirm(() => cancelMutation.mutateAsync({ id: wo.id }));
  };

  const getProgress = (wo: WorkOrder) => {
    if (wo.quantity === 0) return 0;
    return Math.round((wo.completedQuantity / wo.quantity) * 100);
  };

  const columns: Column<WorkOrder>[] = [
    {
      key: 'woNumber',
      header: 'Work Order',
      accessor: (row) => (
        <div>
          <div className="font-medium">{row.woNumber}</div>
          <div className="text-xs text-secondary-500">Priority: {priorityLabels[row.priority] || row.priority}</div>
        </div>
      ),
    },
    {
      key: 'product',
      header: 'Product',
      accessor: (row) => (
        <div>
          <div>{row.product?.name || '—'}</div>
          <div className="text-xs text-secondary-500">{row.product?.sku}</div>
        </div>
      ),
    },
    {
      key: 'quantity',
      header: 'Qty',
      accessor: (row) => (
        <div className="text-right">
          <div>{row.completedQuantity} / {row.quantity}</div>
          <div className="w-full bg-gray-200 rounded-full h-1.5 mt-1">
            <div 
              className="bg-primary-500 h-1.5 rounded-full" 
              style={{ width: `${getProgress(row)}%` }}
            />
          </div>
        </div>
      ),
      align: 'right',
    },
    {
      key: 'status',
      header: 'Status',
      accessor: (row) => (
        <Badge variant={statusVariant[row.status] || 'default'} size="sm">
          {row.status.replace('_', ' ')}
        </Badge>
      ),
    },
    {
      key: 'schedule',
      header: 'Schedule',
      accessor: (row) => (
        <div className="text-sm">
          <div>Start: {safeFormat(row.scheduledStart, 'MMM dd')}</div>
          <div>End: {safeFormat(row.scheduledEnd, 'MMM dd')}</div>
        </div>
      ),
    },
    {
      key: 'actions',
      header: 'Actions',
      accessor: (row) => (
        <div className="flex gap-1">
          {canMutate && row.status === 'PLANNED' && (
            <button
              onClick={(e) => { e.stopPropagation(); releaseMutation.mutate(row.id); }}
              className="p-1 hover:bg-blue-100 text-blue-600 rounded"
              title="Release"
            >
              <PlayIcon className="w-4 h-4" />
            </button>
          )}
          {canMutate && row.status === 'RELEASED' && (
            <button
              onClick={(e) => { e.stopPropagation(); startMutation.mutate(row.id); }}
              className="p-1 hover:bg-green-100 text-green-600 rounded"
              title="Start"
            >
              <PlayIcon className="w-4 h-4" />
            </button>
          )}
          {row.status === 'IN_PROGRESS' && (
            <>
              {canMutate && (
                <button
                  onClick={(e) => { e.stopPropagation(); setSelectedWO(row); setShowCompletionModal(true); }}
                  className="p-1 hover:bg-green-100 text-green-600 rounded"
                  title="Report Completion"
                >
                  <CheckIcon className="w-4 h-4" />
                </button>
              )}
              {canMutate && (
                <button
                  onClick={(e) => { e.stopPropagation(); confirmComplete.confirm(() => completeMutation.mutateAsync(row.id)); }}
                  className="p-1 hover:bg-primary-100 text-primary-600 rounded text-xs"
                  title="Complete WO"
                >
                  Done
                </button>
              )}
              <button
                onClick={(e) => { e.stopPropagation(); setSelectedWO(row); setShowDetailModal(true); }}
                className="p-1 hover:bg-blue-100 text-blue-600 rounded"
                title="View Details"
              >
                <ClockIcon className="w-4 h-4" />
              </button>
            </>
          )}
          {canMutate && (row.status === 'PLANNED' || row.status === 'RELEASED') && (
            <button
              onClick={(e) => { e.stopPropagation(); handleCancel(row); }}
              className="p-1 hover:bg-red-100 text-red-600 rounded"
              title="Cancel"
            >
              <XMarkIcon className="w-4 h-4" />
            </button>
          )}
        </div>
      ),
    },
  ];

  return (
    <div className="space-y-6">
      <div className="flex justify-between items-start">
        <div>
          <h1 className="text-2xl font-bold">Work Orders</h1>
          <p className="text-secondary-500 mt-1">Manage production work orders and shop floor execution</p>
        </div>
        {canMutate && (
          <Button onClick={() => setShowCreateModal(true)}>
            <PlusIcon className="w-4 h-4 mr-2" />
            Create Work Order
          </Button>
        )}
      </div>

      {isError && <QueryErrorBanner error={error} onRetry={() => refetch()} />}

      {/* Status Summary Cards */}
      <div className="grid grid-cols-5 gap-4">
        {['PLANNED', 'RELEASED', 'IN_PROGRESS', 'COMPLETED', 'CANCELLED'].map(status => {
          const count = items.filter(wo => wo.status === status).length;
          return (
            <div 
              key={status} 
              className={`cursor-pointer transition-all rounded-lg border bg-white dark:bg-gray-800 ${statusFilter === status ? 'ring-2 ring-primary-500' : ''}`}
              onClick={() => setStatusFilter(statusFilter === status ? '' : status)}
            >
              <div className="p-4 text-center">
                <div className="text-2xl font-bold">{count}</div>
                <div className="text-sm text-secondary-500">{status.replace('_', ' ')}</div>
              </div>
            </div>
          );
        })}
      </div>

      <Card>
        <CardHeader
          title="Work Orders"
          description="All work orders for production"
          actions={
            statusFilter ? (
              <Button variant="secondary" size="sm" onClick={() => setStatusFilter('')}>
                Clear Filter
              </Button>
            ) : undefined
          }
        />
        <DataTable
          data={items}
          columns={columns}
          keyExtractor={(row) => row.id}
          isLoading={isLoading}
          emptyMessage="No work orders found"
          onRowClick={(row) => { setSelectedWO(row); setShowDetailModal(true); }}
        />
      </Card>

      {/* Create Work Order Modal */}
      <Modal
        isOpen={showCreateModal}
        onClose={() => setShowCreateModal(false)}
        title="Create Work Order"
      >
        <form onSubmit={handleCreate} className="space-y-4">
          <div>
            <label className="block text-sm font-medium mb-1">Product</label>
            <ProductSelector value={createProductId || undefined} onChange={(id) => setCreateProductId(id)} />
          </div>
          <div className="grid grid-cols-2 gap-4">
            <div>
              <label className="block text-sm font-medium mb-1">Quantity</label>
              <input name="quantity" type="number" min="1" required className="w-full px-3 py-2 border rounded-md dark:bg-gray-800 dark:border-gray-700" />
            </div>
            <div>
              <label className="block text-sm font-medium mb-1">Priority</label>
              <select name="priority" className="w-full px-3 py-2 border rounded-md dark:bg-gray-800 dark:border-gray-700">
                <option value="1">1 - Critical</option>
                <option value="2">2 - High</option>
                <option value="3">3 - Medium-High</option>
                <option value="4">4 - Medium</option>
                <option value="5" selected>5 - Normal</option>
                <option value="6">6 - Low</option>
              </select>
            </div>
          </div>
          <div className="grid grid-cols-2 gap-4">
            <div>
              <label className="block text-sm font-medium mb-1">Scheduled Start</label>
              <input name="scheduledStart" type="datetime-local" required className="w-full px-3 py-2 border rounded-md dark:bg-gray-800 dark:border-gray-700" />
            </div>
            <div>
              <label className="block text-sm font-medium mb-1">Scheduled End</label>
              <input name="scheduledEnd" type="datetime-local" required className="w-full px-3 py-2 border rounded-md dark:bg-gray-800 dark:border-gray-700" />
            </div>
          </div>
          <div>
            <label className="block text-sm font-medium mb-1">Notes</label>
            <textarea name="notes" rows={2} className="w-full px-3 py-2 border rounded-md dark:bg-gray-800 dark:border-gray-700" />
          </div>
          <div className="flex justify-end gap-2 pt-4">
            <Button variant="secondary" type="button" onClick={() => setShowCreateModal(false)}>Cancel</Button>
            <Button type="submit" isLoading={createMutation.isPending}>Create</Button>
          </div>
        </form>
      </Modal>

      {/* Report Completion Modal */}
      <Modal
        isOpen={showCompletionModal}
        onClose={() => setShowCompletionModal(false)}
        title={`Report Completion: ${selectedWO?.woNumber}`}
      >
        <form onSubmit={handleReportCompletion} className="space-y-4">
          <div className="bg-gray-50 dark:bg-gray-800 p-3 rounded-md">
            <div className="text-sm">
              <span className="text-secondary-500">Remaining: </span>
              <span className="font-medium">{selectedWO ? selectedWO.quantity - selectedWO.completedQuantity : 0} units</span>
            </div>
          </div>
          <div className="grid grid-cols-2 gap-4">
            <div>
              <label className="block text-sm font-medium mb-1">Completed Quantity</label>
              <input 
                name="quantity" 
                type="number" 
                min="1" 
                max={selectedWO ? selectedWO.quantity - selectedWO.completedQuantity : undefined}
                required 
                className="w-full px-3 py-2 border rounded-md dark:bg-gray-800 dark:border-gray-700" 
              />
            </div>
            <div>
              <label className="block text-sm font-medium mb-1">Scrap Quantity</label>
              <input name="scrapQuantity" type="number" min="0" defaultValue="0" className="w-full px-3 py-2 border rounded-md dark:bg-gray-800 dark:border-gray-700" />
            </div>
          </div>
          <div>
            <label className="block text-sm font-medium mb-1">Lot Number (optional)</label>
            <input name="lotNumber" type="text" className="w-full px-3 py-2 border rounded-md dark:bg-gray-800 dark:border-gray-700" />
          </div>
          <div>
            <label className="block text-sm font-medium mb-1">Notes</label>
            <textarea name="notes" rows={2} className="w-full px-3 py-2 border rounded-md dark:bg-gray-800 dark:border-gray-700" />
          </div>
          <div className="flex justify-end gap-2 pt-4">
            <Button variant="secondary" type="button" onClick={() => setShowCompletionModal(false)}>Cancel</Button>
            <Button type="submit" isLoading={reportCompletionMutation.isPending}>Report</Button>
          </div>
        </form>
      </Modal>

      {/* Work Order Detail Modal */}
      <Modal
        isOpen={showDetailModal}
        onClose={() => setShowDetailModal(false)}
        title={`Work Order Details: ${selectedWO?.woNumber}`}
        size="xl"
      >
        {woDetail && (
          <div className="space-y-6">
            <div className="grid grid-cols-3 gap-4">
              <div>
                <div className="text-sm text-secondary-500">Product</div>
                <div className="font-medium">{woDetail.product?.name}</div>
              </div>
              <div>
                <div className="text-sm text-secondary-500">Status</div>
                <Badge variant={statusVariant[woDetail.status]} size="sm">{woDetail.status}</Badge>
              </div>
              <div>
                <div className="text-sm text-secondary-500">Progress</div>
                <div className="font-medium">{woDetail.completedQuantity} / {woDetail.quantity}</div>
              </div>
            </div>

            <div>
              <h4 className="font-medium mb-2">Operations</h4>
              <table className="w-full text-sm">
                <thead>
                  <tr className="text-left border-b dark:border-gray-700">
                    <th className="pb-2">Seq</th>
                    <th className="pb-2">Operation</th>
                    <th className="pb-2">Work Center</th>
                    <th className="pb-2">Status</th>
                    <th className="pb-2">Planned Time</th>
                    <th className="pb-2">Actual Time</th>
                    <th className="pb-2">Actions</th>
                  </tr>
                </thead>
                <tbody>
                  {woDetail.operations?.map((op: WorkOrderOperation) => (
                    <tr key={op.id} className="border-b dark:border-gray-700">
                      <td className="py-2">{op.sequence}</td>
                      <td className="py-2">{op.operationName}</td>
                      <td className="py-2">{op.workCenter?.name || '—'}</td>
                      <td className="py-2">
                        <Badge variant={statusVariant[op.status]} size="sm">{op.status}</Badge>
                      </td>
                      <td className="py-2">{op.plannedSetupTime + op.plannedRunTime}h</td>
                      <td className="py-2">{(op.actualSetupTime || 0) + (op.actualRunTime || 0)}h</td>
                      <td className="py-2">
                        <button
                          onClick={() => { setSelectedOperation(op); setShowLaborModal(true); }}
                          className="text-xs text-primary-600 hover:underline"
                        >
                          Log Time
                        </button>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>

            <div>
              <h4 className="font-medium mb-2">Material Issues</h4>
              {woDetail.materialIssues && woDetail.materialIssues.length > 0 ? (
                <table className="w-full text-sm">
                  <thead>
                    <tr className="text-left border-b dark:border-gray-700">
                      <th className="pb-2">Material</th>
                      <th className="pb-2 text-right">Quantity</th>
                      <th className="pb-2">Date</th>
                      <th className="pb-2">Lot</th>
                    </tr>
                  </thead>
                  <tbody>
                    {woDetail.materialIssues.map((issue: any) => (
                      <tr key={issue.id} className="border-b dark:border-gray-700">
                        <td className="py-2">{issue.product?.name}</td>
                        <td className="py-2 text-right">{issue.quantity}</td>
                        <td className="py-2">{safeFormat(issue.issueDate, 'MMM dd, HH:mm')}</td>
                        <td className="py-2">{issue.lotNumber || '—'}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              ) : (
                <p className="text-sm text-secondary-500">No materials issued yet</p>
              )}
            </div>
          </div>
        )}
      </Modal>

      {/* Record Labor Modal */}
      <Modal
        isOpen={showLaborModal}
        onClose={() => setShowLaborModal(false)}
        title={`Record Labor: ${selectedOperation?.operationName}`}
      >
        <form onSubmit={handleRecordLabor} className="space-y-4">
          <div>
            <label className="block text-sm font-medium mb-1">Labor Type</label>
            <select name="laborType" required className="w-full px-3 py-2 border rounded-md dark:bg-gray-800 dark:border-gray-700">
              <option value="SETUP">Setup</option>
              <option value="RUN">Run</option>
              <option value="TEARDOWN">Teardown</option>
              <option value="REWORK">Rework</option>
            </select>
          </div>
          <div className="grid grid-cols-2 gap-4">
            <div>
              <label className="block text-sm font-medium mb-1">Start Time</label>
              <input name="startTime" type="datetime-local" required className="w-full px-3 py-2 border rounded-md dark:bg-gray-800 dark:border-gray-700" />
            </div>
            <div>
              <label className="block text-sm font-medium mb-1">End Time</label>
              <input name="endTime" type="datetime-local" required className="w-full px-3 py-2 border rounded-md dark:bg-gray-800 dark:border-gray-700" />
            </div>
          </div>
          <div>
            <label className="block text-sm font-medium mb-1">Employee (optional)</label>
            <select name="employeeId" className="w-full px-3 py-2 border rounded-md dark:bg-gray-800 dark:border-gray-700">
              <option value="">Select employee...</option>
              {users.map((u: any) => (
                <option key={u.id} value={u.id}>{u.name || u.email}</option>
              ))}
            </select>
          </div>
          <div>
            <label className="block text-sm font-medium mb-1">Notes</label>
            <textarea name="notes" rows={2} className="w-full px-3 py-2 border rounded-md dark:bg-gray-800 dark:border-gray-700" />
          </div>
          <div className="flex justify-end gap-2 pt-4">
            <Button variant="secondary" type="button" onClick={() => setShowLaborModal(false)}>Cancel</Button>
            <Button type="submit" isLoading={recordLaborMutation.isPending}>Record</Button>
          </div>
        </form>
      </Modal>

      {/* Confirmation Dialogs */}
      <ConfirmModal {...confirmComplete.confirmProps} />
      <ConfirmModal {...confirmCancel.confirmProps} />
    </div>
  );
}
