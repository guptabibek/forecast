export interface InsightNarrativePromptInput {
  providerName: string;
  title: string;
  severity: string;
  draftSummary: string;
  metricsJson: string;
  evidenceJson: string;
}

/**
 * Single-insight narration prompt. One insight per call keeps the completion
 * bounded (no truncation) and removes any chance of mapping a narrative onto
 * the wrong insight.
 */
export function buildInsightNarrativePrompt(input: InsightNarrativePromptInput): string {
  return `Rewrite the summary of the detected business insight below in clear, natural business language.

Insight provider:
${input.providerName}

Title:
${input.title}

Severity:
${input.severity}

Draft summary:
${input.draftSummary}

Metrics (JSON):
${input.metricsJson}

Evidence (JSON):
${input.evidenceJson}

Rules:
1. Use only the values given in title, draft summary, metrics and evidence.
2. Do not invent or change any numbers.
3. Keep the summary concise (1-3 sentences).
4. Do not expose SQL or implementation details.

Return only valid JSON:

{
  "summary": "string"
}`;
}
