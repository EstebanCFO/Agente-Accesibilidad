/**
 * Deriva el Principio WCAG (Perceptible/Operable/Comprensible/Robusto) del primer dígito del
 * criterio - no es un dato nuevo, es una propiedad fija de la numeración WCAG 2.0.
 */
const PRINCIPIO_POR_DIGITO = { '1': 'Perceptible', '2': 'Operable', '3': 'Comprensible', '4': 'Robusto' };

export function derivePrincipio(wcagCriterion) {
  const primerDigito = String(wcagCriterion).split('.')[0];
  return PRINCIPIO_POR_DIGITO[primerDigito] ?? 'Desconocido';
}

const SEVERIDAD_RANK = { critico: 4, alto: 3, medio: 2, bajo: 1 };

export function worseSeveridad(a, b) {
  return (SEVERIDAD_RANK[b] ?? 0) > (SEVERIDAD_RANK[a] ?? 0) ? b : a;
}

/**
 * Mapeo determinístico Crítico/Alto/Medio/Bajo a partir de datos que el finding ya trae
 * (wcag_level, severity de axe-core, affected_urls.length como proxy de "componente
 * reutilizado en muchas pantallas") - sin pedir tags de negocio nuevos. Ver
 * docs/superpowers/specs/2026-09-23-informe-narrativo-design.md para la justificación de cada
 * regla y del orden de prioridad (en particular: "minor" siempre da "bajo", incluso en AA).
 */
export function deriveSeveridad(finding) {
  const afectaVariasPaginas = (finding.affected_urls?.length ?? 0) > 1;

  if (finding.wcag_level === 'A' && finding.severity === 'critical') return 'critico';
  if (finding.severity === 'minor') return 'bajo';
  if (finding.wcag_level === 'A' && ['serious', 'moderate'].includes(finding.severity)) return 'alto';
  if (afectaVariasPaginas) return 'alto';
  if (finding.wcag_level === 'AA') return 'medio';
  return 'bajo';
}
