import { BadRequestException, ForbiddenException, GatewayTimeoutException, ServiceUnavailableException } from '@nestjs/common';

export type AiReportingErrorCode =
  | 'UNSUPPORTED_QUESTION'
  | 'CLARIFICATION_REQUIRED'
  | 'PERMISSION_DENIED'
  | 'REPORT_UNAVAILABLE'
  | 'QUERY_TOO_BROAD'
  | 'AI_REPORTING_DISABLED'
  | 'RATE_LIMIT_EXCEEDED'
  | 'PROMPT_INJECTION_REJECTED'
  | 'AI_SERVICE_UNAVAILABLE'
  | 'AI_PROVIDER_ERROR'
  | 'DATABASE_TIMEOUT'
  | 'DB_TIMEOUT'
  | 'INVALID_SEMANTIC_QUERY'
  | 'UNSAFE_SQL'
  | 'SQL_VALIDATION_FAILED'
  | 'MISSING_DATASET'
  | 'MISSING_FIELD'
  | 'MISSING_METRIC'
  | 'MISSING_DIMENSION'
  | 'MISSING_FILTER'
  | 'MISSING_DATE_FIELD'
  | 'MISSING_DISPLAY_COLUMN'
  | 'AMBIGUOUS_ENTITY'
  | 'AMBIGUOUS_DOMAIN'
  | 'UNSUPPORTED_OPERATION'
  | 'NO_DATA_FOUND';

export class AiReportingBadRequest extends BadRequestException {
  constructor(code: AiReportingErrorCode, message: string, details?: unknown) {
    super({ code, message, details });
  }
}

export class AiReportingForbidden extends ForbiddenException {
  constructor(message = 'You do not have permission to run this AI report') {
    super({ code: 'PERMISSION_DENIED', message });
  }
}

export class AiReportingUnavailable extends ServiceUnavailableException {
  constructor(message = 'AI reporting service is temporarily unavailable') {
    super({ code: 'AI_SERVICE_UNAVAILABLE', message });
  }
}

export class AiReportingTimeout extends GatewayTimeoutException {
  constructor(message = 'The AI report query timed out') {
    super({ code: 'DATABASE_TIMEOUT', message });
  }
}
