import { Injectable, Logger } from '@nestjs/common';
import { createHash } from 'crypto';
import { PrismaService } from '../../core/database/prisma.service';

export interface AiReportAuditRecord {
  requestId: string;
  tenantId: string;
  userId: string | null;
  companyId?: number | null;
  branchIds?: string[] | null;
  question: string;
  outputMode?: string | null;
  queryKind?: string | null;
  semanticQuery?: unknown;
  sql?: string | null;
  executionTimeMs?: number | null;
  rowCount?: number | null;
  status: 'success' | 'error';
  errorCode?: string | null;
  errorMessage?: string | null;
  aiCallCount?: number | null;
  summaryCallCount?: number | null;
}

@Injectable()
export class AiReportingAuditService {
  private readonly logger = new Logger(AiReportingAuditService.name);

  constructor(private readonly prisma: PrismaService) {}

  async log(record: AiReportAuditRecord) {
    const sqlHash = record.sql ? createHash('sha256').update(record.sql).digest('hex') : null;
    try {
      await this.prisma.$executeRawUnsafe(
        `
          INSERT INTO ai_report_query_audits (
            tenant_id, user_id, request_id, company_id, branch_ids, question,
            output_mode, query_kind, semantic_query, sql_hash, execution_time_ms,
            row_count, status, error_code, error_message, ai_call_count,
            summary_call_count
          )
          VALUES (
            $1::uuid, $2::uuid, $3::uuid, $4::int, $5::uuid[], $6,
            $7, $8, $9::jsonb, $10, $11::int, $12::int, $13, $14, $15,
            $16::int, $17::int
          )
        `,
        record.tenantId,
        record.userId,
        record.requestId,
        record.companyId ?? null,
        record.branchIds?.length ? record.branchIds : null,
        record.question,
        record.outputMode ?? null,
        record.queryKind ?? null,
        record.semanticQuery ? JSON.stringify(record.semanticQuery) : null,
        sqlHash,
        record.executionTimeMs ?? null,
        record.rowCount ?? null,
        record.status,
        record.errorCode ?? null,
        record.errorMessage ? record.errorMessage.slice(0, 1000) : null,
        record.aiCallCount ?? 0,
        record.summaryCallCount ?? 0,
      );
    } catch (error: any) {
      this.logger.warn(`Failed to write AI report audit record: ${String(error?.message ?? error).slice(0, 300)}`);
    }
  }

  async history(tenantId: string, userId: string, limit = 50) {
    const safeLimit = Math.min(Math.max(Number(limit) || 50, 1), 200);
    const rows = await this.prisma.$queryRawUnsafe<any[]>(
      `
        SELECT request_id, question, output_mode, query_kind, execution_time_ms,
               row_count, status, error_code, error_message, created_at
        FROM ai_report_query_audits
        WHERE tenant_id = $1::uuid AND user_id = $2::uuid
        ORDER BY created_at DESC
        LIMIT $3
      `,
      tenantId,
      userId,
      safeLimit,
    );
    return rows.map((row) => ({
      requestId: row.request_id,
      question: row.question,
      outputMode: row.output_mode,
      queryKind: row.query_kind,
      executionTimeMs: row.execution_time_ms,
      rowCount: row.row_count,
      status: row.status,
      errorCode: row.error_code,
      errorMessage: row.error_message,
      createdAt: row.created_at instanceof Date ? row.created_at.toISOString() : row.created_at,
    }));
  }
}
