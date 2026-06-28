import React from 'react';

interface ButtonProps extends React.ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: 'primary' | 'secondary' | 'outline' | 'ghost' | 'danger';
  size?: 'sm' | 'md' | 'lg';
  isLoading?: boolean;
  leftIcon?: React.ReactNode;
  rightIcon?: React.ReactNode;
}

export function Button({
  children,
  variant = 'primary',
  size = 'md',
  isLoading = false,
  leftIcon,
  rightIcon,
  className = '',
  disabled,
  ...props
}: ButtonProps) {
  const baseClasses =
    'inline-flex items-center justify-center font-medium transition-all duration-150 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-offset-2 dark:focus-visible:ring-offset-secondary-900 disabled:opacity-50 disabled:cursor-not-allowed active:scale-[0.97]';

  const variantClasses = {
    primary:
      'bg-primary-600 text-white hover:bg-primary-700 focus-visible:ring-primary-500 shadow-sm',
    secondary:
      'bg-secondary-100 text-secondary-900 hover:bg-secondary-200 focus-visible:ring-secondary-500 dark:bg-secondary-700 dark:text-secondary-100 dark:hover:bg-secondary-600',
    outline:
      'border border-secondary-300 bg-white text-secondary-700 hover:bg-secondary-50 focus-visible:ring-primary-500 dark:bg-secondary-800 dark:border-secondary-600 dark:text-secondary-200 dark:hover:bg-secondary-700',
    ghost:
      'text-secondary-700 hover:bg-secondary-100 focus-visible:ring-secondary-500 dark:text-secondary-300 dark:hover:bg-secondary-800',
    danger:
      'bg-error-600 text-white hover:bg-error-700 focus-visible:ring-error-500 shadow-sm',
  };

  const sizeClasses = {
    sm: 'px-3 py-1.5 text-sm',
    md: 'px-4 py-2 text-sm',
    lg: 'px-6 py-3 text-base',
  };

  return (
    <button
      className={`${baseClasses} ${variantClasses[variant]} ${sizeClasses[size]} ${className}`}
      style={{ borderRadius: 'var(--radius)' }}
      disabled={disabled || isLoading}
      {...props}
    >
      {isLoading && (
        <svg
          className="animate-spin -ml-1 mr-2 h-4 w-4"
          fill="none"
          viewBox="0 0 24 24"
          aria-hidden="true"
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
      )}
      {!isLoading && leftIcon && <span className="mr-2 flex-shrink-0">{leftIcon}</span>}
      {children}
      {!isLoading && rightIcon && <span className="ml-2 flex-shrink-0">{rightIcon}</span>}
    </button>
  );
}

interface IconButtonProps extends React.ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: 'primary' | 'secondary' | 'outline' | 'ghost' | 'danger';
  size?: 'sm' | 'md' | 'lg';
  'aria-label': string;
}

export function IconButton({
  children,
  variant = 'ghost',
  size = 'md',
  className = '',
  ...props
}: IconButtonProps) {
  const baseClasses =
    'inline-flex items-center justify-center transition-all duration-150 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-offset-2 dark:focus-visible:ring-offset-secondary-900 disabled:opacity-50 disabled:cursor-not-allowed active:scale-[0.95]';

  const variantClasses = {
    primary:
      'bg-primary-600 text-white hover:bg-primary-700 focus-visible:ring-primary-500',
    secondary:
      'bg-secondary-100 text-secondary-900 hover:bg-secondary-200 focus-visible:ring-secondary-500 dark:bg-secondary-700 dark:text-secondary-100 dark:hover:bg-secondary-600',
    outline:
      'border border-secondary-300 bg-white text-secondary-700 hover:bg-secondary-50 focus-visible:ring-primary-500 dark:bg-secondary-800 dark:border-secondary-600 dark:text-secondary-200 dark:hover:bg-secondary-700',
    ghost:
      'text-secondary-500 hover:text-secondary-700 hover:bg-secondary-100 focus-visible:ring-secondary-500 dark:text-secondary-400 dark:hover:text-secondary-200 dark:hover:bg-secondary-800',
    danger:
      'bg-error-600 text-white hover:bg-error-700 focus-visible:ring-error-500 dark:bg-error-700 dark:hover:bg-error-600',
  };

  const sizeClasses = {
    sm: 'p-1',
    md: 'p-2',
    lg: 'p-3',
  };

  return (
    <button
      className={`${baseClasses} ${variantClasses[variant]} ${sizeClasses[size]} ${className}`}
      style={{ borderRadius: 'var(--radius)' }}
      {...props}
    >
      {children}
    </button>
  );
}

interface ButtonGroupProps {
  children: React.ReactNode;
  className?: string;
}

export function ButtonGroup({ children, className = '' }: ButtonGroupProps) {
  return (
    <div className={`inline-flex shadow-sm ${className}`} style={{ borderRadius: 'var(--radius)' }}>
      {React.Children.map(children, (child, index) => {
        if (!React.isValidElement(child)) return child;
        
        const isFirst = index === 0;
        const isLast = index === React.Children.count(children) - 1;

        return React.cloneElement(child as React.ReactElement<ButtonProps>, {
          className: `
            ${(child as React.ReactElement<ButtonProps>).props.className || ''}
            ${isFirst ? 'rounded-r-none' : ''}
            ${isLast ? 'rounded-l-none' : ''}
            ${!isFirst && !isLast ? 'rounded-none' : ''}
            ${!isFirst ? '-ml-px' : ''}
          `.trim(),
        });
      })}
    </div>
  );
}
