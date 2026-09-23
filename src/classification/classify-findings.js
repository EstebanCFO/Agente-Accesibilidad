import { randomUUID } from 'node:crypto';
import { classifyByWcagTags } from './wcag-map.js';

const SEVERITY_RANK = { critical: 4, serious: 3, moderate: 2, minor: 1 };
const REVIEW_STATUS_RANK = { confirmado: 2, requiere_revision: 1 };

function worseSeverity(a, b) {
  return (SEVERITY_RANK[b] ?? 0) > (SEVERITY_RANK[a] ?? 0) ? b : a;
}

function worseReviewStatus(a, b) {
  return (REVIEW_STATUS_RANK[b] ?? 0) > (REVIEW_STATUS_RANK[a] ?? 0) ? b : a;
}

function matchedCriteria(classification) {
  return [
    ...classification.onti_criteria.map((criterion) => ({ criterion, in_scope: 'onti' })),
    ...classification.extended_criteria.map((criterion) => ({ criterion, in_scope: 'extended_22' }))
  ];
}

function findingKey(wcagCriterion, ruleId) {
  return `${wcagCriterion}::${ruleId}`;
}

function createFinding(entry, criterion, inScope, reviewStatus) {
  const firstNode = entry.nodes[0];
  return {
    id: randomUUID(),
    source: 'axe-core',
    wcag_criterion: criterion.wcag_criterion,
    wcag_level: criterion.level,
    wcag_description: criterion.description,
    onti_criterion: inScope === 'onti',
    in_scope: inScope,
    severity: entry.impact || 'minor',
    review_status: reviewStatus,
    rule_id: entry.id,
    affected_urls: [],
    occurrences: 0,
    element_sample: firstNode?.html ?? null,
    failure_summary: firstNode?.failure_summary ?? entry.help,
    remediation_hint: entry.help
  };
}

function processEntries(entries, axeResult, reviewStatus, includeExtended, findingsByKey) {
  for (const entry of entries || []) {
    const classification = classifyByWcagTags(entry.tags, { includeExtended });

    for (const { criterion, in_scope: inScope } of matchedCriteria(classification)) {
      const key = findingKey(criterion.wcag_criterion, entry.id);
      if (!findingsByKey.has(key)) {
        findingsByKey.set(key, createFinding(entry, criterion, inScope, reviewStatus));
      }

      const finding = findingsByKey.get(key);
      if (!finding.affected_urls.includes(axeResult.url)) {
        finding.affected_urls.push(axeResult.url);
      }
      finding.occurrences += entry.node_count;
      finding.severity = worseSeverity(finding.severity, entry.impact || 'minor');
      finding.review_status = worseReviewStatus(finding.review_status, reviewStatus);
    }
  }
}

/**
 * Deduplica y agrupa los axe_results[] de scan_url/scan_batch por (criterio WCAG, rule_id),
 * asignando severidad, y descarta lo que quede out_of_scope (decisión D7).
 *
 * Un mismo rule_id puede tocar más de un criterio a la vez (ej. link-name → 2.4.4 y 4.1.2):
 * cada criterio matcheado genera su propia fila, agregada por separado.
 *
 * Procesa tanto violations[] (review_status:'confirmado' - axe-core está seguro de que falla)
 * como incomplete[] (review_status:'requiere_revision' - axe-core no pudo determinar solo).
 * Si el mismo (criterio, rule_id) aparece confirmado en una URL e incompleto en otra, gana el
 * peor caso ('confirmado'), mismo patrón que ya usa worseSeverity.
 */
export function classifyFindings(axeResults, { includeExtended = false } = {}) {
  const findingsByKey = new Map();

  for (const axeResult of axeResults || []) {
    if (!axeResult || axeResult.error) continue;
    processEntries(axeResult.violations, axeResult, 'confirmado', includeExtended, findingsByKey);
    processEntries(axeResult.incomplete, axeResult, 'requiere_revision', includeExtended, findingsByKey);
  }

  const findings = [...findingsByKey.values()];
  return { total_findings: findings.length, findings };
}
