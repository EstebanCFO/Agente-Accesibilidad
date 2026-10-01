import { readFileSync } from 'node:fs';
import { ontiCriteria, extendedCriteria } from '../classification/wcag-map.js';
import { computeWcagSection } from '../classification/wcag-section.js';

/**
 * Informe de Conformidad de Accesibilidad basado en VPAT® 2.5, edición WCAG (ITI).
 * El estado de cada criterio sale de computeWcagSection (misma fuente que el panel y el resto de
 * los informes): el VPAT nunca contradice al consolidado. Documento en español con los niveles de
 * conformidad en los términos oficiales en inglés; "a validar" se informa "Not Evaluated (to validate)".
 */

const AAA_CRITERIA = JSON.parse(readFileSync(new URL('../classification/wcag-aaa-criteria.json', import.meta.url), 'utf8'));

export const CONFORMANCE = {
  supports: 'Supports',
  partial: 'Partially Supports',
  doesNot: 'Does Not Support',
  na: 'Not Applicable',
  notEvaluated: 'Not Evaluated',
  toValidate: 'Not Evaluated (to validate)'
};

const VERSION_LABEL = { wcag20: 'WCAG 2.0', wcag21: 'WCAG 2.1', wcag22: 'WCAG 2.2' };
const OUT_OF_SCOPE = 'Fuera del alcance de la evaluación (norma A+AA)';
const PARSING_NOTE = 'Obsoleto en WCAG 2.2; se considera satisfecho';

const VERSION_OF = new Map([
  ...ontiCriteria.map((c) => [c.wcag_criterion, 'wcag20']),
  ...extendedCriteria.map((c) => [c.wcag_criterion, c.source])
]);

/** Mismo filtro que la Sección 1: solo violaciones confirmadas de axe-core. */
function isConfirmedAxe(finding) {
  return (!finding?.source || finding.source === 'axe-core') && (finding.review_status ?? 'confirmado') === 'confirmado';
}

function compareCriteria(a, b) {
  const pa = a.split('.').map(Number);
  const pb = b.split('.').map(Number);
  for (let i = 0; i < 3; i++) if (pa[i] !== pb[i]) return pa[i] - pb[i];
  return 0;
}

function nokRow(affected, scanned, rules) {
  const ruleList = rules.length ? `: ${rules.join(', ')}` : '';
  if (affected === 0) {
    return { conformance: CONFORMANCE.doesNot, remarks: `Problemas confirmados por las reglas automáticas${ruleList}` };
  }
  const total = Math.max(scanned, affected);
  return {
    conformance: affected < total ? CONFORMANCE.partial : CONFORMANCE.doesNot,
    remarks: `Problemas en ${affected} de ${total} ${total === 1 ? 'página' : 'páginas'}${ruleList}`
  };
}

/** Filas de las Tablas 1 (A), 2 (AA) y 3 (AAA) del VPAT. */
export function buildVpatRows({ findings = [], axeResults = [], includeExtended = false } = {}) {
  const section = computeWcagSection(findings, { axeResults, includeExtended });
  const scanned = (axeResults || []).filter((r) => r && !r.error).length;

  const pagesBy = new Map();
  const rulesBy = new Map();
  for (const f of (findings || []).filter(isConfirmedAxe)) {
    const id = f.wcag_criterion;
    if (!pagesBy.has(id)) { pagesBy.set(id, new Set()); rulesBy.set(id, new Set()); }
    for (const url of f.affected_urls || []) pagesBy.get(id).add(url);
    if (f.rule_id) rulesBy.get(id).add(f.rule_id);
  }

  const rows = { A: [], AA: [], AAA: [] };
  for (const c of section.by_criterion) {
    const id = c.wcag_criterion;
    let result;
    if (c.status === 'ok') result = { conformance: CONFORMANCE.supports, remarks: c.reason.text };
    else if (c.status === 'nok') result = nokRow(pagesBy.get(id)?.size ?? 0, scanned, [...(rulesBy.get(id) ?? [])]);
    else if (c.status === 'no_aplica') result = { conformance: CONFORMANCE.na, remarks: c.reason.text };
    else result = { conformance: CONFORMANCE.toValidate, remarks: c.reason.text };
    if (id === '4.1.1' && includeExtended) result.remarks = `${result.remarks}. ${PARSING_NOTE}`;
    rows[c.level].push({
      criterion: id, description: c.description, version: VERSION_LABEL[VERSION_OF.get(id)] ?? 'WCAG 2.0', ...result
    });
  }
  for (const c of AAA_CRITERIA) {
    if (!includeExtended && c.source !== 'wcag20') continue;
    rows.AAA.push({
      criterion: c.wcag_criterion, description: c.description, version: VERSION_LABEL[c.source],
      conformance: CONFORMANCE.notEvaluated, remarks: OUT_OF_SCOPE
    });
  }
  for (const level of Object.keys(rows)) rows[level].sort((a, b) => compareCriteria(a.criterion, b.criterion));
  return rows;
}
