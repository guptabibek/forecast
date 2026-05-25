import { dataService } from '@services/api';
import { useQuery } from '@tanstack/react-query';
import { useMemo, useRef, useState } from 'react';
import type { Column } from '../../components/ui';
import {
  Alert,
  Badge,
  Button,
  Card,
  CardHeader,
  DataTable,
  Input,
  Modal,
  ProductSelector,
  QueryErrorBanner,
  Select,
} from '../../components/ui';
import type { ProductOption } from '../../components/ui';
import {
  useDeleteReorderConfig,
  useDeleteReorderPolicyScope,
  useReorderConfig,
  useReorderPolicyScopes,
  useReorderScopeOptions,
  useUpsertReorderConfig,
  useUpsertReorderPolicyScopes,
} from '../../hooks/usePharmaReports';
import {
  pharmaReportsService,
  type ReorderPolicyInput,
  type ReorderPolicyRow,
  type ReorderPolicyScopeInput,
  type ReorderPolicyScopeRow,
  type ReorderPolicyScopeType,
} from '../../services/api/pharma-reports.service';
import { parseReorderConfigCsv, parseReorderScopeConfigCsv } from './reorderConfigCsv';
import { fmt } from './shared';

// The editable numeric fields, in display order. Kept in one place so the form,
// the table and the CSV template stay in lockstep.
const NUMERIC_FIELDS: { key: keyof ReorderPolicyInput; label: string; hint: string }[] = [
  { key: 'reorderPoint', label: 'Reorder point', hint: 'Minimum level — reorder when stock ≤ this.' },
  { key: 'minOrderQty', label: 'Min order qty (MOQ)', hint: 'Suggested qty is raised to at least this.' },
  { key: 'maxOrderQty', label: 'Max order qty', hint: 'Suggested qty is capped at this.' },
  { key: 'multipleOrderQty', label: 'Pack / multiple', hint: 'Suggested qty is rounded up to a multiple of this.' },
  { key: 'reorderQty', label: 'Fixed reorder lot', hint: 'When set, used as the order qty instead of the computed need.' },
  { key: 'safetyStockQty', label: 'Safety stock qty', hint: 'Fixed safety stock (overrides safety days).' },
  { key: 'safetyStockDays', label: 'Safety days', hint: 'Safety stock as days of cover × avg daily demand.' },
  { key: 'leadTimeDays', label: 'Lead time (days)', hint: 'Supplier lead time for this product × location.' },
];

const CSV_TEMPLATE_HEADERS = [
  'productCode', 'locationCode', 'reorderPoint', 'minOrderQty', 'maxOrderQty',
  'multipleOrderQty', 'reorderQty', 'safetyStockQty', 'safetyStockDays', 'leadTimeDays', 'abcClass',
];

const SCOPE_CSV_TEMPLATE_HEADERS = [
  'scopeType', 'scopeCode', 'scopeId', 'supplierCode', 'locationCode', 'priority', 'reorderPoint',
  'minOrderQty', 'maxOrderQty', 'multipleOrderQty', 'reorderQty',
  'safetyStockQty', 'safetyStockDays', 'leadTimeDays', 'abcClass',
];

const SCOPE_TYPE_OPTIONS: { value: ReorderPolicyScopeType; label: string }[] = [
  { value: 'PRODUCT_COMPANY', label: 'Product company' },
  { value: 'HSN_CODE', label: 'HSN code' },
  { value: 'SALT', label: 'Salt' },
  { value: 'PRODUCT_GROUP', label: 'Product group' },
  { value: 'SUPPLIER', label: 'Product supplier' },
];

type FormState = {
  productId: string;
  productLabel: string; // code — name, for display when locked (edit)
  locationId: string;
  abcClass: string;
} & Partial<Record<keyof ReorderPolicyInput, number | string>>;

const emptyForm = (): FormState => ({ productId: '', productLabel: '', locationId: '', abcClass: '' });

type ScopeFormState = {
  id?: string;
  scopeType: ReorderPolicyScopeType;
  scopeCode: string;
  scopeId: string;
  supplierCode: string;
  locationId: string;
  priority: number | '';
  abcClass: string;
} & Partial<Record<keyof ReorderPolicyScopeInput, number | string>>;

const defaultPriority = (scopeType: ReorderPolicyScopeType) => {
  switch (scopeType) {
    case 'SUPPLIER': return 90;
    case 'PRODUCT_GROUP': return 80;
    case 'PRODUCT_COMPANY': return 70;
    case 'SALT': return 60;
    case 'HSN_CODE': return 50;
  }
};

const emptyScopeForm = (): ScopeFormState => ({
  scopeType: 'PRODUCT_COMPANY',
  scopeCode: '',
  scopeId: '',
  supplierCode: '',
  locationId: '',
  priority: defaultPriority('PRODUCT_COMPANY'),
  abcClass: '',
});

// Quote a CSV cell when it contains a comma, quote or newline (RFC-4180).
const csvEscape = (v: string) => (/[",\n\r]/.test(v) ? `"${v.replace(/"/g, '""')}"` : v);

export default function ReorderConfigPage() {
  const [activeConfigTab, setActiveConfigTab] = useState<'product' | 'scope'>('product');
  const [page, setPage] = useState(0);
  const [scopePage, setScopePage] = useState(0);
  const pageSize = 50;
  const list = useReorderConfig({ limit: pageSize, offset: page * pageSize });
  const scopeList = useReorderPolicyScopes({ limit: pageSize, offset: scopePage * pageSize });

  const upsert = useUpsertReorderConfig();
  const del = useDeleteReorderConfig();
  const upsertScope = useUpsertReorderPolicyScopes();
  const deleteScope = useDeleteReorderPolicyScope();

  // Locations for the add-form dropdown.
  const { data: locations = [] } = useQuery({
    queryKey: ['reorder-config-locations'],
    queryFn: () => dataService.getLocations({ limit: 500 }),
    staleTime: 60_000,
  });
  const locationOptions = useMemo(
    () => locations.map((l) => ({ value: l.id, label: `${l.code} — ${l.name}` })),
    [locations],
  );

  // ── Editor modal ──────────────────────────────────────────────────────────
  const scopeLocationOptions = useMemo(
    () => [{ value: '', label: 'All locations' }, ...locationOptions],
    [locationOptions],
  );

  const [editorOpen, setEditorOpen] = useState(false);
  const [editingExisting, setEditingExisting] = useState(false);
  const [form, setForm] = useState<FormState>(emptyForm());
  const [formError, setFormError] = useState<string | null>(null);
  const [scopeEditorOpen, setScopeEditorOpen] = useState(false);
  const [scopeForm, setScopeForm] = useState<ScopeFormState>(emptyScopeForm());
  const [scopeSearch, setScopeSearch] = useState('');
  const [scopeFormError, setScopeFormError] = useState<string | null>(null);
  const scopeOptions = useReorderScopeOptions(
    { scopeType: scopeForm.scopeType, search: scopeSearch || undefined, limit: 50 },
    scopeEditorOpen,
  );

  const openAdd = () => {
    setForm(emptyForm());
    setEditingExisting(false);
    setFormError(null);
    setEditorOpen(true);
  };

  const openEdit = (r: ReorderPolicyRow) => {
    setForm({
      productId: r.product_id,
      productLabel: `${r.product_code} — ${r.product_name}`,
      locationId: r.location_id,
      abcClass: r.abc_class ?? '',
      reorderPoint: r.reorder_point ?? undefined,
      minOrderQty: r.min_order_qty ?? undefined,
      maxOrderQty: r.max_order_qty ?? undefined,
      multipleOrderQty: r.multiple_order_qty ?? undefined,
      reorderQty: r.reorder_qty ?? undefined,
      safetyStockQty: r.safety_stock_qty ?? undefined,
      safetyStockDays: r.safety_stock_days ?? undefined,
      leadTimeDays: r.lead_time_days ?? undefined,
    });
    setEditingExisting(true);
    setFormError(null);
    setEditorOpen(true);
  };

  const setNum = (key: keyof ReorderPolicyInput, raw: string) =>
    setForm((f) => ({ ...f, [key]: raw === '' ? undefined : Number(raw) }));

  const handleSave = async () => {
    setFormError(null);
    if (!form.productId) { setFormError('Pick a product.'); return; }
    if (!form.locationId) { setFormError('Pick a location.'); return; }

    const row: ReorderPolicyInput = { productId: form.productId, locationId: form.locationId };
    for (const { key } of NUMERIC_FIELDS) {
      const v = form[key];
      if (v !== undefined && v !== '') {
        const n = Number(v);
        if (!Number.isFinite(n) || n < 0) { setFormError(`"${String(v)}" is not a valid value.`); return; }
        (row as unknown as Record<string, unknown>)[key] = n;
      }
    }
    if (form.abcClass) row.abcClass = String(form.abcClass).toUpperCase();

    try {
      const res = await upsert.mutateAsync([row]);
      if (res.skipped.length) {
        setFormError(`Not saved: ${res.skipped[0].reason}.`);
        return;
      }
      setEditorOpen(false);
    } catch {
      setFormError('Save failed. Check your access and try again.');
    }
  };

  const openAddScope = () => {
    setScopeForm(emptyScopeForm());
    setScopeSearch('');
    setScopeFormError(null);
    setScopeEditorOpen(true);
  };

  const openEditScope = (r: ReorderPolicyScopeRow) => {
    setScopeForm({
      id: r.id,
      scopeType: r.scope_type,
      scopeCode: r.scope_code ?? '',
      scopeId: r.scope_id ?? '',
      supplierCode: '',
      locationId: r.location_id ?? '',
      priority: r.priority,
      abcClass: r.abc_class ?? '',
      reorderPoint: r.reorder_point ?? undefined,
      minOrderQty: r.min_order_qty ?? undefined,
      maxOrderQty: r.max_order_qty ?? undefined,
      multipleOrderQty: r.multiple_order_qty ?? undefined,
      reorderQty: r.reorder_qty ?? undefined,
      safetyStockQty: r.safety_stock_qty ?? undefined,
      safetyStockDays: r.safety_stock_days ?? undefined,
      leadTimeDays: r.lead_time_days ?? undefined,
    });
    setScopeSearch(r.scope_label);
    setScopeFormError(null);
    setScopeEditorOpen(true);
  };

  const setScopeNum = (key: keyof ReorderPolicyScopeInput, raw: string) =>
    setScopeForm((f) => ({ ...f, [key]: raw === '' ? undefined : Number(raw) }));

  const handleScopeSave = async () => {
    setScopeFormError(null);
    const row: ReorderPolicyScopeInput = { scopeType: scopeForm.scopeType };

    if (scopeForm.scopeType === 'SUPPLIER') {
      if (!scopeForm.scopeId && !scopeForm.supplierCode) {
        setScopeFormError('Pick a supplier.');
        return;
      }
      if (scopeForm.scopeId) row.scopeId = scopeForm.scopeId;
      if (scopeForm.supplierCode) row.supplierCode = scopeForm.supplierCode;
    } else {
      if (!scopeForm.scopeCode.trim()) {
        setScopeFormError('Pick a scope value.');
        return;
      }
      row.scopeCode = scopeForm.scopeCode.trim();
    }

    if (scopeForm.locationId) row.locationId = scopeForm.locationId;
    if (scopeForm.priority !== '') row.priority = Number(scopeForm.priority);

    for (const { key } of NUMERIC_FIELDS) {
      const v = scopeForm[key as keyof ScopeFormState];
      if (v !== undefined && v !== '') {
        const n = Number(v);
        if (!Number.isFinite(n) || n < 0) { setScopeFormError(`"${String(v)}" is not a valid value.`); return; }
        (row as unknown as Record<string, unknown>)[key] = n;
      }
    }
    if (scopeForm.abcClass) row.abcClass = String(scopeForm.abcClass).toUpperCase();

    try {
      const res = await upsertScope.mutateAsync([row]);
      if (res.skipped.length) {
        setScopeFormError(`Not saved: ${res.skipped[0].reason}.`);
        return;
      }
      setScopeEditorOpen(false);
    } catch {
      setScopeFormError('Save failed. Check your access and try again.');
    }
  };

  // ── Delete confirmation ─────────────────────────────────────────────────────
  const [toDelete, setToDelete] = useState<ReorderPolicyRow | null>(null);
  const [scopeToDelete, setScopeToDelete] = useState<ReorderPolicyScopeRow | null>(null);
  const confirmDelete = async () => {
    if (!toDelete) return;
    await del.mutateAsync({ productId: toDelete.product_id, locationId: toDelete.location_id });
    setToDelete(null);
  };
  const confirmDeleteScope = async () => {
    if (!scopeToDelete) return;
    await deleteScope.mutateAsync(scopeToDelete.id);
    setScopeToDelete(null);
  };

  // ── CSV import + template ───────────────────────────────────────────────────
  const csvInputRef = useRef<HTMLInputElement>(null);
  const scopeCsvInputRef = useRef<HTMLInputElement>(null);
  const [importMsg, setImportMsg] = useState<{ kind: 'ok' | 'error'; text: string } | null>(null);

  const handleConfigCsv = async (file: File) => {
    setImportMsg(null);
    const text = await file.text();
    const { rows, errors } = parseReorderConfigCsv(text);
    if (errors.length) {
      setImportMsg({ kind: 'error', text: `CSV not imported. ${errors.slice(0, 3).join(' ')}${errors.length > 3 ? ` (+${errors.length - 3} more)` : ''}` });
      return;
    }
    try {
      const res = await upsert.mutateAsync(rows);
      const skippedNote = res.skipped.length
        ? ` ${res.skipped.length} row(s) skipped (unknown product/location).`
        : '';
      setImportMsg({ kind: res.skipped.length ? 'error' : 'ok', text: `Imported ${res.upserted} policy override(s).${skippedNote}` });
    } catch {
      setImportMsg({ kind: 'error', text: 'Import failed. Check your access and try again.' });
    }
  };

  const handleScopeConfigCsv = async (file: File) => {
    setImportMsg(null);
    const text = await file.text();
    const { rows, errors } = parseReorderScopeConfigCsv(text);
    if (errors.length) {
      setImportMsg({ kind: 'error', text: `CSV not imported. ${errors.slice(0, 3).join(' ')}${errors.length > 3 ? ` (+${errors.length - 3} more)` : ''}` });
      return;
    }
    try {
      const res = await upsertScope.mutateAsync(rows);
      const skippedNote = res.skipped.length
        ? ` ${res.skipped.length} row(s) skipped (unknown scope/location).`
        : '';
      setImportMsg({ kind: res.skipped.length ? 'error' : 'ok', text: `Imported ${res.upserted} scoped policy override(s).${skippedNote}` });
    } catch {
      setImportMsg({ kind: 'error', text: 'Import failed. Check your access and try again.' });
    }
  };

  const [templateBusy, setTemplateBusy] = useState(false);
  const triggerCsvDownload = (csv: string, name: string) => {
    const url = URL.createObjectURL(new Blob([csv], { type: 'text/csv;charset=utf-8' }));
    const a = document.createElement('a');
    a.href = url;
    a.download = name;
    a.click();
    URL.revokeObjectURL(url);
  };

  // Download a template pre-populated with EVERY product × stock location, with
  // any existing override already filled in. The product/location *name* columns
  // are helpers — the importer maps only the *code* columns and ignores the rest.
  const downloadTemplate = async () => {
    setTemplateBusy(true);
    setImportMsg(null);
    try {
      const rows = await pharmaReportsService.getReorderConfigTemplate();
      const headers = [...CSV_TEMPLATE_HEADERS, 'productName', 'locationName'];
      const num = (v: number | null) => (v == null ? '' : String(v));
      const lines = rows.map((r) =>
        [
          r.product_code, r.location_code,
          num(r.reorder_point), num(r.min_order_qty), num(r.max_order_qty),
          num(r.multiple_order_qty), num(r.reorder_qty), num(r.safety_stock_qty),
          num(r.safety_stock_days), num(r.lead_time_days), r.abc_class ?? '',
          r.product_name, r.location_name,
        ].map(csvEscape).join(','),
      );
      const body = lines.length ? `${lines.join('\n')}\n` : '';
      triggerCsvDownload(`${headers.join(',')}\n${body}`, 'reorder-config-template.csv');
    } catch {
      setImportMsg({ kind: 'error', text: 'Could not build the template. Check your access and try again.' });
    } finally {
      setTemplateBusy(false);
    }
  };

  const downloadScopeTemplate = () => {
    setImportMsg(null);
    const headers = SCOPE_CSV_TEMPLATE_HEADERS;
    const num = (v: number | null) => (v == null ? '' : String(v));
    const lines = (scopeList.data?.data ?? []).map((r) =>
      [
        r.scope_type,
        r.scope_type === 'SUPPLIER' ? '' : r.scope_code ?? '',
        r.scope_type === 'SUPPLIER' ? r.scope_id ?? '' : '',
        '',
        r.location_code ?? '',
        String(r.priority),
        num(r.reorder_point),
        num(r.min_order_qty),
        num(r.max_order_qty),
        num(r.multiple_order_qty),
        num(r.reorder_qty),
        num(r.safety_stock_qty),
        num(r.safety_stock_days),
        num(r.lead_time_days),
        r.abc_class ?? '',
      ].map(csvEscape).join(','),
    );
    const body = lines.length ? `${lines.join('\n')}\n` : '';
    triggerCsvDownload(`${headers.join(',')}\n${body}`, 'reorder-scope-config.csv');
  };

  // ── Table ───────────────────────────────────────────────────────────────────
  const cols: Column<ReorderPolicyRow>[] = [
    { key: 'product_code', header: 'SKU', accessor: 'product_code', width: '110px' },
    { key: 'product_name', header: 'Product', accessor: 'product_name' },
    { key: 'location_code', header: 'Location', accessor: (r) => `${r.location_code}`, width: '100px' },
    { key: 'reorder_point', header: 'Reorder Pt', accessor: (r) => fmt(r.reorder_point), align: 'right' },
    { key: 'min_order_qty', header: 'MOQ', accessor: (r) => fmt(r.min_order_qty), align: 'right' },
    { key: 'max_order_qty', header: 'Max', accessor: (r) => fmt(r.max_order_qty), align: 'right' },
    { key: 'multiple_order_qty', header: 'Pack', accessor: (r) => fmt(r.multiple_order_qty), align: 'right' },
    { key: 'safety_stock_qty', header: 'Safety Qty', accessor: (r) => fmt(r.safety_stock_qty), align: 'right' },
    { key: 'safety_stock_days', header: 'Safety Days', accessor: (r) => (r.safety_stock_days ?? '—'), align: 'right' },
    { key: 'lead_time_days', header: 'Lead Days', accessor: (r) => (r.lead_time_days ?? '—'), align: 'right' },
    {
      key: 'abc_class', header: 'ABC',
      accessor: (r) => <Badge variant={r.abc_class === 'A' ? 'success' : r.abc_class === 'B' ? 'warning' : 'default'} size="sm">{r.abc_class ?? '—'}</Badge>,
    },
    {
      key: 'actions', header: '', width: '140px',
      accessor: (r) => (
        <div className="flex gap-2 justify-end">
          <Button variant="outline" size="sm" onClick={() => openEdit(r)}>Edit</Button>
          <Button variant="danger" size="sm" onClick={() => setToDelete(r)}>Delete</Button>
        </div>
      ),
    },
  ];

  const scopeCols: Column<ReorderPolicyScopeRow>[] = [
    {
      key: 'scope_type',
      header: 'Scope',
      accessor: (r) => SCOPE_TYPE_OPTIONS.find((o) => o.value === r.scope_type)?.label ?? r.scope_type,
      width: '150px',
    },
    { key: 'scope_label', header: 'Value', accessor: 'scope_label' },
    { key: 'location_code', header: 'Location', accessor: (r) => r.location_code ?? 'All locations', width: '130px' },
    { key: 'priority', header: 'Priority', accessor: (r) => r.priority, align: 'right', width: '90px' },
    { key: 'reorder_point', header: 'Reorder Pt', accessor: (r) => fmt(r.reorder_point), align: 'right' },
    { key: 'min_order_qty', header: 'MOQ', accessor: (r) => fmt(r.min_order_qty), align: 'right' },
    { key: 'max_order_qty', header: 'Max', accessor: (r) => fmt(r.max_order_qty), align: 'right' },
    { key: 'multiple_order_qty', header: 'Pack', accessor: (r) => fmt(r.multiple_order_qty), align: 'right' },
    { key: 'safety_stock_qty', header: 'Safety Qty', accessor: (r) => fmt(r.safety_stock_qty), align: 'right' },
    { key: 'safety_stock_days', header: 'Safety Days', accessor: (r) => (r.safety_stock_days ?? 'â€”'), align: 'right' },
    { key: 'lead_time_days', header: 'Lead Days', accessor: (r) => (r.lead_time_days ?? 'â€”'), align: 'right' },
    {
      key: 'abc_class',
      header: 'ABC',
      accessor: (r) => <Badge variant={r.abc_class === 'A' ? 'success' : r.abc_class === 'B' ? 'warning' : 'default'} size="sm">{r.abc_class ?? 'â€”'}</Badge>,
    },
    {
      key: 'actions',
      header: '',
      width: '140px',
      accessor: (r) => (
        <div className="flex gap-2 justify-end">
          <Button variant="outline" size="sm" onClick={() => openEditScope(r)}>Edit</Button>
          <Button variant="danger" size="sm" onClick={() => setScopeToDelete(r)}>Delete</Button>
        </div>
      ),
    },
  ];

  const total = list.data?.total ?? 0;
  const rows = list.data?.data ?? [];
  const pageCount = Math.max(1, Math.ceil(total / pageSize));
  const scopeTotal = scopeList.data?.total ?? 0;
  const scopeRows = scopeList.data?.data ?? [];
  const scopePageCount = Math.max(1, Math.ceil(scopeTotal / pageSize));
  const selectedScopeValue = scopeForm.scopeType === 'SUPPLIER' ? scopeForm.scopeId : scopeForm.scopeCode;
  const scopeValueOptions = useMemo(() => {
    const options = scopeOptions.data ?? [];
    if (!selectedScopeValue || options.some((o) => o.value === selectedScopeValue)) return options;
    return [{ value: selectedScopeValue, code: selectedScopeValue, label: scopeSearch || selectedScopeValue }, ...options];
  }, [scopeOptions.data, scopeSearch, selectedScopeValue]);

  return (
    <div className="space-y-4 lg:space-y-6">
      <div className="flex flex-wrap justify-between items-start gap-3">
        <div>
          <h1 className="text-2xl font-bold text-gray-900">Reorder Configuration</h1>
          <p className="mt-1 text-sm text-gray-500">
            Per product × location overrides. Any field left blank falls back to the demand-driven computation in the Reorder report.
          </p>
        </div>
        <div className="flex flex-wrap gap-2">
          <Button
            variant="outline"
            size="sm"
            isLoading={activeConfigTab === 'product' && templateBusy}
            onClick={() => activeConfigTab === 'product' ? void downloadTemplate() : downloadScopeTemplate()}
          >
            Download template
          </Button>
          <Button
            variant="outline"
            size="sm"
            isLoading={activeConfigTab === 'product' ? upsert.isPending : upsertScope.isPending}
            onClick={() => activeConfigTab === 'product' ? csvInputRef.current?.click() : scopeCsvInputRef.current?.click()}
          >
            Import CSV
          </Button>
          <Button variant="primary" size="sm" onClick={activeConfigTab === 'product' ? openAdd : openAddScope}>
            {activeConfigTab === 'product' ? 'Add policy' : 'Add scoped policy'}
          </Button>
          <input
            ref={csvInputRef}
            type="file"
            accept=".csv,text/csv"
            className="hidden"
            onChange={(e) => {
              const f = e.target.files?.[0];
              if (f) void handleConfigCsv(f);
              e.target.value = '';
            }}
          />
          <input
            ref={scopeCsvInputRef}
            type="file"
            accept=".csv,text/csv"
            className="hidden"
            onChange={(e) => {
              const f = e.target.files?.[0];
              if (f) void handleScopeConfigCsv(f);
              e.target.value = '';
            }}
          />
        </div>
      </div>

      <Alert variant="info" title="Reorder policy precedence">
        Exact product-location policies are applied first. When no exact policy exists, matching scoped policies apply; location-specific scopes beat all-location scopes, then higher priority wins, then the most recently updated policy wins. Blank policy fields fall back to the demand-driven calculation.
      </Alert>

      <div className="border-b border-gray-200">
        <nav className="-mb-px flex gap-6" aria-label="Reorder config tabs">
          {[
            { key: 'product' as const, label: 'Product-location policies' },
            { key: 'scope' as const, label: 'Scoped policies' },
          ].map((tab) => (
            <button
              key={tab.key}
              type="button"
              onClick={() => setActiveConfigTab(tab.key)}
              className={`border-b-2 py-2 text-sm font-medium ${
                activeConfigTab === tab.key
                  ? 'border-primary-500 text-primary-600'
                  : 'border-transparent text-gray-500 hover:border-gray-300 hover:text-gray-700'
              }`}
            >
              {tab.label}
            </button>
          ))}
        </nav>
      </div>

      {importMsg && (
        <div className={`rounded-md px-4 py-2 text-sm ${importMsg.kind === 'ok' ? 'text-green-700 bg-green-50' : 'text-amber-800 bg-amber-50'}`}>
          {importMsg.text}
        </div>
      )}

      {activeConfigTab === 'product' && list.isError && <QueryErrorBanner error={list.error} />}
      {activeConfigTab === 'scope' && scopeList.isError && <QueryErrorBanner error={scopeList.error} />}

      {activeConfigTab === 'product' && (
      <Card padding="none">
        <CardHeader title={`Configured policies${total ? ` (${total})` : ''}`} className="px-6 pt-6" />
        <DataTable<ReorderPolicyRow>
          data={rows}
          columns={cols}
          keyExtractor={(r) => `${r.product_id}-${r.location_id}`}
          isLoading={list.isLoading}
          emptyMessage="No reorder overrides yet. Add a policy or import a CSV — until then the Reorder report computes levels from demand."
        />
        {pageCount > 1 && (
          <div className="flex items-center justify-between px-6 py-3 border-t border-gray-100 text-sm text-gray-600">
            <span>Page {page + 1} of {pageCount}</span>
            <div className="flex gap-2">
              <Button variant="outline" size="sm" disabled={page === 0} onClick={() => setPage((p) => Math.max(0, p - 1))}>Prev</Button>
              <Button variant="outline" size="sm" disabled={page + 1 >= pageCount} onClick={() => setPage((p) => p + 1)}>Next</Button>
            </div>
          </div>
        )}
      </Card>
      )}

      {activeConfigTab === 'scope' && (
        <Card padding="none">
          <CardHeader
            title={`Scoped policies${scopeTotal ? ` (${scopeTotal})` : ''}`}
            description="Policies by company, HSN, salt, product group, or supplier. Exact product-location policies still take precedence."
            className="px-6 pt-6"
          />
          <DataTable<ReorderPolicyScopeRow>
            data={scopeRows}
            columns={scopeCols}
            keyExtractor={(r) => r.id}
            isLoading={scopeList.isLoading}
            emptyMessage="No scoped reorder policies yet."
          />
          {scopePageCount > 1 && (
            <div className="flex items-center justify-between px-6 py-3 border-t border-gray-100 text-sm text-gray-600">
              <span>Page {scopePage + 1} of {scopePageCount}</span>
              <div className="flex gap-2">
                <Button variant="outline" size="sm" disabled={scopePage === 0} onClick={() => setScopePage((p) => Math.max(0, p - 1))}>Prev</Button>
                <Button variant="outline" size="sm" disabled={scopePage + 1 >= scopePageCount} onClick={() => setScopePage((p) => p + 1)}>Next</Button>
              </div>
            </div>
          )}
        </Card>
      )}

      {/* Add / Edit modal */}
      <Modal isOpen={editorOpen} onClose={() => setEditorOpen(false)} title={editingExisting ? 'Edit reorder policy' : 'Add reorder policy'} size="lg">
        <div className="space-y-4">
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">Product <span className="text-red-500">*</span></label>
              {editingExisting ? (
                <div className="px-3 py-2 border border-gray-200 rounded-md bg-gray-50 text-sm">{form.productLabel}</div>
              ) : (
                <ProductSelector
                  value={form.productId}
                  onChange={(id: string, p: ProductOption | null) =>
                    setForm((f) => ({ ...f, productId: id, productLabel: p ? `${p.code} — ${p.name}` : '' }))
                  }
                />
              )}
            </div>
            <div>
              {editingExisting ? (
                <>
                  <label className="block text-sm font-medium text-gray-700 mb-1">Location</label>
                  <div className="px-3 py-2 border border-gray-200 rounded-md bg-gray-50 text-sm">
                    {locationOptions.find((o) => o.value === form.locationId)?.label ?? form.locationId}
                  </div>
                </>
              ) : (
                <Select
                  label="Location"
                  required
                  placeholder="Select location"
                  value={form.locationId}
                  options={locationOptions}
                  onChange={(e) => setForm((f) => ({ ...f, locationId: e.target.value }))}
                />
              )}
            </div>
          </div>

          <div className="grid grid-cols-2 sm:grid-cols-3 gap-3">
            {NUMERIC_FIELDS.map(({ key, label, hint }) => (
              <div key={key} title={hint}>
                <Input
                  label={label}
                  type="number"
                  min={0}
                  value={form[key] === undefined ? '' : String(form[key])}
                  onChange={(e) => setNum(key, e.target.value)}
                />
              </div>
            ))}
            <Select
              label="ABC class"
              placeholder="—"
              value={String(form.abcClass ?? '')}
              options={[{ value: 'A', label: 'A' }, { value: 'B', label: 'B' }, { value: 'C', label: 'C' }]}
              onChange={(e) => setForm((f) => ({ ...f, abcClass: e.target.value }))}
            />
          </div>

          {formError && <p className="text-sm text-red-600">{formError}</p>}

          <div className="flex justify-end gap-2 pt-2">
            <Button variant="outline" onClick={() => setEditorOpen(false)}>Cancel</Button>
            <Button variant="primary" isLoading={upsert.isPending} onClick={() => void handleSave()}>
              {editingExisting ? 'Save changes' : 'Add policy'}
            </Button>
          </div>
        </div>
      </Modal>

      <Modal isOpen={scopeEditorOpen} onClose={() => setScopeEditorOpen(false)} title={scopeForm.id ? 'Edit scoped policy' : 'Add scoped policy'} size="lg">
        <div className="space-y-4">
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
            <Select
              label="Scope"
              required
              value={scopeForm.scopeType}
              options={SCOPE_TYPE_OPTIONS}
              onChange={(e) => {
                const nextType = e.target.value as ReorderPolicyScopeType;
                setScopeForm((f) => ({
                  ...f,
                  scopeType: nextType,
                  scopeCode: '',
                  scopeId: '',
                  supplierCode: '',
                  priority: defaultPriority(nextType),
                }));
                setScopeSearch('');
              }}
            />
            <Select
              label="Location"
              value={scopeForm.locationId}
              options={scopeLocationOptions}
              onChange={(e) => setScopeForm((f) => ({ ...f, locationId: e.target.value }))}
            />
          </div>

          <div className="grid grid-cols-1 sm:grid-cols-[1fr_1fr_120px] gap-4">
            <Input
              label="Search value"
              value={scopeSearch}
              onChange={(e) => setScopeSearch(e.target.value)}
            />
            <Select
              label="Scope value"
              required
              value={scopeForm.scopeType === 'SUPPLIER' ? scopeForm.scopeId : scopeForm.scopeCode}
              options={scopeValueOptions.map((o) => ({ value: o.value, label: o.label }))}
              onChange={(e) => {
                const option = scopeValueOptions.find((o) => o.value === e.target.value);
                if (scopeForm.scopeType === 'SUPPLIER') {
                  setScopeForm((f) => ({ ...f, scopeId: e.target.value, supplierCode: option?.code ?? '' }));
                } else {
                  setScopeForm((f) => ({ ...f, scopeCode: option?.code ?? e.target.value }));
                }
              }}
            />
            <Input
              label="Priority"
              type="number"
              min={0}
              value={scopeForm.priority}
              onChange={(e) => setScopeForm((f) => ({ ...f, priority: e.target.value === '' ? '' : Number(e.target.value) }))}
            />
          </div>

          <div className="grid grid-cols-2 sm:grid-cols-3 gap-3">
            {NUMERIC_FIELDS.map(({ key, label, hint }) => (
              <div key={key} title={hint}>
                <Input
                  label={label}
                  type="number"
                  min={0}
                  value={scopeForm[key as keyof ScopeFormState] === undefined ? '' : String(scopeForm[key as keyof ScopeFormState])}
                  onChange={(e) => setScopeNum(key as keyof ReorderPolicyScopeInput, e.target.value)}
                />
              </div>
            ))}
            <Select
              label="ABC class"
              placeholder="--"
              value={String(scopeForm.abcClass ?? '')}
              options={[{ value: 'A', label: 'A' }, { value: 'B', label: 'B' }, { value: 'C', label: 'C' }]}
              onChange={(e) => setScopeForm((f) => ({ ...f, abcClass: e.target.value }))}
            />
          </div>

          {scopeFormError && <p className="text-sm text-red-600">{scopeFormError}</p>}

          <div className="flex justify-end gap-2 pt-2">
            <Button variant="outline" onClick={() => setScopeEditorOpen(false)}>Cancel</Button>
            <Button variant="primary" isLoading={upsertScope.isPending} onClick={() => void handleScopeSave()}>
              {scopeForm.id ? 'Save changes' : 'Add scoped policy'}
            </Button>
          </div>
        </div>
      </Modal>

      {/* Delete confirmation */}
      <Modal isOpen={!!toDelete} onClose={() => setToDelete(null)} title="Delete reorder policy" size="sm">
        <div className="space-y-4">
          <p className="text-sm text-gray-600">
            Remove the override for <span className="font-medium">{toDelete?.product_code}</span> at{' '}
            <span className="font-medium">{toDelete?.location_code}</span>? The Reorder report will fall back to demand-driven levels for this item.
          </p>
          <div className="flex justify-end gap-2">
            <Button variant="outline" onClick={() => setToDelete(null)}>Cancel</Button>
            <Button variant="danger" isLoading={del.isPending} onClick={() => void confirmDelete()}>Delete</Button>
          </div>
        </div>
      </Modal>

      <Modal isOpen={!!scopeToDelete} onClose={() => setScopeToDelete(null)} title="Delete scoped policy" size="sm">
        <div className="space-y-4">
          <p className="text-sm text-gray-600">
            Remove the scoped override for <span className="font-medium">{scopeToDelete?.scope_label}</span>
            {scopeToDelete?.location_code ? <> at <span className="font-medium">{scopeToDelete.location_code}</span></> : ' across all locations'}?
          </p>
          <div className="flex justify-end gap-2">
            <Button variant="outline" onClick={() => setScopeToDelete(null)}>Cancel</Button>
            <Button variant="danger" isLoading={deleteScope.isPending} onClick={() => void confirmDeleteScope()}>Delete</Button>
          </div>
        </div>
      </Modal>
    </div>
  );
}
