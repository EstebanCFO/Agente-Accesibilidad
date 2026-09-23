import { ontiCriteria, extendedCriteria } from './wcag-map.js';
import { classifyModule } from './module-classifier.js';
import { computeNaCriteria } from './na-criteria.js';

function round2(n) {
  return Math.round(n * 100) / 100;
}

function percentage(compliant, total) {
  if (total === 0) return 0;
  return round2((compliant / total) * 100);
}

/**
 * Calcula compliance_scores (SPEC §8.1) a partir de classified_findings. axeResults es opcional
 * y se usa para: (1) saber qué URLs se escanearon de verdad (incluidas las 100% conformes, que
 * no generan ningún finding), (2) las cifras crudas de violations/incomplete por URL, y (3)
 * determinar qué criterios ONTI son N/A (computeNaCriteria) - sin él, no hay forma de saber que
 * un criterio nunca tuvo contenido aplicable en ningún lado.
 */
export function calculateScore(classifiedFindings, {
  axeResults = [],
  conformanceThreshold = 30,
  includeExtended = false
} = {}) {
  const findings = classifiedFindings || [];
  const ontiFindings = findings.filter((f) => f.in_scope === 'onti');
  const extendedFindings = findings.filter((f) => f.in_scope === 'extended_22');

  // Los criterios N/A del cuerpo ONTI se calculan siempre con includeExtended:false - la capa
  // extendida no tiene umbral regulatorio propio, no recibe este ajuste de denominador.
  const naOntiCriteria = computeNaCriteria(axeResults, { includeExtended: false });
  const naSet = new Set(naOntiCriteria);
  const evaluatedOntiCriteria = ontiCriteria.filter((c) => !naSet.has(c.wcag_criterion));

  const violatedOntiCriteria = new Set(ontiFindings.map((f) => f.wcag_criterion));
  const ontiCriteriaCompliant = evaluatedOntiCriteria.length - violatedOntiCriteria.size;

  const scoreForLevel = (level) => {
    const criteria = evaluatedOntiCriteria.filter((c) => c.level === level);
    const compliant = criteria.filter((c) => !violatedOntiCriteria.has(c.wcag_criterion)).length;
    return percentage(compliant, criteria.length);
  };

  const effectiveConformanceThreshold = evaluatedOntiCriteria.length === ontiCriteria.length
    ? conformanceThreshold
    : Math.round((conformanceThreshold / ontiCriteria.length) * evaluatedOntiCriteria.length);

  const scannedUrls = axeResults.length > 0
    ? [...new Set(axeResults.filter((r) => r && !r.error).map((r) => r.url))]
    : [...new Set(findings.flatMap((f) => f.affected_urls || []))];

  const axeResultByUrl = new Map(axeResults.filter((r) => r && !r.error).map((r) => [r.url, r]));

  const byUrl = scannedUrls.map((url) => {
    const axeResult = axeResultByUrl.get(url);
    const violatedForUrl = new Set(
      ontiFindings.filter((f) => (f.affected_urls || []).includes(url)).map((f) => f.wcag_criterion)
    );
    const compliantForUrl = evaluatedOntiCriteria.length - violatedForUrl.size;
    return {
      url,
      module: classifyModule(url),
      onti_compliance_percentage: percentage(compliantForUrl, evaluatedOntiCriteria.length),
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
    const compliantForModule = evaluatedOntiCriteria.length - violatedForModule.size;
    return {
      module,
      url_count: entries.length,
      onti_compliance_percentage: percentage(compliantForModule, evaluatedOntiCriteria.length),
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
      onti_criteria_evaluated: evaluatedOntiCriteria.length,
      onti_criteria_na: naSet.size,
      onti_criteria_compliant: ontiCriteriaCompliant,
      onti_compliance_percentage: percentage(ontiCriteriaCompliant, evaluatedOntiCriteria.length),
      onti_conformance: ontiCriteriaCompliant >= effectiveConformanceThreshold,
      conformance_threshold: conformanceThreshold,
      effective_conformance_threshold: effectiveConformanceThreshold,
      score_level_a: scoreForLevel('A'),
      score_level_aa: scoreForLevel('AA')
    },
    extended_22: extended22,
    by_url: byUrl,
    by_module: byModule
  };
}
