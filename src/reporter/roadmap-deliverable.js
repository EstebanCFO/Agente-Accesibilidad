import ExcelJS from 'exceljs';
import { pageLabels, criteriaWithoutAutomatedRules } from './report-helpers.js';
import { DS_CSS, DS_COLORS, DS_FRAMED_SCRIPT, dsHeaderHtml, dsFooterHtml } from './design-system.js';

const SCOPE_ORDER = { onti: 0, extended_22: 1 };
const LEVEL_ORDER = { A: 0, AA: 1 };
const SEVERITY_ORDER = { critical: 0, serious: 1, moderate: 2, minor: 3 };

function priorityKey(item) {
  return [
    SCOPE_ORDER[item.in_scope] ?? 2,
    LEVEL_ORDER[item.wcag_level] ?? 2,
    SEVERITY_ORDER[item.severity] ?? 4,
    -(item.affected_urls?.length ?? 0)
  ];
}

function compareByPriority(a, b) {
  const ka = priorityKey(a);
  const kb = priorityKey(b);
  for (let i = 0; i < ka.length; i += 1) {
    if (ka[i] !== kb[i]) return ka[i] - kb[i];
  }
  return 0;
}

/**
 * Roadmap de remediación: solo los NOK de la Sección 1 (violaciones confirmadas de axe-core).
 * Lo que axe no pudo decidir (requiere_revision) queda "a validar" y no entra al plan de
 * corrección; los hallazgos complementarios del Agente tampoco. Ya no hay "quick win
 * regulatorio": el resultado no tiene umbral de conformidad.
 * estimated_effort queda en null: lo genera `ibelick/improve-ui` (sub-proyecto pendiente).
 */
export function buildRoadmapItems(findings) {
  const nok = (findings || []).filter((f) => (!f.source || f.source === 'axe-core') && (f.review_status ?? 'confirmado') === 'confirmado');
  const items = nok.map((finding) => ({
    wcag_criterion: finding.wcag_criterion,
    wcag_level: finding.wcag_level,
    wcag_description: finding.wcag_description,
    in_scope: finding.in_scope,
    severity: finding.severity,
    review_status: finding.review_status ?? 'confirmado',
    affected_urls: finding.affected_urls || [],
    occurrences: finding.occurrences,
    estimated_effort: null,
    remediation_hint: finding.remediation_hint,
    example: finding.failure_summary ?? null,
    element_sample: finding.element_sample ?? null
  }));

  items.sort(compareByPriority);
  items.forEach((item, index) => {
    item.priority_rank = index + 1;
  });
  return items;
}

export function buildRoadmapJson({ jobId, items }) {
  return { job_id: jobId, total_items: items.length, items };
}

function escapeHtml(value) {
  return String(value ?? '').replace(/[&<>"']/g, (char) => ({
    '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;'
  }[char]));
}

const SEVERITY_LABEL = { critical: 'Crítica', serious: 'Seria', moderate: 'Moderada', minor: 'Menor' };

const TIERS = [
  { key: 'p1', title: 'Prioridad 1 — Criterios de Nivel A', help: 'Bloquean el uso: sin corregirlos, algunas personas no pueden completar tareas en el sitio.', match: (i) => i.in_scope === 'onti' && i.wcag_level === 'A' },
  { key: 'p2', title: 'Prioridad 2 — Criterios de Nivel AA', help: 'Dificultan el uso: el sitio se puede usar, pero con barreras.', match: (i) => i.in_scope === 'onti' && i.wcag_level !== 'A' },
  { key: 'p3', title: 'Prioridad 3 — Capa extendida WCAG 2.1/2.2', help: 'Buenas prácticas no exigidas por la Circular BCRA.', match: (i) => i.in_scope !== 'onti' }
];

/** Primer caso concreto del problema (texto del agente sin el encabezado genérico), recortado. */
function exampleText(example) {
  if (!example) return '';
  const lines = String(example).split('\n').map((l) => l.trim()).filter(Boolean)
    .filter((l) => !/:$/.test(l) && !/^(corregir|fix)\b/i.test(l));
  const text = lines[0] ?? '';
  return text.length > 220 ? `${text.slice(0, 217)}…` : text;
}

function itemRowHtml(item, labels) {
  const pages = item.affected_urls.map((u) => `<li title="${escapeHtml(u)}">${escapeHtml(labels.get(u) ?? u)}</li>`).join('');
  const example = exampleText(item.example);
  return `
    <tr class="severity-${item.severity}">
      <td>${item.priority_rank}</td>
      <td><strong>${escapeHtml(item.wcag_description)}</strong>
        ${example ? `<br><small>Detalle: ${escapeHtml(example)}</small>` : ''}</td>
      <td>${escapeHtml(item.wcag_criterion)}<br><small>Nivel ${escapeHtml(item.wcag_level)}</small></td>
      <td>${SEVERITY_LABEL[item.severity] ?? escapeHtml(item.severity)}</td>
      <td><ul class="pages">${pages}</ul></td>
      <td class="num">${item.occurrences ?? ''}</td>
      <td>${escapeHtml(item.remediation_hint)}</td>
    </tr>`;
}

function tierHtml(tier, items, labels) {
  if (items.length === 0) return '';
  return `<section class="tier">
    <h2>${escapeHtml(tier.title)} <span class="pill">${items.length} problema${items.length > 1 ? 's' : ''}</span></h2>
    <p class="meta">${escapeHtml(tier.help)}</p>
    <div class="table-wrap">
    <table>
      <thead><tr><th>#</th><th>Problema</th><th>Criterio</th><th>Severidad</th><th>Páginas afectadas</th><th>Elementos</th><th>Cómo corregir</th></tr></thead>
      <tbody>${items.map((i) => itemRowHtml(i, labels)).join('\n')}</tbody>
    </table>
    </div>
  </section>`;
}

/** Buenas prácticas con mejora sugerida: complementarias, fuera del plan de corrección WCAG. */
function bestPracticesHtml(bestPractices, labels) {
  const rules = (bestPractices?.rules ?? []).filter((r) => r.status === 'mejora');
  if (rules.length === 0) return '';
  return `<section class="tier">
    <h2>Mejoras sugeridas — buenas prácticas <span class="pill">No forman parte de la normativa BCRA</span></h2>
    <p class="meta">Reglas de buenas prácticas del agente que conviene corregir. No afectan el compliance WCAG.</p>
    <div class="table-wrap">
    <table>
      <thead><tr><th>Regla</th><th>Qué pide</th><th>Impacto</th><th>Páginas</th></tr></thead>
      <tbody>${rules.map((r) => `<tr><td>${escapeHtml(r.rule_id)}</td><td>${escapeHtml(r.help)}</td><td>${SEVERITY_LABEL[r.impact] ?? '—'}</td><td><ul class="pages">${r.affected_urls.map((u) => `<li title="${escapeHtml(u)}">${escapeHtml(labels.get(u) ?? u)}</li>`).join('')}</ul></td></tr>`).join('')}</tbody>
    </table>
    </div>
  </section>`;
}

export function buildRoadmapHtml({ jobId, channel, items, urls, bestPractices = null }) {
  const allUrls = urls?.length ? urls : [...new Set(items.flatMap((i) => i.affected_urls))];
  const labels = pageLabels([...allUrls, ...items.flatMap((i) => i.affected_urls), ...(bestPractices?.rules ?? []).flatMap((r) => r.affected_urls)]);
  const affectedPages = new Set(items.flatMap((i) => i.affected_urls));
  const criterios = new Set(items.map((i) => i.wcag_criterion));
  const elementos = items.reduce((sum, i) => sum + (i.occurrences ?? 0), 0);
  const sinReglas = criteriaWithoutAutomatedRules().missing.length;

  const tiles = [
    ['Problemas a corregir', items.length],
    ['Criterios afectados', criterios.size],
    ['Páginas afectadas', `${affectedPages.size} de ${allUrls.length}`],
    ['Elementos a corregir', elementos]
  ].map(([label, value]) => `<div class="stat-tile"><div class="ds-kpi-label">${label}</div><div class="ds-kpi-value">${value}</div></div>`).join('');

  const body = items.length === 0
    ? '<p class="empty">El agente no detectó problemas automáticos a corregir.</p>'
    : TIERS.map((t) => tierHtml(t, items.filter(t.match), labels)).join('\n');

  return `<!doctype html>
<html lang="es">
<head>
<meta charset="utf-8">
<title>Roadmap de Remediación — ${escapeHtml(jobId)}</title>
<style>${DS_CSS}
  .summary { display: grid; grid-template-columns: repeat(auto-fit, minmax(150px, 1fr)); gap: 12px; margin: 0 0 12px; }
  .summary .stat-tile { background: #fff; border: 1px solid var(--border); border-radius: 12px; padding: 12px 14px; }
  .summary .ds-kpi-label { color: var(--text2); } .summary .ds-kpi-value { color: var(--navy); }
  .explain { background: #fff; border-left: 4px solid var(--blue); border-radius: 8px; padding: 10px 14px; font-size: 13px; margin: 0 0 18px; }
  .tier { margin-bottom: 22px; }
  .table-wrap { overflow-x: auto; background: #fff; border: 1px solid var(--border); border-radius: 12px; }
  th { background: var(--navy); color: #fff; position: sticky; top: 0; border-bottom: 0; }
  td { vertical-align: top; }
  td small { color: var(--text2); }
  td.num { text-align: right; font-weight: 600; }
  ul.pages { margin: 0; padding-left: 16px; font-size: 12px; }
  tr.severity-critical td:first-child { box-shadow: inset 4px 0 0 var(--red); }
  tr.severity-serious td:first-child { box-shadow: inset 4px 0 0 var(--orange); }
  tr.severity-moderate td:first-child { box-shadow: inset 4px 0 0 #E0A100; }
</style>
</head>
<body>
  ${DS_FRAMED_SCRIPT}
  ${dsHeaderHtml('Roadmap de Remediación')}
  <main>
  <h1>Roadmap Preliminar de Remediación</h1>
  <p class="meta">Job: ${escapeHtml(jobId)} · Generado: ${new Date().toISOString()}</p>
  <div class="summary">${tiles}</div>
  <p class="explain">Es el <strong>total de problemas que el agente detectó automáticamente</strong>, ordenados por prioridad de corrección. Cada fila es un tipo de problema (por ejemplo, texto con contraste insuficiente) y puede repetirse en varios elementos y páginas: la columna <em>Elementos</em> indica cuántas veces aparece en total. Incluye solo los criterios NOK: no incluye los criterios a validar${sinReglas > 0 ? ` (entre ellos, los ${sinReglas} que requieren tecnología asistiva o revisión manual)` : ''} ni las pruebas de teclado del Agente.</p>
  ${body}
  ${bestPracticesHtml(bestPractices, labels)}
  </main>
  ${dsFooterHtml()}
</body>
</html>`;
}

export async function buildRoadmapWorkbook(items) {
  const workbook = new ExcelJS.Workbook();
  const sheet = workbook.addWorksheet('Roadmap');
  sheet.columns = [
    { header: '#', key: 'priority_rank', width: 6 },
    { header: 'Criterio WCAG', key: 'wcag_criterion', width: 14 },
    { header: 'Nivel', key: 'wcag_level', width: 8 },
    { header: 'Prioridad', key: 'tier', width: 34 },
    { header: 'Severidad', key: 'severity', width: 12 },
    { header: 'Estado de revisión', key: 'review_status', width: 18 },
    { header: 'Páginas afectadas', key: 'affected_pages', width: 40 },
    { header: 'Elementos', key: 'occurrences', width: 12 },
    { header: 'Descripción', key: 'wcag_description', width: 32 },
    { header: 'Esfuerzo estimado', key: 'estimated_effort', width: 16 },
    { header: 'Sugerencia de remediación', key: 'remediation_hint', width: 50 }
  ];
  const labels = pageLabels(items.flatMap((i) => i.affected_urls));
  sheet.addRows(items.map((item) => ({
    ...item,
    tier: TIERS.find((t) => t.match(item))?.title ?? '',
    severity: SEVERITY_LABEL[item.severity] ?? item.severity,
    affected_pages: item.affected_urls.map((u) => labels.get(u) ?? u).join('\n')
  })));
  return workbook;
}
