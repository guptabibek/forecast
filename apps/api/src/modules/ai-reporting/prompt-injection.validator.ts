import { Injectable } from '@nestjs/common';
import { AiReportingBadRequest } from './ai-reporting.errors';

const BLOCKED_PATTERNS = [
  /\b(ignore|bypass|override|forget)\b.{0,80}\b(instruction|system prompt|policy|guardrail|previous)\b/i,
  /\b(show|reveal|print|dump|export)\b.{0,80}\b(api key|secret|token|password|credential|system prompt)\b/i,
  /\b(show|dump|list|describe)\b.{0,80}\b(database schema|raw schema|table structure|all tables|pg_catalog|information_schema)\b/i,
  /\b(run|execute|perform)\b.{0,80}\b(delete|drop|truncate|update|insert|alter|create|grant|revoke|vacuum|copy)\b/i,
  /\b(delete|drop|truncate|update|insert|alter|create|grant|revoke|vacuum|copy)\b.{0,80}\b(invoice|invoices|data|record|records|table|database|customer|customers|supplier|suppliers|ledger|stock)\b/i,
  /\b(bypass|ignore|override|skip)\b.{0,80}\b(permission|permissions|branch|branches|company|tenant|scope|access)\b/i,
  /\b(raw sql|sql query|direct sql)\b/i,
  /\ball customers\b.{0,80}\b(phone|address|pan|gst|vat|bank|email)\b/i,
  /\b(show|dump|export|list)\b.{0,40}\ball\b.{0,40}\b(customer|supplier|party)\b.{0,40}\b(data|details|records)\b/i,
];

@Injectable()
export class PromptInjectionValidator {
  validateQuestion(question: string) {
    const normalized = question.replace(/\s+/g, ' ').trim();
    if (!normalized) {
      throw new AiReportingBadRequest('INVALID_SEMANTIC_QUERY', 'Report question is required');
    }
    if (normalized.length > 1000) {
      throw new AiReportingBadRequest('INVALID_SEMANTIC_QUERY', 'Report question is too long');
    }
    if (BLOCKED_PATTERNS.some((pattern) => pattern.test(normalized))) {
      throw new AiReportingBadRequest(
        'PROMPT_INJECTION_REJECTED',
        'This request asks for unsafe access or internal implementation details and cannot be processed.',
      );
    }
  }
}
