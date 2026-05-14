import { Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { DatabaseModule } from '../../core/database/database.module';
import { AiProviderService } from './ai-provider.service';
import { AiReportingAuditService } from './ai-reporting.audit';
import { AiReportingController } from './ai-reporting.controller';
import { AiReportingService } from './ai-reporting.service';
import { AiReportingUsageGuard } from './ai-reporting-usage.guard';
import { NlqParserService } from './nlq-parser.service';
import { PromptInjectionValidator } from './prompt-injection.validator';
import { ReportExecutorService } from './report-executor.service';
import { ResultSummarizerService } from './result-summarizer.service';
import { SemanticCatalogLoader } from './semantic-catalog.loader';
import { SemanticQueryValidator } from './semantic-query.validator';
import { SqlCompilerService } from './sql-compiler.service';
import { SqlSafetyValidator } from './sql-safety.validator';

@Module({
  imports: [ConfigModule, DatabaseModule],
  controllers: [AiReportingController],
  providers: [
    AiProviderService,
    AiReportingAuditService,
    AiReportingService,
    AiReportingUsageGuard,
    NlqParserService,
    PromptInjectionValidator,
    ReportExecutorService,
    ResultSummarizerService,
    SemanticCatalogLoader,
    SemanticQueryValidator,
    SqlCompilerService,
    SqlSafetyValidator,
  ],
})
export class AiReportingModule {}
