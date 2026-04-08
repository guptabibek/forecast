import { Badge, Button, Card, CardHeader, Column, DataTable, Modal, QueryErrorBanner } from '@components/ui';
import { PlayIcon } from '@heroicons/react/24/outline';
import { mrpService, type MRPException, type MRPRun, type PlannedOrder } from '@services/api';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { format } from 'date-fns';
import { useState } from 'react';
import toast from 'react-hot-toast';

const statusVariant: Record<string, 'default' | 'primary' | 'secondary' | 'success' | 'warning' | 'error'> = {
  PENDING: 'warning',
  RUNNING: 'primary',
  COMPLETED: 'success',
  FAILED: 'error',
  PLANNED: 'secondary',
  FIRMED: 'primary',
  RELEASED: 'success',
  CANCELLED: 'error',
  OPEN: 'warning',
  ACKNOWLEDGED: 'primary',
  RESOLVED: 'success',
  IGNORED: 'secondary',
};

export default function MRPPage() {
  const queryClient = useQueryClient();
  const [isModalOpen, setIsModalOpen] = useState(false);
  const [runConfig, setRunConfig] = useState({
    name: `MRP Run ${format(new Date(), 'yyyy-MM-dd HH:mm')}`,
    planningHorizonDays: 90,
    frozenPeriodDays: 7,
    respectLeadTime: true,
    considerSafetyStock: true,
  });

  const { data: runsData, isLoading: runsLoading, isError: isRunsError, error: runsError } = useQuery({
    queryKey: ['manufacturing', 'mrp', 'runs'],
    queryFn: () => mrpService.getAllRuns({ pageSize: 20 }),
  });

  const { data: ordersData, isLoading: ordersLoading, isError: isOrdersError, error: ordersError } = useQuery({
    queryKey: ['manufacturing', 'mrp', 'planned-orders'],
    queryFn: () => mrpService.getPlannedOrders({ pageSize: 20 }),
  });

  const { data: exceptionsData, isLoading: exceptionsLoading, isError: isExceptionsError, error: exceptionsError } = useQuery({
    queryKey: ['manufacturing', 'mrp', 'exceptions'],
    queryFn: () => mrpService.getExceptions({ pageSize: 20 }),
  });

  const createAndExecuteMutation = useMutation({
    mutationFn: async (config: typeof runConfig) => {
      // Create the run
      const run = await mrpService.createRun({
        name: config.name,
        planningHorizonDays: config.planningHorizonDays,
        frozenPeriodDays: config.frozenPeriodDays,
        respectLeadTime: config.respectLeadTime,
        considerSafetyStock: config.considerSafetyStock,
      });
      // Execute the run
      const result = await mrpService.executeRun(run.id);
      return result;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['manufacturing', 'mrp'] });
      setIsModalOpen(false);
      setRunConfig({
        name: `MRP Run ${format(new Date(), 'yyyy-MM-dd HH:mm')}`,
        planningHorizonDays: 90,
        frozenPeriodDays: 7,
        respectLeadTime: true,
        considerSafetyStock: true,
      });
      toast.success('MRP run completed successfully');
    },
    onError: (err: any) => { toast.error(err?.response?.data?.message || 'MRP run failed'); },
  });

  const runs: MRPRun[] = Array.isArray(runsData?.items) ? runsData.items : Array.isArray(runsData) ? runsData : [];
  const orders: PlannedOrder[] = Array.isArray(ordersData?.items) ? ordersData.items : Array.isArray(ordersData) ? ordersData : [];
  const exceptions: MRPException[] = Array.isArray(exceptionsData?.items) ? exceptionsData.items : Array.isArray(exceptionsData) ? exceptionsData : [];

  const hasError = isRunsError || isOrdersError || isExceptionsError;
  const firstError = runsError || ordersError || exceptionsError;

  const runColumns: Column<MRPRun>[] = [
    { key: 'name', header: 'Run', accessor: 'name' },
    { key: 'runType', header: 'Type', accessor: 'runType' },
    {
      key: 'status',
      header: 'Status',
      accessor: (row) => (
        <Badge variant={statusVariant[row.status] || 'default'} size="sm">
          {row.status}
        </Badge>
      ),
    },
    {
      key: 'startedAt',
      header: 'Started',
      accessor: (row) => row.startedAt ? format(new Date(row.startedAt), 'yyyy-MM-dd HH:mm') : '—',
    },
  ];

  const orderColumns: Column<PlannedOrder>[] = [
    { key: 'product', header: 'Product', accessor: (row) => row.product?.name || row.product?.sku || '—' },
    { key: 'orderType', header: 'Type', accessor: 'orderType' },
    {
      key: 'status',
      header: 'Status',
      accessor: (row) => (
        <Badge variant={statusVariant[row.status] || 'default'} size="sm">
          {row.status}
        </Badge>
      ),
    },
    {
      key: 'dueDate',
      header: 'Due Date',
      accessor: (row) => row.dueDate ? format(new Date(row.dueDate), 'yyyy-MM-dd') : '—',
    },
    {
      key: 'quantity',
      header: 'Qty',
      accessor: (row) => row.quantity,
      align: 'right',
    },
  ];

  const exceptionColumns: Column<MRPException>[] = [
    { key: 'exceptionType', header: 'Type', accessor: 'exceptionType' },
    { key: 'severity', header: 'Severity', accessor: 'severity' },
    {
      key: 'status',
      header: 'Status',
      accessor: (row) => (
        <Badge variant={statusVariant[row.status] || 'default'} size="sm">
          {row.status}
        </Badge>
      ),
    },
    { key: 'message', header: 'Message', accessor: 'message' },
  ];

  return (
    <div className="space-y-6">
      <div className="flex justify-between items-start">
        <div>
          <h1 className="text-2xl font-bold">MRP</h1>
          <p className="text-secondary-500 mt-1">Runs, planned orders, and exception handling</p>
        </div>
        <Button
          onClick={() => setIsModalOpen(true)}
          leftIcon={<PlayIcon className="h-4 w-4" />}
        >
          Run MRP
        </Button>
      </div>

      {hasError && <QueryErrorBanner error={firstError} />}

      {/* Run MRP Modal */}
      <Modal
        isOpen={isModalOpen}
        onClose={() => setIsModalOpen(false)}
        title="Run MRP"
        size="lg"
      >
        <div className="space-y-4">
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">
              Run Name
            </label>
            <input
              type="text"
              className="w-full rounded-md border-gray-300 shadow-sm focus:border-primary-500 focus:ring-primary-500"
              value={runConfig.name}
              onChange={(e) => setRunConfig({ ...runConfig, name: e.target.value })}
            />
          </div>
          <div className="grid grid-cols-2 gap-4">
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">
                Planning Horizon (days)
              </label>
              <input
                type="number"
                className="w-full rounded-md border-gray-300 shadow-sm focus:border-primary-500 focus:ring-primary-500"
                value={runConfig.planningHorizonDays}
                onChange={(e) => setRunConfig({ ...runConfig, planningHorizonDays: parseInt(e.target.value) || 90 })}
              />
            </div>
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">
                Frozen Period (days)
              </label>
              <input
                type="number"
                className="w-full rounded-md border-gray-300 shadow-sm focus:border-primary-500 focus:ring-primary-500"
                value={runConfig.frozenPeriodDays}
                onChange={(e) => setRunConfig({ ...runConfig, frozenPeriodDays: parseInt(e.target.value) || 0 })}
              />
            </div>
          </div>
          <div className="space-y-2">
            <label className="flex items-center">
              <input
                type="checkbox"
                className="rounded border-gray-300 text-primary-600 focus:ring-primary-500"
                checked={runConfig.respectLeadTime}
                onChange={(e) => setRunConfig({ ...runConfig, respectLeadTime: e.target.checked })}
              />
              <span className="ml-2 text-sm text-gray-700">Respect lead times</span>
            </label>
            <label className="flex items-center">
              <input
                type="checkbox"
                className="rounded border-gray-300 text-primary-600 focus:ring-primary-500"
                checked={runConfig.considerSafetyStock}
                onChange={(e) => setRunConfig({ ...runConfig, considerSafetyStock: e.target.checked })}
              />
              <span className="ml-2 text-sm text-gray-700">Consider safety stock</span>
            </label>
          </div>
          <div className="flex justify-end gap-3 pt-4 border-t">
            <Button variant="secondary" onClick={() => setIsModalOpen(false)}>
              Cancel
            </Button>
            <Button
              onClick={() => createAndExecuteMutation.mutate(runConfig)}
              isLoading={createAndExecuteMutation.isPending}
              leftIcon={<PlayIcon className="h-4 w-4" />}
            >
              Run MRP
            </Button>
          </div>
        </div>
      </Modal>

      <Card>
        <CardHeader title="MRP Runs" description="Latest planning runs" />
        <DataTable
          data={runs}
          columns={runColumns}
          keyExtractor={(row) => row.id}
          isLoading={runsLoading}
          emptyMessage="No MRP runs found"
        />
      </Card>

      <Card>
        <CardHeader title="Planned Orders" description="Recommended supply and production orders" />
        <DataTable
          data={orders}
          columns={orderColumns}
          keyExtractor={(row) => row.id}
          isLoading={ordersLoading}
          emptyMessage="No planned orders found"
        />
      </Card>

      <Card>
        <CardHeader title="Exceptions" description="Shortages, delays, and critical actions" />
        <DataTable
          data={exceptions}
          columns={exceptionColumns}
          keyExtractor={(row) => row.id}
          isLoading={exceptionsLoading}
          emptyMessage="No exceptions found"
        />
      </Card>
    </div>
  );
}
