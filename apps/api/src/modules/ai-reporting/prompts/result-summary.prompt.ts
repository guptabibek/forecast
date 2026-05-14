export interface ResultSummaryPromptInput {
  userQuestion: string;
  reportTitle: string;
  columnsJson: string;
  resultRowsJson: string;
  assumptionsJson: string;
}

export function buildResultSummaryPrompt(input: ResultSummaryPromptInput): string {
  return `Summarize the executed ERP report result in simple business language.

User question:
${input.userQuestion}

Report title:
${input.reportTitle}

Columns:
${input.columnsJson}

Rows:
${input.resultRowsJson}

Assumptions:
${input.assumptionsJson}

Rules:
1. Use only the provided result rows.
2. Do not invent values.
3. Keep the summary concise.
4. Mention exact values where useful.
5. If result is empty, say no matching data was found.
6. Do not expose SQL.
7. Do not mention internal implementation.
8. Do not make unsupported business claims.

Return only valid JSON:

{
  "summary": "string",
  "keyInsights": [],
  "followUpQuestions": [],
  "dataQualityNotes": []
}`;
}
