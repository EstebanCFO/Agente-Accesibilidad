import { ontiCriteria, extendedCriteria, extractWcagCriteria } from './wcag-map.js';
import { computeNaCriteria } from './na-criteria.js';
import { hasAutomatedRules, manualReviewFor, manualReviewLabel } from './manual-review.js';

/** Solo axe-core participa de la Sección 1 (un finding sin source viene de classify-findings). */
function isAxeFinding(finding) {
  return !finding?.source || finding.source === 'axe-core';
}

function paginas(n) {
  return n === 1 ? '1 página' : `${n} páginas`;
}

function evaluadas(n) {
  return n === 1 ? 'en la página evaluada' : `en las ${n} páginas evaluadas`;
}

/** Motivo legible del estado de un criterio (se muestra igual en el panel y en los informes). */
function reasonFor(status, id, { pagesAffected, pagesScanned, incomplete }) {
  if (status === 'ok') return { code: 'verificado', text: 'Verificado automáticamente, sin problemas' };
  if (status === 'nok') return { code: 'con_problemas', text: `Problemas en ${paginas(pagesAffected)}` };
  if (status === 'no_aplica') return { code: 'sin_multimedia', text: `No se encontró audio ni video ${evaluadas(pagesScanned)}` };
  if (incomplete) return { code: 'indeterminado', text: 'El agente no pudo determinarlo automáticamente' };
  if (!hasAutomatedRules(id)) {
    return { code: manualReviewFor(id).assistive ? 'requiere_asistiva' : 'requiere_manual', text: manualReviewLabel(id) };
  }
  return { code: 'sin_elementos', text: `Sin elementos evaluables: las reglas automáticas no encontraron elementos a revisar ${evaluadas(pagesScanned)}` };
}

/**
 * Sección 1 del informe (Compliance WCAG). Estado por criterio, consolidado entre páginas:
 *   nok       - al menos una violación confirmada de axe-core;
 *   a_validar - algún incomplete sin violación, o ninguna regla automática evaluada (requiere
 *               tecnología asistiva o revisión manual). Nunca cuenta como OK;
 *   no_aplica - regla de na-criteria.js (solo inapplicable), sale del total;
 *   ok        - al menos una regla del criterio pasó y no hubo violación ni incomplete.
 * Sin veredicto ni porcentaje: el cumplimiento se decide después de la validación humana.
 * Los hallazgos complementarios (revisión del Agente) no cambian estados.
 */
export function computeWcagSection(findings, { axeResults = [], includeExtended = false } = {}) {
  const axeFindings = (findings || []).filter(isAxeFinding);
  const isConfirmed = (f) => (f.review_status ?? 'confirmado') === 'confirmado';
  const confirmed = new Set(axeFindings.filter(isConfirmed).map((f) => f.wcag_criterion));
  const toReview = new Set(axeFindings.filter((f) => f.review_status === 'requiere_revision').map((f) => f.wcag_criterion));

  const pagesByCriterion = new Map();
  for (const f of axeFindings.filter(isConfirmed)) {
    if (!pagesByCriterion.has(f.wcag_criterion)) pagesByCriterion.set(f.wcag_criterion, new Set());
    for (const url of f.affected_urls || []) pagesByCriterion.get(f.wcag_criterion).add(url);
  }

  const scanned = (axeResults || []).filter((r) => r && !r.error);
  const passed = new Set();
  for (const result of scanned) {
    for (const entry of result.passes || []) {
      for (const criterion of extractWcagCriteria(entry.tags)) passed.add(criterion);
    }
  }
  const naSet = new Set(computeNaCriteria(axeResults, { includeExtended }));

  const inScope = [
    ...ontiCriteria.map((c) => ({ ...c, in_scope: 'onti' })),
    ...(includeExtended ? extendedCriteria.map((c) => ({ ...c, in_scope: 'extended_22' })) : [])
  ];

  const byCriterion = inScope.map((c) => {
    const id = c.wcag_criterion;
    let status;
    if (confirmed.has(id)) status = 'nok';
    else if (toReview.has(id)) status = 'a_validar';
    else if (naSet.has(id)) status = 'no_aplica';
    else if (passed.has(id)) status = 'ok';
    else status = 'a_validar';
    const reason = reasonFor(status, id, {
      pagesAffected: pagesByCriterion.get(id)?.size ?? 0, pagesScanned: scanned.length, incomplete: toReview.has(id)
    });
    return { wcag_criterion: id, level: c.level, description: c.description, in_scope: c.in_scope, status, reason };
  });

  const count = (status) => byCriterion.filter((c) => c.status === status).length;
  const noAplica = count('no_aplica');
  return {
    total: byCriterion.length - noAplica,
    ok: count('ok'),
    nok: count('nok'),
    a_validar: count('a_validar'),
    no_aplica: noAplica,
    by_criterion: byCriterion
  };
}
