import { Badge, Button, Card, CardHeader, Column, DataTable, Modal, QueryErrorBanner } from '@components/ui';
import { CalendarIcon, EyeIcon, PencilIcon, PlusIcon, StarIcon, TrashIcon } from '@heroicons/react/24/outline';
import { fiscalCalendarService, type FiscalCalendar, type FiscalPeriod } from '@services/api';
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

const CALENDAR_TYPES = [
  { value: 'CALENDAR', label: 'Calendar Year' },
  { value: 'FISCAL_445', label: '4-4-5 Fiscal' },
  { value: 'FISCAL_454', label: '4-5-4 Fiscal' },
  { value: 'FISCAL_544', label: '5-4-4 Fiscal' },
  { value: 'WEEKLY', label: 'Weekly' },
  { value: 'CUSTOM', label: 'Custom' },
];

const MONTHS = ['January','February','March','April','May','June','July','August','September','October','November','December'];

const emptyCalendar = { name: '', code: '', type: 'CALENDAR', yearStartMonth: 1, description: '' };
const emptyPeriod = { fiscalYear: new Date().getFullYear(), fiscalQuarter: 1, fiscalMonth: 1, periodName: '', startDate: '', endDate: '', workingDays: 20, isOpen: true };

export default function FiscalCalendarPage() {
  const queryClient = useQueryClient();
  const [showCreate, setShowCreate] = useState(false);
  const [showEdit, setShowEdit] = useState(false);
  const [showDetail, setShowDetail] = useState(false);
  const [showCreatePeriod, setShowCreatePeriod] = useState(false);
  const [showGenerate, setShowGenerate] = useState(false);
  const [selected, setSelected] = useState<FiscalCalendar | null>(null);
  const [calForm, setCalForm] = useState<typeof emptyCalendar>(emptyCalendar);
  const [periodForm, setPeriodForm] = useState<typeof emptyPeriod>(emptyPeriod);
  const [genYear, setGenYear] = useState(new Date().getFullYear());
  const [yearFilter, setYearFilter] = useState<number | ''>('');

  // Queries
  const { data: calData, isLoading, isError, error, refetch } = useQuery({
    queryKey: ['manufacturing', 'fiscal-calendars'],
    queryFn: () => fiscalCalendarService.getCalendars(),
  });

  const items: FiscalCalendar[] = Array.isArray(calData?.items) ? calData.items : Array.isArray(calData) ? calData : [];

  const { data: _calDetail } = useQuery({
    queryKey: ['manufacturing', 'fiscal-calendar', selected?.id],
    queryFn: () => selected ? fiscalCalendarService.getCalendar(selected.id) : null,
    enabled: !!selected && showDetail,
  });

  const { data: periodData } = useQuery({
    queryKey: ['manufacturing', 'fiscal-calendar-periods', selected?.id, yearFilter],
    queryFn: () => selected ? fiscalCalendarService.getPeriods(selected.id, { fiscalYear: yearFilter || undefined }) : null,
    enabled: !!selected && showDetail,
  });

  const periods: FiscalPeriod[] = Array.isArray(periodData?.items) ? periodData.items : Array.isArray(periodData) ? periodData : [];

  // Mutations
  const createCal = useMutation({
    mutationFn: (d: typeof emptyCalendar) => fiscalCalendarService.createCalendar({
      name: d.name, code: d.code, type: d.type, yearStartMonth: Number(d.yearStartMonth), description: d.description || undefined,
    }),
    onSuccess: () => { queryClient.invalidateQueries({ queryKey: ['manufacturing', 'fiscal-calendar'] }); queryClient.invalidateQueries({ queryKey: ['manufacturing', 'fiscal-calendars'] }); setShowCreate(false); setCalForm(emptyCalendar); toast.success('Calendar created'); },
    onError: (err: any) => { toast.error(err?.response?.data?.message || 'Failed to create calendar'); },
  });

  const updateCal = useMutation({
    mutationFn: ({ id, dto }: { id: string; dto: Partial<FiscalCalendar> }) => fiscalCalendarService.updateCalendar(id, dto),
    onSuccess: () => { queryClient.invalidateQueries({ queryKey: ['manufacturing', 'fiscal-calendar'] }); queryClient.invalidateQueries({ queryKey: ['manufacturing', 'fiscal-calendars'] }); setShowEdit(false); toast.success('Calendar updated'); },
    onError: (err: any) => { toast.error(err?.response?.data?.message || 'Failed to update calendar'); },
  });

  const deleteCal = useMutation({
    mutationFn: (id: string) => fiscalCalendarService.deleteCalendar(id),
    onSuccess: () => { queryClient.invalidateQueries({ queryKey: ['manufacturing', 'fiscal-calendar'] }); queryClient.invalidateQueries({ queryKey: ['manufacturing', 'fiscal-calendars'] }); toast.success('Calendar deleted'); },
    onError: (err: any) => { toast.error(err?.response?.data?.message || 'Failed to delete calendar'); },
  });

  const setActiveCal = useMutation({
    mutationFn: (id: string) => fiscalCalendarService.setActiveCalendar(id),
    onSuccess: () => { queryClient.invalidateQueries({ queryKey: ['manufacturing', 'fiscal-calendar'] }); queryClient.invalidateQueries({ queryKey: ['manufacturing', 'fiscal-calendars'] }); toast.success('Calendar set as active'); },
    onError: (err: any) => { toast.error(err?.response?.data?.message || 'Failed to set active calendar'); },
  });

  const createPeriodMut = useMutation({
    mutationFn: ({ calId, dto }: { calId: string; dto: typeof emptyPeriod }) =>
      fiscalCalendarService.createPeriod(calId, {
        fiscalYear: Number(dto.fiscalYear), fiscalQuarter: Number(dto.fiscalQuarter), fiscalMonth: Number(dto.fiscalMonth),
        periodName: dto.periodName, startDate: dto.startDate, endDate: dto.endDate,
        workingDays: Number(dto.workingDays) || undefined, isOpen: dto.isOpen,
      }),
    onSuccess: () => { queryClient.invalidateQueries({ queryKey: ['manufacturing', 'fiscal-calendar'] }); setShowCreatePeriod(false); setPeriodForm(emptyPeriod); toast.success('Period created'); },
    onError: (err: any) => { toast.error(err?.response?.data?.message || 'Failed to create period'); },
  });

  const togglePeriod = useMutation({
    mutationFn: (id: string) => fiscalCalendarService.togglePeriodStatus(id),
    onSuccess: () => { queryClient.invalidateQueries({ queryKey: ['manufacturing', 'fiscal-calendar'] }); toast.success('Period toggled'); },
    onError: (err: any) => { toast.error(err?.response?.data?.message || 'Failed to toggle period'); },
  });

  const deletePeriod = useMutation({
    mutationFn: (id: string) => fiscalCalendarService.deletePeriod(id),
    onSuccess: () => { queryClient.invalidateQueries({ queryKey: ['manufacturing', 'fiscal-calendar'] }); toast.success('Period deleted'); },
    onError: (err: any) => { toast.error(err?.response?.data?.message || 'Failed to delete period'); },
  });

  const generatePeriods = useMutation({
    mutationFn: ({ calId, year }: { calId: string; year: number }) =>
      fiscalCalendarService.generatePeriodsForYear(calId, { fiscalYear: year, calculateWorkingDays: true }),
    onSuccess: () => { queryClient.invalidateQueries({ queryKey: ['manufacturing', 'fiscal-calendar'] }); setShowGenerate(false); toast.success('Periods generated'); },
    onError: (err: any) => { toast.error(err?.response?.data?.message || 'Failed to generate periods'); },
  });

  // Calendar Columns
  const columns: Column<FiscalCalendar>[] = [
    { key: 'name', header: 'Name', accessor: 'name' },
    { key: 'code', header: 'Code', accessor: (r) => r.code || '—' },
    { key: 'type', header: 'Type', accessor: (r) => CALENDAR_TYPES.find(t => t.value === r.type)?.label || r.type },
    { key: 'start', header: 'Year Start', accessor: (r) => MONTHS[(r.yearStartMonth || 1) - 1] || '—' },
    {
      key: 'status', header: 'Status',
      accessor: (r) => <Badge variant={r.isActive ? 'success' : 'secondary'} size="sm">{r.isActive ? 'ACTIVE' : 'INACTIVE'}</Badge>,
    },
    {
      key: 'actions', header: 'Actions',
      accessor: (r) => (
        <div className="flex gap-1">
          <button onClick={() => { setSelected(r); setShowDetail(true); }} className="p-1 text-blue-600 hover:text-blue-800"><EyeIcon className="h-4 w-4" /></button>
          <button onClick={() => {
            setSelected(r); setCalForm({ name: r.name, code: r.code || '', type: r.type, yearStartMonth: r.yearStartMonth || 1, description: r.description || '' });
            setShowEdit(true);
          }} className="p-1 text-amber-600 hover:text-amber-800"><PencilIcon className="h-4 w-4" /></button>
          {!r.isActive && <button onClick={() => setActiveCal.mutate(r.id)} className="p-1 text-yellow-600 hover:text-yellow-800" title="Set Active"><StarIcon className="h-4 w-4" /></button>}
          <button onClick={() => { if (confirm('Delete this calendar and all its periods?')) deleteCal.mutate(r.id); }} className="p-1 text-red-600 hover:text-red-800"><TrashIcon className="h-4 w-4" /></button>
        </div>
      ),
    },
  ];

  // Period Columns
  const periodColumns: Column<FiscalPeriod>[] = [
    { key: 'name', header: 'Period', accessor: 'periodName' },
    { key: 'year', header: 'Year', accessor: (r) => r.fiscalYear },
    { key: 'quarter', header: 'Q', accessor: (r) => `Q${r.fiscalQuarter}` },
    { key: 'month', header: 'Month', accessor: (r) => r.fiscalMonth },
    { key: 'start', header: 'Start', accessor: (r) => safeFormat(r.startDate, 'MMM d, yyyy') },
    { key: 'end', header: 'End', accessor: (r) => safeFormat(r.endDate, 'MMM d, yyyy') },
    { key: 'days', header: 'Work Days', accessor: (r) => r.workingDays ?? '—', align: 'right' },
    {
      key: 'status', header: 'Status',
      accessor: (r) => (
        <div className="flex gap-1">
          <Badge variant={r.isOpen ? 'success' : 'secondary'} size="sm">{r.isOpen ? 'OPEN' : 'CLOSED'}</Badge>
          {r.isCurrent && <Badge variant="warning" size="sm">CURRENT</Badge>}
        </div>
      ),
    },
    {
      key: 'actions', header: '',
      accessor: (r) => (
        <div className="flex gap-1">
          <button onClick={() => togglePeriod.mutate(r.id)} className="p-1 text-indigo-600 hover:text-indigo-800">
            <Badge variant={r.isOpen ? 'warning' : 'success'} size="sm">{r.isOpen ? 'Close' : 'Open'}</Badge>
          </button>
          <button onClick={() => { if (confirm('Delete period?')) deletePeriod.mutate(r.id); }} className="p-1 text-red-600 hover:text-red-800"><TrashIcon className="h-4 w-4" /></button>
        </div>
      ),
    },
  ];

  return (
    <div className="space-y-6">
      <div className="flex justify-between items-start">
        <div>
          <h1 className="text-2xl font-bold">Fiscal Calendar</h1>
          <p className="text-secondary-500 mt-1">Manage fiscal calendars and periods</p>
        </div>
        <Button onClick={() => { setCalForm(emptyCalendar); setShowCreate(true); }} leftIcon={<PlusIcon className="h-4 w-4" />}>New Calendar</Button>
      </div>

      {isError && <QueryErrorBanner error={error} onRetry={() => refetch()} />}

      <Card>
        <CardHeader title="Calendars" description="All fiscal and calendar year definitions" />
        <DataTable data={items} columns={columns} keyExtractor={(r) => r.id} isLoading={isLoading} emptyMessage="No calendars found" />
      </Card>

      {/* Create Calendar */}
      <Modal isOpen={showCreate} onClose={() => setShowCreate(false)} title="Create Fiscal Calendar" size="md">
        <div className="space-y-4">
          <div className="grid grid-cols-2 gap-4">
            <div><label className="block text-sm font-medium text-gray-700 mb-1">Name *</label><input type="text" className="w-full rounded-md border-gray-300 shadow-sm focus:border-primary-500 focus:ring-primary-500" value={calForm.name} onChange={(e) => setCalForm({ ...calForm, name: e.target.value })} /></div>
            <div><label className="block text-sm font-medium text-gray-700 mb-1">Code *</label><input type="text" className="w-full rounded-md border-gray-300 shadow-sm focus:border-primary-500 focus:ring-primary-500" value={calForm.code} onChange={(e) => setCalForm({ ...calForm, code: e.target.value.toUpperCase() })} placeholder="FY2025" /></div>
          </div>
          <div className="grid grid-cols-2 gap-4">
            <div><label className="block text-sm font-medium text-gray-700 mb-1">Type *</label>
              <select className="w-full rounded-md border-gray-300 shadow-sm focus:border-primary-500 focus:ring-primary-500" value={calForm.type} onChange={(e) => setCalForm({ ...calForm, type: e.target.value })}>
                {CALENDAR_TYPES.map(t => <option key={t.value} value={t.value}>{t.label}</option>)}
              </select>
            </div>
            <div><label className="block text-sm font-medium text-gray-700 mb-1">Year Start Month *</label>
              <select className="w-full rounded-md border-gray-300 shadow-sm focus:border-primary-500 focus:ring-primary-500" value={calForm.yearStartMonth} onChange={(e) => setCalForm({ ...calForm, yearStartMonth: +e.target.value })}>
                {MONTHS.map((m, i) => <option key={i} value={i + 1}>{m}</option>)}
              </select>
            </div>
          </div>
          <div><label className="block text-sm font-medium text-gray-700 mb-1">Description</label><textarea className="w-full rounded-md border-gray-300 shadow-sm focus:border-primary-500 focus:ring-primary-500" value={calForm.description} onChange={(e) => setCalForm({ ...calForm, description: e.target.value })} rows={2} /></div>
          <div className="flex justify-end gap-3 pt-4 border-t">
            <Button variant="secondary" onClick={() => setShowCreate(false)}>Cancel</Button>
            <Button onClick={() => createCal.mutate(calForm)} isLoading={createCal.isPending} disabled={!calForm.name || !calForm.code}>Create</Button>
          </div>
        </div>
      </Modal>

      {/* Edit Calendar */}
      <Modal isOpen={showEdit} onClose={() => setShowEdit(false)} title="Edit Calendar" size="md">
        <div className="space-y-4">
          <div className="grid grid-cols-2 gap-4">
            <div><label className="block text-sm font-medium text-gray-700 mb-1">Name *</label><input type="text" className="w-full rounded-md border-gray-300 shadow-sm focus:border-primary-500 focus:ring-primary-500" value={calForm.name} onChange={(e) => setCalForm({ ...calForm, name: e.target.value })} /></div>
            <div><label className="block text-sm font-medium text-gray-700 mb-1">Code</label><input type="text" className="w-full rounded-md border-gray-300 shadow-sm focus:border-primary-500 focus:ring-primary-500" value={calForm.code} onChange={(e) => setCalForm({ ...calForm, code: e.target.value.toUpperCase() })} /></div>
          </div>
          <div className="grid grid-cols-2 gap-4">
            <div><label className="block text-sm font-medium text-gray-700 mb-1">Type</label>
              <select className="w-full rounded-md border-gray-300 shadow-sm focus:border-primary-500 focus:ring-primary-500" value={calForm.type} onChange={(e) => setCalForm({ ...calForm, type: e.target.value })}>
                {CALENDAR_TYPES.map(t => <option key={t.value} value={t.value}>{t.label}</option>)}
              </select>
            </div>
            <div><label className="block text-sm font-medium text-gray-700 mb-1">Year Start Month</label>
              <select className="w-full rounded-md border-gray-300 shadow-sm focus:border-primary-500 focus:ring-primary-500" value={calForm.yearStartMonth} onChange={(e) => setCalForm({ ...calForm, yearStartMonth: +e.target.value })}>
                {MONTHS.map((m, i) => <option key={i} value={i + 1}>{m}</option>)}
              </select>
            </div>
          </div>
          <div><label className="block text-sm font-medium text-gray-700 mb-1">Description</label><textarea className="w-full rounded-md border-gray-300 shadow-sm focus:border-primary-500 focus:ring-primary-500" value={calForm.description} onChange={(e) => setCalForm({ ...calForm, description: e.target.value })} rows={2} /></div>
          <div className="flex justify-end gap-3 pt-4 border-t">
            <Button variant="secondary" onClick={() => setShowEdit(false)}>Cancel</Button>
            <Button onClick={() => selected && updateCal.mutate({ id: selected.id, dto: { name: calForm.name, code: calForm.code, type: calForm.type as any, yearStartMonth: Number(calForm.yearStartMonth), description: calForm.description } })} isLoading={updateCal.isPending}>Save</Button>
          </div>
        </div>
      </Modal>

      {/* Calendar Detail — Periods */}
      <Modal isOpen={showDetail} onClose={() => { setShowDetail(false); setSelected(null); setYearFilter(''); }} title={selected ? selected.name : 'Calendar'} size="xl">
        {selected && (
          <div className="space-y-6">
            <div className="grid grid-cols-4 gap-4 text-sm">
              <div><span className="font-medium text-gray-500">Code:</span> {selected.code || '—'}</div>
              <div><span className="font-medium text-gray-500">Type:</span> {CALENDAR_TYPES.find(t => t.value === selected.type)?.label || selected.type}</div>
              <div><span className="font-medium text-gray-500">Year Start:</span> {MONTHS[(selected.yearStartMonth || 1) - 1]}</div>
              <div><span className="font-medium text-gray-500">Status:</span> <Badge variant={selected.isActive ? 'success' : 'secondary'} size="sm">{selected.isActive ? 'ACTIVE' : 'INACTIVE'}</Badge></div>
            </div>
            {selected.description && <p className="text-sm text-gray-600">{selected.description}</p>}

            <div className="flex justify-between items-center">
              <div className="flex gap-2 items-center">
                <h3 className="text-base font-semibold">Fiscal Periods ({periods.length})</h3>
                <select className="rounded-md border-gray-300 shadow-sm text-sm" value={yearFilter} onChange={(e) => setYearFilter(e.target.value ? Number(e.target.value) : '')}>
                  <option value="">All Years</option>
                  {[...new Set(periods.map(p => p.fiscalYear))].sort((a, b) => b - a).map(y => <option key={y} value={y}>{y}</option>)}
                  {/* Also show current & next year if not in the set */}
                  {![new Date().getFullYear()].every(y => periods.some(p => p.fiscalYear === y)) && <option value={new Date().getFullYear()}>{new Date().getFullYear()}</option>}
                </select>
              </div>
              <div className="flex gap-2">
                <Button size="sm" variant="secondary" onClick={() => { setGenYear(new Date().getFullYear()); setShowGenerate(true); }} leftIcon={<CalendarIcon className="h-3 w-3" />}>Generate Year</Button>
                <Button size="sm" onClick={() => { setPeriodForm(emptyPeriod); setShowCreatePeriod(true); }} leftIcon={<PlusIcon className="h-3 w-3" />}>Add Period</Button>
              </div>
            </div>

            <DataTable data={periods} columns={periodColumns} keyExtractor={(r) => r.id} emptyMessage="No periods found — generate or add them" />
          </div>
        )}
      </Modal>

      {/* Create Period */}
      <Modal isOpen={showCreatePeriod} onClose={() => setShowCreatePeriod(false)} title="Add Period" size="md">
        <div className="space-y-4">
          <div className="grid grid-cols-3 gap-4">
            <div><label className="block text-sm font-medium text-gray-700 mb-1">Fiscal Year *</label><input type="number" className="w-full rounded-md border-gray-300 shadow-sm focus:border-primary-500 focus:ring-primary-500" value={periodForm.fiscalYear} onChange={(e) => setPeriodForm({ ...periodForm, fiscalYear: +e.target.value })} /></div>
            <div><label className="block text-sm font-medium text-gray-700 mb-1">Quarter *</label><select className="w-full rounded-md border-gray-300 shadow-sm focus:border-primary-500 focus:ring-primary-500" value={periodForm.fiscalQuarter} onChange={(e) => setPeriodForm({ ...periodForm, fiscalQuarter: +e.target.value })}>{[1,2,3,4].map(q => <option key={q} value={q}>Q{q}</option>)}</select></div>
            <div><label className="block text-sm font-medium text-gray-700 mb-1">Month *</label><input type="number" min={1} max={12} className="w-full rounded-md border-gray-300 shadow-sm focus:border-primary-500 focus:ring-primary-500" value={periodForm.fiscalMonth} onChange={(e) => setPeriodForm({ ...periodForm, fiscalMonth: +e.target.value })} /></div>
          </div>
          <div><label className="block text-sm font-medium text-gray-700 mb-1">Period Name *</label><input type="text" className="w-full rounded-md border-gray-300 shadow-sm focus:border-primary-500 focus:ring-primary-500" value={periodForm.periodName} onChange={(e) => setPeriodForm({ ...periodForm, periodName: e.target.value })} placeholder="e.g., Jan 2025" /></div>
          <div className="grid grid-cols-3 gap-4">
            <div><label className="block text-sm font-medium text-gray-700 mb-1">Start Date *</label><input type="date" className="w-full rounded-md border-gray-300 shadow-sm focus:border-primary-500 focus:ring-primary-500" value={periodForm.startDate} onChange={(e) => setPeriodForm({ ...periodForm, startDate: e.target.value })} /></div>
            <div><label className="block text-sm font-medium text-gray-700 mb-1">End Date *</label><input type="date" className="w-full rounded-md border-gray-300 shadow-sm focus:border-primary-500 focus:ring-primary-500" value={periodForm.endDate} onChange={(e) => setPeriodForm({ ...periodForm, endDate: e.target.value })} /></div>
            <div><label className="block text-sm font-medium text-gray-700 mb-1">Working Days</label><input type="number" className="w-full rounded-md border-gray-300 shadow-sm focus:border-primary-500 focus:ring-primary-500" value={periodForm.workingDays} onChange={(e) => setPeriodForm({ ...periodForm, workingDays: +e.target.value })} /></div>
          </div>
          <div className="flex justify-end gap-3 pt-4 border-t">
            <Button variant="secondary" onClick={() => setShowCreatePeriod(false)}>Cancel</Button>
            <Button onClick={() => selected && createPeriodMut.mutate({ calId: selected.id, dto: periodForm })} isLoading={createPeriodMut.isPending} disabled={!periodForm.periodName || !periodForm.startDate || !periodForm.endDate}>Add Period</Button>
          </div>
        </div>
      </Modal>

      {/* Generate Periods for Year */}
      <Modal isOpen={showGenerate} onClose={() => setShowGenerate(false)} title="Generate Periods for Year" size="sm">
        <div className="space-y-4">
          <p className="text-sm text-gray-600">Auto-generate all fiscal periods for a given year based on the calendar type.</p>
          <div><label className="block text-sm font-medium text-gray-700 mb-1">Fiscal Year *</label><input type="number" className="w-full rounded-md border-gray-300 shadow-sm focus:border-primary-500 focus:ring-primary-500" value={genYear} onChange={(e) => setGenYear(+e.target.value)} /></div>
          <div className="flex justify-end gap-3 pt-4 border-t">
            <Button variant="secondary" onClick={() => setShowGenerate(false)}>Cancel</Button>
            <Button onClick={() => selected && generatePeriods.mutate({ calId: selected.id, year: genYear })} isLoading={generatePeriods.isPending}>Generate</Button>
          </div>
        </div>
      </Modal>
    </div>
  );
}
