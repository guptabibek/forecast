import { useAuthStore } from '@/stores/auth.store';
import { useEffect, useMemo, useState } from 'react';

const RENEW_WARNING_SECONDS = 5 * 60;

function getTokenExp(token?: string): number | null {
  if (!token) return null;
  try {
    const payload = token.split('.')[1];
    if (!payload) return null;
    const decoded = JSON.parse(atob(payload.replace(/-/g, '+').replace(/_/g, '/')));
    return typeof decoded.exp === 'number' ? decoded.exp : null;
  } catch {
    return null;
  }
}

export function SessionRenewalPrompt() {
  const isAuthenticated = useAuthStore((state) => state.isAuthenticated);
  const accessToken = useAuthStore((state) => state.tokens?.accessToken);
  const refreshToken = useAuthStore((state) => state.refreshToken);
  const logout = useAuthStore((state) => state.logout);
  const [isOpen, setIsOpen] = useState(false);
  const [isRenewing, setIsRenewing] = useState(false);

  const expiresAt = useMemo(() => getTokenExp(accessToken), [accessToken]);

  useEffect(() => {
    setIsOpen(false);
    if (!isAuthenticated || !expiresAt) return;

    const nowMs = Date.now();
    const warningMs = expiresAt * 1000 - RENEW_WARNING_SECONDS * 1000 - nowMs;
    const expiryMs = expiresAt * 1000 - nowMs;

    const warningTimer = window.setTimeout(() => setIsOpen(true), Math.max(0, warningMs));
    const expiryTimer = window.setTimeout(() => {
      void logout();
      window.location.href = '/login';
    }, Math.max(0, expiryMs));

    return () => {
      window.clearTimeout(warningTimer);
      window.clearTimeout(expiryTimer);
    };
  }, [expiresAt, isAuthenticated, logout]);

  if (!isAuthenticated || !isOpen) {
    return null;
  }

  const handleRenew = async () => {
    setIsRenewing(true);
    try {
      await refreshToken();
      setIsOpen(false);
    } catch {
      await logout();
      window.location.href = '/login';
    } finally {
      setIsRenewing(false);
    }
  };

  return (
    <div className="fixed inset-x-0 bottom-4 z-[70] flex justify-center px-4">
      <div className="w-full max-w-md rounded-lg border border-amber-200 bg-white p-4 shadow-xl dark:border-amber-800 dark:bg-secondary-900">
        <p className="text-sm font-medium text-secondary-900 dark:text-secondary-100">
          Your session will expire soon. Renew now to continue.
        </p>
        <div className="mt-3 flex justify-end gap-2">
          <button
            type="button"
            onClick={() => setIsOpen(false)}
            className="rounded-md px-3 py-1.5 text-sm text-secondary-600 hover:bg-secondary-100 dark:text-secondary-300 dark:hover:bg-secondary-800"
          >
            Dismiss
          </button>
          <button
            type="button"
            onClick={handleRenew}
            disabled={isRenewing}
            className="rounded-md bg-primary-600 px-3 py-1.5 text-sm font-semibold text-white hover:bg-primary-700 disabled:opacity-50"
          >
            {isRenewing ? 'Renewing...' : 'Renew now'}
          </button>
        </div>
      </div>
    </div>
  );
}
