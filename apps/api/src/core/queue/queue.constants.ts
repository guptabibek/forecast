// Queue name constants
export const QUEUE_NAMES = {
  FORECAST: 'forecast-queue',
  IMPORT: 'import-queue',
  EXPORT: 'export-queue',
  NOTIFICATION: 'notification-queue',
  MARG_SYNC: 'marg-sync-queue',
} as const;

export type QueueName = (typeof QUEUE_NAMES)[keyof typeof QUEUE_NAMES];
