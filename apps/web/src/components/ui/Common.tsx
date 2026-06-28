import {
    CheckCircleIcon,
    ChevronLeftIcon,
    ChevronRightIcon,
    ExclamationCircleIcon,
    ExclamationTriangleIcon,
    InformationCircleIcon,
    XMarkIcon,
} from '@heroicons/react/20/solid';
import React from 'react';

interface AlertProps {
  variant?: 'info' | 'success' | 'warning' | 'error';
  title?: string;
  children: React.ReactNode;
  onDismiss?: () => void;
  className?: string;
}

const variantConfig = {
  info: {
    bg: 'bg-info-50 dark:bg-info-900/20',
    border: 'border-info-200 dark:border-info-800',
    icon: InformationCircleIcon,
    iconColor: 'text-info-400 dark:text-info-300',
    titleColor: 'text-info-800 dark:text-info-200',
    textColor: 'text-info-700 dark:text-info-300',
    closeColor: 'text-info-500 hover:text-info-600 dark:text-info-400 dark:hover:text-info-300',
  },
  success: {
    bg: 'bg-success-50 dark:bg-success-900/20',
    border: 'border-success-200 dark:border-success-800',
    icon: CheckCircleIcon,
    iconColor: 'text-success-400 dark:text-success-300',
    titleColor: 'text-success-800 dark:text-success-200',
    textColor: 'text-success-700 dark:text-success-300',
    closeColor: 'text-success-500 hover:text-success-600 dark:text-success-400 dark:hover:text-success-300',
  },
  warning: {
    bg: 'bg-warning-50 dark:bg-warning-900/20',
    border: 'border-warning-200 dark:border-warning-800',
    icon: ExclamationTriangleIcon,
    iconColor: 'text-warning-400 dark:text-warning-300',
    titleColor: 'text-warning-800 dark:text-warning-200',
    textColor: 'text-warning-700 dark:text-warning-300',
    closeColor: 'text-warning-500 hover:text-warning-600 dark:text-warning-400 dark:hover:text-warning-300',
  },
  error: {
    bg: 'bg-error-50 dark:bg-error-900/20',
    border: 'border-error-200 dark:border-error-800',
    icon: ExclamationCircleIcon,
    iconColor: 'text-error-400 dark:text-error-300',
    titleColor: 'text-error-800 dark:text-error-200',
    textColor: 'text-error-700 dark:text-error-300',
    closeColor: 'text-error-500 hover:text-error-600 dark:text-error-400 dark:hover:text-error-300',
  },
};

export function Alert({
  variant = 'info',
  title,
  children,
  onDismiss,
  className = '',
}: AlertProps) {
  const config = variantConfig[variant];
  const Icon = config.icon;

  return (
    <div
      className={`border p-4 ${config.bg} ${config.border} ${className}`}
      style={{ borderRadius: 'var(--radius)' }}
      role="alert"
    >
      <div className="flex">
        <div className="flex-shrink-0">
          <Icon className={`h-5 w-5 ${config.iconColor}`} />
        </div>
        <div className="ml-3 flex-1">
          {title && (
            <h3 className={`text-sm font-medium ${config.titleColor}`}>{title}</h3>
          )}
          <div className={`text-sm ${config.textColor} ${title ? 'mt-1' : ''}`}>
            {children}
          </div>
        </div>
        {onDismiss && (
          <div className="ml-auto pl-3">
            <button
              onClick={onDismiss}
              className={`inline-flex rounded-md p-1.5 transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-offset-2 focus-visible:ring-primary-500 ${config.closeColor}`}
            >
              <span className="sr-only">Dismiss</span>
              <XMarkIcon className="h-5 w-5" />
            </button>
          </div>
        )}
      </div>
    </div>
  );
}

interface BadgeProps {
  variant?: 'default' | 'primary' | 'secondary' | 'success' | 'warning' | 'error';
  size?: 'sm' | 'md' | 'lg';
  children: React.ReactNode;
  className?: string;
}

const badgeVariants = {
  default: 'bg-secondary-100 text-secondary-800 dark:bg-secondary-700 dark:text-secondary-200',
  primary: 'bg-primary-100 text-primary-800 dark:bg-primary-900/50 dark:text-primary-200',
  secondary: 'bg-secondary-100 text-secondary-600 dark:bg-secondary-700 dark:text-secondary-300',
  success: 'bg-success-100 text-success-800 dark:bg-success-900/50 dark:text-success-200',
  warning: 'bg-warning-100 text-warning-800 dark:bg-warning-900/50 dark:text-warning-200',
  error: 'bg-error-100 text-error-800 dark:bg-error-900/50 dark:text-error-200',
};

const badgeSizes = {
  sm: 'px-2 py-0.5 text-xs',
  md: 'px-2.5 py-0.5 text-sm',
  lg: 'px-3 py-1 text-sm',
};

export function Badge({
  variant = 'default',
  size = 'md',
  children,
  className = '',
}: BadgeProps) {
  return (
    <span
      className={`inline-flex items-center font-medium rounded-full ${badgeVariants[variant]} ${badgeSizes[size]} ${className}`}
    >
      {children}
    </span>
  );
}

interface CardProps {
  children: React.ReactNode;
  className?: string;
  padding?: 'none' | 'sm' | 'md' | 'lg';
}

const paddingClasses = {
  none: '',
  sm: 'p-4',
  md: 'p-6',
  lg: 'p-8',
};

export function Card({ children, className = '', padding = 'md' }: CardProps) {
  return (
    <div
      className={`bg-white dark:bg-secondary-800 border border-secondary-200 dark:border-secondary-700 shadow-sm ${paddingClasses[padding]} ${className}`}
      style={{ borderRadius: 'var(--radius)' }}
    >
      {children}
    </div>
  );
}

interface CardHeaderProps {
  title: string;
  description?: string;
  actions?: React.ReactNode;
  className?: string;
}

export function CardHeader({ title, description, actions, className = '' }: CardHeaderProps) {
  return (
    <div className={`flex items-start justify-between mb-4 ${className}`}>
      <div>
        <h3 className="text-lg font-semibold text-secondary-900 dark:text-secondary-100">{title}</h3>
        {description && <p className="mt-1 text-sm text-secondary-500 dark:text-secondary-400">{description}</p>}
      </div>
      {actions && <div className="flex items-center space-x-2">{actions}</div>}
    </div>
  );
}

interface LoadingSpinnerProps {
  size?: 'sm' | 'md' | 'lg' | 'xl';
  className?: string;
}

const spinnerSizes = {
  sm: 'h-4 w-4',
  md: 'h-6 w-6',
  lg: 'h-8 w-8',
  xl: 'h-12 w-12',
};

export function LoadingSpinner({ size = 'md', className = '' }: LoadingSpinnerProps) {
  return (
    <svg
      className={`animate-spin text-primary-600 ${spinnerSizes[size]} ${className}`}
      fill="none"
      viewBox="0 0 24 24"
      role="status"
      aria-label="Loading"
    >
      <circle
        className="opacity-25"
        cx="12"
        cy="12"
        r="10"
        stroke="currentColor"
        strokeWidth="4"
      />
      <path
        className="opacity-75"
        fill="currentColor"
        d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z"
      />
    </svg>
  );
}

interface EmptyStateProps {
  icon?: React.ReactNode;
  title: string;
  description?: string;
  action?: React.ReactNode;
  className?: string;
}

export function EmptyState({ icon, title, description, action, className = '' }: EmptyStateProps) {
  return (
    <div className={`text-center py-12 ${className}`}>
      {icon && <div className="mx-auto mb-4 text-secondary-400 dark:text-secondary-500">{icon}</div>}
      <h3 className="text-sm font-medium text-secondary-900 dark:text-secondary-100">{title}</h3>
      {description && <p className="mt-1 text-sm text-secondary-500 dark:text-secondary-400">{description}</p>}
      {action && <div className="mt-6">{action}</div>}
    </div>
  );
}

interface ProgressBarProps {
  value: number;
  max?: number;
  size?: 'sm' | 'md' | 'lg';
  showLabel?: boolean;
  variant?: 'primary' | 'success' | 'warning' | 'error';
  className?: string;
}

const progressVariants = {
  primary: 'bg-primary-600',
  success: 'bg-success-600',
  warning: 'bg-warning-600',
  error: 'bg-error-600',
};

const progressSizes = {
  sm: 'h-1',
  md: 'h-2',
  lg: 'h-3',
};

export function ProgressBar({
  value,
  max = 100,
  size = 'md',
  showLabel = false,
  variant = 'primary',
  className = '',
}: ProgressBarProps) {
  const percentage = Math.min(100, Math.max(0, (value / max) * 100));

  return (
    <div className={className} role="progressbar" aria-valuenow={value} aria-valuemin={0} aria-valuemax={max}>
      {showLabel && (
        <div className="flex justify-between mb-1">
          <span className="text-sm font-medium text-secondary-700 dark:text-secondary-300">Progress</span>
          <span className="text-sm text-secondary-500 dark:text-secondary-400">{Math.round(percentage)}%</span>
        </div>
      )}
      <div className={`w-full bg-secondary-200 dark:bg-secondary-700 rounded-full overflow-hidden ${progressSizes[size]}`}>
        <div
          className={`${progressVariants[variant]} ${progressSizes[size]} rounded-full transition-all duration-300`}
          style={{ width: `${percentage}%` }}
        />
      </div>
    </div>
  );
}

interface SkeletonProps {
  className?: string;
  variant?: 'text' | 'circular' | 'rectangular';
  width?: string | number;
  height?: string | number;
}

export function Skeleton({
  className = '',
  variant = 'text',
  width,
  height,
}: SkeletonProps) {
  const variantClasses = {
    text: 'rounded',
    circular: 'rounded-full',
    rectangular: 'rounded-lg',
  };

  const style: React.CSSProperties = {};
  if (width) style.width = typeof width === 'number' ? `${width}px` : width;
  if (height) style.height = typeof height === 'number' ? `${height}px` : height;
  if (variant === 'text' && !height) style.height = '1em';

  return <div className={`animate-skeleton ${variantClasses[variant]} ${className}`} style={style} />;
}

// ============================================================================
// QueryErrorBanner - Reusable error state for useQuery failures
// ============================================================================

interface QueryErrorBannerProps {
  error: unknown;
  onRetry?: () => void;
  className?: string;
}

export function QueryErrorBanner({ error, onRetry, className = '' }: QueryErrorBannerProps) {
  const message = error instanceof Error ? error.message : 'An unexpected error occurred while loading data.';
  return (
    <Alert variant="error" title="Failed to load data" className={className}>
      <p>{message}</p>
      {onRetry && (
        <button
          onClick={onRetry}
          className="mt-2 text-sm font-medium text-error-800 dark:text-error-200 underline hover:text-error-900 dark:hover:text-error-100 transition-colors"
        >
          Try again
        </button>
      )}
    </Alert>
  );
}

// ============================================================================
// Pagination - Reusable pagination controls
// ============================================================================

interface PaginationProps {
  page: number;
  totalPages: number;
  total: number;
  pageSize: number;
  onPageChange: (page: number) => void;
  className?: string;
}

export function Pagination({ page, totalPages, total, pageSize, onPageChange, className = '' }: PaginationProps) {
  if (totalPages <= 1) return null;

  const startItem = (page - 1) * pageSize + 1;
  const endItem = Math.min(page * pageSize, total);

  return (
    <div className={`flex items-center justify-between border-t border-secondary-200 dark:border-secondary-700 px-4 py-3 sm:px-6 ${className}`}>
      <div className="hidden sm:flex sm:flex-1 sm:items-center sm:justify-between">
        <p className="text-sm text-secondary-700 dark:text-secondary-300">
          Showing <span className="font-medium">{startItem}</span> to{' '}
          <span className="font-medium">{endItem}</span> of{' '}
          <span className="font-medium">{total}</span> results
        </p>
        <nav className="isolate inline-flex -space-x-px rounded-md shadow-sm" aria-label="Pagination">
          <button
            onClick={() => onPageChange(page - 1)}
            disabled={page <= 1}
            className="relative inline-flex items-center rounded-l-md px-2 py-2 text-secondary-400 dark:text-secondary-500 ring-1 ring-inset ring-secondary-300 dark:ring-secondary-600 hover:bg-secondary-50 dark:hover:bg-secondary-800 disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
            aria-label="Previous page"
          >
            <span className="sr-only">Previous</span>
            <ChevronLeftIcon className="h-5 w-5" aria-hidden="true" />
          </button>
          {Array.from({ length: Math.min(totalPages, 7) }, (_, i) => {
            let pageNum: number;
            if (totalPages <= 7) {
              pageNum = i + 1;
            } else if (page <= 4) {
              pageNum = i + 1;
            } else if (page >= totalPages - 3) {
              pageNum = totalPages - 6 + i;
            } else {
              pageNum = page - 3 + i;
            }
            return (
              <button
                key={pageNum}
                onClick={() => onPageChange(pageNum)}
                aria-current={pageNum === page ? 'page' : undefined}
                className={`relative inline-flex items-center px-4 py-2 text-sm font-semibold ring-1 ring-inset transition-colors ${
                  pageNum === page
                    ? 'z-10 bg-primary-600 text-white focus-visible:outline-primary-600'
                    : 'text-secondary-900 dark:text-secondary-200 ring-secondary-300 dark:ring-secondary-600 hover:bg-secondary-50 dark:hover:bg-secondary-800'
                }`}
              >
                {pageNum}
              </button>
            );
          })}
          <button
            onClick={() => onPageChange(page + 1)}
            disabled={page >= totalPages}
            className="relative inline-flex items-center rounded-r-md px-2 py-2 text-secondary-400 dark:text-secondary-500 ring-1 ring-inset ring-secondary-300 dark:ring-secondary-600 hover:bg-secondary-50 dark:hover:bg-secondary-800 disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
            aria-label="Next page"
          >
            <span className="sr-only">Next</span>
            <ChevronRightIcon className="h-5 w-5" aria-hidden="true" />
          </button>
        </nav>
      </div>
      <div className="flex flex-1 justify-between sm:hidden">
        <button
          onClick={() => onPageChange(page - 1)}
          disabled={page <= 1}
          className="relative inline-flex items-center border border-secondary-300 dark:border-secondary-600 bg-white dark:bg-secondary-800 px-4 py-2 text-sm font-medium text-secondary-700 dark:text-secondary-200 hover:bg-secondary-50 dark:hover:bg-secondary-700 disabled:opacity-50 transition-colors"
          style={{ borderRadius: 'var(--radius)' }}
        >
          Previous
        </button>
        <button
          onClick={() => onPageChange(page + 1)}
          disabled={page >= totalPages}
          className="relative ml-3 inline-flex items-center border border-secondary-300 dark:border-secondary-600 bg-white dark:bg-secondary-800 px-4 py-2 text-sm font-medium text-secondary-700 dark:text-secondary-200 hover:bg-secondary-50 dark:hover:bg-secondary-700 disabled:opacity-50 transition-colors"
          style={{ borderRadius: 'var(--radius)' }}
        >
          Next
        </button>
      </div>
    </div>
  );
}
