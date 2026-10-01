import ExcelJS from 'exceljs';
import { pageLabels, pageLabel } from './report-helpers.js';
import { DS_CSS, DS_COLORS, DS_FRAMED_SCRIPT, dsHeaderHtml, dsFooterHtml, complementaryFindingsHtml } from './design-system.js';

const SEVERITY_ORDER = ['critical', 'serious', 'moderate', 'minor'];
const SEVERITY_LABEL_ES = { critical: 'Crítico', serious: 'Alto', moderate: 'Medio', minor: 'Bajo' };
const SEVERITY_COLOR = { critical: DS_COLORS.critical, serious: DS_COLORS.warn, moderate: DS_COLORS.info, minor: DS_COLORS.minor };
const REVIEW_LABEL_ES = { confirmado: 'Confirmado', requiere_revision: 'Requiere revisión' };

function escapeHtml(value) {
  return String(value ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
}

export function buildInventarioJson({ jobId, findings }) {
  return { job_id: jobId, total_findings: findings.length, findings };
}

const FINDING_COLUMNS = [
  { header: 'ID', key: 'id', width: 36 },
  { header: 'Fuente', key: 'source', width: 14 },
  { header: 'Criterio WCAG', key: 'wcag_criterion', width: 14 },
  { header: 'Nivel', key: 'wcag_level', width: 8 },
  { header: 'Descripción WCAG', key: 'wcag_description', width: 32 },
  { header: 'Es criterio ONTI', key: 'onti_criterion', width: 16 },
  { header: 'Alcance', key: 'in_scope', width: 14 },
  { header: 'Severidad', key: 'severity', width: 12 },
  { header: 'Estado de revisión', key: 'review_status', width: 18 },
  { header: 'Rule ID (axe)', key: 'rule_id', width: 24 },
  { header: 'URLs afectadas', key: 'affected_urls', width: 50 },
  { header: 'Ocurrencias', key: 'occurrences', width: 12 },
  { header: 'Elemento (HTML)', key: 'element_sample', width: 50 },
  { header: 'Resumen de la falla', key: 'failure_summary', width: 50 },
  { header: 'Sugerencia de remediación', key: 'remediation_hint', width: 50 }
];

function findingRow(finding) {
  return {
    ...finding,
    affected_urls: (finding.affected_urls || []).join('; ')
  };
}

function buildPivotRows(findings) {
  const byCriterion = new Map();
  for (const finding of findings) {
    if (!byCriterion.has(finding.wcag_criterion)) {
      byCriterion.set(finding.wcag_criterion, {
        wcag_criterion: finding.wcag_criterion,
        wcag_level: finding.wcag_level,
        in_scope: finding.in_scope,
        findings_count: 0,
        total_occurrences: 0,
        worst_severity: finding.severity
      });
    }
    const row = byCriterion.get(finding.wcag_criterion);
    row.findings_count += 1;
    row.total_occurrences += finding.occurrences;
    if (SEVERITY_ORDER.indexOf(finding.severity) < SEVERITY_ORDER.indexOf(row.worst_severity)) {
      row.worst_severity = finding.severity;
    }
  }
  return [...byCriterion.values()].sort((a, b) => a.wcag_criterion.localeCompare(b.wcag_criterion));
}

/**
 * La SPEC pide "Hoja 4 gráficos resumen", pero exceljs no soporta crear objetos de gráfico
 * nativos de Excel (solo imágenes estáticas) — esta hoja deja los datos agregados listos
 * para que alguien los convierta en gráfico en un clic dentro de Excel, no el gráfico en sí.
 */
function buildResumenRows(findings) {
  const severityCounts = SEVERITY_ORDER.map((severity) => ({
    section: 'Por severidad',
    field: severity,
    value: findings.filter((f) => f.severity === severity).length
  }));
  const topCriteria = buildPivotRows(findings)
    .sort((a, b) => b.total_occurrences - a.total_occurrences)
    .slice(0, 10)
    .map((criterio) => ({
      section: 'Top 10 criterios más vulnerados',
      field: `${criterio.wcag_criterion} (${criterio.in_scope})`,
      value: criterio.total_occurrences
    }));
  return [...severityCounts, ...topCriteria];
}

export async function buildInventarioWorkbook(findings) {
  const workbook = new ExcelJS.Workbook();

  const hallazgos = workbook.addWorksheet('Hallazgos');
  hallazgos.columns = FINDING_COLUMNS;
  hallazgos.addRows(findings.map(findingRow));

  const pivot = workbook.addWorksheet('Pivot por criterio WCAG');
  pivot.columns = [
    { header: 'Criterio WCAG', key: 'wcag_criterion', width: 14 },
    { header: 'Nivel', key: 'wcag_level', width: 8 },
    { header: 'Alcance', key: 'in_scope', width: 14 },
    { header: 'Cantidad de hallazgos', key: 'findings_count', width: 20 },
    { header: 'Ocurrencias totales', key: 'total_occurrences', width: 20 },
    { header: 'Severidad más grave', key: 'worst_severity', width: 18 }
  ];
  pivot.addRows(buildPivotRows(findings));

  const soloOnti = workbook.addWorksheet('Solo ONTI');
  soloOnti.columns = FINDING_COLUMNS;
  soloOnti.addRows(findings.filter((f) => f.onti_criterion).map(findingRow));

  const resumen = workbook.addWorksheet('Resumen');
  resumen.columns = [
    { header: 'Sección', key: 'section', width: 28 },
    { header: 'Campo', key: 'field', width: 28 },
    { header: 'Valor', key: 'value', width: 16 }
  ];
  resumen.addRows(buildResumenRows(findings));

  return workbook;
}

function bySeverityThenCriterion(a, b) {
  return SEVERITY_ORDER.indexOf(a.severity) - SEVERITY_ORDER.indexOf(b.severity)
    || String(a.wcag_criterion).localeCompare(String(b.wcag_criterion), undefined, { numeric: true })
    || (b.occurrences ?? 0) - (a.occurrences ?? 0);
}

/**
 * Vista HTML del inventario (misma data que la hoja "Hallazgos" del Excel): una fila por hallazgo,
 * ordenada de más a menos grave, con las páginas afectadas y la sugerencia de remediación.
 */
export function buildInventarioHtml({ jobId, findings = [], complementaryFindings = [], urls = [] }) {
  const labels = pageLabels([...urls, ...findings.flatMap((f) => f.affected_urls || [])]);
  const sorted = [...findings].sort(bySeverityThenCriterion);
  const totalOccurrences = findings.reduce((sum, f) => sum + (f.occurrences ?? 0), 0);
  const counts = SEVERITY_ORDER.map((severity) => ({ severity, count: findings.filter((f) => f.severity === severity).length }));

  const rows = sorted.map((f, i) => `<tr>
      <td>${i + 1}</td>
      <td><span class="sev" style="--c:${SEVERITY_COLOR[f.severity] ?? DS_COLORS.neutral}">${escapeHtml(SEVERITY_LABEL_ES[f.severity] ?? f.severity)}</span></td>
      <td><strong>${escapeHtml(f.wcag_criterion)}</strong> <small>(${escapeHtml(f.wcag_level)})</small><br><span class="muted">${escapeHtml(f.wcag_description)}</span>${f.in_scope === 'extended_22' ? '<br><small>(WCAG 2.1/2.2, no exigido)</small>' : ''}</td>
      <td><code>${escapeHtml(f.rule_id)}</code>${f.failure_summary ? `<br><span class="muted">${escapeHtml(f.failure_summary)}</span>` : ''}${f.element_sample ? `<br><code class="el">${escapeHtml(f.element_sample)}</code>` : ''}</td>
      <td><ul class="pages">${(f.affected_urls || []).map((u) => `<li title="${escapeHtml(u)}">${escapeHtml(pageLabel(u, labels))}</li>`).join('')}</ul></td>
      <td class="num">${f.occurrences ?? 0}</td>
      <td>${escapeHtml(REVIEW_LABEL_ES[f.review_status] ?? f.review_status ?? '—')}</td>
      <td>${escapeHtml(f.remediation_hint)}</td>
    </tr>`).join('\n');

  const table = findings.length === 0
    ? '<p class="empty">No se detectaron hallazgos en las páginas auditadas.</p>'
    : `<div class="card table-wrap"><table>
    <thead><tr><th>#</th><th>Severidad</th><th>Criterio WCAG</th><th>Regla y falla</th><th>Páginas</th><th>Ocurr.</th><th>Estado</th><th>Sugerencia de remediación</th></tr></thead>
    <tbody>${rows}</tbody>
  </table></div>`;

  return `<!doctype html>
<html lang="es">
<head>
<meta charset="utf-8">
<title>Inventario de hallazgos — ${escapeHtml(jobId)}</title>
<style>${DS_CSS}
  .table-wrap { overflow-x: auto; padding: 0; }
  table { font-size: 12px; }
  th { background: var(--navy); color: #fff; border-bottom: 0; }
  td.num { text-align: right; font-weight: 600; }
  .sev { display: inline-block; white-space: nowrap; font-weight: 700; font-size: 11px; color: var(--text); }
  .sev::before { content: ''; display: inline-block; width: 10px; height: 10px; border-radius: 3px; margin-right: 6px; vertical-align: -1px; background: var(--c); }
  code { font-size: 11px; }
  code.el { display: inline-block; margin-top: 3px; color: var(--text2); word-break: break-all; }
  ul.pages { margin: 0; padding-left: 14px; }
  .inv-kpis { display: flex; gap: 12px; flex-wrap: wrap; margin-bottom: 16px; }
  .inv-kpi { background: #fff; border: 1px solid var(--border); border-radius: 12px; padding: 10px 16px; min-width: 110px; }
  .inv-kpi b { display: block; font-size: 22px; color: var(--navy); }
  .inv-kpi span { font-size: 12px; color: var(--text2); }
</style>
</head>
<body>
  ${DS_FRAMED_SCRIPT}
  ${dsHeaderHtml('Inventario de hallazgos')}
  <main>
  <h1>Inventario de hallazgos</h1>
  <p class="meta">Job: ${escapeHtml(jobId)} · Generado: ${new Date().toISOString()}</p>
  <div class="inv-kpis">
    <div class="inv-kpi"><b>${findings.length}</b><span>Hallazgos</span></div>
    <div class="inv-kpi"><b>${totalOccurrences}</b><span>Ocurrencias</span></div>
    ${counts.map((c) => `<div class="inv-kpi"><b>${c.count}</b><span class="sev" style="--c:${SEVERITY_COLOR[c.severity]}">${SEVERITY_LABEL_ES[c.severity]}</span></div>`).join('\n    ')}
  </div>
  <p class="meta">Cada fila es un tipo de problema detectado por el agente sobre un criterio WCAG; puede repetirse en varias páginas y elementos. Ordenado de más a menos grave. El detalle completo (incluido el pivot por criterio) está en el Excel <code>inventario-hallazgos.xlsx</code>.</p>
  ${table}
  ${complementaryFindingsHtml(complementaryFindings, escapeHtml)}
  </main>
  ${dsFooterHtml()}
</body>
</html>`;
}
