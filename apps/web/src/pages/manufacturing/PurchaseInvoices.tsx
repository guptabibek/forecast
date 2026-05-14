import { Badge, Card, CardHeader, Column, DataTable, Modal, QueryErrorBanner } from '@components/ui';
import { DetailPopupActions } from '@components/reports/DetailPopupActions';
import { useGridState } from '@/hooks/useGridState';
import { ArrowPathIcon } from '@heroicons/react/24/outline';
import {
  purchaseInvoiceService,
  type PurchaseInvoiceDetail,
  type PurchaseInvoiceListItem,
} from '@services/api';
import { useQuery } from '@tanstack/react-query';
import { format } from 'date-fns';
import { useEffect, useMemo, useState } from 'react';
import { useSearchParams } from 'react-router-dom';
import { formatInr } from '@utils/number-format';

const safeFormat = (value: string | null | undefined, fmt = 'MMM dd, yyyy', fallback = '—') => {
  if (!value) return fallback;
  try {
    const d = new Date(value);
    if (Number.isNaN(d.getTime())) return fallback;
    return format(d, fmt);
  } catch {
    return fallback;
  }
};

const statusVariant: Record<string, 'default' | 'primary' | 'secondary' | 'success' | 'warning' | 'error'> = {
  POSTED: 'success',
  CONFIRMED: 'success',
  DRAFT: 'secondary',
  CANCELLED: 'error',
};

const sourceLabel: Record<PurchaseInvoiceListItem['source'], string> = {
  MARG_SYNC: 'Marg sync',
  CORE_GRN: 'Core GRN',
};

export default function PurchaseInvoicesPage() {
  const [searchParams] = useSearchParams();
  const linkedInvoiceId = searchParams.get('invoiceId');

  const grid = useGridState({ initialSortBy: 'documentDate', initialSortOrder: 'desc' });

  const [showDetail, setShowDetail] = useState(false);
  const [selectedId, setSelectedId] = useState<string | null>(null);

  const listQuery = useQuery({
    queryKey: ['manufacturing', 'purchase-invoices', grid.queryKey],
    queryFn: () => purchaseInvoiceService.list(grid.queryParams),
    placeholderData: (prev) => prev,
  });

  const detailQuery = useQuery({
    queryKey: ['manufacturing', 'purchase-invoices', selectedId],
    queryFn: () => (selectedId ? purchaseInvoiceService.getById(selectedId) : Promise.resolve(null)),
    enabled: !!selectedId,
  });

  // Auto-select via URL ?invoiceId=...
  useEffect(() => {
    if (linkedInvoiceId) {
      setSelectedId(linkedInvoiceId);
      setShowDetail(true);
    }
  }, [linkedInvoiceId]);

  const items = useMemo<PurchaseInvoiceListItem[]>(
    () => listQuery.data?.items ?? [],
    [listQuery.data?.items],
  );
  const total = listQuery.data?.total ?? 0;

  const summary = useMemo(() => {
    const totalAmount = items.reduce((sum, r) => sum + (r.totalAmount || 0), 0);
    const totalLines = items.reduce((sum, r) => sum + (r.lineCount || 0), 0);
    const margCount = items.filter((r) => r.source === 'MARG_SYNC').length;
    return { totalAmount, totalLines, margCount };
  }, [items]);

  const columns: Column<PurchaseInvoiceListItem>[] = [
    {
      key: 'invoiceNumber',
      header: 'Invoice / VCN',
      sortable: true,
      accessor: (row) => (
        <div>
          <div className="font-medium">{row.invoiceNumber}</div>
          {row.voucher && row.voucher !== row.invoiceNumber && (
            <div className="text-xs text-secondary-500">Voucher: {row.voucher}</div>
          )}
        </div>
      ),
      filterType: 'text',
      filterField: 'invoiceNumber',
    },
    {
      key: 'documentDate',
      header: 'Invoice Date',
      sortable: true,
      accessor: (row) => safeFormat(row.documentDate),
      filterType: 'date',
      filterField: 'documentDate',
    },
    {
      key: 'supplierName',
      header: 'Supplier',
      sortable: true,
      accessor: (row) => (
        <div>
          <div className="font-medium">{row.supplierName ?? '—'}</div>
          {row.supplierCode && <div className="text-xs text-secondary-500">{row.supplierCode}</div>}
        </div>
      ),
      filterType: 'text',
      filterField: 'supplierName',
    },
    {
      key: 'purchaseOrderNumber',
      header: 'PO',
      accessor: (row) =>
        row.purchaseOrderNumber ? (
          <a
            href={`/pharma-reports/purchase-orders?poId=${row.purchaseOrderId}`}
            className="text-primary-700 hover:underline"
          >
            {row.purchaseOrderNumber}
          </a>
        ) : (
          '—'
        ),
      filterType: 'text',
      filterField: 'purchaseOrderNumber',
    },
    {
      key: 'status',
      header: 'Status',
      sortable: true,
      accessor: (row) => (
        <Badge variant={statusVariant[row.status] ?? 'default'} size="sm">
          {row.status}
        </Badge>
      ),
      filterType: 'select',
      filterField: 'status',
      filterOptions: [
        { value: 'POSTED', label: 'Posted' },
        { value: 'CONFIRMED', label: 'Confirmed' },
        { value: 'DRAFT', label: 'Draft' },
        { value: 'CANCELLED', label: 'Cancelled' },
      ],
    },
    {
      key: 'lineCount',
      header: 'Lines',
      sortable: true,
      align: 'right',
      accessor: (row) => row.lineCount,
      filterType: 'number',
      filterField: 'lineCount',
    },
    {
      key: 'totalQty',
      header: 'Qty',
      sortable: true,
      align: 'right',
      accessor: (row) => row.totalQty.toFixed(2),
      filterType: 'number',
      filterField: 'totalQty',
    },
    {
      key: 'totalAmount',
      header: 'Amount',
      sortable: true,
      align: 'right',
      accessor: (row) => formatInr(row.totalAmount),
      filterType: 'number',
      filterField: 'totalAmount',
    },
    {
      key: 'source',
      header: 'Source',
      accessor: (row) => (
        <Badge variant={row.source === 'MARG_SYNC' ? 'primary' : 'secondary'} size="sm">
          {sourceLabel[row.source]}
        </Badge>
      ),
      filterType: 'select',
      filterField: 'source',
      filterOptions: [
        { value: 'MARG_SYNC', label: 'Marg sync' },
        { value: 'CORE_GRN', label: 'Core GRN' },
      ],
    },
  ];

  const detail: PurchaseInvoiceDetail | null = detailQuery.data ?? null;

  return (
    <div className="space-y-4 lg:space-y-6 animate-in">
      <div className="flex flex-col sm:flex-row sm:items-start sm:justify-between gap-4">
        <div>
          <h1 className="text-xl lg:text-2xl font-bold">Purchase Invoices</h1>
          <p className="text-xs lg:text-sm text-secondary-500 mt-1">
            Vendor bills including Marg-synced invoices. Sort by clicking headers.
          </p>
        </div>
        <button className="btn-secondary" onClick={() => void listQuery.refetch()}>
          <ArrowPathIcon className="w-4 h-4 mr-2" />
          Refresh
        </button>
      </div>

      {listQuery.isError && <QueryErrorBanner error={listQuery.error} onRetry={() => listQuery.refetch()} />}

      <div className="grid grid-cols-2 lg:grid-cols-4 gap-3 lg:gap-4">
        <Card padding="sm">
          <p className="text-xs lg:text-sm text-secondary-500">Total Invoices</p>
          <p className="text-xl lg:text-2xl font-bold mt-1">{total}</p>
        </Card>
        <Card padding="sm">
          <p className="text-xs lg:text-sm text-secondary-500">Lines (page)</p>
          <p className="text-xl lg:text-2xl font-bold mt-1">{summary.totalLines}</p>
        </Card>
        <Card padding="sm">
          <p className="text-xs lg:text-sm text-secondary-500">Amount (page)</p>
          <p className="text-xl lg:text-2xl font-bold mt-1">{formatInr(summary.totalAmount)}</p>
        </Card>
        <Card padding="sm">
          <p className="text-xs lg:text-sm text-secondary-500">Marg Synced</p>
          <p className="text-xl lg:text-2xl font-bold mt-1">{summary.margCount}</p>
        </Card>
      </div>

      <Card padding="none">
        <CardHeader title="Purchase Invoices" description="Click a row to view invoice details and line items." />
        <DataTable
          data={items}
          columns={columns}
          keyExtractor={(row) => row.id}
          isLoading={listQuery.isLoading}
          emptyMessage="No purchase invoices found"
          onRowClick={(row) => {
            setSelectedId(row.id);
            setShowDetail(true);
          }}
          sorting={grid.sortingProps}
          filtering={grid.filteringProps}
          pagination={grid.paginationProps(total)}
        />
      </Card>

      <Modal
        isOpen={showDetail}
        onClose={() => setShowDetail(false)}
        title={detail ? `Purchase Invoice: ${detail.invoiceNumber}` : 'Purchase Invoice'}
        size="2xl"
      >
        {detailQuery.isLoading && (
          <div className="flex items-center justify-center py-12">
            <div className="animate-spin rounded-full h-8 w-8 border-t-2 border-b-2 border-primary-500" />
          </div>
        )}
        {detail && (
          <div className="space-y-4 lg:space-y-6">
            <DetailPopupActions
              title="Purchase Invoice"
              documentNumber={detail.invoiceNumber}
              fields={[
                { label: 'Invoice Number', value: detail.invoiceNumber },
                { label: 'Supplier', value: detail.supplierName },
                { label: 'Supplier Code', value: detail.supplierCode },
                { label: 'Phone', value: detail.supplierPhone },
                { label: 'GSTIN', value: detail.supplierGstn },
                { label: 'Address', value: detail.supplierAddress },
                { label: 'Bill Date', value: safeFormat(detail.documentDate) },
                { label: 'Order Date', value: safeFormat(detail.orderDate) },
                { label: 'Status', value: detail.status },
                { label: 'Source', value: detail.source },
                { label: 'Linked PO', value: detail.purchaseOrderNumber },
                { label: 'Total Amount', value: formatInr(detail.totalAmount) },
              ]}
              tables={[{
                title: 'Line Items',
                columns: [
                  { key: 'line', header: '#', align: 'center' },
                  { key: 'product', header: 'Product' },
                  { key: 'quantity', header: 'Qty', align: 'right' },
                  { key: 'uom', header: 'UoM' },
                  { key: 'unitPrice', header: 'Unit Price', align: 'right' },
                  { key: 'lineAmount', header: 'Line Amount', align: 'right' },
                  { key: 'batch', header: 'Batch' },
                  { key: 'expiry', header: 'Expiry' },
                ],
                rows: detail.lines.map((line) => ({
                  line: line.lineNumber,
                  product: line.productName ?? line.productId ?? '-',
                  quantity: line.quantity.toFixed(2),
                  uom: line.uom ?? '-',
                  unitPrice: formatInr(line.unitPrice),
                  lineAmount: formatInr(line.lineAmount),
                  batch: line.lotNumber ?? '-',
                  expiry: safeFormat(line.expiryDate),
                })),
              }]}
              totals={[
                { label: 'Total Qty', value: detail.totalQty.toFixed(2) },
                { label: 'Total Amount', value: formatInr(detail.totalAmount) },
              ]}
            />
            <div className="rounded-lg border dark:border-gray-700 p-4 space-y-2">
              <div className="text-xs uppercase tracking-wide text-secondary-500">Supplier</div>
              <div className="font-semibold">{detail.supplierName ?? '—'}</div>
              <div className="grid grid-cols-1 gap-x-6 gap-y-2 text-xs text-secondary-500 mt-1 md:grid-cols-3">
                {detail.supplierCode && (
                  <div>
                    <span className="text-gray-400">Code:</span>{' '}
                    <span className="text-secondary-700 dark:text-secondary-300">{detail.supplierCode}</span>
                  </div>
                )}
                {detail.supplierPhone && (
                  <div>
                    <span className="text-gray-400">Phone:</span>{' '}
                    <span className="text-secondary-700 dark:text-secondary-300">{detail.supplierPhone}</span>
                  </div>
                )}
                {detail.supplierGstn && (
                  <div>
                    <span className="text-gray-400">GSTIN:</span>{' '}
                    <span className="font-mono text-secondary-700 dark:text-secondary-300">{detail.supplierGstn}</span>
                  </div>
                )}
                {detail.supplierAddress && (
                  <div className="md:col-span-3">
                    <span className="text-gray-400">Address:</span>{' '}
                    <span className="text-secondary-700 dark:text-secondary-300 whitespace-pre-line">
                      {detail.supplierAddress}
                    </span>
                  </div>
                )}
              </div>
            </div>

            <div className="grid grid-cols-2 gap-3 text-sm sm:grid-cols-3 md:grid-cols-4">
              <div>
                <div className="text-secondary-500">Status</div>
                <div>
                  <Badge variant={statusVariant[detail.status] ?? 'default'} size="sm">
                    {detail.status}
                  </Badge>
                </div>
              </div>
              <div>
                <div className="text-secondary-500">Invoice Date</div>
                <div>{safeFormat(detail.documentDate)}</div>
              </div>
              <div>
                <div className="text-secondary-500">Order Date</div>
                <div>{safeFormat(detail.orderDate)}</div>
              </div>
              <div>
                <div className="text-secondary-500">Linked PO</div>
                <div>
                  {detail.purchaseOrderNumber ? (
                    <a
                      href={`/pharma-reports/purchase-orders?poId=${detail.purchaseOrderId}`}
                      className="text-primary-700 hover:underline"
                    >
                      {detail.purchaseOrderNumber}
                    </a>
                  ) : (
                    '—'
                  )}
                </div>
              </div>
              <div>
                <div className="text-secondary-500">Source</div>
                <div>
                  <Badge variant={detail.source === 'MARG_SYNC' ? 'primary' : 'secondary'} size="sm">
                    {sourceLabel[detail.source]}
                  </Badge>
                </div>
              </div>
              {detail.vcn && (
                <div>
                  <div className="text-secondary-500">VCN</div>
                  <div className="font-mono text-xs">{detail.vcn}</div>
                </div>
              )}
              {detail.voucher && detail.voucher !== detail.invoiceNumber && (
                <div>
                  <div className="text-secondary-500">Voucher</div>
                  <div className="font-mono text-xs">{detail.voucher}</div>
                </div>
              )}
              {detail.orn && (
                <div>
                  <div className="text-secondary-500">ORN (Order Ref)</div>
                  <div className="font-mono text-xs">{detail.orn}</div>
                </div>
              )}
              {detail.companyId !== null && (
                <div>
                  <div className="text-secondary-500">Marg Company</div>
                  <div>{detail.companyId}</div>
                </div>
              )}
            </div>

            <div className="grid grid-cols-3 gap-3 text-sm pt-2 border-t dark:border-gray-700">
              <div>
                <div className="text-secondary-500">Lines</div>
                <div className="text-lg font-semibold">{detail.lineCount}</div>
              </div>
              <div>
                <div className="text-secondary-500">Total Qty</div>
                <div className="text-lg font-semibold">{detail.totalQty.toFixed(2)}</div>
              </div>
              <div>
                <div className="text-secondary-500">Total Amount</div>
                <div className="text-lg font-semibold">{formatInr(detail.totalAmount)}</div>
              </div>
            </div>

            <div>
              <div className="text-sm font-medium mb-2">Line Items</div>
              <div className="overflow-x-auto rounded-lg border dark:border-gray-700">
                <table className="w-full min-w-[980px] text-sm border-collapse">
                  <thead className="bg-secondary-50 dark:bg-secondary-900/40">
                    <tr className="text-left border-b dark:border-gray-700">
                      <th className="px-3 py-2 w-12">#</th>
                      <th className="px-3 py-2">Product</th>
                      <th className="px-3 py-2 text-right">Qty</th>
                      <th className="px-3 py-2 w-16">UoM</th>
                      <th className="px-3 py-2 text-right">Unit Price</th>
                      <th className="px-3 py-2 text-right">Line Amount</th>
                      <th className="px-3 py-2">Lot</th>
                      <th className="px-3 py-2">Expiry</th>
                    </tr>
                  </thead>
                  <tbody>
                    {detail.lines.map((line) => (
                      <tr key={line.id} className="border-b last:border-0 dark:border-gray-700">
                        <td className="px-3 py-3">{line.lineNumber}</td>
                        <td className="px-3 py-3">
                          <div>{line.productName ?? line.productId ?? '—'}</div>
                          {line.productSku && (
                            <div className="text-xs text-secondary-500">{line.productSku}</div>
                          )}
                        </td>
                        <td className="px-3 py-3 text-right">{line.quantity.toFixed(2)}</td>
                        <td className="px-3 py-3">{line.uom ?? '—'}</td>
                        <td className="px-3 py-3 text-right">{formatInr(line.unitPrice)}</td>
                        <td className="px-3 py-3 text-right">{formatInr(line.lineAmount)}</td>
                        <td className="px-3 py-3">{line.lotNumber ?? '—'}</td>
                        <td className="px-3 py-3">{safeFormat(line.expiryDate)}</td>
                      </tr>
                    ))}
                    {detail.lines.length === 0 && (
                      <tr>
                        <td colSpan={8} className="py-4 text-center text-secondary-500">
                          No line items
                        </td>
                      </tr>
                    )}
                  </tbody>
                </table>
              </div>
            </div>
          </div>
        )}
      </Modal>
    </div>
  );
}
