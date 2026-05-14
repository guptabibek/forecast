import { Injectable, Logger } from '@nestjs/common';
import { AiProviderService } from './ai-provider.service';
import { buildResultSummaryPrompt } from './prompts/result-summary.prompt';
import { ReportingSecurityContext, SemanticReportQuery } from './semantic-query.types';

const SENSITIVE_KEY = /(pan|vat|gst|phone|address|email|license|secret|token)/i;

@Injectable()
export class ResultSummarizerService {
  private readonly logger = new Logger(ResultSummarizerService.name);

  constructor(private readonly aiProvider: AiProviderService) {}

  async summarize(input: {
    question: string;
    semanticQuery: SemanticReportQuery;
    columns: Array<{ key: string; label: string; dataType?: string }>;
    rows: Record<string, unknown>[];
    securityContext: ReportingSecurityContext;
    requestId: string;
  }): Promise<string | null> {
    if (!input.rows.length) return 'No matching data was found for the selected filters.';

    const config = await this.aiProvider.getTenantOperationalConfig(input.securityContext.tenantId);
    const sampleRows = input.rows.slice(0, config.maxSummaryRows).map((row) => this.maskRow(row, config.maskSensitiveFields));
    const safeColumns = input.columns.filter((c) => !config.maskSensitiveFields || !SENSITIVE_KEY.test(c.key)).slice(0, 20);
    const prompt = buildResultSummaryPrompt({
      userQuestion: input.question,
      reportTitle: input.semanticQuery.title,
      columnsJson: JSON.stringify(safeColumns),
      resultRowsJson: JSON.stringify(sampleRows),
      assumptionsJson: JSON.stringify(input.semanticQuery.assumptions ?? []),
    });

    try {
      const response = await this.aiProvider.generateJson([
        {
          role: 'system',
          content: 'Return valid JSON only. Summarize only the supplied ERP report rows. Do not expose SQL or implementation details.',
        },
        { role: 'user', content: prompt },
      ], {
        maxTokens: 300,
        tenantId: input.securityContext.tenantId,
        userId: input.securityContext.userId,
        requestId: input.requestId,
        callType: 'summary',
      });
      const summary = typeof (response as any)?.summary === 'string' ? (response as any).summary : '';
      return summary.slice(0, 1500) || null;
    } catch (error: any) {
      this.logger.warn(`AI report summarization skipped: ${String(error?.message ?? error).slice(0, 200)}`);
      return null;
    }
  }

  private maskRow(row: Record<string, unknown>, mask: boolean): Record<string, unknown> {
    if (!mask) return row;
    const masked: Record<string, unknown> = {};
    for (const [key, value] of Object.entries(row)) {
      if (SENSITIVE_KEY.test(key)) continue;
      masked[key] = value;
    }
    return masked;
  }
}
