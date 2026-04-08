import type { AxiosError } from 'axios';

type ErrorContext = {
  source?: 'error-boundary' | 'window-error' | 'unhandled-rejection' | 'api';
  componentStack?: string;
  requestId?: string;
  statusCode?: number;
  route?: string;
};

type ClientErrorEvent = {
  timestamp: string;
  message: string;
  stack?: string;
  source: NonNullable<ErrorContext['source']>;
  requestId?: string;
  statusCode?: number;
  route: string;
  userAgent: string;
};

const STORAGE_KEY = 'fh_client_errors';
const MAX_BUFFER = 20;

function isBrowser(): boolean {
  return typeof window !== 'undefined';
}

function readBuffer(): ClientErrorEvent[] {
  if (!isBrowser()) return [];
  try {
    const raw = window.sessionStorage.getItem(STORAGE_KEY);
    if (!raw) return [];
    const parsed = JSON.parse(raw) as ClientErrorEvent[];
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}

function writeBuffer(events: ClientErrorEvent[]) {
  if (!isBrowser()) return;
  try {
    window.sessionStorage.setItem(STORAGE_KEY, JSON.stringify(events.slice(-MAX_BUFFER)));
  } catch {
    // Ignore storage quota/availability failures
  }
}

export function reportClientError(error: unknown, context: ErrorContext = {}) {
  const source = context.source || 'window-error';
  const route = context.route || (isBrowser() ? window.location.pathname : 'unknown');

  let message = 'Unknown client error';
  let stack: string | undefined;

  if (error instanceof Error) {
    message = error.message;
    stack = error.stack;
  } else if (typeof error === 'string') {
    message = error;
  } else if (error && typeof error === 'object' && 'message' in error) {
    message = String((error as { message?: unknown }).message || message);
  }

  const event: ClientErrorEvent = {
    timestamp: new Date().toISOString(),
    message,
    stack,
    source,
    requestId: context.requestId,
    statusCode: context.statusCode,
    route,
    userAgent: isBrowser() ? window.navigator.userAgent : 'unknown',
  };

  const buffer = readBuffer();
  buffer.push(event);
  writeBuffer(buffer);

  if (import.meta.env.DEV) {
    console.error('[ClientError]', event, context.componentStack || '');
  } else {
    console.error('[ClientError]', event.message);
  }
}

export function reportApiError(error: AxiosError) {
  const requestId = (error.response?.headers?.['x-request-id'] as string | undefined)
    || (error.response?.headers?.['X-Request-ID'] as string | undefined);

  reportClientError(error, {
    source: 'api',
    requestId,
    statusCode: error.response?.status,
  });
}

let globalHandlersInstalled = false;

export function installGlobalErrorHandlers() {
  if (!isBrowser() || globalHandlersInstalled) return;
  globalHandlersInstalled = true;

  window.addEventListener('error', (event) => {
    reportClientError(event.error || event.message, {
      source: 'window-error',
      route: window.location.pathname,
    });
  });

  window.addEventListener('unhandledrejection', (event) => {
    reportClientError(event.reason, {
      source: 'unhandled-rejection',
      route: window.location.pathname,
    });
  });
}
