export const MARG_SYNC_SCOPE = {
  FULL: 'full',
  ACCOUNTING: 'accounting',
} as const;

export type MargSyncScope = (typeof MARG_SYNC_SCOPE)[keyof typeof MARG_SYNC_SCOPE];

export const MARG_SYNC_MODE = {
  FETCH: 'fetch',
  REPROJECT: 'reproject',
} as const;

export type MargSyncMode = (typeof MARG_SYNC_MODE)[keyof typeof MARG_SYNC_MODE];

export interface MargSyncJobData {
  configId: string;
  tenantId: string;
  triggeredBy?: string;
  fromDate?: string;
  endDate?: string;
  scope?: MargSyncScope;
  mode?: MargSyncMode;
}