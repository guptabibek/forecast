import type { UnitOfMeasure } from '@/types';
import { Badge, Button, Card, CardHeader, Column, DataTable, Modal, ProductSelector, QueryErrorBanner } from '@components/ui';
import { DocumentDuplicateIcon, MagnifyingGlassIcon, PlusIcon, TrashIcon } from '@heroicons/react/24/outline';
import { bomService, uomService, type BOM, type BOMComponent } from '@services/api';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { format } from 'date-fns';
import { useState } from 'react';
import toast from 'react-hot-toast';
import { addBomComponentSchema, createBomSchema, flattenErrors } from './schemas';

const statusVariant: Record<string, 'default' | 'primary' | 'secondary' | 'success' | 'warning' | 'error'> = {
  DRAFT: 'secondary',
  PENDING_APPROVAL: 'warning',
  APPROVED: 'success',
  ACTIVE: 'success',
  OBSOLETE: 'error',
};

interface BOMFormData {
  productId: string;
  bomType: string;
  revision?: string;
  effectiveDate?: string;
  expiryDate?: string;
  notes?: string;
}

interface ComponentFormData {
  componentProductId: string;
  quantityPer: number;
  uom?: string;
  isPhantom?: boolean;
  wastagePercent?: number;
}

export default function BOMPage() {
  const queryClient = useQueryClient();
  const [showCreateModal, setShowCreateModal] = useState(false);
  const [showEditModal, setShowEditModal] = useState(false);
  const [showComponentModal, setShowComponentModal] = useState(false);
  const [showWhereUsedModal, setShowWhereUsedModal] = useState(false);
  const [showExplodedModal, setShowExplodedModal] = useState(false);
  const [selectedBOM, setSelectedBOM] = useState<BOM | null>(null);
  const [statusFilter, setStatusFilter] = useState<string>('');
  const [createProductId, setCreateProductId] = useState('');
  const [componentProductId, setComponentProductId] = useState('');

  const { data, isLoading, isError, error, refetch } = useQuery({
    queryKey: ['manufacturing', 'boms', statusFilter],
    queryFn: () => bomService.getBOMs({ pageSize: 100, status: statusFilter || undefined }),
  });

  const { data: whereUsedData } = useQuery({
    queryKey: ['manufacturing', 'boms', 'where-used', selectedBOM?.productId],
    queryFn: () => selectedBOM ? bomService.getWhereUsed(selectedBOM.productId) : null,
    enabled: !!selectedBOM && showWhereUsedModal,
  });

  const { data: explodedData } = useQuery({
    queryKey: ['manufacturing', 'boms', 'explode', selectedBOM?.id],
    queryFn: () => selectedBOM ? bomService.explodeBOM(selectedBOM.id, 10) : null,
    enabled: !!selectedBOM && showExplodedModal,
  });

  // Fetch UOM Master for dynamic dropdown
  const { data: uomResult } = useQuery({
    queryKey: ['manufacturing', 'uoms', 'active'],
    queryFn: () => uomService.getAll({ isActive: true, pageSize: 500 }),
    staleTime: 5 * 60 * 1000,
  });
  const uomList: UnitOfMeasure[] = uomResult?.items ?? [];

  const createMutation = useMutation({
    mutationFn: (dto: BOMFormData) => bomService.createBOM(dto),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['manufacturing', 'boms'] });
      setShowCreateModal(false);
      setCreateProductId('');
      toast.success('BOM created successfully');
    },
    onError: (err: any) => { toast.error(err?.response?.data?.message || 'Failed to create BOM'); },
  });

  const updateStatusMutation = useMutation({
    mutationFn: ({ id, status }: { id: string; status: string }) =>
      bomService.updateBOMStatus(id, status),
    onSuccess: () => { queryClient.invalidateQueries({ queryKey: ['manufacturing', 'boms'] }); toast.success('BOM status updated'); },
    onError: (err: any) => { toast.error(err?.response?.data?.message || 'Failed to update BOM status'); },
  });

  const addComponentMutation = useMutation({
    mutationFn: ({ bomId, component }: { bomId: string; component: ComponentFormData }) =>
      bomService.addComponent(bomId, component),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['manufacturing', 'boms'] });
      setShowComponentModal(false);
      setComponentProductId('');
      toast.success('Component added');
    },
    onError: (err: any) => { toast.error(err?.response?.data?.message || 'Failed to add component'); },
  });

  const removeComponentMutation = useMutation({
    mutationFn: (componentId: string) => bomService.removeComponent(componentId),
    onSuccess: () => { queryClient.invalidateQueries({ queryKey: ['manufacturing', 'boms'] }); toast.success('Component removed'); },
    onError: (err: any) => { toast.error(err?.response?.data?.message || 'Failed to remove component'); },
  });

  const copyMutation = useMutation({
    mutationFn: ({ id, targetProductId, newRevision }: { id: string; targetProductId: string; newRevision?: string }) =>
      bomService.copyBOM(id, { targetProductId, newRevision }),
    onSuccess: () => { queryClient.invalidateQueries({ queryKey: ['manufacturing', 'boms'] }); toast.success('BOM copied'); },
    onError: (err: any) => { toast.error(err?.response?.data?.message || 'Failed to copy BOM'); },
  });

  const items: BOM[] = Array.isArray(data?.items) ? data.items : Array.isArray(data) ? data : [];

  const handleCreate = (e: React.FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    const form = e.currentTarget;
    const formData = new FormData(form);
    const raw = {
      productId: createProductId,
      bomType: formData.get('bomType') as string || 'MANUFACTURING',
      revision: formData.get('revision') as string || undefined,
      effectiveDate: formData.get('effectiveDate') as string || undefined,
      expiryDate: formData.get('expiryDate') as string || undefined,
      notes: formData.get('notes') as string || undefined,
    };
    const result = createBomSchema.safeParse(raw);
    if (!result.success) {
      const errors = flattenErrors(result.error);
      const firstMsg = Object.values(errors)[0];
      toast.error(firstMsg || 'Validation failed');
      return;
    }
    createMutation.mutate(result.data);
  };

  const handleAddComponent = (e: React.FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    if (!selectedBOM) return;
    const form = e.currentTarget;
    const formData = new FormData(form);
    const raw = {
      componentProductId: componentProductId,
      quantityPer: formData.get('quantityPer') as string,
      uom: formData.get('uom') as string || 'EA',
      isPhantom: formData.get('isPhantom') === 'true',
      wastagePercent: formData.get('wastagePercent') as string,
    };
    const result = addBomComponentSchema.safeParse(raw);
    if (!result.success) {
      const errors = flattenErrors(result.error);
      const firstMsg = Object.values(errors)[0];
      toast.error(firstMsg || 'Validation failed');
      return;
    }
    addComponentMutation.mutate({
      bomId: selectedBOM.id,
      component: result.data,
    });
  };

  const handleCopyBOM = (bom: BOM) => {
    const newRevision = prompt('Enter new revision number:', `${bom.revision}-copy`);
    if (newRevision) {
      copyMutation.mutate({ id: bom.id, targetProductId: bom.productId, newRevision });
    }
  };

  const columns: Column<BOM>[] = [
    {
      key: 'product',
      header: 'Product',
      accessor: (row) => (
        <div>
          <div className="font-medium">{row.product?.name || '—'}</div>
          <div className="text-sm text-secondary-500">{row.product?.sku}</div>
        </div>
      ),
    },
    { key: 'revision', header: 'Revision', accessor: 'revision' },
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
      key: 'components',
      header: 'Components',
      accessor: (row) => row.components?.length ?? 0,
      align: 'right',
    },
    {
      key: 'effectiveDate',
      header: 'Effective',
      accessor: (row) => row.effectiveDate ? format(new Date(row.effectiveDate), 'yyyy-MM-dd') : '—',
    },
    {
      key: 'actions',
      header: 'Actions',
      accessor: (row) => (
        <div className="flex gap-1">
          <button
            onClick={(e) => { e.stopPropagation(); setSelectedBOM(row); setShowWhereUsedModal(true); }}
            className="p-1 hover:bg-gray-100 dark:hover:bg-gray-700 rounded"
            title="Where Used"
          >
            <MagnifyingGlassIcon className="w-4 h-4" />
          </button>
          <button
            onClick={(e) => { e.stopPropagation(); handleCopyBOM(row); }}
            className="p-1 hover:bg-gray-100 dark:hover:bg-gray-700 rounded"
            title="Copy BOM"
          >
            <DocumentDuplicateIcon className="w-4 h-4" />
          </button>
          <button
            onClick={(e) => { e.stopPropagation(); setSelectedBOM(row); setShowComponentModal(true); }}
            className="p-1 hover:bg-gray-100 dark:hover:bg-gray-700 rounded"
            title="Add Component"
          >
            <PlusIcon className="w-4 h-4" />
          </button>
          {row.status === 'DRAFT' && (
            <button
              onClick={(e) => { e.stopPropagation(); updateStatusMutation.mutate({ id: row.id, status: 'ACTIVE' }); }}
              className="p-1 hover:bg-green-100 text-green-600 rounded text-xs"
              title="Activate"
            >
              Activate
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
          <h1 className="text-2xl font-bold">Bill of Materials</h1>
          <p className="text-secondary-500 mt-1">Manage product structures and component definitions</p>
        </div>
        <Button onClick={() => setShowCreateModal(true)}>
          <PlusIcon className="w-4 h-4 mr-2" />
          Create BOM
        </Button>
      </div>

      {isError && <QueryErrorBanner error={error} onRetry={() => refetch()} />}

      <Card>
        <CardHeader
          title="BOMs"
          description="Active and draft BOMs across products"
          actions={
            <select
              value={statusFilter}
              onChange={(e) => setStatusFilter(e.target.value)}
              className="px-3 py-1 border rounded-md text-sm dark:bg-gray-800 dark:border-gray-700"
            >
              <option value="">All Status</option>
              <option value="DRAFT">Draft</option>
              <option value="PENDING_APPROVAL">Pending Approval</option>
              <option value="ACTIVE">Active</option>
              <option value="OBSOLETE">Obsolete</option>
            </select>
          }
        />
        <DataTable
          data={items}
          columns={columns}
          keyExtractor={(row) => row.id}
          isLoading={isLoading}
          emptyMessage="No BOMs found"
          onRowClick={(row) => { setSelectedBOM(row); setShowEditModal(true); }}
        />
      </Card>

      {/* Create BOM Modal */}
      <Modal
        isOpen={showCreateModal}
        onClose={() => setShowCreateModal(false)}
        title="Create Bill of Materials"
      >
        <form onSubmit={handleCreate} className="space-y-4">
          <div>
            <label className="block text-sm font-medium mb-1">Product</label>
            <ProductSelector
              value={createProductId}
              onChange={(id) => setCreateProductId(id)}
              placeholder="Search and select product..."
            />
          </div>
          <div className="grid grid-cols-2 gap-4">
            <div>
              <label className="block text-sm font-medium mb-1">BOM Type</label>
              <select name="bomType" required className="w-full px-3 py-2 border rounded-md dark:bg-gray-800 dark:border-gray-700">
                <option value="MANUFACTURING">Manufacturing</option>
                <option value="ENGINEERING">Engineering</option>
                <option value="PLANNING">Planning</option>
                <option value="COSTING">Costing</option>
              </select>
            </div>
            <div>
              <label className="block text-sm font-medium mb-1">Revision</label>
              <input name="revision" type="text" className="w-full px-3 py-2 border rounded-md dark:bg-gray-800 dark:border-gray-700" placeholder="1.0" />
            </div>
          </div>
          <div className="grid grid-cols-2 gap-4">
            <div>
              <label className="block text-sm font-medium mb-1">Effective Date</label>
              <input name="effectiveDate" type="date" className="w-full px-3 py-2 border rounded-md dark:bg-gray-800 dark:border-gray-700" />
            </div>
            <div>
              <label className="block text-sm font-medium mb-1">Expiry Date (optional)</label>
              <input name="expiryDate" type="date" className="w-full px-3 py-2 border rounded-md dark:bg-gray-800 dark:border-gray-700" />
            </div>
          </div>
          <div>
            <label className="block text-sm font-medium mb-1">Notes</label>
            <textarea name="notes" rows={2} className="w-full px-3 py-2 border rounded-md dark:bg-gray-800 dark:border-gray-700" />
          </div>
          <div className="flex justify-end gap-2 pt-4">
            <Button variant="secondary" type="button" onClick={() => setShowCreateModal(false)}>Cancel</Button>
            <Button type="submit" isLoading={createMutation.isPending}>Create BOM</Button>
          </div>
        </form>
      </Modal>

      {/* BOM Details Modal */}
      <Modal
        isOpen={showEditModal}
        onClose={() => setShowEditModal(false)}
        title={`BOM Details: ${selectedBOM?.product?.name || ''}`}
        size="xl"
      >
        {selectedBOM && (
          <div className="space-y-4">
            <div className="grid grid-cols-4 gap-4 text-sm">
              <div><span className="text-secondary-500">Revision:</span> {selectedBOM.revision}</div>
              <div><span className="text-secondary-500">Status:</span> <Badge variant={statusVariant[selectedBOM.status] || 'default'} size="sm">{selectedBOM.status}</Badge></div>
              <div><span className="text-secondary-500">Effective:</span> {selectedBOM.effectiveDate ? format(new Date(selectedBOM.effectiveDate), 'yyyy-MM-dd') : '—'}</div>
              <div><span className="text-secondary-500">Expires:</span> {selectedBOM.expiryDate ? format(new Date(selectedBOM.expiryDate), 'yyyy-MM-dd') : '—'}</div>
            </div>
            <div className="flex justify-between items-center">
              <h4 className="font-medium">Components ({selectedBOM.components?.length || 0})</h4>
              <div className="flex gap-2">
                <Button size="sm" variant="secondary" onClick={() => { setShowEditModal(false); setShowExplodedModal(true); }}>
                  Explode BOM
                </Button>
                <Button size="sm" onClick={() => { setShowEditModal(false); setShowComponentModal(true); }}>
                  <PlusIcon className="w-4 h-4 mr-1" /> Add Component
                </Button>
              </div>
            </div>
            {selectedBOM.components && selectedBOM.components.length > 0 ? (
              <table className="w-full text-sm">
                <thead>
                  <tr className="text-left border-b dark:border-gray-700">
                    <th className="pb-2">Component</th>
                    <th className="pb-2 text-right">Qty Per</th>
                    <th className="pb-2">UOM</th>
                    <th className="pb-2 text-right">Wastage %</th>
                    <th className="pb-2 text-center">Phantom</th>
                    <th className="pb-2"></th>
                  </tr>
                </thead>
                <tbody>
                  {selectedBOM.components.map((comp: BOMComponent) => (
                    <tr key={comp.id} className="border-b dark:border-gray-700">
                      <td className="py-2">
                        <div>{comp.componentProduct?.name}</div>
                        <div className="text-secondary-500 text-xs">{comp.componentProduct?.sku}</div>
                      </td>
                      <td className="py-2 text-right">{comp.quantityPer}</td>
                      <td className="py-2">{comp.uom || 'EA'}</td>
                      <td className="py-2 text-right">{comp.wastagePercent || 0}%</td>
                      <td className="py-2 text-center">{comp.isPhantom ? 'Yes' : 'No'}</td>
                      <td className="py-2">
                        <button
                          onClick={() => { if (confirm('Remove this component?')) removeComponentMutation.mutate(comp.id); }}
                          className="p-1 hover:bg-red-100 text-red-600 rounded"
                        >
                          <TrashIcon className="w-4 h-4" />
                        </button>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            ) : (
              <p className="text-secondary-500 py-4 text-center">No components defined. Add components to build the product structure.</p>
            )}
          </div>
        )}
      </Modal>

      {/* Add Component Modal */}
      <Modal
        isOpen={showComponentModal}
        onClose={() => setShowComponentModal(false)}
        title={`Add Component to ${selectedBOM?.product?.name || 'BOM'}`}
      >
        <form onSubmit={handleAddComponent} className="space-y-4">
          <div>
            <label className="block text-sm font-medium mb-1">Component Product</label>
            <ProductSelector
              value={componentProductId}
              onChange={(id) => setComponentProductId(id)}
              placeholder="Search for component product..."
              excludeIds={selectedBOM?.productId ? [selectedBOM.productId] : []}
            />
          </div>
          <div className="grid grid-cols-3 gap-4">
            <div>
              <label className="block text-sm font-medium mb-1">Qty Per Parent</label>
              <input name="quantityPer" type="number" step="0.001" min="0" required className="w-full px-3 py-2 border rounded-md dark:bg-gray-800 dark:border-gray-700" />
            </div>
            <div>
              <label className="block text-sm font-medium mb-1">UOM</label>
              <select name="uom" className="w-full px-3 py-2 border rounded-md dark:bg-gray-800 dark:border-gray-700">
                {uomList.map((u) => (
                  <option key={u.id} value={u.code}>{u.code} — {u.name}</option>
                ))}
                {uomList.length === 0 && <option value="EA">EA</option>}
              </select>
            </div>
            <div>
              <label className="block text-sm font-medium mb-1">Wastage %</label>
              <input name="wastagePercent" type="number" step="0.1" min="0" max="100" defaultValue="0" className="w-full px-3 py-2 border rounded-md dark:bg-gray-800 dark:border-gray-700" />
            </div>
          </div>
          <div className="flex items-center gap-2">
            <input type="checkbox" name="isPhantom" value="true" id="isPhantom" className="rounded border-gray-300" />
            <label htmlFor="isPhantom" className="text-sm font-medium">Phantom Component (not stocked, exploded into parent)</label>
          </div>
          <div className="flex justify-end gap-2 pt-4">
            <Button variant="secondary" type="button" onClick={() => setShowComponentModal(false)}>Cancel</Button>
            <Button type="submit" isLoading={addComponentMutation.isPending}>Add Component</Button>
          </div>
        </form>
      </Modal>

      {/* Where Used Modal */}
      <Modal
        isOpen={showWhereUsedModal}
        onClose={() => setShowWhereUsedModal(false)}
        title={`Where Used: ${selectedBOM?.product?.name || ''}`}
        size="lg"
      >
        <div className="space-y-4">
          <p className="text-secondary-500">Products that use this item as a component:</p>
          {whereUsedData && whereUsedData.length > 0 ? (
            <table className="w-full text-sm">
              <thead>
                <tr className="text-left border-b dark:border-gray-700">
                  <th className="pb-2">Parent Product</th>
                  <th className="pb-2">BOM Revision</th>
                  <th className="pb-2 text-right">Qty Per</th>
                  <th className="pb-2">Status</th>
                </tr>
              </thead>
              <tbody>
                {whereUsedData.map((item: any, idx: number) => (
                  <tr key={idx} className="border-b dark:border-gray-700">
                    <td className="py-2">{item.parentProduct?.name || item.parentProduct?.sku}</td>
                    <td className="py-2">{item.bomRevision}</td>
                    <td className="py-2 text-right">{item.quantity}</td>
                    <td className="py-2">
                      <Badge variant={statusVariant[item.bomStatus] || 'default'} size="sm">
                        {item.bomStatus}
                      </Badge>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          ) : (
            <p className="text-secondary-500">This item is not used in any BOMs</p>
          )}
        </div>
      </Modal>

      {/* Exploded BOM Modal */}
      <Modal
        isOpen={showExplodedModal}
        onClose={() => setShowExplodedModal(false)}
        title={`Exploded BOM: ${selectedBOM?.product?.name || ''}`}
        size="xl"
      >
        <div className="space-y-4 max-h-[60vh] overflow-auto">
          {explodedData && explodedData.length > 0 ? (
            <table className="w-full text-sm">
              <thead className="sticky top-0 bg-white dark:bg-gray-900">
                <tr className="text-left border-b dark:border-gray-700">
                  <th className="pb-2">Level</th>
                  <th className="pb-2">Component</th>
                  <th className="pb-2 text-right">Qty Required</th>
                  <th className="pb-2 text-right">Extended Qty</th>
                  <th className="pb-2">Lead Time</th>
                </tr>
              </thead>
              <tbody>
                {explodedData.map((item: any, idx: number) => (
                  <tr key={idx} className="border-b dark:border-gray-700">
                    <td className="py-2">
                      <span style={{ paddingLeft: `${(item.level - 1) * 16}px` }}>
                        {item.level}
                      </span>
                    </td>
                    <td className="py-2" style={{ paddingLeft: `${(item.level - 1) * 16}px` }}>
                      <div>{item.product?.name || item.componentSku}</div>
                      <div className="text-xs text-secondary-500">{item.product?.sku || item.componentSku}</div>
                    </td>
                    <td className="py-2 text-right">{item.quantity}</td>
                    <td className="py-2 text-right">{item.extendedQuantity}</td>
                    <td className="py-2">{item.cumulativeLeadTime} days</td>
                  </tr>
                ))}
              </tbody>
            </table>
          ) : (
            <p className="text-secondary-500">No components to display</p>
          )}
        </div>
      </Modal>
    </div>
  );
}
