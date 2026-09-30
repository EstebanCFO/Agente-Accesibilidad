import { classifyModule } from './module-classifier.js';
import { computeWcagSection } from './wcag-section.js';
import { computeBestPractices } from './best-practices.js';

/** Solo axe-core participa (un finding sin source viene de classify-findings). */
function isAxeFinding(finding) {
  return !finding?.source || finding.source === 'axe-core';
}

function counts(criteria) {
  const n = (status) => criteria.filter((c) => c.status === status).length;
  return { total: criteria.length - n('no_aplica'), ok: n('ok'), nok: n('nok'), a_validar: n('a_validar'), no_aplica: n('no_aplica') };
}

function levelCounts(criteria, level) {
  const { total, ok, nok, a_validar: aValidar } = counts(criteria.filter((c) => c.level === level));
  return { total, ok, nok, a_validar: aValidar };
}

/**
 * compliance_scores del job (SPEC §8.1, spec 2026-09-30). Sin veredicto, umbral ni porcentaje de
 * cumplimiento: el resultado es un conteo OK / NOK / a validar / no aplica, tomado de la Sección 1
 * (computeWcagSection) — la misma fuente que la tarjeta del panel y el Score de cumplimiento.
 *   summary     - los 38 criterios de la Circular BCRA (WCAG 2.0 A+AA), total y por nivel;
 *   extended_22 - la capa WCAG 2.1/2.2 (solo con includeExtended), también como conteo;
 *   by_url / by_module - criterios con problemas confirmados por página / módulo;
 *   wcag_section / best_practices - Secciones 1 y 2 completas.
 * axeResults es opcional: sin él no se sabe qué reglas pasaron (todo queda "a validar") y
 * total_urls_evaluated se aproxima con las URLs de los hallazgos.
 */
export function calculateScore(classifiedFindings, { axeResults = [], includeExtended = false } = {}) {
  const findings = (classifiedFindings || []).filter(isAxeFinding);
  const confirmedOnti = findings.filter((f) => f.in_scope === 'onti' && (f.review_status ?? 'confirmado') === 'confirmado');
  const wcagSection = computeWcagSection(classifiedFindings, { axeResults, includeExtended });
  const onti = wcagSection.by_criterion.filter((c) => c.in_scope === 'onti');
  const extended = wcagSection.by_criterion.filter((c) => c.in_scope === 'extended_22');

  const scanned = axeResults.filter((r) => r && !r.error);
  const scannedUrls = scanned.length > 0
    ? [...new Set(scanned.map((r) => r.url))]
    : [...new Set(findings.flatMap((f) => f.affected_urls || []))];
  const axeResultByUrl = new Map(scanned.map((r) => [r.url, r]));
  const problemsIn = (urls) => new Set(confirmedOnti.filter((f) => (f.affected_urls || []).some((u) => urls.has(u))).map((f) => f.wcag_criterion)).size;

  const byUrl = scannedUrls.map((url) => {
    const axeResult = axeResultByUrl.get(url);
    return {
      url,
      module: classifyModule(url),
      criterios_con_problemas: problemsIn(new Set([url])),
      violations: axeResult?.violation_count ?? 0,
      incomplete: axeResult?.incomplete_count ?? 0
    };
  });

  const urlsByModule = new Map();
  for (const entry of byUrl) {
    if (!urlsByModule.has(entry.module)) urlsByModule.set(entry.module, []);
    urlsByModule.get(entry.module).push(entry);
  }
  const byModule = [...urlsByModule.entries()].map(([module, entries]) => ({
    module,
    url_count: entries.length,
    criterios_con_problemas: problemsIn(new Set(entries.map((e) => e.url))),
    violations: entries.reduce((sum, e) => sum + e.violations, 0),
    incomplete: entries.reduce((sum, e) => sum + e.incomplete, 0)
  }));

  const { no_aplica: _na, ...extendedCounts } = counts(extended);
  return {
    summary: {
      total_urls_evaluated: scannedUrls.length,
      ...counts(onti),
      level_a: levelCounts(onti, 'A'),
      level_aa: levelCounts(onti, 'AA')
    },
    extended_22: includeExtended ? extendedCounts : null,
    by_url: byUrl,
    by_module: byModule,
    wcag_section: wcagSection,
    best_practices: computeBestPractices(axeResults)
  };
}
