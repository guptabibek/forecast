import { Badge, Button, Card, CardHeader, Column, ConfirmModal, DataTable, Modal, ProductSelector, QueryErrorBanner } from '@components/ui';
import { DetailPopupActions } from '@components/reports/DetailPopupActions';
import { PlusIcon, XMarkIcon } from '@heroicons/react/24/outline';
import { useAuth, useConfirmAction } from '@hooks/index';
import { useGridState } from '@/hooks/useGridState';
import { goodsReceiptService, purchaseOrderService, supplierService, type PurchaseOrder } from '@services/api';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { format } from 'date-fns';
import { useEffect, useState } from 'react';
import toast from 'react-hot-toast';
import { useSearchParams } from 'react-router-dom';
import { formatInr } from '@utils/number-format';

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
  // View-only mode: canMutate retained for re-enabling CRUD.
  const { canMutate: _canMutate } = useAuth();
  const [searchParams] = useSearchParams();
  const linkedPoId = searchParams.get('poId');
  const [showCreateModal, setShowCreateModal] = useState(false);
  const [showReceiveModal, setShowReceiveModal] = useState(false);
  const [showDetailModal, setShowDetailModal] = useState(false);
  const [selectedPO, setSelectedPO] = useState<PurchaseOrder | null>(null);
  const [poLines, setPOLines] = useState<POLineForm[]>([]);
  const [receiveLines, setReceiveLines] = useState<Array<{ lineId: string; quantity: number; lotNumber?: string }>>([]);
  const grid = useGridState({ initialSortBy: 'createdAt', initialSortOrder: 'desc' });

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
    queryKey: ['manufacturing', 'purchase-orders', grid.queryKey],
    queryFn: () => purchaseOrderService.getAll(grid.queryParams),
    placeholderData: (prev) => prev,
  });

  const { data: suppliers } = useQuery({
    queryKey: ['manufacturing', 'suppliers'],
    queryFn: () => supplierService.getAll(),
  });

  const linkedPurchaseOrder = useQuery({
    queryKey: ['manufacturing', 'purchase-orders', linkedPoId],
    queryFn: () => purchaseOrderService.getById(linkedPoId as string),
    enabled: !!linkedPoId,
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

  // View-only mode: releaseMutation commented out.
  /*
  const releaseMutation = useMutation({
    mutationFn: (id: string) => purchaseOrderService.release(id),
    onSuccess: () => { queryClient.invalidateQueries({ queryKey: ['manufacturing', 'purchase-orders'] }); toast.success('PO released'); },
    onError: (err: any) => { toast.error(err?.response?.data?.message || 'Failed to release PO'); },
  });
  */

  // View-only mode: cancelMutation commented out.
  /*
  const cancelMutation = useMutation({
    mutationFn: ({ id, reason }: { id: string; reason?: string }) => purchaseOrderService.cancel(id, reason),
    onSuccess: () => { queryClient.invalidateQueries({ queryKey: ['manufacturing', 'purchase-orders'] }); toast.success('PO cancelled'); },
    onError: (err: any) => { toast.error(err?.response?.data?.message || 'Failed to cancel PO'); },
  });
  */

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

  const items: PurchaseOrder[] = Array.isArray((purchaseOrders as any)?.items) ? (purchaseOrders as any).items : Array.isArray(purchaseOrders) ? purchaseOrders : [];
  const total = (purchaseOrders as any)?.total ?? items.length;
  const suppliersData: any[] = Array.isArray(suppliers?.items) ? suppliers.items : suppliers || [];

  // View-only auto-select: when navigated with ?poId=..., open the read-only detail modal
  // so the user sees the specific PO they linked from (e.g., supplier performance report).
  useEffect(() => {
    if (!linkedPurchaseOrder.data) return;
    setSelectedPO(linkedPurchaseOrder.data);
    setShowDetailModal(true);
  }, [linkedPurchaseOrder.data]);

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

  // View-only mode: handleCancel + openReceiveModal commented out.
  /*
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
  */

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
      sortable: true, filterType: 'text', filterField: 'orderNumber',
    },
    {
      key: 'supplier',
      header: 'Supplier',
      filterType: 'select',
      filterField: 'supplierId',
      filterOptions: suppliersData.map((supplier) => ({
        value: supplier.id,
        label: supplier.name || supplier.code || supplier.id,
      })),
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
      filterType: 'select', filterField: 'status',
      filterOptions: [
        { value: 'DRAFT', label: 'Draft' },
        { value: 'RELEASED', label: 'Released' },
        { value: 'PARTIAL', label: 'Partial' },
        { value: 'COMPLETED', label: 'Completed' },
        { value: 'CANCELLED', label: 'Cancelled' },
      ],
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
      key: 'orderDate',
      header: 'Order Date',
      accessor: (row) => safeFormat(row.orderDate, 'MMM dd, yyyy'),
      sortable: true, filterType: 'date', filterField: 'orderDate',
    },
    {
      key: 'expectedDate',
      header: 'Expected',
      accessor: (row) => safeFormat(row.expectedDate, 'MMM dd, yyyy'),
      sortable: true, filterType: 'date', filterField: 'expectedDate',
    },
    {
      key: 'totalAmount',
      header: 'Total',
      accessor: (row) => formatInr(row.totalAmount || 0),
      align: 'right', sortable: true, filterType: 'number', filterField: 'totalAmount',
    },
    // View-only mode: action buttons (release/cancel/receive) intentionally disabled.
    // Restore by reinstating this column block when CRUD is re-enabled for planners.
    // {
    //   key: 'actions',
    //   header: 'Actions',
    //   accessor: (row) => (
    //     <div className="flex gap-1">
    //       {canMutate && row.status === 'DRAFT' && (
    //         <>
    //           <button
    //             onClick={(e) => { e.stopPropagation(); releaseMutation.mutate(row.id); }}
    //             className="p-1 hover:bg-green-100 text-green-600 rounded"
    //             title="Release"
    //           >
    //             <CheckIcon className="w-4 h-4" />
    //           </button>
    //           <button
    //             onClick={(e) => { e.stopPropagation(); handleCancel(row); }}
    //             className="p-1 hover:bg-red-100 text-red-600 rounded"
    //             title="Cancel"
    //           >
    //             <XMarkIcon className="w-4 h-4" />
    //           </button>
    //         </>
    //       )}
    //       {canMutate && (row.status === 'RELEASED' || row.status === 'PARTIAL') && (
    //         <button
    //           onClick={(e) => { e.stopPropagation(); openReceiveModal(row); }}
    //           className="p-1 hover:bg-blue-100 text-blue-600 rounded"
    //           title="Receive Goods"
    //         >
    //           <TruckIcon className="w-4 h-4" />
    //         </button>
    //       )}
    //     </div>
    //   ),
    // },
  ];

  return (
    <div className="space-y-4 lg:space-y-6">
      <div className="flex justify-between items-start">
        <div>
          <h1 className="text-xl lg:text-2xl font-bold">Purchase Orders</h1>
          <p className="text-xs lg:text-sm text-secondary-500 mt-1">Procurement and vendor orders (view-only)</p>
        </div>
        {/* View-only mode: PO creation disabled. */}
        {/* {canMutate && (
          <Button onClick={() => { setPOLines([]); setShowCreateModal(true); }}>
            <PlusIcon className="w-4 h-4 mr-2" />
            Create PO
          </Button>
        )} */}
      </div>

      {isError && <QueryErrorBanner error={error} onRetry={() => refetch()} />}

      {/* Status Summary (current page) */}
      <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-5 gap-3 lg:gap-4">
        {['DRAFT', 'RELEASED', 'PARTIAL', 'COMPLETED', 'CANCELLED'].map(status => {
          const count = items.filter(po => po.status === status).length;
          return (
            <div key={status} className="rounded-lg border bg-white dark:bg-gray-800">
              <div className="p-4 text-center">
                <div className="text-xl lg:text-2xl font-bold">{count}</div>
                <div className="text-xs lg:text-sm text-secondary-500">{status}</div>
              </div>
            </div>
          );
        })}
      </div>

      <Card>
        <CardHeader
          title="Purchase Orders"
          description="All purchase orders. Filter per column · sort by clicking header · server-side."
        />
        <DataTable
          data={items}
          columns={columns}
          keyExtractor={(row) => row.id}
          isLoading={isLoading}
          emptyMessage="No purchase orders found"
          onRowClick={(row) => { setSelectedPO(row); setShowDetailModal(true); }}
          sorting={grid.sortingProps}
          filtering={grid.filteringProps}
          pagination={grid.paginationProps(total)}
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
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 lg:gap-4">
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
              <div className="overflow-x-auto"><table className="w-full text-sm">
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
                        {formatInr(line.quantity * line.unitPrice)}
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
                      {formatInr(poLines.reduce((s, l) => s + l.quantity * l.unitPrice, 0))}
                    </td>
                    <td></td>
                  </tr>
                </tfoot>
              </table></div>
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

          <div className="overflow-x-auto">
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
          </div>

          <div className="flex justify-end gap-2 pt-4">
            <Button variant="secondary" type="button" onClick={() => setShowReceiveModal(false)}>Cancel</Button>
            <Button type="submit" isLoading={receiveAndConfirmMutation.isPending}>
              Receive & Confirm
            </Button>
          </div>
        </form>
      </Modal>

      {/* Read-only PO Detail Modal (used in view-only mode and on row click / ?poId= navigation) */}
      <Modal
        isOpen={showDetailModal}
        onClose={() => setShowDetailModal(false)}
        title={`Purchase Order: ${selectedPO?.poNumber ?? ''}`}
        size="2xl"
      >
        {selectedPO && (
          <div className="space-y-4 lg:space-y-6">
            <DetailPopupActions
              title="Purchase Order"
              documentNumber={selectedPO.poNumber}
              fields={[
                { label: 'PO Number', value: selectedPO.poNumber },
                { label: 'Supplier', value: selectedPO.supplier?.name },
                { label: 'Status', value: selectedPO.status },
                { label: 'Order Date', value: safeFormat(selectedPO.orderDate, 'MMM dd, yyyy') },
                { label: 'Expected Date', value: safeFormat(selectedPO.expectedDate, 'MMM dd, yyyy') },
                { label: 'Total Amount', value: formatInr(selectedPO.totalAmount || 0) },
              ]}
              tables={[{
                title: 'Line Items',
                columns: [
                  { key: 'product', header: 'Product' },
                  { key: 'ordered', header: 'Ordered', align: 'right' },
                  { key: 'received', header: 'Received', align: 'right' },
                  { key: 'unitPrice', header: 'Unit Price', align: 'right' },
                  { key: 'lineTotal', header: 'Line Total', align: 'right' },
                ],
                rows: (selectedPO.lines ?? []).map((line) => ({
                  product: line.product?.name ?? line.productId,
                  ordered: line.quantity,
                  received: line.receivedQuantity,
                  unitPrice: formatInr(line.unitPrice || 0),
                  lineTotal: formatInr((line.quantity || 0) * (line.unitPrice || 0)),
                })),
              }]}
              totals={[{ label: 'Total Amount', value: formatInr(selectedPO.totalAmount || 0) }]}
            />
            <div className="grid grid-cols-2 gap-3 text-sm sm:grid-cols-3">
              <div>
                <div className="text-secondary-500">Supplier</div>
                <div className="font-medium">{selectedPO.supplier?.name ?? '—'}</div>
              </div>
              <div>
                <div className="text-secondary-500">Status</div>
                <div>
                  <Badge variant={statusVariant[selectedPO.status] || 'default'} size="sm">
                    {selectedPO.status}
                  </Badge>
                </div>
              </div>
              <div>
                <div className="text-secondary-500">Order Date</div>
                <div>{safeFormat(selectedPO.orderDate, 'MMM dd, yyyy')}</div>
              </div>
              <div>
                <div className="text-secondary-500">Expected Date</div>
                <div>{safeFormat(selectedPO.expectedDate, 'MMM dd, yyyy')}</div>
              </div>
              <div>
                <div className="text-secondary-500">Total Amount</div>
                <div className="font-medium">{formatInr(selectedPO.totalAmount || 0)}</div>
              </div>
              <div>
                <div className="text-secondary-500">Lines</div>
                <div>{selectedPO.lines?.length ?? 0}</div>
              </div>
            </div>

            <div>
              <div className="text-sm font-medium mb-2">Line Items</div>
              <div className="overflow-x-auto rounded-lg border dark:border-gray-700">
                <table className="w-full min-w-[760px] text-sm border-collapse">
                  <thead className="bg-secondary-50 dark:bg-secondary-900/40">
                    <tr className="text-left border-b dark:border-gray-700">
                      <th className="px-3 py-2">Product</th>
                      <th className="px-3 py-2 text-right">Ordered</th>
                      <th className="px-3 py-2 text-right">Received</th>
                      <th className="px-3 py-2 text-right">Unit Price</th>
                      <th className="px-3 py-2 text-right">Line Total</th>
                    </tr>
                  </thead>
                  <tbody>
                    {(selectedPO.lines ?? []).map((line) => (
                      <tr key={line.id} className="border-b last:border-0 dark:border-gray-700">
                        <td className="px-3 py-3">
                          <div>{line.product?.name ?? line.productId}</div>
                          {line.product?.sku && <div className="text-xs text-secondary-500">{line.product.sku}</div>}
                        </td>
                        <td className="px-3 py-3 text-right">{line.quantity}</td>
                        <td className="px-3 py-3 text-right">{line.receivedQuantity}</td>
                        <td className="px-3 py-3 text-right">{formatInr(line.unitPrice || 0)}</td>
                        <td className="px-3 py-3 text-right">{formatInr((line.quantity || 0) * (line.unitPrice || 0))}</td>
                      </tr>
                    ))}
                    {(!selectedPO.lines || selectedPO.lines.length === 0) && (
                      <tr>
                        <td colSpan={5} className="py-4 text-center text-secondary-500">No line items</td>
                      </tr>
                    )}
                  </tbody>
                </table>
              </div>
            </div>

            <div className="flex justify-end gap-2 pt-4">
              <Button variant="secondary" type="button" onClick={() => setShowDetailModal(false)}>Close</Button>
            </div>
          </div>
        )}
      </Modal>

      {/* Confirmation Dialogs */}
      <ConfirmModal {...confirmReceive.confirmProps} />
      <ConfirmModal {...confirmCancel.confirmProps} />
    </div>
  );
}
