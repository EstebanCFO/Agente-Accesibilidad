import { readFileSync } from 'node:fs';
import { ontiCriteria, extendedCriteria } from '../classification/wcag-map.js';
import { computeWcagSection } from '../classification/wcag-section.js';
import { DS_CSS } from './design-system.js';

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

const CHANNEL_LABEL = {
  home_banking: 'Home Banking (web)',
  app_ios: 'App iOS (vista móvil)',
  app_android: 'App Android (vista móvil)'
};
const DEFAULT_CONTACT = 'CFOTech IT Global Services';

function text(value) {
  return typeof value === 'string' && value.trim() ? value.trim() : null;
}

/** Nombre por defecto: dominio para http(s); para carpeta local o file:, el último segmento. */
function defaultProductName(target) {
  const raw = String(target ?? '').trim();
  try {
    const url = new URL(raw);
    if (url.protocol === 'http:' || url.protocol === 'https:') return url.hostname;
    if (url.protocol === 'file:') {
      const last = decodeURIComponent(url.pathname).split('/').filter(Boolean).pop();
      if (last) return last;
    }
  } catch {
    // no es URL: path de carpeta local
  }
  // "C:\..." también parsea como URL con protocolo "c:": cae acá igual que un path sin protocolo.
  return raw.split(/[\\/]/).filter(Boolean).pop() || 'Sitio auditado';
}

/** Datos del producto del VPAT: lo cargado en config.vpat o, si falta, valores por defecto. */
export function resolveVpatInfo(vpat, { target, channel, date }) {
  const v = vpat && typeof vpat === 'object' ? vpat : {};
  return {
    productName: text(v.product_name) ?? defaultProductName(target),
    productVersion: text(v.product_version) ?? `Evaluado el ${date.toLocaleDateString('es-AR')}`,
    description: text(v.description) ?? `${CHANNEL_LABEL[channel] ?? channel ?? 'Sitio web'} — ${String(target ?? '').trim()}`,
    contact: text(v.contact) ?? DEFAULT_CONTACT
  };
}

function escapeHtml(value) {
  return String(value ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
}

const TERMS = [
  [CONFORMANCE.supports, 'La funcionalidad cumple el criterio sin defectos conocidos.'],
  [CONFORMANCE.partial, 'Parte de la funcionalidad no cumple el criterio. En este informe: se detectaron problemas en algunas de las páginas evaluadas.'],
  [CONFORMANCE.doesNot, 'La mayor parte de la funcionalidad no cumple el criterio. En este informe: se detectaron problemas en todas las páginas evaluadas.'],
  [CONFORMANCE.na, 'El criterio no es relevante para el producto.'],
  [CONFORMANCE.notEvaluated, 'El producto no se evaluó contra el criterio. Solo se usa para el nivel AAA.'],
  [CONFORMANCE.toValidate, 'El agente no pudo verificarlo automáticamente y requiere validación humana. No implica cumplimiento.']
];

const CONFORMANCE_CLASS = {
  [CONFORMANCE.supports]: 'c-ok',
  [CONFORMANCE.partial]: 'c-partial',
  [CONFORMANCE.doesNot]: 'c-nok',
  [CONFORMANCE.na]: 'c-na',
  [CONFORMANCE.notEvaluated]: 'c-na',
  [CONFORMANCE.toValidate]: 'c-validate'
};

const VPAT_CSS = `
  @page { size: A4; margin: 16mm 12mm 18mm; }
  * { -webkit-print-color-adjust: exact; print-color-adjust: exact; }
  body { background: #fff; font-size: 11px; }
  main { padding: 0; }
  .vpat-band { background: var(--navy-dark); color: #fff; border-radius: 12px; padding: 22px 26px; margin-bottom: 18px; }
  .vpat-band h1 { color: #fff; font-size: 22px; margin: 10px 0 4px; }
  .vpat-band p { color: rgba(255,255,255,.75); margin: 0; font-size: 12px; }
  .vpat-brand { display: flex; align-items: center; gap: 10px; }
  .vpat-brand b { font-size: 13px; } .vpat-brand span { color: var(--green-a); font-size: 11px; font-weight: 700; display: block; }
  h2 { font-size: 14px; color: var(--navy); border-bottom: 2px solid var(--navy); padding-bottom: 4px; margin: 20px 0 10px; break-after: avoid; }
  table { width: 100%; border-collapse: collapse; table-layout: fixed; }
  th, td { border: 1px solid var(--border); padding: 5px 6px; text-align: left; vertical-align: top; overflow-wrap: anywhere; }
  th { background: var(--gray2); font-weight: 700; }
  thead { display: table-header-group; }
  tr { break-inside: avoid; }
  table.info td:first-child, table.std td:first-child, table.terms td:first-child { width: 30%; font-weight: 600; color: var(--text2); }
  table.sc th:nth-child(1) { width: 34%; } table.sc th:nth-child(2) { width: 20%; }
  .ver { color: var(--text2); font-size: 9.5px; }
  .c-ok { color: var(--green-text); font-weight: 700; }
  .c-partial { color: var(--orange-text); font-weight: 700; }
  .c-nok { color: var(--red-text); font-weight: 700; }
  .c-validate { color: var(--text); font-weight: 700; }
  .c-na { color: var(--text2); }
  .table-section { break-before: page; }
`;

const LOGO = '<svg width="32" height="32" viewBox="0 0 32 32" role="img" aria-label="Logo CFOTech"><rect width="32" height="32" rx="8" fill="#00A878"/><text x="16" y="20" text-anchor="middle" fill="#fff" font-family="Segoe UI, system-ui, sans-serif" font-size="11" font-weight="700">CFO</text></svg>';

function criteriaTable(number, level, rows) {
  const body = rows.map((r) => `<tr>
      <td><strong>${escapeHtml(r.criterion)}</strong> ${escapeHtml(r.description)} <span class="ver">(Nivel ${level} · ${escapeHtml(r.version)})</span></td>
      <td class="${CONFORMANCE_CLASS[r.conformance] ?? ''}">${escapeHtml(r.conformance)}</td>
      <td>${escapeHtml(r.remarks)}</td>
    </tr>`).join('\n');
  return `<section class="table-section">
    <h2>Tabla ${number}: Criterios de conformidad, Nivel ${level}</h2>
    <table class="sc">
      <thead><tr><th>Criterio</th><th>Nivel de conformidad</th><th>Observaciones y explicaciones</th></tr></thead>
      <tbody>${body}</tbody>
    </table>
  </section>`;
}

/** HTML imprimible del VPAT (lo pasa a PDF el builder "vpat" de generate-deliverable). */
export function buildVpatHtml({ jobId, channel, info, rows, includeExtended, date, pagesEvaluated, keyboardRan }) {
  const paginas = `${pagesEvaluated} ${pagesEvaluated === 1 ? 'página evaluada' : 'páginas evaluadas'}`;
  const methods = `Análisis automático con axe-core sobre Playwright (Chromium) en ${paginas}, canal ${CHANNEL_LABEL[channel] ?? channel ?? '—'}`
    + `${keyboardRan ? '; pruebas de teclado del Agente (recorrido con Tab)' : ''}.`
    + ' Los criterios informados como "Not Evaluated (to validate)" requieren validación humana.';
  const extended = includeExtended ? 'Sí — Nivel A: Sí · Nivel AA: Sí · Nivel AAA: Sí (Not Evaluated)' : 'No';

  return `<!doctype html>
<html lang="es">
<head>
<meta charset="utf-8">
<title>Informe de Conformidad de Accesibilidad (VPAT) — ${escapeHtml(info.productName)}</title>
<style>${DS_CSS}
${VPAT_CSS}
</style>
</head>
<body>
<main>
  <div class="vpat-band">
    <div class="vpat-brand">${LOGO}<div><b>CFOTech</b><span>Agente F1 · Compliance de Accesibilidad</span></div></div>
    <h1>Informe de Conformidad de Accesibilidad — Edición WCAG</h1>
    <p>Basado en VPAT® 2.5 (ITI) · ${escapeHtml(info.productName)}</p>
  </div>

  <h2>Datos del producto</h2>
  <table class="info">
    <tr><td>Nombre del producto / versión</td><td>${escapeHtml(info.productName)} — ${escapeHtml(info.productVersion)}</td></tr>
    <tr><td>Fecha del informe</td><td>${escapeHtml(date.toLocaleDateString('es-AR'))}</td></tr>
    <tr><td>Descripción del producto</td><td>${escapeHtml(info.description)}</td></tr>
    <tr><td>Contacto</td><td>${escapeHtml(info.contact)}</td></tr>
    <tr><td>Notas</td><td>Generado por el Agente F1 de CFOTech. Job ${escapeHtml(jobId)}.</td></tr>
    <tr><td>Métodos de evaluación utilizados</td><td>${escapeHtml(methods)}</td></tr>
  </table>

  <h2>Estándares aplicables</h2>
  <table class="std">
    <thead><tr><th>Estándar / guía</th><th>Incluido en el informe</th></tr></thead>
    <tbody>
      <tr><td>WCAG 2.0</td><td>Sí — Nivel A: Sí · Nivel AA: Sí · Nivel AAA: Sí (Not Evaluated)</td></tr>
      <tr><td>WCAG 2.1</td><td>${extended}</td></tr>
      <tr><td>WCAG 2.2</td><td>${extended}</td></tr>
    </tbody>
  </table>

  <h2>Términos</h2>
  <table class="terms">
    <thead><tr><th>Nivel de conformidad</th><th>Significado</th></tr></thead>
    <tbody>${TERMS.map(([term, meaning]) => `<tr><td class="${CONFORMANCE_CLASS[term]}">${escapeHtml(term)}</td><td>${escapeHtml(meaning)}</td></tr>`).join('\n')}</tbody>
  </table>

  ${criteriaTable(1, 'A', rows.A)}
  ${criteriaTable(2, 'AA', rows.AA)}
  ${criteriaTable(3, 'AAA', rows.AAA)}
</main>
</body>
</html>`;
}

/** Arma el VPAT completo a partir de los mismos datos que reciben los demás entregables. */
export function buildVpatReportHtml(data, { date = new Date() } = {}) {
  const axeResults = data.axeResults ?? data.axe_results ?? [];
  const includeExtended = data.includeExtended ?? false;
  const rows = buildVpatRows({ findings: data.findings ?? [], axeResults, includeExtended });
  const info = resolveVpatInfo(data.vpat, { target: data.target ?? data.urls?.[0] ?? '', channel: data.channel, date });
  return buildVpatHtml({
    jobId: data.jobId, channel: data.channel, info, rows, includeExtended, date,
    pagesEvaluated: axeResults.filter((r) => r && !r.error).length,
    keyboardRan: (data.keyboardResults ?? []).length > 0
  });
}
