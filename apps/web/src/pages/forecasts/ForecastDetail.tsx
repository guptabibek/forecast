import {
    ArrowDownTrayIcon,
    ArrowLeftIcon,
    ArrowPathIcon,
    CalendarIcon,
    ChartBarIcon,
    CubeIcon,
    CurrencyDollarIcon,
    ExclamationTriangleIcon,
    MapPinIcon,
    PencilSquareIcon,
    UserGroupIcon,
} from '@heroicons/react/24/outline';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { format, parseISO } from 'date-fns';
import { Link, useParams } from 'react-router-dom';
import { forecastsService } from '../../services/api';

// Display names for forecast models
const modelDisplayNames: Record<string, string> = {
  MOVING_AVERAGE: 'Moving Average',
  WEIGHTED_AVERAGE: 'Weighted Average',
  LINEAR_REGRESSION: 'Linear Regression',
  HOLT_WINTERS: 'Holt-Winters',
  SEASONAL_NAIVE: 'Seasonal Naive',
  YOY_GROWTH: 'Year-over-Year Growth',
  TREND_PERCENT: 'Trend Percentage',
  AI_HYBRID: 'AI Hybrid',
  MANUAL: 'Manual Entry',
};

const DetailRow = ({
  label,
  value,
  icon: Icon,
}: {
  label: string;
  value: string | number | null | undefined;
  icon?: React.ElementType;
}) => (
  <div className="flex items-start justify-between py-3 border-b border-secondary-100 dark:border-secondary-800">
    <dt className="flex items-center gap-2 text-sm text-secondary-600">
      {Icon && <Icon className="w-4 h-4" />}
      {label}
    </dt>
    <dd className="text-sm font-medium text-right">{value ?? '-'}</dd>
  </div>
);

const MetricCard = ({
  label,
  value,
  suffix = '',
}: {
  label: string;
  value: number | string;
  suffix?: string;
}) => (
  <div className="bg-secondary-50 dark:bg-secondary-800/50 rounded-lg p-4">
    <span className="text-sm text-secondary-500 block mb-1">{label}</span>
    <p className="text-2xl font-bold">
      {typeof value === 'number'
        ? value.toLocaleString(undefined, {
            minimumFractionDigits: 2,
            maximumFractionDigits: 2,
          })
        : value}
      <span className="text-sm font-normal text-secondary-500">{suffix}</span>
    </p>
  </div>
);

export default function ForecastDetail() {
  const { id } = useParams<{ id: string }>();
  const queryClient = useQueryClient();

  // Fetch forecast details
  const { data: forecast, isLoading, error } = useQuery({
    queryKey: ['forecast', id],
    queryFn: () => forecastsService.getById(id!),
    enabled: !!id,
  });

  // Re-run forecast mutation (uses the run endpoint)
  const rerunMutation = useMutation({
    mutationFn: () => forecastsService.run(id!, { forceRefresh: true }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['forecast', id] });
    },
  });

  // Export forecast data - client-side CSV export
  const handleExport = () => {
    if (!forecast) return;

    const csvContent = [
      [
        'ID',
        'Period Date',
        'Period Type',
        'Model',
        'Amount',
        'Quantity',
        'Currency',
        'Is Override',
      ].join(','),
      [
        forecast.id,
        forecast.periodDate,
        forecast.periodType,
        forecast.forecastModel,
        forecast.forecastAmount.toString(),
        forecast.forecastQuantity?.toString() || '',
        forecast.currency,
        (forecast.isOverride ?? false).toString(),
      ].join(','),
    ].join('\n');

    const blob = new Blob([csvContent], { type: 'text/csv;charset=utf-8;' });
    const url = window.URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `forecast-${id}.csv`;
    a.click();
    window.URL.revokeObjectURL(url);
  };

  if (isLoading) {
    return (
      <div className="flex items-center justify-center h-64">
        <ArrowPathIcon className="w-8 h-8 animate-spin text-primary-500" />
      </div>
    );
  }

  if (error || !forecast) {
    return (
      <div className="space-y-6">
        <Link
          to="/forecasts"
          className="flex items-center gap-2 text-secondary-500 hover:text-secondary-700"
        >
          <ArrowLeftIcon className="w-4 h-4" />
          Back to Forecasts
        </Link>
        <div className="card p-8 text-center">
          <ExclamationTriangleIcon className="w-12 h-12 text-error-500 mx-auto mb-4" />
          <h2 className="text-xl font-semibold">Forecast Not Found</h2>
          <p className="text-secondary-500 mt-2">
            The forecast you&apos;re looking for doesn&apos;t exist or has been
            deleted.
          </p>
          <Link to="/forecasts" className="btn btn-primary mt-4">
            View All Forecasts
          </Link>
        </div>
      </div>
    );
  }

  const modelDisplayName =
    (forecast.forecastModel ? modelDisplayNames[forecast.forecastModel] : undefined) || forecast.forecastModel || 'Unknown';

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex flex-col lg:flex-row lg:items-center lg:justify-between gap-4">
        <div>
          <Link
            to="/forecasts"
            className="flex items-center gap-2 text-secondary-500 hover:text-secondary-700 mb-2"
          >
            <ArrowLeftIcon className="w-4 h-4" />
            Back to Forecasts
          </Link>
          <div className="flex items-center gap-3">
            <h1 className="text-2xl font-bold">Forecast Details</h1>
            {forecast.isOverride && (
              <span className="px-3 py-1 rounded-full text-sm font-medium bg-warning-100 text-warning-700">
                <PencilSquareIcon className="w-4 h-4 inline mr-1" />
                Manual Override
              </span>
            )}
          </div>
          <div className="flex items-center gap-4 mt-2 text-sm text-secondary-500">
            <span className="flex items-center gap-1">
              <ChartBarIcon className="w-4 h-4" />
              {modelDisplayName}
            </span>
            <span className="flex items-center gap-1">
              <CalendarIcon className="w-4 h-4" />
              {format(parseISO(forecast.periodDate), 'MMMM yyyy')}
            </span>
            {forecast.createdBy && (
              <span>
                Created by {forecast.createdBy.firstName}{' '}
                {forecast.createdBy.lastName}
              </span>
            )}
          </div>
        </div>

        <div className="flex items-center gap-2">
          <button
            onClick={handleExport}
            className="btn btn-secondary flex items-center gap-2"
          >
            <ArrowDownTrayIcon className="w-4 h-4" />
            Export
          </button>
          <button
            onClick={() => rerunMutation.mutate()}
            disabled={rerunMutation.isPending}
            className="btn btn-primary flex items-center gap-2"
          >
            <ArrowPathIcon
              className={`w-4 h-4 ${rerunMutation.isPending ? 'animate-spin' : ''}`}
            />
            Re-run Forecast
          </button>
        </div>
      </div>

      {/* Key Metrics */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
        <MetricCard
          label="Forecast Amount"
          value={forecast.forecastAmount}
          suffix={` ${forecast.currency}`}
        />
        {forecast.forecastQuantity && (
          <MetricCard
            label="Forecast Quantity"
            value={forecast.forecastQuantity}
            suffix=" units"
          />
        )}
        {forecast.confidenceLower && forecast.confidenceUpper && (
          <>
            <MetricCard
              label="Lower Bound"
              value={forecast.confidenceLower}
              suffix={` ${forecast.currency}`}
            />
            <MetricCard
              label="Upper Bound"
              value={forecast.confidenceUpper}
              suffix={` ${forecast.currency}`}
            />
          </>
        )}
        {forecast.isOverride && forecast.originalAmount && (
          <MetricCard
            label="Original Amount"
            value={forecast.originalAmount}
            suffix={` ${forecast.currency}`}
          />
        )}
      </div>

      {/* Details Grid */}
      <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
        {/* Forecast Information */}
        <div className="card p-6">
          <h3 className="text-lg font-semibold mb-4">Forecast Information</h3>
          <dl className="space-y-0">
            <DetailRow label="Forecast ID" value={forecast.id} />
            <DetailRow
              label="Model"
              value={modelDisplayName}
              icon={ChartBarIcon}
            />
            <DetailRow
              label="Period"
              value={format(parseISO(forecast.periodDate), 'MMMM yyyy')}
              icon={CalendarIcon}
            />
            <DetailRow label="Period Type" value={forecast.periodType} />
            <DetailRow
              label="Currency"
              value={forecast.currency}
              icon={CurrencyDollarIcon}
            />
            {forecast.confidenceLevel && (
              <DetailRow
                label="Confidence Level"
                value={`${(forecast.confidenceLevel * 100).toFixed(0)}%`}
              />
            )}
          </dl>
        </div>

        {/* Dimensions */}
        <div className="card p-6">
          <h3 className="text-lg font-semibold mb-4">Dimensions</h3>
          <dl className="space-y-0">
            {forecast.product && (
              <DetailRow
                label="Product"
                value={`${forecast.product.name} (${forecast.product.code})`}
                icon={CubeIcon}
              />
            )}
            {forecast.location && (
              <DetailRow
                label="Location"
                value={`${forecast.location.name} (${forecast.location.code})`}
                icon={MapPinIcon}
              />
            )}
            {forecast.customer && (
              <DetailRow
                label="Customer"
                value={`${forecast.customer.name} (${forecast.customer.code})`}
                icon={UserGroupIcon}
              />
            )}
            {forecast.account && (
              <DetailRow
                label="Account"
                value={`${forecast.account.name} (${forecast.account.code})`}
              />
            )}
            {!forecast.product &&
              !forecast.location &&
              !forecast.customer &&
              !forecast.account && (
                <p className="text-secondary-500 text-sm">
                  No dimensions assigned
                </p>
              )}
          </dl>
        </div>

        {/* Override Information (if applicable) */}
        {forecast.isOverride && (
          <div className="card p-6">
            <h3 className="text-lg font-semibold mb-4">Override Details</h3>
            <dl className="space-y-0">
              <DetailRow
                label="Original Amount"
                value={forecast.originalAmount?.toLocaleString()}
              />
              <DetailRow
                label="Override Reason"
                value={forecast.overrideReason}
              />
              {forecast.overrideAt && (
                <DetailRow
                  label="Override Date"
                  value={format(parseISO(forecast.overrideAt), 'MMM d, yyyy HH:mm')}
                />
              )}
            </dl>
          </div>
        )}

        {/* Metadata */}
        <div className="card p-6">
          <h3 className="text-lg font-semibold mb-4">Metadata</h3>
          <dl className="space-y-0">
            {forecast.planVersion && (
              <DetailRow label="Plan Version" value={forecast.planVersion.name} />
            )}
            {forecast.scenario && (
              <DetailRow label="Scenario" value={forecast.scenario.name} />
            )}
            <DetailRow
              label="Created"
              value={forecast.createdAt ? format(parseISO(forecast.createdAt), 'MMM d, yyyy HH:mm') : 'N/A'}
            />
            <DetailRow
              label="Last Updated"
              value={forecast.updatedAt ? format(parseISO(forecast.updatedAt), 'MMM d, yyyy HH:mm') : 'N/A'}
            />
          </dl>
        </div>
      </div>
    </div>
  );
}
