/**
 * Arma las tarjetas de resultados parciales que muestra el panel (Compliance WCAG, problemas por
 * severidad, buenas prácticas, pruebas de teclado y consumo de IA). Lógica pura, sin I/O.
 */
const IMPACT_ORDER = ['critical', 'serious', 'moderate', 'minor'];

// La normativa BCRA es WCAG 2.0 A+AA; "Sumar WCAG 2.2" agrega 2.1 A/AA y 2.2 AA (2.2 incluye 2.1).
// Las reglas 'best-practice' de axe no son criterios WCAG y nunca se cuentan acá.
const BCRA_TAGS = ['wcag2a', 'wcag2aa'];
const EXTENDED_TAGS = ['wcag21a', 'wcag21aa', 'wcag22aa'];

/** Violación que cuenta para la Sección 1: WCAG 2.0 (BCRA), + 2.1/2.2 con includeExtended. */
export function isWcagViolation(violation, { includeExtended = false } = {}) {
  const tags = includeExtended ? [...BCRA_TAGS, ...EXTENDED_TAGS] : BCRA_TAGS;
  return (violation.tags || []).some((tag) => tags.includes(tag));
}

/**
 * Cuenta violaciones de axe-core por severidad (una por regla por página), solo de reglas WCAG
 * 2.0 (BCRA) y, con includeExtended, también WCAG 2.1/2.2.
 */
export function countViolationsByImpact(axeResults = [], { includeExtended = false } = {}) {
  const counts = { critical: 0, serious: 0, moderate: 0, minor: 0 };
  for (const result of axeResults) {
    for (const violation of result.violations || []) {
      if (!isWcagViolation(violation, { includeExtended })) continue;
      if (IMPACT_ORDER.includes(violation.impact)) counts[violation.impact] += 1;
    }
  }
  return counts;
}

const PCT = new Intl.NumberFormat('es-AR', { maximumFractionDigits: 2 });

/**
 * Tarjeta de la Sección 1: conteo sin veredicto. El anillo muestra cuánto se pudo validar
 * automáticamente ((OK+NOK)/total), no un porcentaje de cumplimiento.
 */
export function buildWcagCard(section, { includeExtended = false } = {}) {
  const validated = section.total ? Math.round(((section.ok + section.nok) / section.total) * 10000) / 100 : 0;
  const na = section.no_aplica ? ` · ${section.no_aplica} ${section.no_aplica === 1 ? 'no aplica' : 'no aplican'}` : '';
  return {
    key: 'wcag',
    label: includeExtended ? 'Compliance WCAG 2.0 (BCRA) + 2.2' : 'Compliance WCAG 2.0 (BCRA)',
    value: `${section.ok} OK · ${section.nok} NOK`,
    detail: `${section.a_validar} a validar (de ${section.total})${na}`,
    title: 'Los criterios "a validar" requieren tecnología asistiva o revisión manual y no cuentan como OK.',
    ring: { pct: validated, tone: 'warn' }
  };
}

/** Tarjeta de la Sección 2: puntaje ponderado por impacto; no afecta el compliance. */
export function buildBestPracticesCard(bp) {
  return {
    key: 'best-practices',
    label: 'Buenas prácticas (complementario)',
    value: bp.score === null ? '—' : `${PCT.format(bp.score)}%`,
    detail: `${bp.cumple} ${bp.cumple === 1 ? 'cumple' : 'cumplen'} · ${bp.mejora} a mejorar · ${bp.no_aplica} ${bp.no_aplica === 1 ? 'no aplica' : 'no aplican'}`,
    title: 'Reglas de buenas prácticas de axe-core, ponderadas por impacto. No forman parte de la normativa BCRA.'
  };
}

/** Tarjeta semáforo de problemas WCAG por severidad (2.0 BCRA, más 2.2 si se seleccionó). */
export function buildSeverityCard(counts, { includeExtended = false } = {}) {
  const total = IMPACT_ORDER.reduce((sum, k) => sum + (counts[k] || 0), 0);
  return {
    key: 'severity',
    label: includeExtended ? 'Problemas WCAG 2.0 (BCRA) + 2.2' : 'Problemas WCAG 2.0 (BCRA)',
    value: String(total),
    breakdown: [
      { label: 'Críticos', value: counts.critical || 0, tone: 'critical' },
      { label: 'Serios', value: counts.serious || 0, tone: 'serious' },
      { label: 'Moderados', value: counts.moderate || 0, tone: 'moderate' },
      { label: 'Menores', value: counts.minor || 0, tone: 'minor' }
    ]
  };
}

/**
 * Tarjeta de la Sección 3 (Pruebas de teclado del Agente): % de pares página×criterio sin indicios
 * (ver computeKeyboardScore). Complementaria: no afecta el compliance WCAG ni las buenas prácticas.
 */
export function buildKeyboardCard(k, { pending = 0 } = {}) {
  const parts = [`${k.con_indicios} con indicios`, `${k.sin_indicios} sin indicios`];
  if (k.no_evaluable) parts.push(`${k.no_evaluable} no evaluables`);
  if (pending) parts.push(`${pending} página(s) en curso`);
  return {
    key: 'keyboard',
    label: 'Pruebas de teclado del Agente (complementario)',
    value: k.score === null ? '—' : `${PCT.format(k.score)}%`,
    detail: parts.join(' · '),
    title: 'Recorrido con Tab en cada página: trampas de teclado (2.1.2), orden del foco (2.4.3), foco visible (2.4.7) y cambios al recibir el foco (3.2.1). "Con indicios" requiere validación humana.'
  };
}

const NUMBER = new Intl.NumberFormat('es-AR');
const USD = new Intl.NumberFormat('es-AR', { minimumFractionDigits: 4, maximumFractionDigits: 4 });

/** Tarjeta de consumo de la IA: tokens totales y costo estimado en US$. */
export function buildUsageCard(usage, costUsd) {
  const total = usage.inputTokens + usage.outputTokens + usage.cacheWriteTokens + usage.cacheReadTokens;
  const cost = costUsd === null || costUsd === undefined ? 'costo s/d' : `≈ US$ ${USD.format(costUsd)}`;
  return {
    key: 'usage',
    label: 'Consumo de IA',
    value: `${NUMBER.format(total)} tokens`,
    detail: `${cost} · ${usage.calls} llamada(s)`,
    title: `Entrada ${NUMBER.format(usage.inputTokens)} · salida ${NUMBER.format(usage.outputTokens)} · caché ${NUMBER.format(usage.cacheReadTokens + usage.cacheWriteTokens)}`
  };
}

const plural = (n, one, many) => `${n} ${n === 1 ? one : many}`;

/**
 * Línea del log por página (ver summarizeRuleChecks): los chequeos son REGLAS de axe-core, no
 * criterios; se aclaran cuántos criterios WCAG quedaron con verificación, y las buenas prácticas
 * van aparte ("a mejorar" = falla o a revisar, igual que en la Sección 2).
 */
export function formatPageChecks({ wcag, best_practice: bp }) {
  return `WCAG — ${plural(wcag.fail, 'regla con problemas', 'reglas con problemas')}, ${wcag.review} a revisar, `
    + `${plural(wcag.pass, 'aprobada', 'aprobadas')} (${plural(wcag.criteria_with_pass, 'criterio con verificación', 'criterios con verificación')})`
    + ` · Buenas prácticas — ${bp.fail + bp.review} a mejorar, ${plural(bp.pass, 'cumple', 'cumplen')}`;
}
