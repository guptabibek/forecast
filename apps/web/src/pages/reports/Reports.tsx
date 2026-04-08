import { Dialog, Listbox, Transition } from '@headlessui/react';
import {
    ArrowDownTrayIcon,
    ArrowPathIcon,
    ChartBarIcon,
    ChartPieIcon,
    CheckIcon,
    ChevronUpDownIcon,
    DocumentChartBarIcon,
    PencilIcon,
    PlusIcon,
    TableCellsIcon,
    TrashIcon,
} from '@heroicons/react/24/outline';
import { zodResolver } from '@hookform/resolvers/zod';
import { planService, reportService } from '@services/api';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import clsx from 'clsx';
import { format } from 'date-fns';
import { Fragment, useCallback, useMemo, useState } from 'react';
import { Controller, useForm } from 'react-hook-form';
import toast from 'react-hot-toast';
import {
    Area,
    AreaChart,
    Bar,
    BarChart,
    CartesianGrid,
    Cell,
    Legend,
    Line,
    LineChart,
    Pie,
    PieChart,
    ResponsiveContainer,
    Tooltip,
    XAxis,
    YAxis,
} from 'recharts';
import { z } from 'zod';

// ============================================================================
// TYPES & INTERFACES
// ============================================================================

interface Report {
  id: string;
  name: string;
  description?: string;
  type: 'line' | 'bar' | 'pie' | 'area' | 'table';
  config: ReportConfig;
  createdAt: string;
  updatedAt: string;
}

interface ReportConfig {
  planId?: string;
  metrics?: string[];
  groupBy?: string;
  dateRange?: {
    start?: string;
    end?: string;
  };
}

interface ReportData {
  data: Array<Record<string, unknown>>;
  summary: ReportSummary;
}

interface ReportSummary {
  total?: number;
  average?: number;
  variance?: number;
  count?: number;
  minValue?: number;
  maxValue?: number;
  [key: string]: number | string | undefined;
}

interface KPICardProps {
  title: string;
  value: number | string;
  format?: 'currency' | 'percentage' | 'number';
  trend?: number;
  description?: string;
}

// ============================================================================
// CONSTANTS
// ============================================================================

const reportTypes = [
  { value: 'line', label: 'Line Chart', icon: ChartBarIcon },
  { value: 'bar', label: 'Bar Chart', icon: ChartBarIcon },
  { value: 'area', label: 'Area Chart', icon: ChartBarIcon },
  { value: 'pie', label: 'Pie Chart', icon: ChartPieIcon },
  { value: 'table', label: 'Data Table', icon: TableCellsIcon },
] as const;

const CHART_COLORS = [
  '#3B82F6', // Blue
  '#10B981', // Green
  '#F59E0B', // Amber
  '#EF4444', // Red
  '#8B5CF6', // Purple
  '#EC4899', // Pink
  '#06B6D4', // Cyan
  '#F97316', // Orange
];

// ============================================================================
// VALIDATION SCHEMA
// ============================================================================

const reportSchema = z.object({
  name: z.string().min(1, 'Name is required'),
  description: z.string().optional(),
  type: z.enum(['line', 'bar', 'pie', 'area', 'table']),
  config: z.object({
    planId: z.string().optional(),
    metrics: z.array(z.string()).optional(),
    groupBy: z.string().optional(),
    dateRange: z
      .object({
        start: z.string().optional(),
        end: z.string().optional(),
      })
      .optional(),
  }),
});

type ReportFormData = z.infer<typeof reportSchema>;

// ============================================================================
// SUB-COMPONENTS
// ============================================================================

/**
 * KPI Card Component - displays a single metric with enterprise styling
 */
function KPICard({ title, value, format: formatType = 'number', trend, description }: KPICardProps) {
  const formattedValue = useMemo(() => {
    if (typeof value === 'string') return value;
    
    switch (formatType) {
      case 'currency':
        return new Intl.NumberFormat('en-US', {
          style: 'currency',
          currency: 'USD',
          minimumFractionDigits: 0,
          maximumFractionDigits: 0,
        }).format(value);
      case 'percentage':
        return `${value.toFixed(1)}%`;
      case 'number':
      default:
        return new Intl.NumberFormat('en-US', {
          minimumFractionDigits: 0,
          maximumFractionDigits: 2,
        }).format(value);
    }
  }, [value, formatType]);

  return (
    <div className="bg-white dark:bg-secondary-800 rounded-xl border border-secondary-200 dark:border-secondary-700 p-5 shadow-sm hover:shadow-md transition-shadow">
      <p className="text-xs font-semibold uppercase tracking-wider mb-1.5 text-[var(--text-muted)]">
        {title}
      </p>
      <p className="text-2xl font-bold text-secondary-900 dark:text-white">
        {formattedValue}
      </p>
      {trend !== undefined && (
        <p className={clsx(
          'text-xs mt-1 flex items-center gap-1',
          trend >= 0 ? 'text-success-600' : 'text-error-600'
        )}>
          {trend >= 0 ? '↑' : '↓'} {Math.abs(trend).toFixed(1)}%
          <span className="text-secondary-500">vs last period</span>
        </p>
      )}
      {description && (
        <p className="text-xs text-secondary-500 mt-1">{description}</p>
      )}
    </div>
  );
}

/**
 * Report Card Component - displays a saved report in the sidebar
 */
interface ReportCardProps {
  report: Report;
  isActive: boolean;
  onSelect: () => void;
  onEdit: (e: React.MouseEvent) => void;
  onDelete: (e: React.MouseEvent) => void;
}

function ReportCard({ report, isActive, onSelect, onEdit, onDelete }: ReportCardProps) {
  const [isHovered, setIsHovered] = useState(false);
  const TypeIcon = reportTypes.find((t) => t.value === report.type)?.icon || ChartBarIcon;

  return (
    <div
      onClick={onSelect}
      onMouseEnter={() => setIsHovered(true)}
      onMouseLeave={() => setIsHovered(false)}
      className={clsx(
        'relative rounded-xl border-2 p-4 cursor-pointer transition-all duration-200',
        'bg-white dark:bg-secondary-800',
        isActive
          ? 'border-primary-500 shadow-md ring-1 ring-primary-500/20'
          : 'border-secondary-200 dark:border-secondary-700 hover:border-secondary-300 dark:hover:border-secondary-600 hover:shadow-sm',
      )}
    >
      <div className="flex items-start gap-3">
        <div className={clsx(
          'flex-shrink-0 p-2.5 rounded-lg',
          isActive
            ? 'bg-primary-100 dark:bg-primary-900/40'
            : 'bg-secondary-100 dark:bg-secondary-700'
        )}>
          <TypeIcon className={clsx(
            'w-5 h-5',
            isActive ? 'text-primary-600' : 'text-secondary-600 dark:text-secondary-400'
          )} />
        </div>
        <div className="flex-1 min-w-0">
          <h3 className={clsx(
            'font-semibold text-sm truncate',
            isActive ? 'text-primary-700 dark:text-primary-400' : 'text-secondary-900 dark:text-white'
          )}>
            {report.name}
          </h3>
          {report.description && (
            <p className="text-xs text-secondary-500 dark:text-secondary-400 mt-0.5 line-clamp-2">
              {report.description}
            </p>
          )}
        </div>
      </div>

      {/* Hover Actions */}
      <div className={clsx(
        'absolute top-2 right-2 flex items-center gap-1 transition-opacity duration-200',
        isHovered ? 'opacity-100' : 'opacity-0'
      )}>
        <button
          onClick={onEdit}
          className="p-1.5 rounded-lg bg-secondary-100 dark:bg-secondary-700 hover:bg-secondary-200 dark:hover:bg-secondary-600 transition-colors"
          title="Edit report"
        >
          <PencilIcon className="w-3.5 h-3.5 text-secondary-600 dark:text-secondary-300" />
        </button>
        <button
          onClick={onDelete}
          className="p-1.5 rounded-lg bg-error-50 dark:bg-error-900/30 hover:bg-error-100 dark:hover:bg-error-900/50 transition-colors"
          title="Delete report"
        >
          <TrashIcon className="w-3.5 h-3.5 text-error-600" />
        </button>
      </div>
    </div>
  );
}

/**
 * Empty State Component
 */
function EmptyState({ onCreateClick }: { onCreateClick: () => void }) {
  return (
    <div className="flex flex-col items-center justify-center py-12 px-6 text-center bg-white dark:bg-secondary-800 rounded-xl border border-dashed border-secondary-300 dark:border-secondary-600">
      <DocumentChartBarIcon className="w-16 h-16 text-secondary-300 dark:text-secondary-600 mb-4" />
      <h3 className="text-lg font-semibold text-secondary-900 dark:text-white mb-1">
        No Reports Yet
      </h3>
      <p className="text-secondary-500 dark:text-secondary-400 mb-4 max-w-xs">
        Create your first report to visualize forecasts, actuals, and variances
      </p>
      <button onClick={onCreateClick} className="btn-primary btn-sm">
        <PlusIcon className="w-4 h-4 mr-1.5" />
        Create First Report
      </button>
    </div>
  );
}

/**
 * Select Report Prompt
 */
function SelectReportPrompt() {
  return (
    <div className="flex flex-col items-center justify-center h-full min-h-[400px] py-12 px-6 text-center bg-white dark:bg-secondary-800 rounded-xl border border-secondary-200 dark:border-secondary-700">
      <DocumentChartBarIcon className="w-20 h-20 text-secondary-200 dark:text-secondary-700 mb-4" />
      <h3 className="text-xl font-semibold text-secondary-900 dark:text-white mb-2">
        Select a Report
      </h3>
      <p className="text-secondary-500 dark:text-secondary-400 max-w-md">
        Choose a report from the sidebar to view its data and visualizations, or create a new report to get started.
      </p>
    </div>
  );
}

// ============================================================================
// MAIN COMPONENT
// ============================================================================

export default function Reports() {
  const queryClient = useQueryClient();
  const [isModalOpen, setIsModalOpen] = useState(false);
  const [editingReport, setEditingReport] = useState<Report | null>(null);
  const [selectedReport, setSelectedReport] = useState<Report | null>(null);
  const [selectedType, setSelectedType] = useState<(typeof reportTypes)[number]>(
    reportTypes[0],
  );

  // Fetch reports
  const { data: reports, isLoading: loadingReports } = useQuery({
    queryKey: ['reports'],
    queryFn: () => reportService.listReports(),
  });

  // Fetch report data
  const { data: reportData, isLoading: loadingData, refetch: refetchData } = useQuery<ReportData | null>({
    queryKey: ['report-data', selectedReport?.id],
    queryFn: async (): Promise<ReportData | null> => {
      if (!selectedReport) return null;
      const response = await reportService.getReportData(selectedReport.id);
      return {
        data: response.data,
        summary: (response.summary ?? {}) as ReportSummary,
      };
    },
    enabled: !!selectedReport,
  });

  // Fetch plans for config
  const { data: plans } = useQuery({
    queryKey: ['plans'],
    queryFn: async () => {
      const result = await planService.getAll({ page: 1, pageSize: 100 });
      return result?.data || [];
    },
  });

  // Create mutation
  const createMutation = useMutation({
    mutationFn: (data: ReportFormData) => reportService.createReport(data),
    onSuccess: (newReport) => {
      queryClient.invalidateQueries({ queryKey: ['reports'] });
      toast.success('Report created successfully');
      setSelectedReport(newReport);
      handleCloseModal();
    },
    onError: () => {
      toast.error('Failed to create report');
    },
  });

  // Update mutation
  const updateMutation = useMutation({
    mutationFn: ({ id, data }: { id: string; data: ReportFormData }) => reportService.updateReport(id, data),
    onSuccess: (updatedReport) => {
      queryClient.invalidateQueries({ queryKey: ['reports'] });
      toast.success('Report updated successfully');
      setSelectedReport(updatedReport);
      handleCloseModal();
    },
    onError: () => {
      toast.error('Failed to update report');
    },
  });

  // Delete mutation
  const deleteMutation = useMutation({
    mutationFn: (id: string) => reportService.deleteReport(id),
    onSuccess: (_, deletedId) => {
      queryClient.invalidateQueries({ queryKey: ['reports'] });
      if (selectedReport?.id === deletedId) {
        setSelectedReport(null);
      }
      toast.success('Report deleted successfully');
    },
    onError: () => {
      toast.error('Failed to delete report');
    },
  });

  const {
    register,
    handleSubmit,
    reset,
    control,
    formState: { errors },
  } = useForm<ReportFormData>({
    resolver: zodResolver(reportSchema),
    defaultValues: {
      type: 'line',
      config: {},
    },
  });

  const handleOpenModal = useCallback((report?: Report) => {
    if (report) {
      setEditingReport(report);
      reset({
        name: report.name,
        description: report.description,
        type: report.type,
        config: report.config,
      });
      setSelectedType(reportTypes.find((t) => t.value === report.type) || reportTypes[0]);
    } else {
      setEditingReport(null);
      reset({
        name: '',
        description: '',
        type: 'line',
        config: {},
      });
      setSelectedType(reportTypes[0]);
    }
    setIsModalOpen(true);
  }, [reset]);

  const handleCloseModal = useCallback(() => {
    setIsModalOpen(false);
    setEditingReport(null);
    reset();
  }, [reset]);

  const onSubmit = useCallback((data: ReportFormData) => {
    const submitData = {
      ...data,
      type: selectedType.value,
    };

    if (editingReport) {
      updateMutation.mutate({ id: editingReport.id, data: submitData });
    } else {
      createMutation.mutate(submitData);
    }
  }, [selectedType, editingReport, updateMutation, createMutation]);

  const handleDelete = useCallback((report: Report, e?: React.MouseEvent) => {
    e?.stopPropagation();
    if (confirm(`Are you sure you want to delete "${report.name}"?`)) {
      deleteMutation.mutate(report.id);
    }
  }, [deleteMutation]);

  const handleEdit = useCallback((report: Report, e?: React.MouseEvent) => {
    e?.stopPropagation();
    handleOpenModal(report);
  }, [handleOpenModal]);

  const handleRefresh = useCallback(() => {
    refetchData();
    toast.success('Report data refreshed');
  }, [refetchData]);

  const handleExport = useCallback(() => {
    if (!selectedReport || !reportData?.data) return;
    
    const csvContent = reportData.data.map((row) => 
      Object.values(row).join(',')
    ).join('\n');
    
    const headers = Object.keys(reportData.data[0] || {}).join(',');
    const fullCsv = `${headers}\n${csvContent}`;
    
    const blob = new Blob([fullCsv], { type: 'text/csv' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `${selectedReport.name.replace(/\s+/g, '_')}_${format(new Date(), 'yyyy-MM-dd')}.csv`;
    a.click();
    URL.revokeObjectURL(url);
    
    toast.success('Report exported successfully');
  }, [selectedReport, reportData]);

  // Chart rendering function with enhanced styling
  const renderChart = useCallback(() => {
    if (!selectedReport || !reportData?.data || reportData.data.length === 0) {
      return (
        <div className="flex items-center justify-center h-[400px] text-secondary-500">
          No data available for this report
        </div>
      );
    }

    const data = reportData.data;
    const chartHeight = 400;

    switch (selectedReport.type) {
      case 'line':
        return (
          <ResponsiveContainer width="100%" height={chartHeight}>
            <LineChart data={data} margin={{ top: 20, right: 30, left: 20, bottom: 20 }}>
              <CartesianGrid strokeDasharray="3 3" stroke="var(--color-secondary-200)" />
              <XAxis 
                dataKey="period" 
                tick={{ fontSize: 12, fill: 'var(--text-secondary)' }}
                tickLine={{ stroke: 'var(--color-secondary-300)' }}
              />
              <YAxis 
                tick={{ fontSize: 12, fill: 'var(--text-secondary)' }}
                tickFormatter={(value) => value.toLocaleString()}
              />
              <Tooltip 
                contentStyle={{ 
                  backgroundColor: 'var(--color-secondary-800)', 
                  border: 'none',
                  borderRadius: '8px',
                  boxShadow: '0 4px 12px rgba(0,0,0,0.15)'
                }}
                labelStyle={{ color: 'var(--text-primary)', fontWeight: 600 }}
              />
              <Legend wrapperStyle={{ paddingTop: '20px' }} />
              <Line
                type="monotone"
                dataKey="actual"
                stroke={CHART_COLORS[0]}
                name="Actual"
                strokeWidth={2.5}
                dot={{ r: 4, strokeWidth: 2 }}
                activeDot={{ r: 6, strokeWidth: 2 }}
              />
              <Line
                type="monotone"
                dataKey="forecast"
                stroke={CHART_COLORS[1]}
                name="Forecast"
                strokeWidth={2.5}
                dot={{ r: 4, strokeWidth: 2 }}
              />
              <Line
                type="monotone"
                dataKey="budget"
                stroke={CHART_COLORS[2]}
                name="Budget"
                strokeWidth={2}
                strokeDasharray="5 5"
                dot={false}
              />
            </LineChart>
          </ResponsiveContainer>
        );

      case 'bar':
        return (
          <ResponsiveContainer width="100%" height={chartHeight}>
            <BarChart data={data} margin={{ top: 20, right: 30, left: 20, bottom: 20 }}>
              <CartesianGrid strokeDasharray="3 3" stroke="var(--color-secondary-200)" />
              <XAxis 
                dataKey="period"
                tick={{ fontSize: 12, fill: 'var(--text-secondary)' }}
              />
              <YAxis 
                tick={{ fontSize: 12, fill: 'var(--text-secondary)' }}
                tickFormatter={(value) => value.toLocaleString()}
              />
              <Tooltip 
                contentStyle={{ 
                  backgroundColor: 'var(--color-secondary-800)', 
                  border: 'none',
                  borderRadius: '8px'
                }}
              />
              <Legend wrapperStyle={{ paddingTop: '20px' }} />
              <Bar 
                dataKey="actual" 
                fill={CHART_COLORS[0]} 
                name="Actual"
                radius={[4, 4, 0, 0]}
              />
              <Bar 
                dataKey="forecast" 
                fill={CHART_COLORS[1]} 
                name="Forecast"
                radius={[4, 4, 0, 0]}
              />
            </BarChart>
          </ResponsiveContainer>
        );

      case 'area':
        return (
          <ResponsiveContainer width="100%" height={chartHeight}>
            <AreaChart data={data} margin={{ top: 20, right: 30, left: 20, bottom: 20 }}>
              <defs>
                <linearGradient id="colorActual" x1="0" y1="0" x2="0" y2="1">
                  <stop offset="5%" stopColor={CHART_COLORS[0]} stopOpacity={0.8}/>
                  <stop offset="95%" stopColor={CHART_COLORS[0]} stopOpacity={0.1}/>
                </linearGradient>
                <linearGradient id="colorForecast" x1="0" y1="0" x2="0" y2="1">
                  <stop offset="5%" stopColor={CHART_COLORS[1]} stopOpacity={0.8}/>
                  <stop offset="95%" stopColor={CHART_COLORS[1]} stopOpacity={0.1}/>
                </linearGradient>
              </defs>
              <CartesianGrid strokeDasharray="3 3" stroke="var(--color-secondary-200)" />
              <XAxis 
                dataKey="period"
                tick={{ fontSize: 12, fill: 'var(--text-secondary)' }}
              />
              <YAxis 
                tick={{ fontSize: 12, fill: 'var(--text-secondary)' }}
                tickFormatter={(value) => value.toLocaleString()}
              />
              <Tooltip 
                contentStyle={{ 
                  backgroundColor: 'var(--color-secondary-800)', 
                  border: 'none',
                  borderRadius: '8px'
                }}
              />
              <Legend wrapperStyle={{ paddingTop: '20px' }} />
              <Area
                type="monotone"
                dataKey="actual"
                stroke={CHART_COLORS[0]}
                fill="url(#colorActual)"
                strokeWidth={2}
                name="Actual"
              />
              <Area
                type="monotone"
                dataKey="forecast"
                stroke={CHART_COLORS[1]}
                fill="url(#colorForecast)"
                strokeWidth={2}
                name="Forecast"
              />
            </AreaChart>
          </ResponsiveContainer>
        );

      case 'pie':
        return (
          <ResponsiveContainer width="100%" height={chartHeight}>
            <PieChart>
              <Pie
                data={data}
                dataKey="value"
                nameKey="name"
                cx="50%"
                cy="50%"
                outerRadius={140}
                innerRadius={60}
                paddingAngle={2}
                label={({ name, percent }) => `${name}: ${(percent * 100).toFixed(0)}%`}
                labelLine={{ stroke: 'var(--text-secondary)', strokeWidth: 1 }}
              >
                {data.map((_, index) => (
                  <Cell
                    key={`cell-${index}`}
                    fill={CHART_COLORS[index % CHART_COLORS.length]}
                    strokeWidth={2}
                    stroke="#fff"
                  />
                ))}
              </Pie>
              <Tooltip 
                contentStyle={{ 
                  backgroundColor: 'var(--color-secondary-800)', 
                  border: 'none',
                  borderRadius: '8px'
                }}
              />
              <Legend 
                layout="vertical" 
                align="right" 
                verticalAlign="middle"
                wrapperStyle={{ paddingLeft: '20px' }}
              />
            </PieChart>
          </ResponsiveContainer>
        );

      case 'table':
        return (
          <div className="overflow-x-auto rounded-lg border border-secondary-200 dark:border-secondary-700">
            <table className="w-full">
              <thead className="bg-secondary-50 dark:bg-secondary-800">
                <tr>
                  {Object.keys(data[0] || {}).map((key) => (
                    <th 
                      key={key} 
                      className="px-4 py-3 text-left text-xs font-semibold uppercase tracking-wider text-secondary-600 dark:text-secondary-300 border-b border-secondary-200 dark:border-secondary-700"
                    >
                      {key.replace(/([A-Z])/g, ' $1').trim()}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody className="divide-y divide-secondary-200 dark:divide-secondary-700">
                {data.map((row, index) => (
                  <tr 
                    key={index}
                    className="hover:bg-secondary-50 dark:hover:bg-secondary-800/50 transition-colors"
                  >
                    {Object.values(row).map((value: unknown, i) => (
                      <td key={i} className="px-4 py-3 text-sm text-secondary-900 dark:text-secondary-100">
                        {typeof value === 'number'
                          ? value.toLocaleString()
                          : String(value)}
                      </td>
                    ))}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        );

      default:
        return null;
    }
  }, [selectedReport, reportData]);

  // Calculate summary KPIs from report data
  const summaryKPIs = useMemo(() => {
    if (!reportData?.summary) return null;
    
    const { total, average, variance, count, minValue, maxValue } = reportData.summary;
    
    return {
      total: total ?? 0,
      average: average ?? 0,
      variance: variance ?? 0,
      count: count ?? 0,
      minValue: minValue ?? 0,
      maxValue: maxValue ?? 0,
    };
  }, [reportData]);

  return (
    <div className="h-full flex flex-col">
      {/* Header */}
      <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4 mb-6">
        <div>
          <h1 className="text-2xl font-bold text-secondary-900 dark:text-white">Reports</h1>
          <p className="text-secondary-500 mt-1">
            Build and view custom reports and dashboards
          </p>
        </div>
        <button className="btn-primary" onClick={() => handleOpenModal()}>
          <PlusIcon className="w-5 h-5 mr-2" />
          Create Report
        </button>
      </div>

      {/* Two-Column Layout: 250px sidebar + flexible main */}
      <div className="flex-1 flex gap-6 min-h-0">
        {/* Left Sidebar - Saved Reports */}
        <aside className="w-[280px] flex-shrink-0 flex flex-col">
          <div className="mb-4">
            <h2 className="text-xs font-semibold uppercase tracking-wider mb-1.5 text-[var(--text-muted)]">
              Saved Reports
            </h2>
          </div>

          <div className="flex-1 overflow-y-auto space-y-3 pr-2">
            {loadingReports ? (
              <div className="space-y-3">
                {[1, 2, 3].map((i) => (
                  <div key={i} className="bg-white dark:bg-secondary-800 rounded-xl border border-secondary-200 dark:border-secondary-700 p-4 animate-pulse">
                    <div className="flex items-center gap-3">
                      <div className="w-10 h-10 bg-secondary-200 dark:bg-secondary-700 rounded-lg" />
                      <div className="flex-1">
                        <div className="h-4 bg-secondary-200 dark:bg-secondary-700 rounded w-3/4 mb-2" />
                        <div className="h-3 bg-secondary-200 dark:bg-secondary-700 rounded w-1/2" />
                      </div>
                    </div>
                  </div>
                ))}
              </div>
            ) : !reports || reports.length === 0 ? (
              <EmptyState onCreateClick={() => handleOpenModal()} />
            ) : (
              reports.map((report) => (
                <ReportCard
                  key={report.id}
                  report={report}
                  isActive={selectedReport?.id === report.id}
                  onSelect={() => setSelectedReport(report)}
                  onEdit={(e) => handleEdit(report, e)}
                  onDelete={(e) => handleDelete(report, e)}
                />
              ))
            )}
          </div>
        </aside>

        {/* Main Content - Report Detail View */}
        <main className="flex-1 min-w-0 flex flex-col">
          {selectedReport ? (
            <div className="flex-1 flex flex-col bg-white dark:bg-secondary-800 rounded-xl border border-secondary-200 dark:border-secondary-700 overflow-hidden">
              {/* Report Header */}
              <div className="p-5 border-b border-secondary-200 dark:border-secondary-700 flex items-start justify-between">
                <div>
                  <h2 className="text-xl font-bold text-secondary-900 dark:text-white">
                    {selectedReport.name}
                  </h2>
                  {selectedReport.description && (
                    <p className="text-sm text-secondary-500 mt-1">
                      {selectedReport.description}
                    </p>
                  )}
                  <p className="text-xs text-secondary-400 mt-2">
                    Last updated: {format(new Date(selectedReport.updatedAt), 'MMM d, yyyy h:mm a')}
                  </p>
                </div>
                <div className="flex items-center gap-2">
                  <button 
                    onClick={handleExport}
                    className="inline-flex items-center gap-2 px-4 py-2 text-sm font-medium text-secondary-700 dark:text-secondary-300 bg-white dark:bg-secondary-700 border border-secondary-300 dark:border-secondary-600 rounded-lg hover:bg-secondary-50 dark:hover:bg-secondary-600 transition-colors"
                  >
                    <ArrowDownTrayIcon className="w-4 h-4" />
                    Export
                  </button>
                  <button 
                    onClick={handleRefresh}
                    className="inline-flex items-center gap-2 px-4 py-2 text-sm font-medium text-white bg-primary-600 border border-primary-600 rounded-lg hover:bg-primary-700 transition-colors"
                  >
                    <ArrowPathIcon className="w-4 h-4" />
                    Refresh
                  </button>
                </div>
              </div>

              {/* KPI Summary Cards */}
              {summaryKPIs && (
                <div className="p-5 border-b border-secondary-200 dark:border-secondary-700 bg-secondary-50/50 dark:bg-secondary-900/30">
                  <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
                    <KPICard
                      title="Total Value"
                      value={summaryKPIs.total}
                      format="currency"
                    />
                    <KPICard
                      title="Average"
                      value={summaryKPIs.average}
                      format="currency"
                    />
                    <KPICard
                      title="Variance"
                      value={summaryKPIs.variance}
                      format="percentage"
                      trend={summaryKPIs.variance}
                    />
                  </div>
                </div>
              )}

              {/* Chart Area */}
              <div className="flex-1 p-5 overflow-auto">
                {loadingData ? (
                  <div className="h-[400px] flex items-center justify-center">
                    <div className="flex flex-col items-center gap-3">
                      <div className="animate-spin rounded-full h-10 w-10 border-t-2 border-b-2 border-primary-500" />
                      <span className="text-secondary-500 text-sm">Loading report data...</span>
                    </div>
                  </div>
                ) : (
                  renderChart()
                )}
              </div>
            </div>
          ) : (
            <SelectReportPrompt />
          )}
        </main>
      </div>

      {/* Create/Edit Modal */}
      <Transition appear show={isModalOpen} as={Fragment}>
        <Dialog as="div" className="relative z-50" onClose={handleCloseModal}>
          <Transition.Child
            as={Fragment}
            enter="ease-out duration-300"
            enterFrom="opacity-0"
            enterTo="opacity-100"
            leave="ease-in duration-200"
            leaveFrom="opacity-100"
            leaveTo="opacity-0"
          >
            <div className="fixed inset-0 bg-black/25 backdrop-blur-sm" />
          </Transition.Child>

          <div className="fixed inset-0 overflow-y-auto">
            <div className="flex min-h-full items-center justify-center p-4">
              <Transition.Child
                as={Fragment}
                enter="ease-out duration-300"
                enterFrom="opacity-0 scale-95"
                enterTo="opacity-100 scale-100"
                leave="ease-in duration-200"
                leaveFrom="opacity-100 scale-100"
                leaveTo="opacity-0 scale-95"
              >
                <Dialog.Panel className="w-full max-w-lg transform overflow-hidden rounded-2xl bg-white dark:bg-secondary-800 p-6 shadow-xl transition-all">
                  <Dialog.Title as="h3" className="text-lg font-semibold mb-4">
                    {editingReport ? 'Edit Report' : 'Create Report'}
                  </Dialog.Title>

                  <form onSubmit={handleSubmit(onSubmit)} className="space-y-4">
                    <div>
                      <label className="text-xs font-semibold uppercase tracking-wider mb-1.5 text-[var(--text-muted)] block">
                        Report Name
                      </label>
                      <input
                        type="text"
                        {...register('name')}
                        className="input w-full"
                        placeholder="e.g., Monthly Revenue Forecast"
                      />
                      {errors.name && (
                        <p className="text-sm text-red-500 mt-1">
                          {errors.name.message}
                        </p>
                      )}
                    </div>

                    <div>
                      <label className="text-xs font-semibold uppercase tracking-wider mb-1.5 text-[var(--text-muted)] block">
                        Description (optional)
                      </label>
                      <textarea
                        {...register('description')}
                        rows={2}
                        className="input w-full"
                        placeholder="Enter description..."
                      />
                    </div>

                    <div>
                      <label className="text-xs font-semibold uppercase tracking-wider mb-1.5 text-[var(--text-muted)] block">
                        Chart Type
                      </label>
                      <Listbox value={selectedType} onChange={setSelectedType}>
                        <div className="relative">
                          <Listbox.Button className="input w-full text-left flex items-center justify-between">
                            <span className="flex items-center gap-2">
                              <selectedType.icon className="w-5 h-5" />
                              {selectedType.label}
                            </span>
                            <ChevronUpDownIcon className="w-5 h-5 text-secondary-400" />
                          </Listbox.Button>
                          <Transition
                            as={Fragment}
                            leave="transition ease-in duration-100"
                            leaveFrom="opacity-100"
                            leaveTo="opacity-0"
                          >
                            <Listbox.Options className="absolute z-10 mt-1 w-full bg-white dark:bg-secondary-700 rounded-lg shadow-lg border border-secondary-200 dark:border-secondary-600 max-h-60 overflow-auto">
                              {reportTypes.map((type) => (
                                <Listbox.Option
                                  key={type.value}
                                  value={type}
                                  className={({ active }) =>
                                    clsx(
                                      'px-4 py-2 cursor-pointer flex items-center gap-2',
                                      active &&
                                        'bg-primary-50 dark:bg-primary-900/30',
                                    )
                                  }
                                >
                                  {({ selected }) => (
                                    <>
                                      <type.icon className="w-5 h-5" />
                                      <span className="flex-1">{type.label}</span>
                                      {selected && (
                                        <CheckIcon className="w-5 h-5 text-primary-500" />
                                      )}
                                    </>
                                  )}
                                </Listbox.Option>
                              ))}
                            </Listbox.Options>
                          </Transition>
                        </div>
                      </Listbox>
                    </div>

                    <div>
                      <label className="text-xs font-semibold uppercase tracking-wider mb-1.5 text-[var(--text-muted)] block">
                        Data Source (Plan)
                      </label>
                      <Controller
                        name="config.planId"
                        control={control}
                        render={({ field }) => (
                          <select {...field} className="input w-full">
                            <option value="">All Plans</option>
                            {Array.isArray(plans) && plans.map((plan) => (
                              <option key={plan.id} value={plan.id}>
                                {plan.name}
                              </option>
                            ))}
                          </select>
                        )}
                      />
                    </div>

                    <div className="flex justify-end gap-3 pt-4">
                      <button
                        type="button"
                        onClick={handleCloseModal}
                        className="btn-secondary"
                      >
                        Cancel
                      </button>
                      <button
                        type="submit"
                        disabled={createMutation.isPending || updateMutation.isPending}
                        className="btn-primary"
                      >
                        {createMutation.isPending || updateMutation.isPending
                          ? 'Saving...'
                          : editingReport
                            ? 'Update'
                            : 'Create'}
                      </button>
                    </div>
                  </form>
                </Dialog.Panel>
              </Transition.Child>
            </div>
          </div>
        </Dialog>
      </Transition>
    </div>
  );
}
