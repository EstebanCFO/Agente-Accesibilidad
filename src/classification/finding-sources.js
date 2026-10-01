/**
 * Fuentes de hallazgos. Regla del proyecto: el puntaje y los informes se basan SOLO en lo que
 * detecta axe-core. Lo que aporta la revisión del Agente (IA visual / UX) es un análisis
 * complementario: se muestra aparte y nunca modifica criterios, puntaje ni prioridades.
 */
export const COMPLEMENTARY_SOURCES = ['visual_audit', 'ux_review'];

export function isComplementaryFinding(finding) {
  return COMPLEMENTARY_SOURCES.includes(finding?.source);
}

/** Separa hallazgos de axe-core (primary) de los del Agente (complementary). */
export function splitFindings(findings = []) {
  const primary = [];
  const complementary = [];
  for (const finding of findings || []) {
    (isComplementaryFinding(finding) ? complementary : primary).push(finding);
  }
  return { primary, complementary };
}
