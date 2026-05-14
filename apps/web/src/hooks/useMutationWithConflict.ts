import { useMutation, type UseMutationOptions, useQueryClient } from '@tanstack/react-query';
import type { AxiosError } from 'axios';
import { useCallback, useState } from 'react';
import toast from 'react-hot-toast';

interface ConflictState {
  hasConflict: boolean;
  message: string;
}

/**
 * Wrapper around useMutation that:
 * 1. Detects 409 Conflict responses and surfaces them as a UI retry prompt.
 * 2. Invalidates the specified query keys on conflict so fresh data is loaded.
 * 3. Provides a `retry()` callback for the user to re-attempt after reviewing.
 *
 * Usage:
 *   const { mutate, conflict, retry } = useMutationWithConflict({
 *     mutationFn: (id) => workOrderService.complete(id),
 *     invalidateKeys: [['manufacturing', 'work-orders']],
 *   });
 */
export function useMutationWithConflict<TData = unknown, TVariables = void>(
  options: UseMutationOptions<TData, AxiosError, TVariables> & {
    invalidateKeys?: readonly (readonly string[])[];
    conflictMessage?: string;
  },
) {
  const qc = useQueryClient();
  const [conflict, setConflict] = useState<ConflictState>({ hasConflict: false, message: '' });
  const [lastVariables, setLastVariables] = useState<TVariables | null>(null);

  const mutation = useMutation<TData, AxiosError, TVariables>({
    ...options,
    onMutate: (variables, context) => {
      setLastVariables(variables);
      setConflict({ hasConflict: false, message: '' });
      return options.onMutate?.(variables, context);
    },
    onError: (error, variables, onMutateResult, context) => {
      if (error.response?.status === 409) {
        const serverMsg =
          (error.response.data as Record<string, string>)?.message ??
          options.conflictMessage ??
          'This record was modified by another user. The page has been refreshed — please review and try again.';
        setConflict({ hasConflict: true, message: serverMsg });
        toast.error(serverMsg);

        // Auto-invalidate related queries so user sees fresh data
        if (options.invalidateKeys) {
          for (const key of options.invalidateKeys) {
            qc.invalidateQueries({ queryKey: [...key] });
          }
        }
        return;
      }
      options.onError?.(error, variables, onMutateResult, context);
    },
  });

  const retry = useCallback(() => {
    if (lastVariables !== null) {
      setConflict({ hasConflict: false, message: '' });
      mutation.mutate(lastVariables);
    }
  }, [lastVariables, mutation]);

  const dismissConflict = useCallback(() => {
    setConflict({ hasConflict: false, message: '' });
  }, []);

  return {
    ...mutation,
    conflict,
    retry,
    dismissConflict,
  };
}
