import { extractWcagCriteria } from './wcag-map.js';

export const IMPACT_WEIGHT = { critical: 4, serious: 3, moderate: 2, minor: 1 };
const DEFAULT_WEIGHT = IMPACT_WEIGHT.moderate;

/** Regla de buenas prácticas de axe-core: tag 'best-practice' y ningún criterio WCAG numerado. */
function isBestPracticeRule(tags) {
  return Array.isArray(tags) && tags.includes('best-practice') && extractWcagCriteria(tags).length === 0;
}

/**
 * Sección 2 del informe (Buenas prácticas). Complementaria: no afecta el compliance WCAG.
 * Estado por regla, consolidado entre páginas: 'mejora' si falló o quedó incomplete en alguna
 * página; si no, 'cumple' si pasó en alguna; si no, 'no_aplica'. Puntaje = peso de las que
 * cumplen / peso de las que aplican, ponderado por el impacto de la regla en axe-core
 * (passes/inapplicable no traen impact: se toma de rule_impacts que guarda el scanner).
 */
export function computeBestPractices(axeResults = []) {
  const rules = new Map();
  const get = (entry) => {
    if (!rules.has(entry.id)) {
      rules.set(entry.id, { rule_id: entry.id, help: entry.help ?? '', impact: null, failed: false, passed: false, affected_urls: [] });
    }
    return rules.get(entry.id);
  };

  for (const result of axeResults || []) {
    if (!result || result.error) continue;
    const impacts = result.rule_impacts || {};
    for (const entry of [...(result.violations || []), ...(result.incomplete || [])]) {
      if (!isBestPracticeRule(entry.tags)) continue;
      const r = get(entry);
      r.failed = true;
      r.impact = r.impact ?? entry.impact ?? impacts[entry.id] ?? null;
      if (entry.help) r.help = entry.help;
      if (!r.affected_urls.includes(result.url)) r.affected_urls.push(result.url);
    }
    for (const entry of result.passes || []) {
      if (!isBestPracticeRule(entry.tags)) continue;
      const r = get(entry);
      r.passed = true;
      r.impact = r.impact ?? impacts[entry.id] ?? null;
    }
    for (const entry of result.inapplicable || []) {
      if (!isBestPracticeRule(entry.tags)) continue;
      const r = get(entry);
      r.impact = r.impact ?? impacts[entry.id] ?? null;
    }
  }

  const list = [...rules.values()].map(({ failed, passed, ...r }) => ({
    ...r,
    weight: IMPACT_WEIGHT[r.impact] ?? DEFAULT_WEIGHT,
    status: failed ? 'mejora' : passed ? 'cumple' : 'no_aplica'
  }));

  const sumWeight = (status) => list.filter((r) => r.status === status).reduce((sum, r) => sum + r.weight, 0);
  const applicable = sumWeight('cumple') + sumWeight('mejora');
  const count = (status) => list.filter((r) => r.status === status).length;
  return {
    score: applicable === 0 ? null : Math.round((sumWeight('cumple') / applicable) * 10000) / 100,
    cumple: count('cumple'),
    mejora: count('mejora'),
    no_aplica: count('no_aplica'),
    rules: list
  };
}
