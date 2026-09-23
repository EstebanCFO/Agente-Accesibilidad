import { ontiCriteria, extendedCriteria, extractWcagCriteria } from './wcag-map.js';

/**
 * Determina qué criterios ONTI (+ extendidos si includeExtended) son N/A para el canal
 * completo: un criterio es N/A solo si TODAS las reglas de axe-core que lo tocan resultaron
 * "inapplicable" en TODAS las URLs donde aparecieron - nunca generaron ni una violación, ni
 * un pase, ni un incomplete en ningún lado. Si axe-core no tiene ninguna regla conocida para
 * ese criterio (nunca aparece en ninguna de las 4 categorías, en ninguna URL), NO se marca
 * N/A - se deja como limitación de cobertura ya documentada (ver docs/superpowers/specs/
 * 2026-09-22-incomplete-inapplicable-design.md), no se inventa una respuesta.
 */
export function computeNaCriteria(axeResults, { includeExtended = false } = {}) {
  const ruleTagsById = new Map();
  const ruleIdsEverApplicable = new Set();

  for (const result of axeResults || []) {
    if (!result || result.error) continue;

    for (const entry of result.violations || []) {
      ruleTagsById.set(entry.id, entry.tags);
      ruleIdsEverApplicable.add(entry.id);
    }
    for (const entry of result.incomplete || []) {
      ruleTagsById.set(entry.id, entry.tags);
      ruleIdsEverApplicable.add(entry.id);
    }
    for (const entry of result.passes || []) {
      ruleTagsById.set(entry.id, entry.tags);
      ruleIdsEverApplicable.add(entry.id);
    }
    for (const entry of result.inapplicable || []) {
      if (!ruleTagsById.has(entry.id)) ruleTagsById.set(entry.id, entry.tags);
    }
  }

  const criteria = includeExtended ? [...ontiCriteria, ...extendedCriteria] : ontiCriteria;
  const naCriteria = [];

  for (const criterion of criteria) {
    const rulesForCriterion = [...ruleTagsById.entries()]
      .filter(([, tags]) => extractWcagCriteria(tags).includes(criterion.wcag_criterion))
      .map(([ruleId]) => ruleId);

    if (rulesForCriterion.length > 0 && rulesForCriterion.every((ruleId) => !ruleIdsEverApplicable.has(ruleId))) {
      naCriteria.push(criterion.wcag_criterion);
    }
  }

  return naCriteria;
}
