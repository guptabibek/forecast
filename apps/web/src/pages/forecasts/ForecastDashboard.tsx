import {
    ArrowTrendingUpIcon,
    ChartBarIcon,
    CheckCircleIcon,
    ClockIcon,
    CubeIcon,
    ExclamationTriangleIcon,
} from '@heroicons/react/24/outline';
import { forecastService } from '@services/api';
import { useQuery } from '@tanstack/react-query';
import clsx from 'clsx';
import { format } from 'date-fns';
import { motion } from 'framer-motion';
import { useNavigate } from 'react-router-dom';
import {
    Bar,
    BarChart,
    CartesianGrid,
    Cell,
    Pie,
    PieChart,
    ResponsiveContainer,
    Tooltip,
    XAxis,
    YAxis,
} from 'recharts';

const MODEL_COLORS: Record<string, string> = {
  MOVING_AVERAGE: '#3b82f6',
  WEIGHTED_AVERAGE: '#8b5cf6',
  LINEAR_REGRESSION: '#ec4899',
  HOLT_WINTERS: '#f59e0b',
  SEASONAL_NAIVE: '#10b981',
  YOY_GROWTH: '#06b6d4',
  TREND_PERCENT: '#6366f1',
  AI_HYBRID: '#ef4444',
  ARIMA: '#14b8a6',
  PROPHET: '#f97316',
};

export default function ForecastDashboard() {
  const navigate = useNavigate();

  const { data: summary, isLoading } = useQuery({
    queryKey: ['forecast-dashboard-summary'],
    queryFn: forecastService.getDashboardSummary,
    refetchInterval: 30000,
    refetchOnWindowFocus: true,
    staleTime: 15000,
  });

  if (isLoading) {
    return (
      <div className="space-y-6 animate-pulse">
        <div className="h-8 w-64 bg-secondary-200 dark:bg-secondary-700 rounded" />
        <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
          {[...Array(4)].map((_, i) => (
            <div key={i} className="card p-4 space-y-3">
              <div className="h-4 w-24 bg-secondary-200 dark:bg-secondary-700 rounded" />
              <div className="h-8 w-16 bg-secondary-200 dark:bg-secondary-700 rounded" />
              <div className="h-3 w-32 bg-secondary-200 dark:bg-secondary-700 rounded" />
            </div>
          ))}
        </div>
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
          <div className="card p-6 h-[300px] bg-secondary-100 dark:bg-secondary-800 rounded" />
          <div className="card p-6 h-[300px] bg-secondary-100 dark:bg-secondary-800 rounded" />
        </div>
      </div>
    );
  }

  if (!summary) {
    return (
      <div className="card p-12 text-center">
        <ChartBarIcon className="w-16 h-16 text-secondary-300 mx-auto mb-4" />
        <h3 className="text-lg font-semibold mb-2">No Forecast Data</h3>
        <p className="text-secondary-500 mb-6">
          Generate forecasts first to populate the dashboard.
        </p>
        <button onClick={() => navigate('/forecasts')} className="btn-primary">
          Go to Forecasts
        </button>
      </div>
    );
  }

  const successRate = summary.totalRuns > 0
    ? ((summary.completedRuns / summary.totalRuns) * 100).toFixed(1)
    : '0';

  const modelDistribution = summary.modelsUsed.map((model) => ({
    name: model.replace(/_/g, ' '),
    value: summary.recentRuns.filter((r: Record<string, unknown>) => r.forecastModel === model).length || 1,
    color: MODEL_COLORS[model] || '#94a3b8',
  }));

  return (
    <div className="space-y-6">
      <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4">
        <div>
          <h1 className="text-2xl font-bold">Forecast Dashboard</h1>
          <p className="text-secondary-500 mt-1">
            Overview of forecast activity across all plans
          </p>
        </div>
        <button onClick={() => navigate('/forecasts')} className="btn-primary">
          Open Forecasts
        </button>
      </div>

      <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
        <motion.div
          initial={{ opacity: 0, y: 20 }}
          animate={{ opacity: 1, y: 0 }}
          className="card p-4"
        >
          <div className="flex items-center justify-between mb-2">
            <p className="text-sm text-secondary-500">Total Runs</p>
            <ClockIcon className="w-5 h-5 text-secondary-400" />
          </div>
          <p className="text-2xl font-bold">{summary.totalRuns.toLocaleString()}</p>
          <p className="text-xs text-secondary-500 mt-1">
            {summary.completedRuns} completed, {summary.failedRuns} failed
          </p>
        </motion.div>

        <motion.div
          initial={{ opacity: 0, y: 20 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ delay: 0.1 }}
          className="card p-4"
        >
          <div className="flex items-center justify-between mb-2">
            <p className="text-sm text-secondary-500">Success Rate</p>
            <CheckCircleIcon className="w-5 h-5 text-success-500" />
          </div>
          <p className={clsx(
            'text-2xl font-bold',
            parseFloat(successRate) >= 90 ? 'text-success-600' : parseFloat(successRate) >= 70 ? 'text-warning-600' : 'text-error-600',
          )}>
            {successRate}%
          </p>
          <p className="text-xs text-secondary-500 mt-1">Run completion rate</p>
        </motion.div>

        <motion.div
          initial={{ opacity: 0, y: 20 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ delay: 0.2 }}
          className="card p-4"
        >
          <div className="flex items-center justify-between mb-2">
            <p className="text-sm text-secondary-500">Total Forecasts</p>
            <CubeIcon className="w-5 h-5 text-primary-500" />
          </div>
          <p className="text-2xl font-bold">{(summary.totalForecasts ?? 0).toLocaleString()}</p>
          <p className="text-xs text-secondary-500 mt-1">
            ${(summary.totalForecastValue ?? 0).toLocaleString()} total value
          </p>
        </motion.div>

        <motion.div
          initial={{ opacity: 0, y: 20 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ delay: 0.3 }}
          className="card p-4"
        >
          <div className="flex items-center justify-between mb-2">
            <p className="text-sm text-secondary-500">Models Used</p>
            <ArrowTrendingUpIcon className="w-5 h-5 text-primary-500" />
          </div>
          <p className="text-2xl font-bold">{summary.modelsUsed.length}</p>
          <p className="text-xs text-secondary-500 mt-1">
            Last: {summary.lastForecastDate ? format(new Date(summary.lastForecastDate), 'MMM dd, HH:mm') : 'N/A'}
          </p>
        </motion.div>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        <motion.div
          initial={{ opacity: 0, y: 20 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ delay: 0.4 }}
          className="card p-6"
        >
          <h3 className="font-semibold mb-4">Model Usage Distribution</h3>
          {modelDistribution.length > 0 ? (
            <ResponsiveContainer width="100%" height={250}>
              <PieChart>
                <Pie
                  data={modelDistribution}
                  dataKey="value"
                  nameKey="name"
                  cx="50%"
                  cy="50%"
                  outerRadius={90}
                  label={({ name, percent }) => `${name} (${(percent * 100).toFixed(0)}%)`}
                >
                  {modelDistribution.map((entry, index) => (
                    <Cell key={index} fill={entry.color} />
                  ))}
                </Pie>
                <Tooltip />
              </PieChart>
            </ResponsiveContainer>
          ) : (
            <div className="flex items-center justify-center h-[250px] text-secondary-400">
              No model data available
            </div>
          )}
        </motion.div>

        <motion.div
          initial={{ opacity: 0, y: 20 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ delay: 0.5 }}
          className="card p-6"
        >
          <h3 className="font-semibold mb-4">Recent Runs</h3>
          {summary.recentRuns.length > 0 ? (
            <div className="space-y-3 max-h-[250px] overflow-y-auto">
              {summary.recentRuns.map((run: Record<string, unknown>, idx: number) => (
                <div key={idx} className="flex items-center justify-between p-2 rounded-lg hover:bg-secondary-50 dark:hover:bg-secondary-800/50">
                  <div className="flex items-center gap-3">
                    <div
                      className="w-3 h-3 rounded-full"
                      style={{ backgroundColor: MODEL_COLORS[run.forecastModel as string] || '#94a3b8' }}
                    />
                    <div>
                      <p className="text-sm font-medium">{(run.forecastModel as string || '').replace(/_/g, ' ')}</p>
                      <p className="text-xs text-secondary-500">
                        {run.createdAt ? format(new Date(run.createdAt as string), 'MMM dd HH:mm') : ''}
                      </p>
                    </div>
                  </div>
                  <div className="flex items-center gap-2">
                    {run.status === 'COMPLETED' ? (
                      <CheckCircleIcon className="w-4 h-4 text-success-500" />
                    ) : (
                      <ExclamationTriangleIcon className="w-4 h-4 text-warning-500" />
                    )}
                    <span className={clsx(
                      'text-xs px-2 py-0.5 rounded-full',
                      run.status === 'COMPLETED' ? 'bg-success-100 text-success-700' : 'bg-warning-100 text-warning-700',
                    )}>
                      {run.status as string}
                    </span>
                  </div>
                </div>
              ))}
            </div>
          ) : (
            <div className="flex items-center justify-center h-[250px] text-secondary-400">
              No recent runs
            </div>
          )}
        </motion.div>
      </div>

      {summary.modelsUsed.length > 0 && (
        <motion.div
          initial={{ opacity: 0, y: 20 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ delay: 0.6 }}
          className="card p-6"
        >
          <h3 className="font-semibold mb-4">Models Overview</h3>
          <ResponsiveContainer width="100%" height={200}>
            <BarChart data={modelDistribution}>
              <CartesianGrid strokeDasharray="3 3" stroke="#e2e8f0" />
              <XAxis dataKey="name" stroke="#94a3b8" fontSize={11} />
              <YAxis stroke="#94a3b8" fontSize={11} />
              <Tooltip />
              <Bar dataKey="value" name="Runs">
                {modelDistribution.map((entry, index) => (
                  <Cell key={index} fill={entry.color} />
                ))}
              </Bar>
            </BarChart>
          </ResponsiveContainer>
        </motion.div>
      )}
    </div>
  );
}
