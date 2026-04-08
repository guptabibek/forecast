import { Badge, Button, Card, CardHeader, Column, ConfirmModal, DataTable, Modal, ProductSelector, QueryErrorBanner } from '@components/ui';
import { CheckIcon, PlusIcon, TruckIcon, XMarkIcon } from '@heroicons/react/24/outline';
import { useAuth, useConfirmAction } from '@hooks/index';
import { goodsReceiptService, purchaseOrderService, supplierService, type PurchaseOrder } from '@services/api';
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
  DRAFT: 'secondary',
  RELEASED: 'primary',
  PARTIAL: 'warning',
  COMPLETED: 'success',
  CANCELLED: 'error',
};

interface POLineForm {
  productId: string;
  productName?: string;
  quantity: number;
  unitPrice: number;
}

export default function PurchaseOrdersPage() {
  const queryClient = useQueryClient();
  const { canMutate } = useAuth();
  const [showCreateModal, setShowCreateModal] = useState(false);
  const [showReceiveModal, setShowReceiveModal] = useState(false);
  const [selectedPO, setSelectedPO] = useState<PurchaseOrder | null>(null);
  const [statusFilter, setStatusFilter] = useState<string>('');
  const [poLines, setPOLines] = useState<POLineForm[]>([]);
  const [receiveLines, setReceiveLines] = useState<Array<{ lineId: string; quantity: number; lotNumber?: string }>>([]);

  const confirmReceive = useConfirmAction({
    title: 'Receive & Confirm Goods',
    message: 'This will create a Goods Receipt, update inventory levels, and post the financial entries. This action cannot be reversed without a separate reversal entry.',
    variant: 'warning',
    confirmText: 'Receive & Confirm',
  });

  const confirmCancel = useConfirmAction({
    title: 'Cancel Purchase Order',
    message: 'This will cancel the purchase order. Any unreceived line items will no longer be expected.',
    variant: 'danger',
    confirmText: 'Cancel PO',
  });

  const { data: purchaseOrders, isLoading, isError, error, refetch } = useQuery({
    queryKey: ['manufacturing', 'purchase-orders', statusFilter],
    queryFn: () => purchaseOrderService.getAll({ status: statusFilter || undefined }),
  });

  const { data: suppliers } = useQuery({
    queryKey: ['manufacturing', 'suppliers'],
    queryFn: () => supplierService.getAll(),
  });

  const createMutation = useMutation({
    mutationFn: purchaseOrderService.create,
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['manufacturing', 'purchase-orders'] });
      setShowCreateModal(false);
      setPOLines([]);
      toast.success('Purchase order created');
    },
    onError: (err: any) => { toast.error(err?.response?.data?.message || 'Failed to create purchase order'); },
  });

  const releaseMutation = useMutation({
    mutationFn: (id: string) => purchaseOrderService.release(id),
    onSuccess: () => { queryClient.invalidateQueries({ queryKey: ['manufacturing', 'purchase-orders'] }); toast.success('PO released'); },
    onError: (err: any) => { toast.error(err?.response?.data?.message || 'Failed to release PO'); },
  });

  const cancelMutation = useMutation({
    mutationFn: ({ id, reason }: { id: string; reason?: string }) => purchaseOrderService.cancel(id, reason),
    onSuccess: () => { queryClient.invalidateQueries({ queryKey: ['manufacturing', 'purchase-orders'] }); toast.success('PO cancelled'); },
    onError: (err: any) => { toast.error(err?.response?.data?.message || 'Failed to cancel PO'); },
  });

  const receiveAndConfirmMutation = useMutation({
    mutationFn: async (data: { purchaseOrderId: string; lines: Array<{ purchaseOrderLineId: string; quantity: number; lotNumber?: string }> }) => {
      const gr = await goodsReceiptService.create({
        purchaseOrderId: data.purchaseOrderId,
        lines: data.lines,
      });
      return goodsReceiptService.confirm(gr.id);
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['manufacturing', 'purchase-orders'] });
      setShowReceiveModal(false);
      setReceiveLines([]);
      toast.success('Goods received and confirmed');
    },
    onError: (err: any) => { toast.error(err?.response?.data?.message || 'Failed to receive goods'); },
  });

  const items: PurchaseOrder[] = purchaseOrders || [];
  const suppliersData: any[] = Array.isArray(suppliers?.items) ? suppliers.items : suppliers || [];

  const addPOLine = () => {
    setPOLines([...poLines, { productId: '', quantity: 1, unitPrice: 0 }]);
  };

  const updatePOLine = (index: number, field: keyof POLineForm, value: any, product?: any) => {
    const newLines = [...poLines];
    newLines[index] = { ...newLines[index], [field]: value };
    
    // Auto-populate price from product if available
    if (field === 'productId' && product) {
      newLines[index].unitPrice = product.standardCost || product.listPrice || 0;
      newLines[index].productName = product.name;
    }
    
    setPOLines(newLines);
  };

  const removePOLine = (index: number) => {
    setPOLines(poLines.filter((_, i) => i !== index));
  };

  const handleCreate = (e: React.FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    const form = e.currentTarget;
    const formData = new FormData(form);
    
    if (poLines.length === 0) {
      alert('Please add at least one line item');
      return;
    }

    createMutation.mutate({
      supplierId: formData.get('supplierId') as string,
      expectedDate: formData.get('expectedDate') as string,
      lines: poLines.map(line => ({
        productId: line.productId,
        quantity: line.quantity,
        unitPrice: line.unitPrice,
      })),
      notes: formData.get('notes') as string || undefined,
    });
  };

  const handleCancel = (po: PurchaseOrder) => {
    confirmCancel.confirm(() => cancelMutation.mutateAsync({ id: po.id }));
  };

  const openReceiveModal = (po: PurchaseOrder) => {
    setSelectedPO(po);
    // Initialize receive lines from PO lines with pending quantities
    const lines = (po.lines || [])
      .filter(line => line.quantity - line.receivedQuantity > 0)
      .map(line => ({
        lineId: line.id,
        quantity: line.quantity - line.receivedQuantity,
        lotNumber: '',
      }));
    setReceiveLines(lines);
    setShowReceiveModal(true);
  };

  const handleReceive = (e: React.FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    if (!selectedPO) return;

    const linesToReceive = receiveLines.filter(l => l.quantity > 0);
    if (linesToReceive.length === 0) {
      alert('Please enter quantities to receive');
      return;
    }

    const po = selectedPO;
    confirmReceive.confirm(() =>
      receiveAndConfirmMutation.mutateAsync({
        purchaseOrderId: po.id,
        lines: linesToReceive.map(l => ({
          purchaseOrderLineId: l.lineId,
          quantity: l.quantity,
          lotNumber: l.lotNumber || undefined,
        })),
      }),
    );
  };

  const getReceivedPercent = (po: PurchaseOrder) => {
    if (!po.lines || po.lines.length === 0) return 0;
    const total = po.lines.reduce((s, l) => s + l.quantity, 0);
    const received = po.lines.reduce((s, l) => s + l.receivedQuantity, 0);
    return total > 0 ? Math.round((received / total) * 100) : 0;
  };

  const columns: Column<PurchaseOrder>[] = [
    {
      key: 'poNumber',
      header: 'PO Number',
      accessor: (row) => (
        <div>
          <div className="font-medium">{row.poNumber}</div>
          <div className="text-xs text-secondary-500">
            {safeFormat(row.orderDate, 'MMM dd, yyyy')}
          </div>
        </div>
      ),
    },
    {
      key: 'supplier',
      header: 'Supplier',
      accessor: (row) => row.supplier?.name || '—',
    },
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
      key: 'lines',
      header: 'Lines',
      accessor: (row) => row.lines?.length || 0,
      align: 'right',
    },
    {
      key: 'received',
      header: 'Received',
      accessor: (row) => (
        <div>
          <div>{getReceivedPercent(row)}%</div>
          <div className="w-16 bg-gray-200 rounded-full h-1.5 mt-1">
            <div 
              className="bg-primary-500 h-1.5 rounded-full" 
              style={{ width: `${getReceivedPercent(row)}%` }}
            />
          </div>
        </div>
      ),
      align: 'right',
    },
    {
      key: 'expectedDate',
      header: 'Expected',
      accessor: (row) => safeFormat(row.expectedDate, 'MMM dd, yyyy'),
    },
    {
      key: 'total',
      header: 'Total',
      accessor: (row) => `$${(row.totalAmount || 0).toLocaleString()}`,
      align: 'right',
    },
    {
      key: 'actions',
      header: 'Actions',
      accessor: (row) => (
        <div className="flex gap-1">
          {canMutate && row.status === 'DRAFT' && (
            <>
              <button
                onClick={(e) => { e.stopPropagation(); releaseMutation.mutate(row.id); }}
                className="p-1 hover:bg-green-100 text-green-600 rounded"
                title="Release"
              >
                <CheckIcon className="w-4 h-4" />
              </button>
              <button
                onClick={(e) => { e.stopPropagation(); handleCancel(row); }}
                className="p-1 hover:bg-red-100 text-red-600 rounded"
                title="Cancel"
              >
                <XMarkIcon className="w-4 h-4" />
              </button>
            </>
          )}
          {canMutate && (row.status === 'RELEASED' || row.status === 'PARTIAL') && (
            <button
              onClick={(e) => { e.stopPropagation(); openReceiveModal(row); }}
              className="p-1 hover:bg-blue-100 text-blue-600 rounded"
              title="Receive Goods"
            >
              <TruckIcon className="w-4 h-4" />
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
          <h1 className="text-2xl font-bold">Purchase Orders</h1>
          <p className="text-secondary-500 mt-1">Manage procurement and vendor orders</p>
        </div>
        {canMutate && (
          <Button onClick={() => { setPOLines([]); setShowCreateModal(true); }}>
            <PlusIcon className="w-4 h-4 mr-2" />
            Create PO
          </Button>
        )}
      </div>

      {isError && <QueryErrorBanner error={error} onRetry={() => refetch()} />}

      {/* Status Summary Cards */}
      <div className="grid grid-cols-5 gap-4">
        {['DRAFT', 'RELEASED', 'PARTIAL', 'COMPLETED', 'CANCELLED'].map(status => {
          const count = items.filter(po => po.status === status).length;
          return (
            <div 
              key={status} 
              className={`cursor-pointer transition-all rounded-lg border bg-white dark:bg-gray-800 ${statusFilter === status ? 'ring-2 ring-primary-500' : ''}`}
              onClick={() => setStatusFilter(statusFilter === status ? '' : status)}
            >
              <div className="p-4 text-center">
                <div className="text-2xl font-bold">{count}</div>
                <div className="text-sm text-secondary-500">{status}</div>
              </div>
            </div>
          );
        })}
      </div>

      <Card>
        <CardHeader
          title="Purchase Orders"
          description="All purchase orders"
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
          emptyMessage="No purchase orders found"
          onRowClick={(row) => { setSelectedPO(row); setShowReceiveModal(true); }}
        />
      </Card>

      {/* Create PO Modal */}
      <Modal
        isOpen={showCreateModal}
        onClose={() => setShowCreateModal(false)}
        title="Create Purchase Order"
        size="lg"
      >
        <form onSubmit={handleCreate} className="space-y-4">
          <div className="grid grid-cols-2 gap-4">
            <div>
              <label className="block text-sm font-medium mb-1">Supplier</label>
              <select name="supplierId" required className="w-full px-3 py-2 border rounded-md dark:bg-gray-800 dark:border-gray-700">
                <option value="">Select supplier...</option>
                {suppliersData.map((s: any) => (
                  <option key={s.id} value={s.id}>{s.name}</option>
                ))}
              </select>
            </div>
            <div>
              <label className="block text-sm font-medium mb-1">Expected Date</label>
              <input name="expectedDate" type="date" required className="w-full px-3 py-2 border rounded-md dark:bg-gray-800 dark:border-gray-700" />
            </div>
          </div>

          <div>
            <div className="flex justify-between items-center mb-2">
              <label className="block text-sm font-medium">Line Items</label>
              <Button type="button" size="sm" variant="secondary" onClick={addPOLine}>
                <PlusIcon className="w-4 h-4 mr-1" />
                Add Line
              </Button>
            </div>
            
            {poLines.length > 0 ? (
              <table className="w-full text-sm">
                <thead>
                  <tr className="text-left border-b dark:border-gray-700">
                    <th className="pb-2">Product</th>
                    <th className="pb-2 w-24">Qty</th>
                    <th className="pb-2 w-28">Unit Price</th>
                    <th className="pb-2 w-24 text-right">Total</th>
                    <th className="pb-2 w-10"></th>
                  </tr>
                </thead>
                <tbody>
                  {poLines.map((line, idx) => (
                    <tr key={idx} className="border-b dark:border-gray-700">
                      <td className="py-2">
                        <ProductSelector
                          value={line.productId || undefined}
                          onChange={(id, product) => updatePOLine(idx, 'productId', id, product)}
                        />
                      </td>
                      <td className="py-2">
                        <input 
                          type="number" 
                          min="1" 
                          value={line.quantity}
                          onChange={(e) => updatePOLine(idx, 'quantity', parseInt(e.target.value) || 0)}
                          required
                          className="w-full px-2 py-1 border rounded dark:bg-gray-800 dark:border-gray-700"
                        />
                      </td>
                      <td className="py-2">
                        <input 
                          type="number" 
                          min="0" 
                          step="0.01" 
                          value={line.unitPrice}
                          onChange={(e) => updatePOLine(idx, 'unitPrice', parseFloat(e.target.value) || 0)}
                          required
                          className="w-full px-2 py-1 border rounded dark:bg-gray-800 dark:border-gray-700"
                        />
                      </td>
                      <td className="py-2 text-right">
                        ${(line.quantity * line.unitPrice).toFixed(2)}
                      </td>
                      <td className="py-2">
                        <button 
                          type="button" 
                          onClick={() => removePOLine(idx)}
                          className="p-1 hover:bg-red-100 text-red-600 rounded"
                        >
                          <XMarkIcon className="w-4 h-4" />
                        </button>
                      </td>
                    </tr>
                  ))}
                </tbody>
                <tfoot>
                  <tr className="font-medium">
                    <td colSpan={3} className="pt-2 text-right">Total:</td>
                    <td className="pt-2 text-right">
                      ${poLines.reduce((s, l) => s + l.quantity * l.unitPrice, 0).toFixed(2)}
                    </td>
                    <td></td>
                  </tr>
                </tfoot>
              </table>
            ) : (
              <p className="text-sm text-secondary-500 py-4 text-center border rounded-md dark:border-gray-700">
                No line items. Click "Add Line" to add products.
              </p>
            )}
          </div>

          <div>
            <label className="block text-sm font-medium mb-1">Notes</label>
            <textarea name="notes" rows={2} className="w-full px-3 py-2 border rounded-md dark:bg-gray-800 dark:border-gray-700" />
          </div>

          <div className="flex justify-end gap-2 pt-4">
            <Button variant="secondary" type="button" onClick={() => setShowCreateModal(false)}>Cancel</Button>
            <Button type="submit" isLoading={createMutation.isPending} disabled={poLines.length === 0}>
              Create PO
            </Button>
          </div>
        </form>
      </Modal>

      {/* Receive Goods Modal */}
      <Modal
        isOpen={showReceiveModal}
        onClose={() => setShowReceiveModal(false)}
        title={`Receive Goods: ${selectedPO?.poNumber}`}
        size="lg"
      >
        <form onSubmit={handleReceive} className="space-y-4">
          <div className="bg-gray-50 dark:bg-gray-800 p-3 rounded-md">
            <div className="text-sm">
              <span className="text-secondary-500">Supplier: </span>
              <span className="font-medium">{selectedPO?.supplier?.name}</span>
            </div>
          </div>

          <table className="w-full text-sm">
            <thead>
              <tr className="text-left border-b dark:border-gray-700">
                <th className="pb-2">Product</th>
                <th className="pb-2 text-right">Pending</th>
                <th className="pb-2 w-28">Receive Qty</th>
                <th className="pb-2 w-32">Lot Number</th>
              </tr>
            </thead>
            <tbody>
              {selectedPO?.lines?.filter(l => l.quantity - l.receivedQuantity > 0).map((line) => {
                const pending = line.quantity - line.receivedQuantity;
                const receiveLine = receiveLines.find(r => r.lineId === line.id);
                return (
                  <tr key={line.id} className="border-b dark:border-gray-700">
                    <td className="py-2">
                      <div>{line.product?.name}</div>
                      <div className="text-xs text-secondary-500">{line.product?.sku}</div>
                    </td>
                    <td className="py-2 text-right">{pending}</td>
                    <td className="py-2">
                      <input 
                        type="number" 
                        min="0" 
                        max={pending}
                        value={receiveLine?.quantity || 0}
                        onChange={(e) => {
                          const newLines = receiveLines.map(r => 
                            r.lineId === line.id 
                              ? { ...r, quantity: parseInt(e.target.value) || 0 }
                              : r
                          );
                          setReceiveLines(newLines);
                        }}
                        className="w-full px-2 py-1 border rounded dark:bg-gray-800 dark:border-gray-700"
                      />
                    </td>
                    <td className="py-2">
                      <input 
                        type="text" 
                        placeholder="Optional"
                        value={receiveLine?.lotNumber || ''}
                        onChange={(e) => {
                          const newLines = receiveLines.map(r => 
                            r.lineId === line.id 
                              ? { ...r, lotNumber: e.target.value }
                              : r
                          );
                          setReceiveLines(newLines);
                        }}
                        className="w-full px-2 py-1 border rounded dark:bg-gray-800 dark:border-gray-700"
                      />
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>

          <div className="flex justify-end gap-2 pt-4">
            <Button variant="secondary" type="button" onClick={() => setShowReceiveModal(false)}>Cancel</Button>
            <Button type="submit" isLoading={receiveAndConfirmMutation.isPending}>
              Receive & Confirm
            </Button>
          </div>
        </form>
      </Modal>

      {/* Confirmation Dialogs */}
      <ConfirmModal {...confirmReceive.confirmProps} />
      <ConfirmModal {...confirmCancel.confirmProps} />
    </div>
  );
}
