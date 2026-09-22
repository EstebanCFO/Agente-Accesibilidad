import { randomUUID } from 'node:crypto';
import { classifyByWcagTags } from './wcag-map.js';

const SEVERITY_RANK = { critical: 4, serious: 3, moderate: 2, minor: 1 };

function worseSeverity(a, b) {
  return (SEVERITY_RANK[b] ?? 0) > (SEVERITY_RANK[a] ?? 0) ? b : a;
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

function createFinding(violation, criterion, inScope) {
  const firstNode = violation.nodes[0];
  return {
    id: randomUUID(),
    source: 'axe-core',
    wcag_criterion: criterion.wcag_criterion,
    wcag_level: criterion.level,
    wcag_description: criterion.description,
    onti_criterion: inScope === 'onti',
    in_scope: inScope,
    severity: violation.impact || 'minor',
    rule_id: violation.id,
    affected_urls: [],
    occurrences: 0,
    element_sample: firstNode?.html ?? null,
    failure_summary: firstNode?.failure_summary ?? violation.help,
    remediation_hint: violation.help
  };
}

/**
 * Deduplica y agrupa los axe_results[] de scan_url/scan_batch por (criterio WCAG, rule_id),
 * asignando severidad, y descarta lo que quede out_of_scope (decisión D7).
 *
 * Un mismo rule_id puede tocar más de un criterio a la vez (ej. link-name → 2.4.4 y 4.1.2):
 * cada criterio matcheado genera su propia fila, agregada por separado.
 */
export function classifyFindings(axeResults, { includeExtended = false } = {}) {
  const findingsByKey = new Map();

  for (const axeResult of axeResults || []) {
    if (!axeResult || axeResult.error || !Array.isArray(axeResult.violations)) continue;

    for (const violation of axeResult.violations) {
      const classification = classifyByWcagTags(violation.tags, { includeExtended });

      for (const { criterion, in_scope: inScope } of matchedCriteria(classification)) {
        const key = findingKey(criterion.wcag_criterion, violation.id);
        if (!findingsByKey.has(key)) {
          findingsByKey.set(key, createFinding(violation, criterion, inScope));
        }

        const finding = findingsByKey.get(key);
        if (!finding.affected_urls.includes(axeResult.url)) {
          finding.affected_urls.push(axeResult.url);
        }
        finding.occurrences += violation.node_count;
        finding.severity = worseSeverity(finding.severity, violation.impact || 'minor');
      }
    }
  }

  const findings = [...findingsByKey.values()];
  return { total_findings: findings.length, findings };
}
