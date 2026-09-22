import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

const ONTI_38 = JSON.parse(readFileSync(path.join(__dirname, 'onti-38-criteria.json'), 'utf8'));
const EXTENDED_22 = JSON.parse(readFileSync(path.join(__dirname, 'wcag-extended-22.json'), 'utf8'));

const ONTI_BY_CRITERION = new Map(ONTI_38.map((entry) => [entry.wcag_criterion, entry]));
const EXTENDED_BY_CRITERION = new Map(EXTENDED_22.map((entry) => [entry.wcag_criterion, entry]));

export const ontiCriteria = ONTI_38;
export const extendedCriteria = EXTENDED_22;

const WCAG_TAG_PATTERN = /^wcag(\d)(\d)(\d+)$/;

/**
 * axe-core codifica cada criterio de éxito como un tag "wcagXYZ" (p.ej. "wcag143" = SC 1.4.3),
 * distinto de los tags de nivel ("wcag2a", "wcag21aa", etc.) que no llevan sufijo puramente numérico.
 */
export function extractWcagCriteria(tags) {
  if (!Array.isArray(tags)) return [];
  const criteria = [];
  for (const tag of tags) {
    const match = WCAG_TAG_PATTERN.exec(tag);
    if (match) criteria.push(`${match[1]}.${match[2]}.${match[3]}`);
  }
  return criteria;
}

export function lookupOntiCriterion(wcagCriterion) {
  return ONTI_BY_CRITERION.get(wcagCriterion) ?? null;
}

export function lookupExtendedCriterion(wcagCriterion) {
  return EXTENDED_BY_CRITERION.get(wcagCriterion) ?? null;
}

/**
 * Clasifica un hallazgo de axe-core (por sus tags) contra el marco normativo (decisiones D6/D7):
 * - "onti": cae dentro de los 38 criterios ONTI Disp. 6/2019 → siempre cuenta para el compliance.
 * - "extended_22": cae en la capa extendida WCAG 2.1/2.2 → solo cuenta si includeExtended=true.
 * - "out_of_scope": sin tag de criterio WCAG (best-practice) o criterio fuera de ambas tablas (p.ej. AAA).
 *
 * Un mismo hallazgo puede tocar varios criterios ONTI/extendidos a la vez (p.ej. link-name → 2.4.4 y 4.1.2).
 */
export function classifyByWcagTags(tags, { includeExtended = false } = {}) {
  const criteriaFound = extractWcagCriteria(tags);
  const ontiMatches = [];
  const extendedMatches = [];

  for (const criterion of criteriaFound) {
    const ontiEntry = lookupOntiCriterion(criterion);
    if (ontiEntry) {
      ontiMatches.push(ontiEntry);
      continue;
    }
    const extendedEntry = lookupExtendedCriterion(criterion);
    if (extendedEntry) extendedMatches.push(extendedEntry);
  }

  if (ontiMatches.length > 0) {
    return { scope: 'onti', onti_criteria: ontiMatches, extended_criteria: [] };
  }
  if (includeExtended && extendedMatches.length > 0) {
    return { scope: 'extended_22', onti_criteria: [], extended_criteria: extendedMatches };
  }
  return { scope: 'out_of_scope', onti_criteria: [], extended_criteria: [] };
}
