import { SemanticReportQuery } from '../ai-reporting/semantic-query.types';

export const INSIGHT_PROVIDERS = Symbol('INSIGHT_PROVIDERS');

export type InsightSeverity = 'info' | 'low' | 'medium' | 'high' | 'critical';

export type InsightStatus = 'NEW' | 'ACTIVE' | 'ACKNOWLEDGED' | 'RESOLVED' | 'ARCHIVED';

export interface InsightReportRows {
  columns: Array<{ key: string; label: string; dataType?: string }>;
  rows: Record<string, unknown>[];
  rowCount: number;
}

/**
 * Execution context handed to each provider. Providers never run raw SQL:
 * they express analyses as semantic report queries that go through the same
 * validate → compile → safety-check → execute pipeline as user questions,
 * so tenant scoping is always applied by the compiler.
 */
export interface InsightProviderContext {
  tenantId: string;
  now: Date;
  /** Provider-specific config from ai_insight_provider_configs.config */
  config: Record<string, unknown>;
  runReport(query: SemanticReportQuery): Promise<InsightReportRows>;
}

export interface InsightCandidate {
  /** Stable natural key within the provider; re-detections update instead of duplicate */
  dedupeKey: string;
  severity: InsightSeverity;
  title: string;
  summary: string;
  /** 0..1 */
  confidence: number;
  metrics?: Record<string, unknown>;
  evidence?: string[];
  actions?: string[];
  /** NLQ the user can re-run in AI Reporting to drill down */
  drillDownQuestion?: string | null;
}

/**
 * Strategy interface for insight generation (Open/Closed extension point).
 * Add a new provider by implementing this interface and registering the
 * class in insights-dashboard.module.ts — no engine or provider changes.
 */
export interface IInsightProvider {
  readonly providerId: string;
  readonly displayName: string;
  readonly category: string;
  readonly defaultEnabled: boolean;
  generate(ctx: InsightProviderContext): Promise<InsightCandidate[]>;
}
