export const CLARIFICATION_PROMPT_VERSION = '1.0.0';

export const CLARIFICATION_RESPONSE_RULES = `Clarification and unsupported handling:
- Return status "clarification_required" only when one missing business choice prevents a safe report.
- Ask exactly one concise clarifyingQuestion.
- Return status "unsupported" when the catalog has no approved dataset, metric, dimension, filter, or report template for the request.
- Do not suggest raw database access or SQL.
- Do not expose internal schema names, view names, table names, SQL, or implementation details.
- When reasonable catalog defaults answer the request safely, return status "ok" and list those defaults in assumptions.`;
