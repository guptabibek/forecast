import {
    AdjustmentsHorizontalIcon,
    ArrowDownIcon,
    ArrowPathIcon,
    ArrowTrendingDownIcon,
    ArrowTrendingUpIcon,
    ArrowUpIcon,
    BanknotesIcon,
    CalendarDaysIcon,
    ChartBarIcon,
    ChartPieIcon,
    CheckCircleIcon,
    ChevronDownIcon,
    ClockIcon,
    CubeIcon,
    DocumentTextIcon,
    ExclamationTriangleIcon,
    FunnelIcon,
    GlobeAltIcon,
    SparklesIcon,
    TableCellsIcon,
    UserGroupIcon,
    XMarkIcon,
} from '@heroicons/react/24/outline';
import { useQuery } from '@tanstack/react-query';
import { AnimatePresence, motion } from 'framer-motion';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Link } from 'react-router-dom';
import {
    Area,
    Bar,
    BarChart,
    CartesianGrid,
    Cell,
    ComposedChart,
    Legend,
    Line,
    Pie,
    PieChart,
    ResponsiveContainer,
    Tooltip,
    XAxis,
    YAxis,
} from 'recharts';
import { dataService, reportsService } from '../services/api';
import type { ABCAnalysisParams } from '../services/api/report.service';
import type { Dimension } from '../types';
import PharmaExecutiveOverview from './pharma-reports/PharmaExecutiveOverview';

// =====================
// Types
// =====================

interface DashboardStats {
  forecastAccuracy: number;
  accuracyChange: number;
  activePlans: number;
  pendingApproval: number;
  totalForecasts: number;
  forecastsChange: number;
  lastDataSync: string;
}

interface RevenueMetrics {
  currentMonth: number;
  lastMonth: number;
  momChange: number;
  yoyChange: number;
  ytdRevenue: number;
  ytdForecast: number;
  ytdVariance: number;
}

interface TopProduct {
  id: string;
  name: string;
  code: string;
  revenue: number;
  percentage: number;
}

interface RegionalData {
  id: string;
  name: string;
  code: string;
  revenue: number;
  percentage: number;
}

interface VarianceAlert {
  id: string;
  type: 'over' | 'under';
  entity: string;
  period: string;
  expected: number;
  actual: number;
  variance: number;
  severity: 'high' | 'medium' | 'low';
}

interface ForecastHealth {
  totalForecasts: number;
  modelDistribution: { model: string; count: number }[];
  coverage: number;
  accuracy: number;
}

interface ActivityItem {
  id: string;
  type: 'plan' | 'forecast' | 'import' | 'approval';
  title: string;
  user: string;
  time: string;
  createdAt: string;
}

// =====================
// Period Configuration
// =====================

type Granularity = 'daily' | 'weekly' | 'monthly' | 'quarterly';

interface PeriodOption {
  label: string;
  value: Granularity;
  defaultPeriods: number;
  description: string;
}

const PERIOD_OPTIONS: PeriodOption[] = [
  { label: 'Daily', value: 'daily', defaultPeriods: 30, description: 'Last 30 days' },
  { label: 'Weekly', value: 'weekly', defaultPeriods: 12, description: 'Last 12 weeks' },
  { label: 'Monthly', value: 'monthly', defaultPeriods: 6, description: 'Last 6 months' },
  { label: 'Quarterly', value: 'quarterly', defaultPeriods: 4, description: 'Last 4 quarters' },
];

// =====================
// Utility Functions
// =====================

const formatCurrency = (value: number): string => {
  if (value >= 1000000) {
    return `$${(value / 1000000).toFixed(2)}M`;
  } else if (value >= 1000) {
    return `$${(value / 1000).toFixed(1)}K`;
  }
  return `$${value.toFixed(0)}`;
};

const formatNumber = (value: number): string => {
  if (value >= 1000000) {
    return `${(value / 1000000).toFixed(1)}M`;
  } else if (value >= 1000) {
    return `${(value / 1000).toFixed(1)}K`;
  }
  return value.toFixed(0);
};

const formatPercent = (value: number): string => {
  return `${value >= 0 ? '+' : ''}${value.toFixed(1)}%`;
};

const formatRelativeTime = (dateString: string): string => {
  const date = new Date(dateString);
  const now = new Date();
  const diffMs = now.getTime() - date.getTime();
  const diffMins = Math.floor(diffMs / 60000);
  const diffHours = Math.floor(diffMins / 60);
  const diffDays = Math.floor(diffHours / 24);

  if (diffMins < 1) return 'Just now';
  if (diffMins < 60) return `${diffMins}m ago`;
  if (diffHours < 24) return `${diffHours}h ago`;
  if (diffDays < 7) return `${diffDays}d ago`;
  return date.toLocaleDateString();
};

// =====================
// Components
// =====================

const StatCard = ({
  title,
  value,
  change,
  changeType,
  icon: Icon,
  iconBg,
  iconColor,
  isLoading,
  subtitle,
}: {
  title: string;
  value: string;
  change?: string;
  changeType?: 'up' | 'down' | 'neutral';
  icon: React.ElementType;
  iconBg?: string;
  iconColor?: string;
  isLoading?: boolean;
  subtitle?: string;
}) => (
  <motion.div
    initial={{ opacity: 0, y: 20 }}
    animate={{ opacity: 1, y: 0 }}
    className="card p-5"
  >
    {isLoading ? (
      <div className="animate-pulse">
        <div className="h-4 bg-secondary-200 rounded w-24 mb-2" />
        <div className="h-8 bg-secondary-200 rounded w-16 mb-2" />
        <div className="h-3 bg-secondary-200 rounded w-32" />
      </div>
    ) : (
      <div className="flex items-start justify-between">
        <div className="flex-1">
          <p className="text-sm font-medium text-secondary-500 dark:text-secondary-400">{title}</p>
          <p className="text-2xl font-bold mt-1 text-secondary-900 dark:text-white">{value}</p>
          {change && (
            <div className="flex items-center gap-1 mt-2">
              {changeType === 'up' && <ArrowTrendingUpIcon className="w-4 h-4 text-success-500" />}
              {changeType === 'down' && <ArrowTrendingDownIcon className="w-4 h-4 text-error-500" />}
              <span
                className={`text-sm ${
                  changeType === 'up'
                    ? 'text-success-600'
                    : changeType === 'down'
                    ? 'text-error-600'
                    : 'text-secondary-500'
                }`}
              >
                {change}
              </span>
            </div>
          )}
          {subtitle && <p className="text-xs text-secondary-400 mt-1">{subtitle}</p>}
        </div>
        <div
          className={`w-12 h-12 rounded-xl flex items-center justify-center flex-shrink-0 ${
            iconBg || 'bg-primary-50 dark:bg-primary-900/30'
          }`}
        >
          <Icon className={`w-6 h-6 ${iconColor || 'text-primary-600 dark:text-primary-400'}`} />
        </div>
      </div>
    )}
  </motion.div>
);

const KPICard = ({
  title,
  value,
  subValue,
  trend,
  icon: Icon,
  color,
  isLoading,
}: {
  title: string;
  value: string;
  subValue?: string;
  trend?: number;
  icon: React.ElementType;
  color: 'blue' | 'green' | 'purple' | 'orange' | 'red';
  isLoading?: boolean;
}) => {
  const colors = {
    blue: { bg: 'bg-blue-50 dark:bg-blue-900/20', icon: 'text-blue-600', border: 'border-blue-200' },
    green: { bg: 'bg-emerald-50 dark:bg-emerald-900/20', icon: 'text-emerald-600', border: 'border-emerald-200' },
    purple: { bg: 'bg-purple-50 dark:bg-purple-900/20', icon: 'text-purple-600', border: 'border-purple-200' },
    orange: { bg: 'bg-orange-50 dark:bg-orange-900/20', icon: 'text-orange-600', border: 'border-orange-200' },
    red: { bg: 'bg-red-50 dark:bg-red-900/20', icon: 'text-red-600', border: 'border-red-200' },
  };

  return (
    <motion.div
      initial={{ opacity: 0, scale: 0.95 }}
      animate={{ opacity: 1, scale: 1 }}
      className={`p-4 rounded-xl ${colors[color].bg} border ${colors[color].border} border-opacity-50`}
    >
      {isLoading ? (
        <div className="animate-pulse space-y-2">
          <div className="h-3 bg-secondary-200 rounded w-16" />
          <div className="h-6 bg-secondary-200 rounded w-20" />
        </div>
      ) : (
        <>
          <div className="flex items-center gap-2 mb-2">
            <Icon className={`w-4 h-4 ${colors[color].icon}`} />
            <span className="text-xs font-medium text-secondary-600 dark:text-secondary-300">{title}</span>
          </div>
          <div className="flex items-end justify-between">
            <div>
              <p className="text-xl font-bold text-secondary-900 dark:text-white">{value}</p>
              {subValue && <p className="text-xs text-secondary-500">{subValue}</p>}
            </div>
            {trend !== undefined && (
              <div
                className={`flex items-center gap-0.5 text-sm font-medium ${
                  trend >= 0 ? 'text-emerald-600' : 'text-red-600'
                }`}
              >
                {trend >= 0 ? <ArrowUpIcon className="w-3 h-3" /> : <ArrowDownIcon className="w-3 h-3" />}
                {Math.abs(trend).toFixed(1)}%
              </div>
            )}
          </div>
        </>
      )}
    </motion.div>
  );
};

const VarianceAlertCard = ({ alert }: { alert: VarianceAlert }) => {
  const severityColors = {
    high: 'bg-red-50 border-red-200 dark:bg-red-900/20',
    medium: 'bg-orange-50 border-orange-200 dark:bg-orange-900/20',
    low: 'bg-yellow-50 border-yellow-200 dark:bg-yellow-900/20',
  };

  return (
    <div className={`p-3 rounded-lg border ${severityColors[alert.severity]}`}>
      <div className="flex items-center justify-between mb-1">
        <span className="text-sm font-medium text-secondary-900 dark:text-white">{alert.entity}</span>
        <span
          className={`text-xs px-2 py-0.5 rounded-full ${
            alert.type === 'over' ? 'bg-emerald-100 text-emerald-700' : 'bg-red-100 text-red-700'
          }`}
        >
          {alert.type === 'over' ? '+' : ''}{alert.variance.toFixed(1)}%
        </span>
      </div>
      <p className="text-xs text-secondary-500">
        Expected: {formatCurrency(alert.expected)} | Actual: {formatCurrency(alert.actual)}
      </p>
    </div>
  );
};

const getActivityIcon = (type: string) => {
  switch (type) {
    case 'plan':
    case 'approval':
      return { icon: CheckCircleIcon, bg: 'bg-success-50', color: 'text-success-600' };
    case 'forecast':
      return { icon: ChartBarIcon, bg: 'bg-primary-50', color: 'text-primary-600' };
    case 'import':
      return { icon: DocumentTextIcon, bg: 'bg-secondary-100', color: 'text-secondary-600' };
    default:
      return { icon: ClockIcon, bg: 'bg-secondary-100', color: 'text-secondary-600' };
  }
};

const CHART_COLORS = ['#3b82f6', '#22c55e', '#f59e0b', '#ef4444', '#8b5cf6', '#06b6d4', '#ec4899', '#f97316'];

// Period Selector Component
const PeriodSelector = ({
  selectedGranularity,
  onGranularityChange,
}: {
  selectedGranularity: Granularity;
  onGranularityChange: (granularity: Granularity) => void;
}) => (
  <div className="flex items-center gap-2">
    <CalendarDaysIcon className="w-4 h-4 text-secondary-400" />
    <div className="flex bg-secondary-100 dark:bg-secondary-800 rounded-lg p-1">
      {PERIOD_OPTIONS.map((option) => (
        <button
          key={option.value}
          onClick={() => onGranularityChange(option.value)}
          className={`px-3 py-1.5 text-xs font-medium rounded-md transition-all ${
            selectedGranularity === option.value
              ? 'bg-white dark:bg-secondary-700 text-primary-600 shadow-sm'
              : 'text-secondary-500 hover:text-secondary-700'
          }`}
          title={option.description}
        >
          {option.label}
        </button>
      ))}
    </div>
  </div>
);

// Multi-Select Filter Dropdown Component
interface FilterDropdownProps {
  label: string;
  icon: React.ComponentType<{ className?: string }>;
  options: Dimension[];
  selectedIds: string[];
  onChange: (ids: string[]) => void;
  isLoading?: boolean;
  placeholder?: string;
}

const FilterDropdown = ({
  label,
  icon: Icon,
  options,
  selectedIds,
  onChange,
  isLoading,
  placeholder = 'All',
}: FilterDropdownProps) => {
  const [isOpen, setIsOpen] = useState(false);
  const [searchTerm, setSearchTerm] = useState('');
  const dropdownRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const handleClickOutside = (event: MouseEvent) => {
      if (dropdownRef.current && !dropdownRef.current.contains(event.target as Node)) {
        setIsOpen(false);
      }
    };
    document.addEventListener('mousedown', handleClickOutside);
    return () => document.removeEventListener('mousedown', handleClickOutside);
  }, []);

  const filteredOptions = useMemo(() => {
    if (!searchTerm) return options;
    const term = searchTerm.toLowerCase();
    return options.filter(
      (opt) =>
        opt.name.toLowerCase().includes(term) ||
        opt.code.toLowerCase().includes(term)
    );
  }, [options, searchTerm]);

  const handleToggle = (id: string) => {
    if (selectedIds.includes(id)) {
      onChange(selectedIds.filter((sid) => sid !== id));
    } else {
      onChange([...selectedIds, id]);
    }
  };

  const handleSelectAll = () => {
    if (selectedIds.length === options.length) {
      onChange([]);
    } else {
      onChange(options.map((o) => o.id));
    }
  };

  const handleClear = () => {
    onChange([]);
    setIsOpen(false);
  };

  const displayText = useMemo(() => {
    if (selectedIds.length === 0) return placeholder;
    if (selectedIds.length === 1) {
      const selected = options.find((o) => o.id === selectedIds[0]);
      return selected?.name || '1 selected';
    }
    return `${selectedIds.length} selected`;
  }, [selectedIds, options, placeholder]);

  return (
    <div className="relative" ref={dropdownRef}>
      <button
        onClick={() => setIsOpen(!isOpen)}
        className={`flex items-center gap-2 px-3 py-2 text-sm rounded-lg border transition-all ${
          selectedIds.length > 0
            ? 'border-primary-500 bg-primary-50 dark:bg-primary-900/20 text-primary-700'
            : 'border-secondary-200 dark:border-secondary-700 bg-white dark:bg-secondary-800 text-secondary-700 dark:text-secondary-300 hover:border-secondary-300'
        }`}
        disabled={isLoading}
      >
        <Icon className="w-4 h-4" />
        <span className="font-medium">{label}:</span>
        <span className={selectedIds.length > 0 ? 'text-primary-600' : 'text-secondary-500'}>
          {isLoading ? 'Loading...' : displayText}
        </span>
        <ChevronDownIcon className={`w-4 h-4 transition-transform ${isOpen ? 'rotate-180' : ''}`} />
      </button>

      <AnimatePresence>
        {isOpen && (
          <motion.div
            initial={{ opacity: 0, y: -10 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: -10 }}
            transition={{ duration: 0.15 }}
            className="absolute top-full left-0 mt-2 w-72 bg-white dark:bg-secondary-800 rounded-lg shadow-lg border border-secondary-200 dark:border-secondary-700 z-50"
          >
            {/* Search */}
            <div className="p-2 border-b border-secondary-200 dark:border-secondary-700">
              <input
                type="text"
                value={searchTerm}
                onChange={(e) => setSearchTerm(e.target.value)}
                placeholder={`Search ${label.toLowerCase()}...`}
                className="w-full px-3 py-2 text-sm bg-secondary-50 dark:bg-secondary-900 border border-secondary-200 dark:border-secondary-600 rounded-md focus:outline-none focus:ring-2 focus:ring-primary-500"
                autoFocus
              />
            </div>

            {/* Actions */}
            <div className="flex items-center justify-between px-3 py-2 border-b border-secondary-100 dark:border-secondary-700 text-xs">
              <button
                onClick={handleSelectAll}
                className="text-primary-600 hover:text-primary-700 font-medium"
              >
                {selectedIds.length === options.length ? 'Deselect All' : 'Select All'}
              </button>
              {selectedIds.length > 0 && (
                <button
                  onClick={handleClear}
                  className="text-secondary-500 hover:text-secondary-700 flex items-center gap-1"
                >
                  <XMarkIcon className="w-3 h-3" />
                  Clear
                </button>
              )}
            </div>

            {/* Options List */}
            <div className="max-h-60 overflow-y-auto">
              {filteredOptions.length === 0 ? (
                <div className="p-4 text-center text-secondary-500 text-sm">
                  {searchTerm ? 'No matches found' : 'No options available'}
                </div>
              ) : (
                filteredOptions.map((option) => (
                  <label
                    key={option.id}
                    className="flex items-center gap-3 px-3 py-2 hover:bg-secondary-50 dark:hover:bg-secondary-700 cursor-pointer"
                  >
                    <input
                      type="checkbox"
                      checked={selectedIds.includes(option.id)}
                      onChange={() => handleToggle(option.id)}
                      className="w-4 h-4 rounded border-secondary-300 text-primary-600 focus:ring-primary-500"
                    />
                    <div className="flex-1 min-w-0">
                      <p className="text-sm font-medium text-secondary-900 dark:text-white truncate">
                        {option.name}
                      </p>
                      <p className="text-xs text-secondary-500 truncate">{option.code}</p>
                    </div>
                  </label>
                ))
              )}
            </div>

            {/* Footer */}
            <div className="p-2 border-t border-secondary-200 dark:border-secondary-700 bg-secondary-50 dark:bg-secondary-900 rounded-b-lg">
              <p className="text-xs text-secondary-500 text-center">
                {selectedIds.length} of {options.length} selected
              </p>
            </div>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
};

// Filter Bar Component
interface DashboardFilters {
  productIds: string[];
  customerIds: string[];
}

const FilterBar = ({
  filters,
  onFiltersChange,
  products,
  customers,
  isLoadingProducts,
  isLoadingCustomers,
}: {
  filters: DashboardFilters;
  onFiltersChange: (filters: DashboardFilters) => void;
  products: Dimension[];
  customers: Dimension[];
  isLoadingProducts: boolean;
  isLoadingCustomers: boolean;
}) => {
  const hasFilters = filters.productIds.length > 0 || filters.customerIds.length > 0;

  const handleClearAll = () => {
    onFiltersChange({ productIds: [], customerIds: [] });
  };

  return (
    <div className="flex items-center gap-3 flex-wrap">
      <div className="flex items-center gap-1 text-secondary-500">
        <FunnelIcon className="w-4 h-4" />
        <span className="text-xs font-medium">Filters:</span>
      </div>

      <FilterDropdown
        label="Products"
        icon={CubeIcon}
        options={products}
        selectedIds={filters.productIds}
        onChange={(ids) => onFiltersChange({ ...filters, productIds: ids })}
        isLoading={isLoadingProducts}
        placeholder="All Products"
      />

      <FilterDropdown
        label="Customers"
        icon={UserGroupIcon}
        options={customers}
        selectedIds={filters.customerIds}
        onChange={(ids) => onFiltersChange({ ...filters, customerIds: ids })}
        isLoading={isLoadingCustomers}
        placeholder="All Customers"
      />

      {hasFilters && (
        <button
          onClick={handleClearAll}
          className="flex items-center gap-1 px-2 py-1 text-xs text-secondary-500 hover:text-secondary-700 hover:bg-secondary-100 rounded-md transition-colors"
        >
          <XMarkIcon className="w-3 h-3" />
          Clear All
        </button>
      )}
    </div>
  );
};

// =====================
// ABC Classification Component
// =====================

type ABCMode = 'revenue' | 'margin';

interface ABCThresholds {
  thresholdA: number;
  thresholdB: number;
}

interface ABCClassificationProps {
  filterParams: { productIds?: string[]; customerIds?: string[] };
}

const DEFAULT_THRESHOLDS: ABCThresholds = {
  thresholdA: 80,
  thresholdB: 95,
};

const ABC_CLASS_COLORS = {
  A: { bg: 'bg-emerald-100', text: 'text-emerald-700', fill: '#22c55e', border: 'border-emerald-500' },
  B: { bg: 'bg-amber-100', text: 'text-amber-700', fill: '#f59e0b', border: 'border-amber-500' },
  C: { bg: 'bg-slate-100', text: 'text-slate-600', fill: '#94a3b8', border: 'border-slate-400' },
};

const ABCClassificationSection = ({ filterParams }: ABCClassificationProps) => {
  // Local state for ABC configuration
  const [mode, setMode] = useState<ABCMode>('revenue');
  const [thresholds, setThresholds] = useState<ABCThresholds>(DEFAULT_THRESHOLDS);
  const [showThresholdConfig, setShowThresholdConfig] = useState(false);
  const [tempThresholds, setTempThresholds] = useState<ABCThresholds>(DEFAULT_THRESHOLDS);
  
  // Build ABC params
  const abcParams: ABCAnalysisParams = useMemo(() => ({
    ...filterParams,
    mode,
    thresholdA: thresholds.thresholdA,
    thresholdB: thresholds.thresholdB,
  }), [filterParams, mode, thresholds]);

  const dashboardQueryBehavior = {
    retry: false,
    refetchOnWindowFocus: false,
    refetchOnReconnect: false,
  };

  // Fetch ABC analysis data
  const { data: abcData, isLoading, error, refetch } = useQuery({
    queryKey: ['dashboard-abc-analysis', abcParams],
    queryFn: () => reportsService.getABCAnalysis(abcParams),
    staleTime: 30000,
    ...dashboardQueryBehavior,
  });

  // Handle mode change
  const handleModeChange = useCallback((newMode: ABCMode) => {
    setMode(newMode);
  }, []);

  // Handle threshold apply
  const handleApplyThresholds = useCallback(() => {
    if (tempThresholds.thresholdA >= tempThresholds.thresholdB) {
      alert('Threshold A must be less than Threshold B');
      return;
    }
    setThresholds(tempThresholds);
    setShowThresholdConfig(false);
  }, [tempThresholds]);

  // Reset thresholds to default
  const handleResetThresholds = useCallback(() => {
    setTempThresholds(DEFAULT_THRESHOLDS);
    setThresholds(DEFAULT_THRESHOLDS);
    setShowThresholdConfig(false);
  }, []);

  // Prepare chart data
  const chartData = useMemo(() => {
    if (!abcData?.distribution) return [];
    return abcData.distribution.map((d) => ({
      ...d,
      value: mode === 'margin' ? d.margin : d.revenue,
    }));
  }, [abcData, mode]);

  return (
    <motion.div
      initial={{ opacity: 0, y: 20 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ delay: 0.45 }}
      className="card"
    >
      {/* Header with Controls */}
      <div className="card-header border-b border-secondary-200 dark:border-secondary-700">
        <div className="flex flex-col lg:flex-row lg:items-center lg:justify-between gap-4">
          {/* Title and Description */}
          <div>
            <div className="flex items-center gap-2">
              <TableCellsIcon className="w-5 h-5 text-primary-600" />
              <h2 className="text-lg font-semibold">ABC Product Classification</h2>
            </div>
            <p className="text-sm text-secondary-500 mt-1">
              {mode === 'revenue' ? 'Revenue-based' : 'Margin-based'} classification using cumulative contribution (
              A ≤ {thresholds.thresholdA}%, B ≤ {thresholds.thresholdB}%, C &gt; {thresholds.thresholdB}%)
            </p>
          </div>

          {/* Controls */}
          <div className="flex items-center gap-3 flex-wrap">
            {/* Mode Toggle */}
            <div className="flex bg-secondary-100 dark:bg-secondary-800 rounded-lg p-1">
              <button
                onClick={() => handleModeChange('revenue')}
                className={`px-3 py-1.5 text-xs font-medium rounded-md transition-all flex items-center gap-1 ${
                  mode === 'revenue'
                    ? 'bg-white dark:bg-secondary-700 text-primary-600 shadow-sm'
                    : 'text-secondary-500 hover:text-secondary-700'
                }`}
              >
                <BanknotesIcon className="w-3.5 h-3.5" />
                Revenue
              </button>
              <button
                onClick={() => handleModeChange('margin')}
                className={`px-3 py-1.5 text-xs font-medium rounded-md transition-all flex items-center gap-1 ${
                  mode === 'margin'
                    ? 'bg-white dark:bg-secondary-700 text-primary-600 shadow-sm'
                    : 'text-secondary-500 hover:text-secondary-700'
                }`}
              >
                <ChartBarIcon className="w-3.5 h-3.5" />
                Margin
              </button>
            </div>

            {/* Threshold Config Button */}
            <div className="relative">
              <button
                onClick={() => {
                  setTempThresholds(thresholds);
                  setShowThresholdConfig(!showThresholdConfig);
                }}
                className={`flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium rounded-lg border transition-all ${
                  showThresholdConfig
                    ? 'bg-primary-50 border-primary-300 text-primary-700'
                    : 'bg-white dark:bg-secondary-800 border-secondary-200 dark:border-secondary-700 text-secondary-600 hover:border-secondary-300'
                }`}
              >
                <AdjustmentsHorizontalIcon className="w-4 h-4" />
                Thresholds
                <ChevronDownIcon className={`w-3 h-3 transition-transform ${showThresholdConfig ? 'rotate-180' : ''}`} />
              </button>

              {/* Threshold Config Dropdown */}
              <AnimatePresence>
                {showThresholdConfig && (
                  <motion.div
                    initial={{ opacity: 0, y: -10 }}
                    animate={{ opacity: 1, y: 0 }}
                    exit={{ opacity: 0, y: -10 }}
                    className="absolute right-0 top-full mt-2 w-64 bg-white dark:bg-secondary-800 rounded-lg shadow-lg border border-secondary-200 dark:border-secondary-700 z-50 p-4"
                  >
                    <h4 className="text-sm font-medium mb-3">Classification Thresholds</h4>
                    
                    <div className="space-y-3">
                      <div>
                        <label className="flex items-center justify-between text-xs text-secondary-500 mb-1">
                          <span>Class A Threshold (≤)</span>
                          <span className="font-mono">{tempThresholds.thresholdA}%</span>
                        </label>
                        <input
                          type="range"
                          min="50"
                          max="95"
                          value={tempThresholds.thresholdA}
                          onChange={(e) => setTempThresholds(prev => ({ ...prev, thresholdA: Number(e.target.value) }))}
                          className="w-full h-2 bg-secondary-200 rounded-lg appearance-none cursor-pointer accent-emerald-500"
                        />
                      </div>

                      <div>
                        <label className="flex items-center justify-between text-xs text-secondary-500 mb-1">
                          <span>Class B Threshold (≤)</span>
                          <span className="font-mono">{tempThresholds.thresholdB}%</span>
                        </label>
                        <input
                          type="range"
                          min="60"
                          max="99"
                          value={tempThresholds.thresholdB}
                          onChange={(e) => setTempThresholds(prev => ({ ...prev, thresholdB: Number(e.target.value) }))}
                          className="w-full h-2 bg-secondary-200 rounded-lg appearance-none cursor-pointer accent-amber-500"
                        />
                      </div>

                      <div className="pt-2 border-t border-secondary-100 dark:border-secondary-700 flex justify-between">
                        <button
                          onClick={handleResetThresholds}
                          className="text-xs text-secondary-500 hover:text-secondary-700"
                        >
                          Reset to Default
                        </button>
                        <button
                          onClick={handleApplyThresholds}
                          className="text-xs bg-primary-600 text-white px-3 py-1 rounded-md hover:bg-primary-700"
                        >
                          Apply
                        </button>
                      </div>
                    </div>
                  </motion.div>
                )}
              </AnimatePresence>
            </div>

            {/* Refresh Button */}
            <button
              onClick={() => refetch()}
              className="p-1.5 text-secondary-400 hover:text-secondary-600 hover:bg-secondary-100 rounded-md transition-colors"
              title="Refresh data"
            >
              <ArrowPathIcon className={`w-4 h-4 ${isLoading ? 'animate-spin' : ''}`} />
            </button>
          </div>
        </div>

        {/* Summary Badges */}
        {abcData?.summary && (
          <div className="flex gap-3 mt-4">
            <div className={`px-3 py-1.5 rounded-lg ${ABC_CLASS_COLORS.A.bg} flex items-center gap-2`}>
              <span className={`text-lg font-bold ${ABC_CLASS_COLORS.A.text}`}>{abcData.summary.classA}</span>
              <span className="text-xs text-secondary-600">
                Class A ({abcData.summary.classAContribution?.toFixed(1) || 0}%)
              </span>
            </div>
            <div className={`px-3 py-1.5 rounded-lg ${ABC_CLASS_COLORS.B.bg} flex items-center gap-2`}>
              <span className={`text-lg font-bold ${ABC_CLASS_COLORS.B.text}`}>{abcData.summary.classB}</span>
              <span className="text-xs text-secondary-600">
                Class B ({abcData.summary.classBContribution?.toFixed(1) || 0}%)
              </span>
            </div>
            <div className={`px-3 py-1.5 rounded-lg ${ABC_CLASS_COLORS.C.bg} flex items-center gap-2`}>
              <span className={`text-lg font-bold ${ABC_CLASS_COLORS.C.text}`}>{abcData.summary.classC}</span>
              <span className="text-xs text-secondary-600">
                Class C ({abcData.summary.classCContribution?.toFixed(1) || 0}%)
              </span>
            </div>
          </div>
        )}
      </div>

      {/* Content */}
      <div className="p-6">
        {isLoading ? (
          <div className="h-[400px] flex items-center justify-center">
            <ArrowPathIcon className="w-8 h-8 animate-spin text-primary-500" />
          </div>
        ) : error ? (
          <div className="h-[400px] flex items-center justify-center text-red-500">
            <div className="text-center">
              <ExclamationTriangleIcon className="w-12 h-12 mx-auto mb-2 opacity-50" />
              <p>Failed to load ABC analysis</p>
            </div>
          </div>
        ) : !abcData?.products || abcData.products.length === 0 ? (
          <div className="h-[400px] flex items-center justify-center text-secondary-500">
            <div className="text-center">
              <CubeIcon className="w-12 h-12 mx-auto mb-2 opacity-50" />
              <p>No product data available for ABC analysis</p>
              <Link to="/data/import" className="text-primary-600 text-sm hover:underline mt-2 inline-block">
                Import data to get started →
              </Link>
            </div>
          </div>
        ) : (
          <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
            {/* ABC Distribution Pie Chart */}
            <div className="lg:col-span-1">
              <h3 className="text-sm font-medium text-secondary-700 dark:text-secondary-300 mb-3">
                {mode === 'revenue' ? 'Revenue' : 'Margin'} Distribution by Class
              </h3>
              <ResponsiveContainer width="100%" height={250}>
                <PieChart>
                  <Pie
                    data={chartData}
                    dataKey="contribution"
                    nameKey="class"
                    cx="50%"
                    cy="50%"
                    innerRadius={50}
                    outerRadius={80}
                    label={({ name, percent }) => `${name}: ${(percent * 100).toFixed(0)}%`}
                    labelLine={{ stroke: '#94a3b8', strokeWidth: 1 }}
                  >
                    {chartData.map((entry) => (
                      <Cell
                        key={entry.class}
                        fill={ABC_CLASS_COLORS[entry.class as keyof typeof ABC_CLASS_COLORS]?.fill || '#94a3b8'}
                      />
                    ))}
                  </Pie>
                  <Tooltip
                    formatter={(value: number, name: string) => [
                      `${value.toFixed(1)}%`,
                      `Class (${name})`,
                    ]}
                    contentStyle={{
                      backgroundColor: '#1e293b',
                      border: 'none',
                      borderRadius: '8px',
                      color: '#f8fafc',
                    }}
                  />
                </PieChart>
              </ResponsiveContainer>

              {/* Class Legend with Details */}
              <div className="mt-4 space-y-2">
                {abcData.distribution.map((d) => (
                  <div
                    key={d.class}
                    className={`flex items-center justify-between p-2 rounded-lg ${
                      ABC_CLASS_COLORS[d.class as keyof typeof ABC_CLASS_COLORS]?.bg || 'bg-secondary-100'
                    }`}
                  >
                    <div className="flex items-center gap-2">
                      <div
                        className="w-3 h-3 rounded-full"
                        style={{ backgroundColor: ABC_CLASS_COLORS[d.class as keyof typeof ABC_CLASS_COLORS]?.fill }}
                      />
                      <span className="text-sm font-medium">{d.label}</span>
                    </div>
                    <div className="text-right">
                      <p className="text-sm font-bold">{d.count} products</p>
                      <p className="text-xs text-secondary-500">
                        {formatCurrency(mode === 'margin' ? d.margin : d.revenue)}
                      </p>
                    </div>
                  </div>
                ))}
              </div>
            </div>

            {/* Products Table */}
            <div className="lg:col-span-2">
              <h3 className="text-sm font-medium text-secondary-700 dark:text-secondary-300 mb-3">
                Product Classification Details (Top 20)
              </h3>
              <div className="overflow-x-auto max-h-[420px] overflow-y-auto border border-secondary-200 dark:border-secondary-700 rounded-lg">
                <table className="w-full text-sm">
                  <thead className="sticky top-0 bg-secondary-50 dark:bg-secondary-800 z-10">
                    <tr>
                      <th className="text-left py-3 px-4 font-medium text-secondary-500 border-b">Product</th>
                      <th className="text-right py-3 px-4 font-medium text-secondary-500 border-b">
                        {mode === 'revenue' ? 'Revenue' : 'Margin'}
                      </th>
                      <th className="text-right py-3 px-4 font-medium text-secondary-500 border-b">Contrib.</th>
                      <th className="text-right py-3 px-4 font-medium text-secondary-500 border-b">Cumulative</th>
                      <th className="text-center py-3 px-4 font-medium text-secondary-500 border-b">Class</th>
                    </tr>
                  </thead>
                  <tbody>
                    {abcData.products.slice(0, 20).map((product, idx) => (
                      <tr
                        key={product.id}
                        className={`border-b border-secondary-100 dark:border-secondary-800 hover:bg-secondary-50 dark:hover:bg-secondary-800/50 ${
                          idx % 2 === 0 ? '' : 'bg-secondary-50/50 dark:bg-secondary-900/30'
                        }`}
                      >
                        <td className="py-2.5 px-4">
                          <div>
                            <p className="font-medium text-secondary-900 dark:text-white">{product.name}</p>
                            <p className="text-xs text-secondary-400">{product.code}</p>
                          </div>
                        </td>
                        <td className="py-2.5 px-4 text-right font-mono">
                          {formatCurrency(product.metricValue)}
                        </td>
                        <td className="py-2.5 px-4 text-right">
                          <span className="font-medium">{product.contribution.toFixed(1)}%</span>
                        </td>
                        <td className="py-2.5 px-4 text-right">
                          <div className="flex items-center justify-end gap-2">
                            <div className="w-16 h-1.5 bg-secondary-200 dark:bg-secondary-700 rounded-full overflow-hidden">
                              <div
                                className={`h-full rounded-full ${
                                  product.cumulativeContribution <= thresholds.thresholdA
                                    ? 'bg-emerald-500'
                                    : product.cumulativeContribution <= thresholds.thresholdB
                                    ? 'bg-amber-500'
                                    : 'bg-slate-400'
                                }`}
                                style={{ width: `${Math.min(100, product.cumulativeContribution)}%` }}
                              />
                            </div>
                            <span className="text-xs font-mono w-12 text-right">
                              {product.cumulativeContribution.toFixed(1)}%
                            </span>
                          </div>
                        </td>
                        <td className="py-2.5 px-4 text-center">
                          <span
                            className={`inline-flex w-7 h-7 items-center justify-center rounded-full text-xs font-bold ${
                              ABC_CLASS_COLORS[product.class]?.bg || 'bg-secondary-100'
                            } ${ABC_CLASS_COLORS[product.class]?.text || 'text-secondary-600'}`}
                          >
                            {product.class}
                          </span>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>

              {/* Audit Footer */}
              {abcData.config && (
                <div className="mt-4 p-3 bg-secondary-50 dark:bg-secondary-800/50 rounded-lg text-xs text-secondary-500">
                  <div className="flex items-center justify-between">
                    <span>
                      <strong>Classification Config:</strong> Mode: {abcData.config.mode}, 
                      Thresholds: A≤{abcData.config.thresholdA}%, B≤{abcData.config.thresholdB}%
                    </span>
                    <span>
                      Total: {abcData.config.totalProducts} products | 
                      Revenue: {formatCurrency(abcData.config.totalRevenue)} | 
                      Margin: {formatCurrency(abcData.config.totalMargin)}
                    </span>
                  </div>
                </div>
              )}
            </div>
          </div>
        )}
      </div>
    </motion.div>
  );
};

// =====================
// Main Dashboard Component
// =====================

export default function Dashboard() {
  // Period selector state
  const [granularity, setGranularity] = useState<Granularity>('monthly');
  
  // Filter state
  const [filters, setFilters] = useState<DashboardFilters>({
    productIds: [],
    customerIds: [],
  });
  
  // Get periods based on selected granularity
  const periodConfig = PERIOD_OPTIONS.find(p => p.value === granularity) || PERIOD_OPTIONS[2];

  // Build filter params for API calls
  const filterParams = useMemo(() => ({
    productIds: filters.productIds.length > 0 ? filters.productIds : undefined,
    customerIds: filters.customerIds.length > 0 ? filters.customerIds : undefined,
  }), [filters]);

  // Fetch filter dimension data (products and customers)
  const { data: productsData, isLoading: productsFilterLoading } = useQuery({
    queryKey: ['filter-products'],
    queryFn: () => dataService.getDimensionHierarchy('product'),
    staleTime: 300000, // 5 minutes
  });

  const { data: customersData, isLoading: customersFilterLoading } = useQuery({
    queryKey: ['filter-customers'],
    queryFn: () => dataService.getDimensionHierarchy('customer'),
    staleTime: 300000, // 5 minutes
  });

  const productOptions = (productsData || []) as Dimension[];
  const customerOptions = (customersData || []) as Dimension[];

  const dashboardQueryBehavior = {
    retry: false,
    refetchOnWindowFocus: false,
    refetchOnReconnect: false,
  };

  // Fetch all dashboard data with filter support
  const { data: statsData, isLoading: statsLoading } = useQuery({
    queryKey: ['dashboard-stats', filterParams],
    queryFn: () => reportsService.getDashboardStats(filterParams),
    staleTime: 30000,
    ...dashboardQueryBehavior,
  });

  const { data: revenueData, isLoading: revenueLoading } = useQuery({
    queryKey: ['dashboard-revenue', filterParams],
    queryFn: () => reportsService.getRevenueMetrics(filterParams),
    staleTime: 30000,
    ...dashboardQueryBehavior,
  });

  const { data: topProducts, isLoading: productsLoading } = useQuery({
    queryKey: ['dashboard-top-products', filterParams],
    queryFn: () => reportsService.getTopProducts({ limit: 5, ...filterParams }),
    staleTime: 60000,
    ...dashboardQueryBehavior,
  });

  const { data: regionalData, isLoading: regionalLoading } = useQuery({
    queryKey: ['dashboard-regional', filterParams],
    queryFn: () => reportsService.getRegionalBreakdown(filterParams),
    staleTime: 60000,
    ...dashboardQueryBehavior,
  });

  const { data: varianceAlerts, isLoading: alertsLoading } = useQuery({
    queryKey: ['dashboard-variance-alerts', filterParams],
    queryFn: () => reportsService.getVarianceAlerts(filterParams),
    staleTime: 30000,
    ...dashboardQueryBehavior,
  });

  const { data: forecastHealth, isLoading: healthLoading } = useQuery({
    queryKey: ['dashboard-forecast-health', filterParams],
    queryFn: () => reportsService.getForecastHealth(filterParams),
    staleTime: 60000,
    ...dashboardQueryBehavior,
  });

  const { data: activityData, isLoading: activityLoading } = useQuery({
    queryKey: ['dashboard-activity'],
    queryFn: () => reportsService.getRecentActivity({ limit: 5 }),
    staleTime: 30000,
    ...dashboardQueryBehavior,
  });

  const { data: modelAccuracy, isLoading: accuracyLoading } = useQuery({
    queryKey: ['dashboard-model-accuracy'],
    queryFn: () => reportsService.getModelAccuracy(),
    staleTime: 60000,
    ...dashboardQueryBehavior,
  });

  // Flexible period trend (with granularity)
  const { data: trendComparison, isLoading: trendComparisonLoading } = useQuery({
    queryKey: ['dashboard-trend-comparison', granularity, periodConfig.defaultPeriods],
    queryFn: () => reportsService.getTrendComparison({
      granularity,
      periods: periodConfig.defaultPeriods,
      ...filterParams,
    }),
    staleTime: 60000,
    ...dashboardQueryBehavior,
  });

  // Demand vs Supply Analysis
  const { data: demandSupply, isLoading: demandSupplyLoading } = useQuery({
    queryKey: ['dashboard-demand-supply', filterParams],
    queryFn: () => reportsService.getDemandSupply({ periods: 6, ...filterParams }),
    staleTime: 60000,
    ...dashboardQueryBehavior,
  });

  // Forecast Bias Analysis
  const { data: forecastBias, isLoading: biasLoading } = useQuery({
    queryKey: ['dashboard-forecast-bias', filterParams],
    queryFn: () => reportsService.getForecastBias(filterParams),
    staleTime: 60000,
    ...dashboardQueryBehavior,
  });

  // ABC Analysis is now handled by the ABCClassificationSection component internally

  const stats = statsData as DashboardStats | undefined;
  const revenue = revenueData as RevenueMetrics | undefined;
  const health = forecastHealth as ForecastHealth | undefined;
  const products = topProducts as TopProduct[] | undefined;
  const regions = regionalData as RegionalData[] | undefined;
  const alerts = varianceAlerts as VarianceAlert[] | undefined;
  const activity = activityData as ActivityItem[] | undefined;
  const models = modelAccuracy as { model: string; mape: number }[] | undefined;

  // Check if any filters are active
  const hasActiveFilters = filters.productIds.length > 0 || filters.customerIds.length > 0;

  return (
    <div className="space-y-6 pb-8">
      {/* Header with Period Selector */}
      <div className="flex items-center justify-between flex-wrap gap-4">
        <div>
          <h1 className="text-2xl font-bold text-secondary-900 dark:text-white">Dashboard</h1>
          <p className="text-secondary-500 dark:text-secondary-400 mt-1">
            Real-time insights into your forecasting performance
            {hasActiveFilters && (
              <span className="ml-2 text-xs bg-primary-100 text-primary-700 px-2 py-0.5 rounded-full">
                Filtered view
              </span>
            )}
          </p>
        </div>
        <div className="flex items-center gap-4">
          <PeriodSelector
            selectedGranularity={granularity}
            onGranularityChange={setGranularity}
          />
          <span className="text-xs text-secondary-500 flex items-center gap-1">
            <span className="w-2 h-2 bg-emerald-500 rounded-full animate-pulse" />
            Live data
          </span>
          <Link
            to="/reports"
            className="btn-secondary text-sm"
          >
            View Reports
          </Link>
        </div>
      </div>

      {/* Filters Row */}
      <motion.div
        initial={{ opacity: 0, y: -10 }}
        animate={{ opacity: 1, y: 0 }}
        className="card p-4"
      >
        <FilterBar
          filters={filters}
          onFiltersChange={setFilters}
          products={productOptions}
          customers={customerOptions}
          isLoadingProducts={productsFilterLoading}
          isLoadingCustomers={customersFilterLoading}
        />
      </motion.div>

      {/* Revenue KPIs Row */}
      <motion.div
        initial={{ opacity: 0, y: 20 }}
        animate={{ opacity: 1, y: 0 }}
        className="card p-6"
      >
        <div className="flex items-center justify-between mb-4">
          <div className="flex items-center gap-2">
            <BanknotesIcon className="w-5 h-5 text-emerald-600" />
            <h2 className="text-lg font-semibold">Revenue Overview</h2>
          </div>
          <span className="text-xs text-secondary-400">Last updated: {formatRelativeTime(stats?.lastDataSync || new Date().toISOString())}</span>
        </div>
        <div className="grid grid-cols-2 md:grid-cols-4 lg:grid-cols-7 gap-4">
          <KPICard
            title="This Month"
            value={formatCurrency(revenue?.currentMonth || 0)}
            trend={revenue?.momChange}
            icon={BanknotesIcon}
            color="green"
            isLoading={revenueLoading}
          />
          <KPICard
            title="Last Month"
            value={formatCurrency(revenue?.lastMonth || 0)}
            icon={ClockIcon}
            color="blue"
            isLoading={revenueLoading}
          />
          <KPICard
            title="MoM Change"
            value={formatPercent(revenue?.momChange || 0)}
            icon={ArrowTrendingUpIcon}
            color={revenue?.momChange && revenue.momChange >= 0 ? 'green' : 'red'}
            isLoading={revenueLoading}
          />
          <KPICard
            title="YoY Change"
            value={formatPercent(revenue?.yoyChange || 0)}
            icon={ArrowTrendingUpIcon}
            color={revenue?.yoyChange && revenue.yoyChange >= 0 ? 'green' : 'red'}
            isLoading={revenueLoading}
          />
          <KPICard
            title="YTD Revenue"
            value={formatCurrency(revenue?.ytdRevenue || 0)}
            icon={ChartBarIcon}
            color="purple"
            isLoading={revenueLoading}
          />
          <KPICard
            title="YTD Forecast"
            value={formatCurrency(revenue?.ytdForecast || 0)}
            icon={SparklesIcon}
            color="blue"
            isLoading={revenueLoading}
          />
          <KPICard
            title="YTD Variance"
            value={formatPercent(revenue?.ytdVariance || 0)}
            icon={ExclamationTriangleIcon}
            color={revenue?.ytdVariance && Math.abs(revenue.ytdVariance) < 5 ? 'green' : 'orange'}
            isLoading={revenueLoading}
          />
        </div>
      </motion.div>

      {/* Core Stats Row */}
      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-4">
        <StatCard
          title="Forecast Accuracy"
          value={`${(stats?.forecastAccuracy || 0).toFixed(1)}%`}
          change={`${(stats?.accuracyChange || 0) >= 0 ? '+' : ''}${(stats?.accuracyChange || 0).toFixed(1)}% vs last month`}
          changeType={(stats?.accuracyChange || 0) > 0 ? 'up' : (stats?.accuracyChange || 0) < 0 ? 'down' : 'neutral'}
          icon={ChartBarIcon}
          iconBg="bg-emerald-50 dark:bg-emerald-900/30"
          iconColor="text-emerald-600"
          isLoading={statsLoading}
        />
        <StatCard
          title="Active Plans"
          value={String(stats?.activePlans || 0)}
          change={`${stats?.pendingApproval || 0} pending approval`}
          changeType="neutral"
          icon={DocumentTextIcon}
          iconBg="bg-blue-50 dark:bg-blue-900/30"
          iconColor="text-blue-600"
          isLoading={statsLoading}
        />
        <StatCard
          title="Total Forecasts"
          value={formatNumber(stats?.totalForecasts || 0)}
          change={`${(stats?.forecastsChange || 0) >= 0 ? '+' : ''}${(stats?.forecastsChange || 0).toFixed(1)}% this quarter`}
          changeType={(stats?.forecastsChange || 0) > 0 ? 'up' : (stats?.forecastsChange || 0) < 0 ? 'down' : 'neutral'}
          icon={SparklesIcon}
          iconBg="bg-purple-50 dark:bg-purple-900/30"
          iconColor="text-purple-600"
          isLoading={statsLoading}
        />
        <StatCard
          title="Forecast Coverage"
          value={`${(health?.coverage || 0).toFixed(0)}%`}
          subtitle="Products with forecasts"
          icon={CubeIcon}
          iconBg="bg-orange-50 dark:bg-orange-900/30"
          iconColor="text-orange-600"
          isLoading={healthLoading}
        />
      </div>

      <PharmaExecutiveOverview />

      {/* Main Charts Row */}
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
        {/* Forecast vs Actual Trend - Now with Flexible Periods */}
        <motion.div
          initial={{ opacity: 0, y: 20 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ delay: 0.1 }}
          className="lg:col-span-2 card"
        >
          <div className="card-header">
            <div className="flex items-center justify-between">
              <div>
                <h2 className="text-lg font-semibold">Forecast vs Actual Trend</h2>
                <p className="text-sm text-secondary-500">
                  {periodConfig.description} ({granularity} view)
                </p>
              </div>
              {trendComparison?.meta && (
                <span className="text-xs bg-secondary-100 dark:bg-secondary-800 px-2 py-1 rounded-md">
                  {trendComparison.meta.totalPeriods} periods
                </span>
              )}
            </div>
          </div>
          <div className="p-6">
            {trendComparisonLoading ? (
              <div className="h-[300px] flex items-center justify-center">
                <ArrowPathIcon className="w-8 h-8 animate-spin text-primary-500" />
              </div>
            ) : !trendComparison?.data || trendComparison.data.length === 0 ? (
              <div className="h-[300px] flex items-center justify-center text-secondary-500">
                <div className="text-center">
                  <ChartBarIcon className="w-12 h-12 mx-auto mb-2 opacity-50" />
                  <p>No trend data available</p>
                  <Link to="/forecasts" className="text-primary-600 text-sm hover:underline">
                    Generate forecasts to see trends →
                  </Link>
                </div>
              </div>
            ) : (
              <>
                <ResponsiveContainer width="100%" height={300}>
                  <ComposedChart data={trendComparison.data}>
                    <defs>
                      <linearGradient id="actualGradient" x1="0" y1="0" x2="0" y2="1">
                        <stop offset="5%" stopColor="#22c55e" stopOpacity={0.3} />
                        <stop offset="95%" stopColor="#22c55e" stopOpacity={0} />
                      </linearGradient>
                      <linearGradient id="forecastGradient" x1="0" y1="0" x2="0" y2="1">
                        <stop offset="5%" stopColor="#3b82f6" stopOpacity={0.3} />
                        <stop offset="95%" stopColor="#3b82f6" stopOpacity={0} />
                      </linearGradient>
                    </defs>
                    <CartesianGrid strokeDasharray="3 3" stroke="#e2e8f0" />
                    <XAxis dataKey="label" stroke="#94a3b8" fontSize={12} />
                    <YAxis stroke="#94a3b8" fontSize={12} tickFormatter={(v) => formatCurrency(v)} />
                    <Tooltip
                      contentStyle={{
                        backgroundColor: '#1e293b',
                        border: 'none',
                        borderRadius: '8px',
                        color: '#f8fafc',
                      }}
                      formatter={(value: number) => formatCurrency(value)}
                    />
                    <Legend />
                    <Area
                      type="monotone"
                      dataKey="actual"
                      name="Actual"
                      fill="url(#actualGradient)"
                      stroke="#22c55e"
                      strokeWidth={2}
                    />
                    <Line
                      type="monotone"
                      dataKey="forecast"
                      name="Forecast"
                      stroke="#3b82f6"
                      strokeWidth={2}
                      dot={{ fill: '#3b82f6', strokeWidth: 2 }}
                    />
                    <Bar dataKey="variance" name="Variance" fill="#f59e0b" opacity={0.5} />
                  </ComposedChart>
                </ResponsiveContainer>
                <div className="flex items-center justify-center gap-6 mt-4 pt-4 border-t border-secondary-100">
                  <div className="flex items-center gap-2">
                    <div className="w-3 h-3 bg-emerald-500 rounded-full" />
                    <span className="text-sm text-secondary-600">Actual Revenue</span>
                  </div>
                  <div className="flex items-center gap-2">
                    <div className="w-3 h-3 bg-blue-500 rounded-full" />
                    <span className="text-sm text-secondary-600">Forecasted</span>
                  </div>
                  <div className="flex items-center gap-2">
                    <div className="w-3 h-3 bg-amber-500 rounded-full opacity-50" />
                    <span className="text-sm text-secondary-600">Variance</span>
                  </div>
                </div>
              </>
            )}
          </div>
        </motion.div>

        {/* Model Accuracy */}
        <motion.div
          initial={{ opacity: 0, y: 20 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ delay: 0.2 }}
          className="card"
        >
          <div className="card-header">
            <h2 className="text-lg font-semibold">Model Accuracy (MAPE)</h2>
            <p className="text-sm text-secondary-500">Lower is better</p>
          </div>
          <div className="p-6">
            {accuracyLoading ? (
              <div className="h-[260px] flex items-center justify-center">
                <ArrowPathIcon className="w-8 h-8 animate-spin text-primary-500" />
              </div>
            ) : !models || models.length === 0 ? (
              <div className="h-[260px] flex items-center justify-center text-secondary-500">
                <div className="text-center">
                  <SparklesIcon className="w-10 h-10 mx-auto mb-2 opacity-50" />
                  <p className="text-sm">Run forecasts to see accuracy</p>
                </div>
              </div>
            ) : (
              <ResponsiveContainer width="100%" height={260}>
                <BarChart data={models} layout="vertical">
                  <CartesianGrid strokeDasharray="3 3" stroke="#e2e8f0" />
                  <XAxis type="number" stroke="#94a3b8" fontSize={12} domain={[0, 'auto']} />
                  <YAxis dataKey="model" type="category" stroke="#94a3b8" fontSize={11} width={85} />
                  <Tooltip
                    contentStyle={{
                      backgroundColor: '#1e293b',
                      border: 'none',
                      borderRadius: '8px',
                      color: '#f8fafc',
                    }}
                    formatter={(value: number) => [`${value.toFixed(1)}%`, 'MAPE']}
                  />
                  <Bar dataKey="mape" radius={[0, 4, 4, 0]}>
                    {models.map((_, index) => (
                      <Cell
                        key={`cell-${index}`}
                        fill={index === 0 ? '#22c55e' : index === 1 ? '#3b82f6' : '#94a3b8'}
                      />
                    ))}
                  </Bar>
                </BarChart>
              </ResponsiveContainer>
            )}
          </div>
        </motion.div>
      </div>

      {/* Analytics Row */}
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
        {/* Top Products */}
        <motion.div
          initial={{ opacity: 0, y: 20 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ delay: 0.3 }}
          className="card"
        >
          <div className="card-header flex items-center gap-2">
            <CubeIcon className="w-5 h-5 text-blue-600" />
            <h2 className="text-lg font-semibold">Top Products</h2>
          </div>
          <div className="p-6">
            {productsLoading ? (
              <div className="space-y-4">
                {[1, 2, 3, 4, 5].map((i) => (
                  <div key={i} className="animate-pulse flex items-center gap-3">
                    <div className="w-8 h-8 bg-secondary-200 rounded" />
                    <div className="flex-1">
                      <div className="h-3 bg-secondary-200 rounded w-24 mb-1" />
                      <div className="h-2 bg-secondary-200 rounded w-16" />
                    </div>
                  </div>
                ))}
              </div>
            ) : !products || products.length === 0 ? (
              <div className="text-center py-8 text-secondary-500">
                <CubeIcon className="w-10 h-10 mx-auto mb-2 opacity-50" />
                <p className="text-sm">No product data</p>
              </div>
            ) : (
              <div className="space-y-4">
                {products.map((product, index) => (
                  <div key={product.id} className="flex items-center gap-3">
                    <div
                      className="w-8 h-8 rounded-lg flex items-center justify-center text-sm font-bold text-white"
                      style={{ backgroundColor: CHART_COLORS[index % CHART_COLORS.length] }}
                    >
                      {index + 1}
                    </div>
                    <div className="flex-1 min-w-0">
                      <p className="text-sm font-medium truncate">{product.name}</p>
                      <p className="text-xs text-secondary-500">{formatCurrency(product.revenue)}</p>
                    </div>
                    <div className="text-right">
                      <span className="text-sm font-semibold text-secondary-700">
                        {product.percentage.toFixed(1)}%
                      </span>
                    </div>
                  </div>
                ))}
              </div>
            )}
          </div>
          <div className="p-4 border-t border-secondary-200 dark:border-secondary-700">
            <Link to="/data/dimensions" className="text-sm text-primary-600 hover:text-primary-700 font-medium">
              View all products →
            </Link>
          </div>
        </motion.div>

        {/* Regional Breakdown */}
        <motion.div
          initial={{ opacity: 0, y: 20 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ delay: 0.35 }}
          className="card"
        >
          <div className="card-header flex items-center gap-2">
            <GlobeAltIcon className="w-5 h-5 text-purple-600" />
            <h2 className="text-lg font-semibold">Regional Breakdown</h2>
          </div>
          <div className="p-6">
            {regionalLoading ? (
              <div className="h-[200px] flex items-center justify-center">
                <ArrowPathIcon className="w-6 h-6 animate-spin text-primary-500" />
              </div>
            ) : !regions || regions.length === 0 ? (
              <div className="h-[200px] flex items-center justify-center text-secondary-500">
                <div className="text-center">
                  <GlobeAltIcon className="w-10 h-10 mx-auto mb-2 opacity-50" />
                  <p className="text-sm">No regional data</p>
                </div>
              </div>
            ) : (
              <>
                <ResponsiveContainer width="100%" height={180}>
                  <PieChart>
                    <Pie
                      data={regions.slice(0, 6)}
                      cx="50%"
                      cy="50%"
                      innerRadius={50}
                      outerRadius={80}
                      paddingAngle={2}
                      dataKey="revenue"
                      nameKey="name"
                    >
                      {regions.slice(0, 6).map((_, index) => (
                        <Cell key={`cell-${index}`} fill={CHART_COLORS[index % CHART_COLORS.length]} />
                      ))}
                    </Pie>
                    <Tooltip
                      contentStyle={{
                        backgroundColor: '#1e293b',
                        border: 'none',
                        borderRadius: '8px',
                        color: '#f8fafc',
                      }}
                      formatter={(value: number) => formatCurrency(value)}
                    />
                  </PieChart>
                </ResponsiveContainer>
                <div className="grid grid-cols-2 gap-2 mt-2">
                  {regions.slice(0, 6).map((region, index) => (
                    <div key={region.id} className="flex items-center gap-2 text-xs">
                      <div
                        className="w-2 h-2 rounded-full"
                        style={{ backgroundColor: CHART_COLORS[index % CHART_COLORS.length] }}
                      />
                      <span className="text-secondary-600 truncate">{region.name}</span>
                      <span className="font-medium ml-auto">{region.percentage.toFixed(0)}%</span>
                    </div>
                  ))}
                </div>
              </>
            )}
          </div>
        </motion.div>

        {/* Variance Alerts */}
        <motion.div
          initial={{ opacity: 0, y: 20 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ delay: 0.4 }}
          className="card"
        >
          <div className="card-header flex items-center gap-2">
            <ExclamationTriangleIcon className="w-5 h-5 text-orange-600" />
            <h2 className="text-lg font-semibold">Variance Alerts</h2>
            {alerts && alerts.length > 0 && (
              <span className="ml-auto text-xs bg-red-100 text-red-700 px-2 py-0.5 rounded-full font-medium">
                {alerts.filter((a) => a.severity === 'high').length} critical
              </span>
            )}
          </div>
          <div className="p-4 space-y-3 max-h-[320px] overflow-y-auto">
            {alertsLoading ? (
              <div className="flex items-center justify-center py-8">
                <ArrowPathIcon className="w-6 h-6 animate-spin text-primary-500" />
              </div>
            ) : !alerts || alerts.length === 0 ? (
              <div className="text-center py-8 text-secondary-500">
                <CheckCircleIcon className="w-10 h-10 mx-auto mb-2 text-emerald-500" />
                <p className="text-sm">All forecasts within tolerance</p>
              </div>
            ) : (
              alerts.slice(0, 5).map((alert) => (
                <VarianceAlertCard key={alert.id} alert={alert} />
              ))
            )}
          </div>
          {alerts && alerts.length > 5 && (
            <div className="p-4 border-t border-secondary-200 dark:border-secondary-700">
              <Link to="/reports" className="text-sm text-primary-600 hover:text-primary-700 font-medium">
                View all {alerts.length} alerts →
              </Link>
            </div>
          )}
        </motion.div>
      </div>

      {/* Manufacturing KPIs Row - Demand vs Supply & Forecast Bias */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        {/* Demand vs Supply Analysis */}
        <motion.div
          initial={{ opacity: 0, y: 20 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ delay: 0.35 }}
          className="card"
        >
          <div className="card-header">
            <div className="flex items-center justify-between">
              <div>
                <h2 className="text-lg font-semibold">Demand vs Supply</h2>
                <p className="text-sm text-secondary-500">Fill rate analysis</p>
              </div>
              {demandSupply?.summary && (
                <span className={`text-xs px-2 py-1 rounded-full font-medium ${
                  demandSupply.summary.overallFillRate >= 95 
                    ? 'bg-emerald-100 text-emerald-700' 
                    : demandSupply.summary.overallFillRate >= 85 
                    ? 'bg-yellow-100 text-yellow-700'
                    : 'bg-red-100 text-red-700'
                }`}>
                  {demandSupply.summary.overallFillRate.toFixed(1)}% Fill Rate
                </span>
              )}
            </div>
          </div>
          <div className="p-6">
            {demandSupplyLoading ? (
              <div className="h-[260px] flex items-center justify-center">
                <ArrowPathIcon className="w-8 h-8 animate-spin text-primary-500" />
              </div>
            ) : !demandSupply?.data || demandSupply.data.length === 0 ? (
              <div className="h-[260px] flex items-center justify-center text-secondary-500">
                <p>No demand/supply data available</p>
              </div>
            ) : (
              <>
                <ResponsiveContainer width="100%" height={220}>
                  <ComposedChart data={demandSupply.data}>
                    <CartesianGrid strokeDasharray="3 3" stroke="#e2e8f0" />
                    <XAxis dataKey="label" stroke="#94a3b8" fontSize={11} />
                    <YAxis stroke="#94a3b8" fontSize={11} tickFormatter={(v) => formatCurrency(v)} />
                    <Tooltip
                      contentStyle={{
                        backgroundColor: '#1e293b',
                        border: 'none',
                        borderRadius: '8px',
                        color: '#f8fafc',
                      }}
                      formatter={(value: number) => formatCurrency(value)}
                    />
                    <Bar dataKey="demand" name="Demand" fill="#3b82f6" opacity={0.8} />
                    <Bar dataKey="supply" name="Supply" fill="#22c55e" opacity={0.8} />
                    <Line type="monotone" dataKey="gap" name="Gap" stroke="#ef4444" strokeWidth={2} dot={false} />
                  </ComposedChart>
                </ResponsiveContainer>
                {demandSupply.summary && (
                  <div className="grid grid-cols-3 gap-4 mt-4 pt-4 border-t border-secondary-100">
                    <div className="text-center">
                      <p className="text-lg font-bold text-blue-600">{formatCurrency(demandSupply.summary.totalDemand)}</p>
                      <p className="text-xs text-secondary-500">Total Demand</p>
                    </div>
                    <div className="text-center">
                      <p className="text-lg font-bold text-emerald-600">{formatCurrency(demandSupply.summary.totalSupply)}</p>
                      <p className="text-xs text-secondary-500">Total Supply</p>
                    </div>
                    <div className="text-center">
                      <p className={`text-lg font-bold ${demandSupply.summary.totalGap > 0 ? 'text-red-600' : 'text-emerald-600'}`}>
                        {demandSupply.summary.totalGap > 0 ? '-' : '+'}{formatCurrency(Math.abs(demandSupply.summary.totalGap))}
                      </p>
                      <p className="text-xs text-secondary-500">Gap</p>
                    </div>
                  </div>
                )}
              </>
            )}
          </div>
        </motion.div>

        {/* Forecast Bias Analysis */}
        <motion.div
          initial={{ opacity: 0, y: 20 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ delay: 0.4 }}
          className="card"
        >
          <div className="card-header">
            <h2 className="text-lg font-semibold">Forecast Bias by Model</h2>
            <p className="text-sm text-secondary-500">Over/under forecasting tendency</p>
          </div>
          <div className="p-6">
            {biasLoading ? (
              <div className="h-[300px] flex items-center justify-center">
                <ArrowPathIcon className="w-8 h-8 animate-spin text-primary-500" />
              </div>
            ) : !forecastBias?.data || forecastBias.data.length === 0 ? (
              <div className="h-[300px] flex items-center justify-center text-secondary-500">
                <p>No bias data available</p>
              </div>
            ) : (
              <div className="space-y-3">
                {forecastBias.data.map((item) => (
                  <div key={item.model} className="p-3 bg-secondary-50 dark:bg-secondary-800 rounded-lg">
                    <div className="flex items-center justify-between mb-2">
                      <span className="font-medium text-sm">{item.model}</span>
                      <span className={`text-xs px-2 py-0.5 rounded-full font-medium ${
                        Math.abs(item.avgBias) <= 5 
                          ? 'bg-emerald-100 text-emerald-700' 
                          : Math.abs(item.avgBias) <= 10 
                          ? 'bg-yellow-100 text-yellow-700'
                          : 'bg-red-100 text-red-700'
                      }`}>
                        {item.avgBias >= 0 ? '+' : ''}{item.avgBias.toFixed(1)}% bias
                      </span>
                    </div>
                    <div className="flex gap-2">
                      <div className="flex-1 h-2 rounded-full overflow-hidden bg-secondary-200 dark:bg-secondary-700">
                        <div
                          className="h-full bg-blue-500"
                          style={{ width: `${item.overForecastRate}%` }}
                          title={`Over: ${item.overForecastRate.toFixed(1)}%`}
                        />
                      </div>
                      <span className="text-xs text-secondary-500 w-20 text-right">
                        {item.totalForecasts} forecasts
                      </span>
                    </div>
                    <div className="flex justify-between mt-1 text-xs text-secondary-500">
                      <span>Over: {item.overForecastRate.toFixed(0)}%</span>
                      <span>Under: {item.underForecastRate.toFixed(0)}%</span>
                    </div>
                  </div>
                ))}
              </div>
            )}
          </div>
        </motion.div>
      </div>

      {/* ABC Classification Section - Enhanced */}
      <ABCClassificationSection filterParams={filterParams} />

      {/* Bottom Row */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        {/* Recent Activity */}
        <motion.div
          initial={{ opacity: 0, y: 20 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ delay: 0.5 }}
          className="card"
        >
          <div className="card-header">
            <h2 className="text-lg font-semibold">Recent Activity</h2>
          </div>
          <div className="divide-y divide-secondary-200 dark:divide-secondary-700">
            {activityLoading ? (
              <div className="p-8 flex justify-center">
                <ArrowPathIcon className="w-6 h-6 animate-spin text-primary-500" />
              </div>
            ) : !activity || activity.length === 0 ? (
              <div className="p-8 text-center text-secondary-500">
                <ClockIcon className="w-10 h-10 mx-auto mb-2 opacity-50" />
                <p>No recent activity</p>
              </div>
            ) : (
              activity.map((item) => {
                const iconConfig = getActivityIcon(item.type);
                return (
                  <div key={item.id} className="p-4 flex items-start gap-4">
                    <div
                      className={`w-10 h-10 rounded-lg flex items-center justify-center flex-shrink-0 ${iconConfig.bg}`}
                    >
                      <iconConfig.icon className={`w-5 h-5 ${iconConfig.color}`} />
                    </div>
                    <div className="flex-1 min-w-0">
                      <p className="text-sm font-medium">{item.title}</p>
                      <p className="text-xs text-secondary-500 mt-0.5">
                        {item.user} • {formatRelativeTime(item.createdAt)}
                      </p>
                    </div>
                  </div>
                );
              })
            )}
          </div>
          <div className="p-4 border-t border-secondary-200 dark:border-secondary-700">
            <Link to="/reports/audit" className="text-sm text-primary-600 hover:text-primary-700 font-medium">
              View all activity →
            </Link>
          </div>
        </motion.div>

        {/* Quick Actions */}
        <motion.div
          initial={{ opacity: 0, y: 20 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ delay: 0.55 }}
          className="card"
        >
          <div className="card-header">
            <h2 className="text-lg font-semibold">Quick Actions</h2>
          </div>
          <div className="p-6 grid grid-cols-2 gap-4">
            <Link
              to="/plans/new"
              className="p-4 rounded-lg border-2 border-dashed border-secondary-200 dark:border-secondary-700 hover:border-primary-500 hover:bg-primary-50 dark:hover:bg-primary-900/20 transition-colors text-left group"
            >
              <DocumentTextIcon className="w-8 h-8 text-secondary-400 group-hover:text-primary-500 mb-2" />
              <p className="font-medium">Create Plan</p>
              <p className="text-xs text-secondary-500 mt-1">Start a new planning version</p>
            </Link>
            <Link
              to="/forecasts"
              className="p-4 rounded-lg border-2 border-dashed border-secondary-200 dark:border-secondary-700 hover:border-primary-500 hover:bg-primary-50 dark:hover:bg-primary-900/20 transition-colors text-left group"
            >
              <ChartBarIcon className="w-8 h-8 text-secondary-400 group-hover:text-primary-500 mb-2" />
              <p className="font-medium">Run Forecast</p>
              <p className="text-xs text-secondary-500 mt-1">Generate predictions</p>
            </Link>
            <Link
              to="/data/import"
              className="p-4 rounded-lg border-2 border-dashed border-secondary-200 dark:border-secondary-700 hover:border-primary-500 hover:bg-primary-50 dark:hover:bg-primary-900/20 transition-colors text-left group"
            >
              <ArrowTrendingUpIcon className="w-8 h-8 text-secondary-400 group-hover:text-primary-500 mb-2" />
              <p className="font-medium">Import Data</p>
              <p className="text-xs text-secondary-500 mt-1">Upload actuals</p>
            </Link>
            <Link
              to="/reports"
              className="p-4 rounded-lg border-2 border-dashed border-secondary-200 dark:border-secondary-700 hover:border-primary-500 hover:bg-primary-50 dark:hover:bg-primary-900/20 transition-colors text-left group"
            >
              <ChartPieIcon className="w-8 h-8 text-secondary-400 group-hover:text-primary-500 mb-2" />
              <p className="font-medium">View Reports</p>
              <p className="text-xs text-secondary-500 mt-1">Analyze performance</p>
            </Link>
          </div>
        </motion.div>
      </div>
    </div>
  );
}
