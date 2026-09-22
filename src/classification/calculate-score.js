import { ontiCriteria, extendedCriteria } from './wcag-map.js';
import { classifyModule } from './module-classifier.js';

function round2(n) {
  return Math.round(n * 100) / 100;
}

function percentage(compliant, total) {
  if (total === 0) return 0;
  return round2((compliant / total) * 100);
}

function criteriaOfLevel(level) {
  return ontiCriteria.filter((c) => c.level === level);
}

/**
 * Calcula compliance_scores (SPEC §8.1) a partir de classified_findings. axeResults es opcional
 * y solo se usa para saber qué URLs se escanearon de verdad (incluidas las que quedaron 100%
 * conformes, que no generan ningún finding) y para las cifras crudas de violations/incomplete
 * por URL; sin él, se aproxima con la unión de affected_urls de los findings.
 */
export function calculateScore(classifiedFindings, {
  axeResults = [],
  conformanceThreshold = 30,
  includeExtended = false
} = {}) {
  const findings = classifiedFindings || [];
  const ontiFindings = findings.filter((f) => f.in_scope === 'onti');
  const extendedFindings = findings.filter((f) => f.in_scope === 'extended_22');

  const violatedOntiCriteria = new Set(ontiFindings.map((f) => f.wcag_criterion));
  const ontiCriteriaCompliant = ontiCriteria.length - violatedOntiCriteria.size;

  const scoreForLevel = (level) => {
    const criteria = criteriaOfLevel(level);
    const compliant = criteria.filter((c) => !violatedOntiCriteria.has(c.wcag_criterion)).length;
    return percentage(compliant, criteria.length);
  };

  const scannedUrls = axeResults.length > 0
    ? [...new Set(axeResults.filter((r) => r && !r.error).map((r) => r.url))]
    : [...new Set(findings.flatMap((f) => f.affected_urls || []))];

  const axeResultByUrl = new Map(axeResults.filter((r) => r && !r.error).map((r) => [r.url, r]));

  const byUrl = scannedUrls.map((url) => {
    const axeResult = axeResultByUrl.get(url);
    const violatedForUrl = new Set(
      ontiFindings.filter((f) => (f.affected_urls || []).includes(url)).map((f) => f.wcag_criterion)
    );
    const compliantForUrl = ontiCriteria.length - violatedForUrl.size;
    return {
      url,
      module: classifyModule(url),
      onti_compliance_percentage: percentage(compliantForUrl, ontiCriteria.length),
      violations: axeResult?.violation_count ?? 0,
      incomplete: axeResult?.incomplete_count ?? 0
    };
  });

  const urlsByModule = new Map();
  for (const entry of byUrl) {
    if (!urlsByModule.has(entry.module)) urlsByModule.set(entry.module, []);
    urlsByModule.get(entry.module).push(entry);
  }

  const byModule = [...urlsByModule.entries()].map(([module, entries]) => {
    const moduleUrls = new Set(entries.map((e) => e.url));
    const violatedForModule = new Set(
      ontiFindings
        .filter((f) => (f.affected_urls || []).some((url) => moduleUrls.has(url)))
        .map((f) => f.wcag_criterion)
    );
    const compliantForModule = ontiCriteria.length - violatedForModule.size;
    return {
      module,
      url_count: entries.length,
      onti_compliance_percentage: percentage(compliantForModule, ontiCriteria.length),
      violations: entries.reduce((sum, e) => sum + e.violations, 0),
      incomplete: entries.reduce((sum, e) => sum + e.incomplete, 0)
    };
  });

  let extended22 = null;
  if (includeExtended) {
    const violatedExtended = new Set(extendedFindings.map((f) => f.wcag_criterion));
    const compliant = extendedCriteria.length - violatedExtended.size;
    extended22 = {
      criteria_evaluated: extendedCriteria.length,
      criteria_compliant: compliant,
      compliance_percentage: percentage(compliant, extendedCriteria.length),
      by_criterion: extendedCriteria.map((c) => ({
        wcag_criterion: c.wcag_criterion,
        level: c.level,
        source: c.source,
        description: c.description,
        compliant: !violatedExtended.has(c.wcag_criterion)
      }))
    };
  }

  return {
    summary: {
      total_urls_evaluated: scannedUrls.length,
      onti_criteria_evaluated: ontiCriteria.length,
      onti_criteria_compliant: ontiCriteriaCompliant,
      onti_compliance_percentage: percentage(ontiCriteriaCompliant, ontiCriteria.length),
      onti_conformance: ontiCriteriaCompliant >= conformanceThreshold,
      conformance_threshold: conformanceThreshold,
      score_level_a: scoreForLevel('A'),
      score_level_aa: scoreForLevel('AA')
    },
    extended_22: extended22,
    by_url: byUrl,
    by_module: byModule
  };
}
