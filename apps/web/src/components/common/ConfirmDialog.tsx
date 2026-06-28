import { Fragment, useRef } from 'react';
import { Dialog, Transition } from '@headlessui/react';

interface ConfirmDialogProps {
  open: boolean;
  title: string;
  message: string;
  confirmLabel?: string;
  cancelLabel?: string;
  variant?: 'danger' | 'warning' | 'info';
  onConfirm: () => void;
  onCancel: () => void;
}

/**
 * ConfirmDialog — modal confirmation for destructive or irreversible actions.
 * Uses Headless UI for fully accessible focus trapping and screen reader support.
 */
export function ConfirmDialog({
  open,
  title,
  message,
  confirmLabel = 'Confirm',
  cancelLabel = 'Cancel',
  variant = 'danger',
  onConfirm,
  onCancel,
}: ConfirmDialogProps) {
  const cancelRef = useRef<HTMLButtonElement>(null);

  const variantStyles = {
    danger: {
      icon: 'text-error-500 dark:text-error-400',
      button: 'bg-error-600 hover:bg-error-700 focus-visible:ring-error-500',
    },
    warning: {
      icon: 'text-warning-500 dark:text-warning-400',
      button: 'bg-warning-600 hover:bg-warning-700 focus-visible:ring-warning-500',
    },
    info: {
      icon: 'text-info-500 dark:text-info-400',
      button: 'bg-info-600 hover:bg-info-700 focus-visible:ring-info-500',
    },
  };

  const styles = variantStyles[variant];

  return (
    <Transition appear show={open} as={Fragment}>
      <Dialog 
        as="div" 
        className="relative z-50" 
        onClose={onCancel}
        initialFocus={cancelRef}
      >
        <Transition.Child
          as={Fragment}
          enter="ease-out duration-200"
          enterFrom="opacity-0"
          enterTo="opacity-100"
          leave="ease-in duration-150"
          leaveFrom="opacity-100"
          leaveTo="opacity-0"
        >
          <div className="fixed inset-0 bg-black/50 backdrop-blur-sm transition-opacity" />
        </Transition.Child>

        <div className="fixed inset-0 z-50 overflow-y-auto">
          <div className="flex min-h-full items-center justify-center p-4 text-center sm:p-0">
            <Transition.Child
              as={Fragment}
              enter="ease-out duration-200"
              enterFrom="opacity-0 translate-y-4 sm:translate-y-0 sm:scale-95"
              enterTo="opacity-100 translate-y-0 sm:scale-100"
              leave="ease-in duration-150"
              leaveFrom="opacity-100 translate-y-0 sm:scale-100"
              leaveTo="opacity-0 translate-y-4 sm:translate-y-0 sm:scale-95"
            >
              <Dialog.Panel 
                className="relative transform overflow-hidden bg-white dark:bg-secondary-800 text-left shadow-xl transition-all sm:my-8 sm:w-full sm:max-w-md p-6"
                style={{ borderRadius: 'calc(var(--radius) + 4px)' }}
              >
                <div className="flex items-start gap-4">
                  <div className={`flex-shrink-0 ${styles.icon}`}>
                    <svg
                      className="h-6 w-6"
                      fill="none"
                      viewBox="0 0 24 24"
                      stroke="currentColor"
                      aria-hidden="true"
                    >
                      <path
                        strokeLinecap="round"
                        strokeLinejoin="round"
                        strokeWidth={2}
                        d="M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-2.5L13.732 4c-.77-.833-1.964-.833-2.732 0L3.34 16.5c-.77.833.192 2.5 1.732 2.5z"
                      />
                    </svg>
                  </div>
                  <div className="mt-0.5">
                    <Dialog.Title
                      as="h3"
                      className="text-lg font-semibold text-secondary-900 dark:text-secondary-100 leading-6"
                    >
                      {title}
                    </Dialog.Title>
                    <div className="mt-2">
                      <p className="text-sm text-secondary-600 dark:text-secondary-400">
                        {message}
                      </p>
                    </div>
                  </div>
                </div>

                <div className="mt-6 flex justify-end gap-3">
                  <button
                    ref={cancelRef}
                    onClick={onCancel}
                    className="px-4 py-2 text-sm font-medium text-secondary-700 dark:text-secondary-200 bg-secondary-100 dark:bg-secondary-700 hover:bg-secondary-200 dark:hover:bg-secondary-600 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-secondary-400 transition-colors"
                    style={{ borderRadius: 'var(--radius)' }}
                  >
                    {cancelLabel}
                  </button>
                  <button
                    onClick={onConfirm}
                    className={`px-4 py-2 text-sm font-medium text-white focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-offset-2 dark:focus-visible:ring-offset-secondary-800 transition-colors ${styles.button}`}
                    style={{ borderRadius: 'var(--radius)' }}
                  >
                    {confirmLabel}
                  </button>
                </div>
              </Dialog.Panel>
            </Transition.Child>
          </div>
        </div>
      </Dialog>
    </Transition>
  );
}
