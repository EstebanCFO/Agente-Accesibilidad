export const BASELINE_LABEL = 'ONTI 6/2019 — WCAG 2.0 A+AA (38 criterios)';
export const COVERAGE_NOTE = 'Conteo OK / NOK / a validar sobre los 38 criterios ONTI, sin umbral ni veredicto. '
  + 'Los criterios que requieren tecnología asistiva o revisión manual quedan a validar (F2).';

/**
 * Envuelve la salida de calculateScore() con el envelope de job que pide SPEC §8.1
 * (score-compliance.json). calculateScore ya deja summary/extended_22/by_url/by_module listos.
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
    by_url: scores.by_url,
    by_module: scores.by_module,
    wcag_section: scores.wcag_section ?? null,
    best_practices: scores.best_practices ?? null
  };
}
