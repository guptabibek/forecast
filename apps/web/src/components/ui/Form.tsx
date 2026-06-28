import React, { forwardRef } from 'react';
import { ExclamationCircleIcon } from '@heroicons/react/20/solid';

interface InputProps extends React.InputHTMLAttributes<HTMLInputElement> {
  label?: string;
  error?: string;
  helperText?: string;
  leftIcon?: React.ReactNode;
  rightIcon?: React.ReactNode;
}

export const Input = forwardRef<HTMLInputElement, InputProps>(
  ({ label, error, helperText, leftIcon, rightIcon, className = '', ...props }, ref) => {
    const inputId = props.id || props.name;

    return (
      <div className="w-full">
        {label && (
          <label
            htmlFor={inputId}
            className="block text-sm font-medium text-secondary-700 dark:text-secondary-300 mb-1"
          >
            {label}
            {props.required && <span className="text-error-500 ml-1">*</span>}
          </label>
        )}
        <div className="relative rounded-md">
          {leftIcon && (
            <div className="pointer-events-none absolute inset-y-0 left-0 flex items-center pl-3">
              <span className="text-secondary-500 dark:text-secondary-400 sm:text-sm">{leftIcon}</span>
            </div>
          )}
          <input
            ref={ref}
            id={inputId}
            className={`
              block w-full border px-3 py-2 shadow-sm transition-colors
              focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-offset-0
              disabled:bg-secondary-50 disabled:text-secondary-500 disabled:cursor-not-allowed
              dark:disabled:bg-secondary-800/50 dark:disabled:text-secondary-500
              ${leftIcon ? 'pl-10' : ''}
              ${rightIcon || error ? 'pr-10' : ''}
              ${
                error
                  ? 'border-error-300 dark:border-error-500 text-error-900 dark:text-error-300 placeholder-error-300 dark:placeholder-error-500/50 focus-visible:border-error-500 focus-visible:ring-error-500'
                  : 'border-secondary-300 dark:border-secondary-600 bg-white dark:bg-secondary-800 text-secondary-900 dark:text-secondary-100 placeholder-secondary-400 dark:placeholder-secondary-500 focus-visible:border-primary-500 focus-visible:ring-primary-500'
              }
              ${className}
            `}
            style={{ borderRadius: 'var(--radius)' }}
            aria-invalid={error ? 'true' : 'false'}
            aria-describedby={error ? `${inputId}-error` : helperText ? `${inputId}-helper` : undefined}
            {...props}
          />
          {error && (
            <div className="pointer-events-none absolute inset-y-0 right-0 flex items-center pr-3">
              <ExclamationCircleIcon className="h-5 w-5 text-error-500" />
            </div>
          )}
          {rightIcon && !error && (
            <div className="absolute inset-y-0 right-0 flex items-center pr-3">
              {rightIcon}
            </div>
          )}
        </div>
        {error && (
          <p className="mt-1 text-sm text-error-600 dark:text-error-400" id={`${inputId}-error`} role="alert">
            {error}
          </p>
        )}
        {helperText && !error && (
          <p className="mt-1 text-sm text-secondary-500 dark:text-secondary-400" id={`${inputId}-helper`}>
            {helperText}
          </p>
        )}
      </div>
    );
  }
);

Input.displayName = 'Input';

interface SelectProps extends React.SelectHTMLAttributes<HTMLSelectElement> {
  label?: string;
  error?: string;
  helperText?: string;
  options: { value: string | number; label: string }[];
  placeholder?: string;
}

export const Select = forwardRef<HTMLSelectElement, SelectProps>(
  ({ label, error, helperText, options, placeholder, className = '', ...props }, ref) => {
    const selectId = props.id || props.name;

    return (
      <div className="w-full">
        {label && (
          <label
            htmlFor={selectId}
            className="block text-sm font-medium text-secondary-700 dark:text-secondary-300 mb-1"
          >
            {label}
            {props.required && <span className="text-error-500 ml-1">*</span>}
          </label>
        )}
        <select
          ref={ref}
          id={selectId}
          className={`
            block w-full border px-3 py-2 shadow-sm transition-colors
            focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-offset-0
            disabled:bg-secondary-50 disabled:text-secondary-500 disabled:cursor-not-allowed
            dark:disabled:bg-secondary-800/50 dark:disabled:text-secondary-500
            ${
              error
                ? 'border-error-300 dark:border-error-500 text-error-900 dark:text-error-300 focus-visible:border-error-500 focus-visible:ring-error-500'
                : 'border-secondary-300 dark:border-secondary-600 bg-white dark:bg-secondary-800 text-secondary-900 dark:text-secondary-100 focus-visible:border-primary-500 focus-visible:ring-primary-500'
            }
            ${className}
          `}
          style={{ borderRadius: 'var(--radius)' }}
          aria-invalid={error ? 'true' : 'false'}
          aria-describedby={error ? `${selectId}-error` : helperText ? `${selectId}-helper` : undefined}
          {...props}
        >
          {placeholder && (
            <option value="" disabled>
              {placeholder}
            </option>
          )}
          {options.map((option) => (
            <option key={option.value} value={option.value}>
              {option.label}
            </option>
          ))}
        </select>
        {error && (
          <p className="mt-1 text-sm text-error-600 dark:text-error-400" id={`${selectId}-error`} role="alert">
            {error}
          </p>
        )}
        {helperText && !error && (
          <p className="mt-1 text-sm text-secondary-500 dark:text-secondary-400" id={`${selectId}-helper`}>
            {helperText}
          </p>
        )}
      </div>
    );
  }
);

Select.displayName = 'Select';

interface TextareaProps extends React.TextareaHTMLAttributes<HTMLTextAreaElement> {
  label?: string;
  error?: string;
  helperText?: string;
}

export const Textarea = forwardRef<HTMLTextAreaElement, TextareaProps>(
  ({ label, error, helperText, className = '', ...props }, ref) => {
    const textareaId = props.id || props.name;

    return (
      <div className="w-full">
        {label && (
          <label
            htmlFor={textareaId}
            className="block text-sm font-medium text-secondary-700 dark:text-secondary-300 mb-1"
          >
            {label}
            {props.required && <span className="text-error-500 ml-1">*</span>}
          </label>
        )}
        <textarea
          ref={ref}
          id={textareaId}
          className={`
            block w-full border px-3 py-2 shadow-sm transition-colors
            focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-offset-0
            disabled:bg-secondary-50 disabled:text-secondary-500 disabled:cursor-not-allowed
            dark:disabled:bg-secondary-800/50 dark:disabled:text-secondary-500
            ${
              error
                ? 'border-error-300 dark:border-error-500 text-error-900 dark:text-error-300 placeholder-error-300 dark:placeholder-error-500/50 focus-visible:border-error-500 focus-visible:ring-error-500'
                : 'border-secondary-300 dark:border-secondary-600 bg-white dark:bg-secondary-800 text-secondary-900 dark:text-secondary-100 placeholder-secondary-400 dark:placeholder-secondary-500 focus-visible:border-primary-500 focus-visible:ring-primary-500'
            }
            ${className}
          `}
          style={{ borderRadius: 'var(--radius)' }}
          aria-invalid={error ? 'true' : 'false'}
          aria-describedby={error ? `${textareaId}-error` : helperText ? `${textareaId}-helper` : undefined}
          {...props}
        />
        {error && (
          <p className="mt-1 text-sm text-error-600 dark:text-error-400" id={`${textareaId}-error`} role="alert">
            {error}
          </p>
        )}
        {helperText && !error && (
          <p className="mt-1 text-sm text-secondary-500 dark:text-secondary-400" id={`${textareaId}-helper`}>
            {helperText}
          </p>
        )}
      </div>
    );
  }
);

Textarea.displayName = 'Textarea';

interface CheckboxProps extends Omit<React.InputHTMLAttributes<HTMLInputElement>, 'type'> {
  label: string;
  description?: string;
}

export const Checkbox = forwardRef<HTMLInputElement, CheckboxProps>(
  ({ label, description, className = '', ...props }, ref) => {
    const checkboxId = props.id || props.name;

    return (
      <div className="relative flex items-start">
        <div className="flex h-6 items-center">
          <input
            ref={ref}
            id={checkboxId}
            type="checkbox"
            className={`
              h-4 w-4 rounded border-secondary-300 dark:border-secondary-600
              text-primary-600 bg-white dark:bg-secondary-800
              focus:ring-primary-600 cursor-pointer
              disabled:cursor-not-allowed disabled:opacity-50
              ${className}
            `}
            {...props}
          />
        </div>
        <div className="ml-3 text-sm leading-6">
          <label
            htmlFor={checkboxId}
            className="font-medium text-secondary-900 dark:text-secondary-100 cursor-pointer"
          >
            {label}
          </label>
          {description && <p className="text-secondary-500 dark:text-secondary-400">{description}</p>}
        </div>
      </div>
    );
  }
);

Checkbox.displayName = 'Checkbox';
