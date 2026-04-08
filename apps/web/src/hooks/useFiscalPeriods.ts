import { fiscalCalendarService, type FiscalPeriod } from '@services/api';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import toast from 'react-hot-toast';

const periodKeys = {
  all: ['fiscal-periods'] as const,
  byCalendar: (calendarId: string) => [...periodKeys.all, calendarId] as const,
  current: (calendarId: string) => [...periodKeys.all, 'current', calendarId] as const,
};

/**
 * Hook for reading fiscal periods for a given calendar.
 * Exposes `isLocked` state so the UI can disable financial posting controls.
 */
export function useFiscalPeriods(calendarId: string | undefined, params?: { fiscalYear?: number }) {
  return useQuery<FiscalPeriod[]>({
    queryKey: periodKeys.byCalendar(calendarId ?? ''),
    queryFn: () => fiscalCalendarService.getPeriods(calendarId!, params),
    enabled: !!calendarId,
  });
}

/**
 * Hook for the current fiscal period.
 * Useful for quickly checking whether the current period is locked.
 */
export function useCurrentFiscalPeriod(calendarId: string | undefined) {
  return useQuery<FiscalPeriod | null>({
    queryKey: periodKeys.current(calendarId ?? ''),
    queryFn: () => fiscalCalendarService.getCurrentPeriod(calendarId!),
    enabled: !!calendarId,
    staleTime: 60_000, // period lock status changes infrequently
  });
}

/**
 * Returns a helper that answers: "can a financial posting be made right now?"
 * If the current period is locked/closed, returns false.
 */
export function useCanPost(calendarId: string | undefined) {
  const { data: period, isLoading } = useCurrentFiscalPeriod(calendarId);

  return {
    canPost: !!period && !period.isLocked && !period.isClosed,
    isLocked: !!period?.isLocked,
    isClosed: !!period?.isClosed,
    periodName: period?.periodName,
    isLoading,
  };
}

/**
 * Mutations: lock / unlock a fiscal period (ADMIN only).
 */
export function useLockPeriod() {
  const qc = useQueryClient();

  const lockMutation = useMutation({
    mutationFn: (periodId: string) => fiscalCalendarService.lockPeriod(periodId),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: periodKeys.all });
      toast.success('Fiscal period locked');
    },
    onError: (err: { response?: { data?: { message?: string } } }) => {
      toast.error(err?.response?.data?.message || 'Failed to lock period');
    },
  });

  const unlockMutation = useMutation({
    mutationFn: (periodId: string) => fiscalCalendarService.unlockPeriod(periodId),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: periodKeys.all });
      toast.success('Fiscal period unlocked');
    },
    onError: (err: { response?: { data?: { message?: string } } }) => {
      toast.error(err?.response?.data?.message || 'Failed to unlock period');
    },
  });

  return { lockMutation, unlockMutation };
}
