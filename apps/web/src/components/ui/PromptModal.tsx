import { Dialog, Transition } from '@headlessui/react';
import { XMarkIcon } from '@heroicons/react/24/outline';
import React, { Fragment, useRef, useState } from 'react';

interface PromptModalProps {
  isOpen: boolean;
  onClose: () => void;
  onConfirm: (value: string) => void;
  title: string;
  message?: string;
  placeholder?: string;
  initialValue?: string;
  inputLabel?: string;
  confirmText?: string;
  cancelText?: string;
  isLoading?: boolean;
  /** If true, the confirm button is disabled when the input is empty. */
  required?: boolean;
}

/**
 * A modal with a text input that replaces browser `prompt()` calls.
 * Used for BOM revision input, work order cancellation reasons, etc.
 */
export function PromptModal({
  isOpen,
  onClose,
  onConfirm,
  title,
  message,
  placeholder = '',
  initialValue = '',
  inputLabel,
  confirmText = 'Confirm',
  cancelText = 'Cancel',
  isLoading = false,
  required = false,
}: PromptModalProps) {
  const [value, setValue] = useState(initialValue);
  const inputRef = useRef<HTMLInputElement>(null);

  // Reset value when modal opens with a new initialValue
  React.useEffect(() => {
    if (isOpen) {
      setValue(initialValue);
    }
  }, [isOpen, initialValue]);

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (required && !value.trim()) return;
    onConfirm(value);
  };

  const isConfirmDisabled = isLoading || (required && !value.trim());

  return (
    <Transition appear show={isOpen} as={Fragment}>
      <Dialog
        as="div"
        className="relative z-50"
        onClose={onClose}
        initialFocus={inputRef}
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
          <div className="fixed inset-0 bg-black/25 backdrop-blur-sm" />
        </Transition.Child>

        <div className="fixed inset-0 overflow-y-auto">
          <div className="flex min-h-full items-center justify-center p-4">
            <Transition.Child
              as={Fragment}
              enter="ease-out duration-200"
              enterFrom="opacity-0 scale-95"
              enterTo="opacity-100 scale-100"
              leave="ease-in duration-150"
              leaveFrom="opacity-100 scale-100"
              leaveTo="opacity-0 scale-95"
            >
              <Dialog.Panel
                className="w-full max-w-md transform overflow-hidden bg-white dark:bg-secondary-800 text-left shadow-xl transition-all"
                style={{ borderRadius: 'calc(var(--radius) + 8px)' }}
              >
                {/* Header */}
                <div className="flex items-center justify-between border-b border-secondary-200 dark:border-secondary-700 px-4 py-3">
                  <Dialog.Title className="text-sm font-semibold text-secondary-900 dark:text-secondary-100">
                    {title}
                  </Dialog.Title>
                  <button
                    type="button"
                    className="rounded-md p-1.5 text-secondary-400 hover:text-secondary-500 hover:bg-secondary-100 dark:hover:bg-secondary-700 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary-500 transition-colors"
                    onClick={onClose}
                  >
                    <XMarkIcon className="h-5 w-5" />
                  </button>
                </div>

                {/* Body */}
                <form onSubmit={handleSubmit} className="p-4">
                  {message && (
                    <p className="text-sm text-secondary-500 dark:text-secondary-400 mb-3">
                      {message}
                    </p>
                  )}

                  <div>
                    {inputLabel && (
                      <label
                        htmlFor="prompt-input"
                        className="block text-sm font-medium text-secondary-700 dark:text-secondary-300 mb-1"
                      >
                        {inputLabel}
                        {required && <span className="text-error-500 ml-1">*</span>}
                      </label>
                    )}
                    <input
                      ref={inputRef}
                      id="prompt-input"
                      type="text"
                      value={value}
                      onChange={(e) => setValue(e.target.value)}
                      placeholder={placeholder}
                      className="block w-full border border-secondary-300 dark:border-secondary-600 bg-white dark:bg-secondary-700 text-secondary-900 dark:text-secondary-100 placeholder-secondary-400 dark:placeholder-secondary-500 px-3 py-2 shadow-sm transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary-500 focus-visible:border-primary-500"
                      style={{ borderRadius: 'var(--radius)' }}
                      required={required}
                    />
                  </div>

                  {/* Footer */}
                  <div className="flex justify-end gap-3 mt-4">
                    <button
                      type="button"
                      className="px-4 py-2 text-sm font-medium text-secondary-700 dark:text-secondary-200 bg-white dark:bg-secondary-700 border border-secondary-300 dark:border-secondary-600 hover:bg-secondary-50 dark:hover:bg-secondary-600 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-offset-2 focus-visible:ring-primary-500 transition-colors disabled:opacity-50"
                      style={{ borderRadius: 'var(--radius)' }}
                      onClick={onClose}
                      disabled={isLoading}
                    >
                      {cancelText}
                    </button>
                    <button
                      type="submit"
                      className="px-4 py-2 text-sm font-medium text-white bg-primary-600 hover:bg-primary-700 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-offset-2 focus-visible:ring-primary-500 transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
                      style={{ borderRadius: 'var(--radius)' }}
                      disabled={isConfirmDisabled}
                    >
                      {isLoading ? (
                        <span className="flex items-center">
                          <svg className="animate-spin -ml-1 mr-2 h-4 w-4 text-white" fill="none" viewBox="0 0 24 24">
                            <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
                            <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z" />
                          </svg>
                          Processing...
                        </span>
                      ) : (
                        confirmText
                      )}
                    </button>
                  </div>
                </form>
              </Dialog.Panel>
            </Transition.Child>
          </div>
        </div>
      </Dialog>
    </Transition>
  );
}
