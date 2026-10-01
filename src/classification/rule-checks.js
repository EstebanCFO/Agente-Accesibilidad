import { extractWcagCriteria } from './wcag-map.js';

const BCRA_TAGS = ['wcag2a', 'wcag2aa'];
const EXTENDED_TAGS = ['wcag21a', 'wcag21aa', 'wcag22aa'];

function isWcagRule(tags, includeExtended) {
  const scope = includeExtended ? [...BCRA_TAGS, ...EXTENDED_TAGS] : BCRA_TAGS;
  return (tags || []).some((tag) => scope.includes(tag));
}

function isBestPracticeRule(tags) {
  return (tags || []).includes('best-practice') && extractWcagCriteria(tags).length === 0;
}

/**
 * Desglose de los "chequeos" de axe-core en una página: cuántas REGLAS terminaron en cada
 * resultado (falla / a revisar / aprobada / sin elementos), separando WCAG de buenas prácticas.
 * Una misma regla puede figurar en falla y en aprobada (falló en unos elementos y pasó en otros).
 * criteria_with_pass: criterios WCAG distintos con al menos una regla aprobada (reglas ≠ criterios).
 */
export function summarizeRuleChecks(axeResult, { includeExtended = false } = {}) {
  const empty = () => ({ fail: 0, review: 0, pass: 0, inapplicable: 0 });
  const wcag = empty();
  const bestPractice = empty();
  const criteria = new Set();
  const groups = [['fail', axeResult?.violations], ['review', axeResult?.incomplete], ['pass', axeResult?.passes], ['inapplicable', axeResult?.inapplicable]];
  for (const [key, entries] of groups) {
    for (const entry of entries || []) {
      if (isWcagRule(entry.tags, includeExtended)) {
        wcag[key] += 1;
        if (key === 'pass') for (const c of extractWcagCriteria(entry.tags)) criteria.add(c);
      } else if (isBestPracticeRule(entry.tags)) {
        bestPractice[key] += 1;
      }
    }
  }
  return { wcag: { ...wcag, criteria_with_pass: criteria.size }, best_practice: bestPractice };
}
