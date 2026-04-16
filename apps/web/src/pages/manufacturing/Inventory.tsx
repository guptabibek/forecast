import { Badge, Button, Card, CardHeader, Column, DataTable, Modal, ProductSelector, QueryErrorBanner } from '@components/ui';
import { AdjustmentsHorizontalIcon, ArrowDownTrayIcon, ArrowsRightLeftIcon, ArrowUpTrayIcon, PlusIcon } from '@heroicons/react/24/outline';
import { dataService, inventoryService, inventoryTransactionService, type InventoryLevel, type InventoryPolicy, type InventoryTransaction } from '@services/api';
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

const transactionTypeIcons: Record<string, React.ReactNode> = {
  RECEIPT: <ArrowDownTrayIcon className="w-4 h-4 text-green-600" />,
  ISSUE: <ArrowUpTrayIcon className="w-4 h-4 text-red-600" />,
  TRANSFER: <ArrowsRightLeftIcon className="w-4 h-4 text-blue-600" />,
  ADJUSTMENT_IN: <AdjustmentsHorizontalIcon className="w-4 h-4 text-emerald-600" />,
  ADJUSTMENT_OUT: <AdjustmentsHorizontalIcon className="w-4 h-4 text-orange-600" />,
  PRODUCTION_RECEIPT: <PlusIcon className="w-4 h-4 text-green-600" />,
  PRODUCTION_ISSUE: <ArrowUpTrayIcon className="w-4 h-4 text-red-600" />,
  SCRAP: <ArrowUpTrayIcon className="w-4 h-4 text-red-600" />,
  RETURN: <ArrowDownTrayIcon className="w-4 h-4 text-blue-600" />,
};

const transactionTypeVariant: Record<string, 'default' | 'primary' | 'secondary' | 'success' | 'warning' | 'error'> = {
  RECEIPT: 'success',
  ISSUE: 'error',
  TRANSFER: 'primary',
  ADJUSTMENT_IN: 'success',
  ADJUSTMENT_OUT: 'warning',
  PRODUCTION_RECEIPT: 'success',
  PRODUCTION_ISSUE: 'error',
  SCRAP: 'error',
  RETURN: 'primary',
};

const formatTransactionTypeLabel = (transactionType: string) =>
  transactionType
    .toLowerCase()
    .split('_')
    .map((segment) => segment.charAt(0).toUpperCase() + segment.slice(1))
    .join(' ');

const getSignedQuantity = (transaction: InventoryTransaction) => {
  if (typeof transaction.signedQuantity === 'number') {
    return transaction.signedQuantity;
  }

  if (['ISSUE', 'ADJUSTMENT_OUT', 'SCRAP', 'PRODUCTION_ISSUE'].includes(transaction.transactionType)) {
    return -Math.abs(Number(transaction.quantity || 0));
  }

  return Number(transaction.quantity || 0);
};

const getMovementRoute = (transaction: InventoryTransaction) => {
  const from = transaction.location?.name || transaction.location?.code;
  const to = transaction.toLocation?.name || transaction.toLocation?.code;

  if (from && to) {
    return `${from} -> ${to}`;
  }

  return from || to || '—';
};

export default function InventoryPage() {
  const queryClient = useQueryClient();
  const [activeTab, setActiveTab] = useState<'levels' | 'policies' | 'transactions'>('levels');
  const [showAdjustModal, setShowAdjustModal] = useState(false);
  const [showTransferModal, setShowTransferModal] = useState(false);
  const [transactionFilter, setTransactionFilter] = useState<string>('');
  const [adjustProductId, setAdjustProductId] = useState<string>('');
  const [transferProductId, setTransferProductId] = useState<string>('');

  const { data: policiesData, isLoading: policiesLoading, isError: isPoliciesError, error: policiesError } = useQuery({
    queryKey: ['manufacturing', 'inventory', 'policies'],
    queryFn: () => inventoryService.getPolicies({ pageSize: 50 }),
  });

  const { data: levelsData, isLoading: levelsLoading, isError: isLevelsError, error: levelsError } = useQuery({
    queryKey: ['manufacturing', 'inventory', 'levels'],
    queryFn: () => inventoryService.getLevels({ pageSize: 50 }),
  });

  const { data: transactionsData, isLoading: transactionsLoading, isError: isTransactionsError, error: transactionsError } = useQuery({
    queryKey: ['manufacturing', 'inventory', 'transactions', transactionFilter],
    queryFn: () => inventoryTransactionService.getAll({ 
      transactionType: transactionFilter || undefined,
      limit: 100 
    }),
    enabled: activeTab === 'transactions',
  });

  const { data: locations } = useQuery({
    queryKey: ['locations'],
    queryFn: () => dataService.getLocations({ limit: 200 }),
  });

  const locationsData: any[] = locations || [];

  const adjustMutation = useMutation({
    mutationFn: inventoryTransactionService.adjust,
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['manufacturing', 'inventory'] });
      queryClient.invalidateQueries({ queryKey: ['products'] });
      setShowAdjustModal(false);
      toast.success('Inventory adjusted');
    },
    onError: (err: any) => { toast.error(err?.response?.data?.message || 'Failed to adjust inventory'); },
  });

  const transferMutation = useMutation({
    mutationFn: inventoryTransactionService.transfer,
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['manufacturing', 'inventory'] });
      setShowTransferModal(false);
      toast.success('Transfer completed');
    },
    onError: (err: any) => { toast.error(err?.response?.data?.message || 'Failed to transfer inventory'); },
  });

  const policies: InventoryPolicy[] = Array.isArray(policiesData?.items) ? policiesData.items : Array.isArray(policiesData) ? policiesData : [];
  const levels: InventoryLevel[] = Array.isArray(levelsData?.items) ? levelsData.items : Array.isArray(levelsData) ? levelsData : [];
  const transactions: InventoryTransaction[] = Array.isArray(transactionsData) ? transactionsData : [];

  const hasError = isPoliciesError || isLevelsError || isTransactionsError;
  const firstError = policiesError || levelsError || transactionsError;

  const handleAdjust = (e: React.FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    const form = e.currentTarget;
    const formData = new FormData(form);
    adjustMutation.mutate({
      productId: adjustProductId,
      quantity: parseFloat(formData.get('quantity') as string),
      reason: formData.get('reason') as string,
    });
  };

  const handleTransfer = (e: React.FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    const form = e.currentTarget;
    const formData = new FormData(form);
    transferMutation.mutate({
      productId: transferProductId,
      quantity: parseFloat(formData.get('quantity') as string),
      fromLocation: formData.get('fromLocation') as string,
      toLocation: formData.get('toLocation') as string,
      notes: formData.get('notes') as string || undefined,
    });
  };

  const policyColumns: Column<InventoryPolicy>[] = [
    { key: 'product', header: 'Product', accessor: (row) => row.product?.name || row.product?.sku || '—' },
    { key: 'location', header: 'Location', accessor: (row) => row.location?.name || row.location?.code || '—' },
    { key: 'planningMethod', header: 'Method', accessor: 'planningMethod' },
    { key: 'lotSizingRule', header: 'Lot Sizing', accessor: 'lotSizingRule' },
    {
      key: 'abcClass',
      header: 'ABC',
      accessor: (row) => row.abcClass ? <Badge variant="primary" size="sm">{row.abcClass}</Badge> : '—',
      align: 'center',
    },
  ];

  const levelColumns: Column<InventoryLevel>[] = [
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
    { key: 'location', header: 'Location', accessor: (row) => row.location?.name || row.location?.code || '—' },
    { 
      key: 'onHandQty', 
      header: 'On Hand', 
      accessor: (row) => (
        <span className={row.onHandQty < 0 ? 'text-red-600' : ''}>
          {row.onHandQty}
        </span>
      ), 
      align: 'right' 
    },
    { key: 'availableQty', header: 'Available', accessor: (row) => row.availableQty, align: 'right' },
    { key: 'allocatedQty', header: 'Allocated', accessor: (row) => row.allocatedQty || 0, align: 'right' },
    { key: 'onOrderQty', header: 'On Order', accessor: (row) => row.onOrderQty, align: 'right' },
    {
      key: 'status',
      header: 'Status',
      accessor: (row) => {
        // Simple status based on quantity - safety stock checks would require policy lookup
        if (row.onHandQty <= 0) {
          return <Badge variant="error" size="sm">Out of Stock</Badge>;
        } else if (row.availableQty <= 0) {
          return <Badge variant="warning" size="sm">Fully Allocated</Badge>;
        }
        return <Badge variant="success" size="sm">OK</Badge>;
      },
    },
  ];

  const transactionColumns: Column<InventoryTransaction>[] = [
    {
      key: 'date',
      header: 'Date',
      accessor: (row) => safeFormat(row.transactionDate, 'MMM dd, HH:mm'),
    },
    {
      key: 'type',
      header: 'Type',
      accessor: (row) => (
        <div className="flex items-center gap-2">
          {transactionTypeIcons[row.transactionType]}
          <Badge variant={transactionTypeVariant[row.transactionType] || 'default'} size="sm">
            {formatTransactionTypeLabel(row.transactionType)}
          </Badge>
        </div>
      ),
    },
    {
      key: 'product',
      header: 'Product',
      accessor: (row) => (
        <div>
          <div>{row.product?.name || row.product?.code || row.productId || '—'}</div>
          <div className="text-xs text-secondary-500">{row.product?.sku || row.product?.code || row.productId}</div>
        </div>
      ),
    },
    {
      key: 'movement',
      header: 'Movement',
      accessor: (row) => getMovementRoute(row),
    },
    {
      key: 'quantity',
      header: 'Quantity',
      accessor: (row) => {
        const quantity = getSignedQuantity(row);

        return (
          <span className={quantity > 0 ? 'text-green-600' : quantity < 0 ? 'text-red-600' : 'text-blue-600'}>
            {quantity > 0 ? '+' : ''}{quantity}
          </span>
        );
      },
      align: 'right',
    },
    {
      key: 'uom',
      header: 'UOM',
      accessor: (row) => row.uom || '—',
      align: 'center',
    },
    {
      key: 'reference',
      header: 'Reference',
      accessor: (row) => row.referenceNumber || row.referenceType || row.reason || '—',
    },
    {
      key: 'lot',
      header: 'Batch',
      accessor: (row) => row.batch?.batchNumber || row.lotNumber || '—',
    },
    {
      key: 'cost',
      header: 'Value',
      accessor: (row) => row.totalCost != null ? row.totalCost.toLocaleString() : '—',
      align: 'right',
    },
    {
      key: 'notes',
      header: 'Notes',
      accessor: (row) => row.notes ? (
        <span className="text-sm text-secondary-500 truncate max-w-xs block" title={row.notes}>
          {row.notes}
        </span>
      ) : '—',
    },
  ];

  const tabs = [
    { key: 'levels', label: 'Inventory Levels' },
    { key: 'policies', label: 'Policies' },
    { key: 'transactions', label: 'Transactions' },
  ];

  return (
    <div className="space-y-6">
      <div className="flex justify-between items-start">
        <div>
          <h1 className="text-2xl font-bold">Inventory Management</h1>
          <p className="text-secondary-500 mt-1">Stock levels, policies, and transaction history</p>
        </div>
        <div className="flex gap-2">
          <Button variant="secondary" onClick={() => setShowTransferModal(true)}>
            <ArrowsRightLeftIcon className="w-4 h-4 mr-2" />
            Transfer
          </Button>
          <Button onClick={() => setShowAdjustModal(true)}>
            <AdjustmentsHorizontalIcon className="w-4 h-4 mr-2" />
            Adjust
          </Button>
        </div>
      </div>

      {hasError && <QueryErrorBanner error={firstError} />}

      {/* Summary Cards */}
      <div className="grid grid-cols-4 gap-4">
        <Card>
          <div className="p-4">
            <div className="text-sm text-secondary-500">Total SKUs</div>
            <div className="text-2xl font-bold">{levels.length}</div>
          </div>
        </Card>
        <Card>
          <div className="p-4">
            <div className="text-sm text-secondary-500">Low Availability</div>
            <div className="text-2xl font-bold text-warning-600">
              {levels.filter(l => l.availableQty <= 0 && l.onHandQty > 0).length}
            </div>
          </div>
        </Card>
        <Card>
          <div className="p-4">
            <div className="text-sm text-secondary-500">Out of Stock</div>
            <div className="text-2xl font-bold text-error-600">
              {levels.filter(l => l.onHandQty <= 0).length}
            </div>
          </div>
        </Card>
        <Card>
          <div className="p-4">
            <div className="text-sm text-secondary-500">Recent Transactions</div>
            <div className="text-2xl font-bold">{transactions.length}</div>
          </div>
        </Card>
      </div>

      {/* Tabs */}
      <div className="border-b dark:border-gray-700">
        <nav className="flex gap-4">
          {tabs.map(tab => (
            <button
              key={tab.key}
              onClick={() => setActiveTab(tab.key as any)}
              className={`pb-3 px-1 border-b-2 transition-colors ${
                activeTab === tab.key 
                  ? 'border-primary-500 text-primary-600' 
                  : 'border-transparent text-secondary-500 hover:text-secondary-700'
              }`}
            >
              {tab.label}
            </button>
          ))}
        </nav>
      </div>

      {/* Tab Content */}
      {activeTab === 'levels' && (
        <Card>
          <CardHeader title="Inventory Levels" description="Current stock position by product and location" />
          <DataTable
            data={levels}
            columns={levelColumns}
            keyExtractor={(row) => row.id}
            isLoading={levelsLoading}
            emptyMessage="No inventory levels found"
          />
        </Card>
      )}

      {activeTab === 'policies' && (
        <Card>
          <CardHeader title="Inventory Policies" description="Planning policies and stocking rules" />
          <DataTable
            data={policies}
            columns={policyColumns}
            keyExtractor={(row) => row.id}
            isLoading={policiesLoading}
            emptyMessage="No policies found"
          />
        </Card>
      )}

      {activeTab === 'transactions' && (
        <Card>
          <CardHeader 
            title="Transaction History" 
            description="Recent inventory movements"
            actions={
              <select 
                value={transactionFilter}
                onChange={(e) => setTransactionFilter(e.target.value)}
                className="px-3 py-1 border rounded-md text-sm dark:bg-gray-800 dark:border-gray-700"
              >
                <option value="">All Types</option>
                <option value="RECEIPT">Receipts</option>
                <option value="ISSUE">Issues</option>
                <option value="TRANSFER">Transfers</option>
                <option value="ADJUSTMENT_IN">Adjustment In</option>
                <option value="ADJUSTMENT_OUT">Adjustment Out</option>
                <option value="PRODUCTION_RECEIPT">Production Receipt</option>
                <option value="PRODUCTION_ISSUE">Production Issue</option>
                <option value="RETURN">Returns</option>
                <option value="SCRAP">Scrap</option>
              </select>
            }
          />
          <DataTable
            data={transactions}
            columns={transactionColumns}
            keyExtractor={(row) => row.id}
            isLoading={transactionsLoading}
            emptyMessage="No transactions found"
          />
        </Card>
      )}

      {/* Adjustment Modal */}
      <Modal
        isOpen={showAdjustModal}
        onClose={() => setShowAdjustModal(false)}
        title="Adjust Inventory"
      >
        <form onSubmit={handleAdjust} className="space-y-4">
          <div>
            <label className="block text-sm font-medium mb-1">Product</label>
            <ProductSelector value={adjustProductId || undefined} onChange={(id) => setAdjustProductId(id)} />
          </div>
          <div>
            <label className="block text-sm font-medium mb-1">Adjustment Quantity</label>
            <input 
              name="quantity" 
              type="number" 
              step="0.01" 
              required 
              placeholder="Positive to add, negative to remove"
              className="w-full px-3 py-2 border rounded-md dark:bg-gray-800 dark:border-gray-700" 
            />
            <p className="text-xs text-secondary-500 mt-1">
              Enter positive number to increase stock, negative to decrease
            </p>
          </div>
          <div>
            <label className="block text-sm font-medium mb-1">Reason</label>
            <select name="reason" required className="w-full px-3 py-2 border rounded-md dark:bg-gray-800 dark:border-gray-700">
              <option value="">Select reason...</option>
              <option value="Cycle count correction">Cycle count correction</option>
              <option value="Physical inventory adjustment">Physical inventory adjustment</option>
              <option value="Damaged goods">Damaged goods</option>
              <option value="Expired product">Expired product</option>
              <option value="Data entry error correction">Data entry error correction</option>
              <option value="Other">Other</option>
            </select>
          </div>
          <div className="flex justify-end gap-2 pt-4">
            <Button variant="secondary" type="button" onClick={() => setShowAdjustModal(false)}>Cancel</Button>
            <Button type="submit" isLoading={adjustMutation.isPending}>Apply Adjustment</Button>
          </div>
        </form>
      </Modal>

      {/* Transfer Modal */}
      <Modal
        isOpen={showTransferModal}
        onClose={() => setShowTransferModal(false)}
        title="Transfer Inventory"
      >
        <form onSubmit={handleTransfer} className="space-y-4">
          <div>
            <label className="block text-sm font-medium mb-1">Product</label>
            <ProductSelector value={transferProductId || undefined} onChange={(id) => setTransferProductId(id)} />
          </div>
          <div>
            <label className="block text-sm font-medium mb-1">Quantity</label>
            <input 
              name="quantity" 
              type="number" 
              min="1" 
              required 
              className="w-full px-3 py-2 border rounded-md dark:bg-gray-800 dark:border-gray-700" 
            />
          </div>
          <div className="grid grid-cols-2 gap-4">
            <div>
              <label className="block text-sm font-medium mb-1">From Location</label>
              <select
                name="fromLocation"
                required
                className="w-full px-3 py-2 border rounded-md dark:bg-gray-800 dark:border-gray-700"
              >
                <option value="">Select source...</option>
                {locationsData.map((loc: any) => (
                  <option key={loc.id} value={loc.name || loc.code}>
                    {loc.code ? `${loc.code} - ${loc.name}` : loc.name}
                  </option>
                ))}
              </select>
            </div>
            <div>
              <label className="block text-sm font-medium mb-1">To Location</label>
              <select
                name="toLocation"
                required
                className="w-full px-3 py-2 border rounded-md dark:bg-gray-800 dark:border-gray-700"
              >
                <option value="">Select destination...</option>
                {locationsData.map((loc: any) => (
                  <option key={loc.id} value={loc.name || loc.code}>
                    {loc.code ? `${loc.code} - ${loc.name}` : loc.name}
                  </option>
                ))}
              </select>
            </div>
          </div>
          <div>
            <label className="block text-sm font-medium mb-1">Notes (optional)</label>
            <textarea name="notes" rows={2} className="w-full px-3 py-2 border rounded-md dark:bg-gray-800 dark:border-gray-700" />
          </div>
          <div className="flex justify-end gap-2 pt-4">
            <Button variant="secondary" type="button" onClick={() => setShowTransferModal(false)}>Cancel</Button>
            <Button type="submit" isLoading={transferMutation.isPending}>Transfer</Button>
          </div>
        </form>
      </Modal>
    </div>
  );
}
