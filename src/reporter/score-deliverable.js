export const BASELINE_LABEL = 'ONTI 6/2019 — WCAG 2.0 A+AA (38 criterios)';
export const COVERAGE_NOTE = 'Score sobre los 38 criterios ONTI por detección automática (~57% de barreras). '
  + 'Los criterios que requieren AT reales se evalúan en F2.';

/**
 * Envuelve la salida de calculateScore() con el envelope de job que pide SPEC §8.1
 * (score-compliance.json). calculateScore ya deja summary/extended_22/by_url listos.
 */
export function buildScoreDeliverable({ jobId, channel, scores }) {
  return {
    job_id: jobId,
    generated_at: new Date().toISOString(),
    channel: channel ?? null,
    baseline: BASELINE_LABEL,
    coverage_note: COVERAGE_NOTE,
    summary: scores.summary,
    extended_22: scores.extended_22,
    by_url: scores.by_url
  };
}
