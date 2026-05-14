import { Injectable, Logger } from '@nestjs/common';
import { PrismaService } from '../../core/database/prisma.service';
import { AiReportingTimeout } from './ai-reporting.errors';
import { CompiledSql, ExecutedReportResult } from './semantic-query.types';

const SLOW_QUERY_MS = 5000;

@Injectable()
export class ReportExecutorService {
  private readonly logger = new Logger(ReportExecutorService.name);

  constructor(private readonly prisma: PrismaService) {}

  async execute(compiled: CompiledSql, options: { timeoutMs: number }): Promise<ExecutedReportResult> {
    const started = Date.now();
    const timeoutMs = options.timeoutMs;

    try {
      const rows = await this.prisma.$transaction(async (tx) => {
        await tx.$executeRawUnsafe('SET TRANSACTION READ ONLY');
        await tx.$queryRawUnsafe(`SELECT set_config('statement_timeout', $1, true)`, `${timeoutMs}`);
        return tx.$queryRawUnsafe<Record<string, unknown>[]>(compiled.sql, ...compiled.params);
      }, { timeout: timeoutMs + 5000, maxWait: 5000 });

      const normalizedRows = rows.map((row) => this.normalizeRow(row));
      const executionTimeMs = Date.now() - started;
      if (executionTimeMs >= SLOW_QUERY_MS) {
        this.logger.warn(`Slow AI report query: dataset=${compiled.datasetId}, view=${compiled.viewName}, durationMs=${executionTimeMs}, rows=${normalizedRows.length}`);
      }
      return {
        columns: this.columnsFromRows(normalizedRows, compiled.selectedColumns, compiled.selectedColumnMetadata ?? []),
        rows: normalizedRows,
        rowCount: normalizedRows.length,
        executionTimeMs,
      };
    } catch (error: any) {
      const message = String(error?.message ?? '');
      this.logger.warn(`AI report query failed after ${Date.now() - started}ms: ${message.slice(0, 300)}`);
      if (/timeout|canceling statement|P2028/i.test(message)) {
        throw new AiReportingTimeout();
      }
      throw error;
    }
  }

  private normalizeRow(row: Record<string, unknown>): Record<string, unknown> {
    const output: Record<string, unknown> = {};
    for (const [key, value] of Object.entries(row)) {
      if (typeof value === 'bigint') output[key] = Number(value);
      else if (value instanceof Date) output[key] = value.toISOString();
      else output[key] = value;
    }
    return output;
  }

  private columnsFromRows(
    rows: Record<string, unknown>[],
    preferred: string[],
    metadata: Array<{ key: string; label: string; dataType?: string }>,
  ) {
    const keys = rows[0] ? Object.keys(rows[0]) : preferred;
    const metadataByKey = new Map(metadata.map((column) => [column.key, column]));
    return keys.map((key) => ({
      key,
      label: metadataByKey.get(key)?.label ?? this.toLabel(key),
      dataType: metadataByKey.get(key)?.dataType ?? this.inferType(rows[0]?.[key]),
    }));
  }

  private inferType(value: unknown): string {
    if (typeof value === 'number') return 'number';
    if (typeof value === 'boolean') return 'boolean';
    if (typeof value === 'string' && /^\d{4}-\d{2}-\d{2}/.test(value)) return 'date';
    return 'string';
  }

  private toLabel(key: string): string {
    return key.replace(/_/g, ' ').replace(/\b\w/g, (c) => c.toUpperCase());
  }
}
