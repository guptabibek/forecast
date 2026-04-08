import { useCallback, useRef, useState } from 'react';

interface ConfirmState {
  isOpen: boolean;
  title: string;
  message: string;
  variant: 'danger' | 'warning' | 'primary';
  confirmText: string;
  isLoading: boolean;
}

interface UseConfirmActionOptions {
  title: string;
  message: string;
  variant?: 'danger' | 'warning' | 'primary';
  confirmText?: string;
}

/**
 * Hook that pairs with ConfirmModal to gate destructive / financial actions
 * behind a confirmation dialog.
 *
 * Usage:
 *   const { confirm, confirmProps } = useConfirmAction({
 *     title: 'Complete Work Order',
 *     message: 'This will finalize all costs and release reservations.',
 *     variant: 'warning',
 *   });
 *
 *   const handleComplete = () => confirm(() => completeMutation.mutate(id));
 *
 *   return <ConfirmModal {...confirmProps} />;
 */
export function useConfirmAction(options: UseConfirmActionOptions) {
  const [state, setState] = useState<ConfirmState>({
    isOpen: false,
    title: options.title,
    message: options.message,
    variant: options.variant ?? 'primary',
    confirmText: options.confirmText ?? 'Confirm',
    isLoading: false,
  });

  const pendingAction = useRef<(() => unknown | Promise<unknown>) | null>(null);

  const confirm = useCallback(
    (action: () => unknown | Promise<unknown>) => {
      pendingAction.current = action;
      setState((s) => ({ ...s, isOpen: true, isLoading: false }));
    },
    [],
  );

  const handleConfirm = useCallback(async () => {
    if (!pendingAction.current) return;
    setState((s) => ({ ...s, isLoading: true }));
    try {
      await pendingAction.current();
    } finally {
      setState((s) => ({ ...s, isOpen: false, isLoading: false }));
      pendingAction.current = null;
    }
  }, []);

  const handleClose = useCallback(() => {
    setState((s) => ({ ...s, isOpen: false, isLoading: false }));
    pendingAction.current = null;
  }, []);

  return {
    confirm,
    confirmProps: {
      isOpen: state.isOpen,
      onClose: handleClose,
      onConfirm: handleConfirm,
      title: state.title,
      message: state.message,
      variant: state.variant,
      confirmText: state.confirmText,
      isLoading: state.isLoading,
    },
  };
}
