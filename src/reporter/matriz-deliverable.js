import ExcelJS from 'exceljs';
import { ontiCriteria, extendedCriteria, extractWcagCriteria } from '../classification/wcag-map.js';
import { classifyModule } from '../classification/module-classifier.js';
import { criteriaWithoutAutomatedRules, pageLabels, manualReviewLabel, manualReviewFor } from './report-helpers.js';
import { DS_CSS, DS_COLORS, DS_FRAMED_SCRIPT, dsHeaderHtml, dsFooterHtml } from './design-system.js';

const SEVERITY_ORDER = ['critical', 'serious', 'moderate', 'minor'];
const IMPACT_ORDER = ['bloqueante', 'degradado', 'menor'];
const SEVERITY_LABEL_ES = { critical: 'Crítico', serious: 'Alto', moderate: 'Medio', minor: 'Bajo' };
const IMPACT_LABEL_ES = { bloqueante: 'Bloqueante', degradado: 'Degradado', menor: 'Menor' };
const STATUS_LABEL_ES = { ok: 'OK', nok: 'NOK', a_validar: 'A validar', no_aplica: 'No aplica' };
const STATUS_RANK = { nok: 3, a_validar: 2, ok: 1, no_aplica: 0 };

/**
 * No hay ninguna fuente de datos de "impacto de negocio" todavía. En vez de inventar una,
 * reusamos una relación que la SPEC ya establece explícitamente: los 25 criterios Nivel A
 * de la ONTI son "bloqueos críticos" (§2) y la capa extendida WCAG 2.1/2.2 es "no exigida"
 * (§8.5 la trata como la de menor prioridad). De ahí: ONTI+A=bloqueante, ONTI+AA=degradado,
 * extended_22=menor.
 */
function impactoFor({ inScope, level }) {
  if (inScope === 'extended_22') return 'menor';
  return level === 'A' ? 'bloqueante' : 'degradado';
}

function taggedCriteria(includeExtended) {
  const onti = ontiCriteria.map((c) => ({ ...c, in_scope: 'onti' }));
  if (!includeExtended) return onti;
  return [...onti, ...extendedCriteria.map((c) => ({ ...c, in_scope: 'extended_22' }))];
}

/**
 * Vista detallada criterio × URL, con los mismos estados que la Sección 1 del informe:
 *   nok       - un finding confirmado de axe-core afecta esa página;
 *   a_validar - un finding requiere_revision en esa página, el criterio no tiene reglas
 *               automáticas, o ninguna de sus reglas se evaluó en esa página;
 *   ok        - alguna regla del criterio pasó en esa página y no hubo problema.
 * Sin axeResults no se sabe qué reglas pasaron: nada se da por OK. Los multimedia quedan a
 * validar, igual que en la Sección 1 (no hay "No aplica" automático).
 */
export function buildConformityMatrix({ findings, urls, includeExtended = false, axeResults = [] }) {
  const sinReglas = new Set(criteriaWithoutAutomatedRules().missing);
  const confirmed = new Set();
  const review = new Set();
  for (const finding of findings) {
    if (finding.source && finding.source !== 'axe-core') continue;
    if (finding.in_scope !== 'onti' && !(includeExtended && finding.in_scope === 'extended_22')) continue;
    const target = finding.review_status === 'requiere_revision' ? review : confirmed;
    for (const url of finding.affected_urls || []) target.add(`${url}::${finding.wcag_criterion}`);
  }
  const passed = new Set();
  for (const result of axeResults || []) {
    if (!result || result.error) continue;
    for (const entry of result.passes || []) {
      for (const criterion of extractWcagCriteria(entry.tags)) passed.add(`${result.url}::${criterion}`);
    }
  }

  const rows = taggedCriteria(includeExtended).map((criterion) => ({
    wcag_criterion: criterion.wcag_criterion,
    level: criterion.level,
    in_scope: criterion.in_scope,
    description: criterion.description,
    manual_review: criterion.in_scope === 'onti' && sinReglas.has(criterion.wcag_criterion) ? manualReviewFor(criterion.wcag_criterion) : null,
    cells: Object.fromEntries(urls.map((url) => {
      const key = `${url}::${criterion.wcag_criterion}`;
      if (confirmed.has(key)) return [url, 'nok'];
      if (passed.has(key) && !review.has(key)) return [url, 'ok'];
      return [url, 'a_validar'];
    }))
  }));

  return { urls, rows };
}

/**
 * Misma matriz agrupando columnas por módulo (primer segmento del path, ver
 * module-classifier.js): cada módulo toma el peor estado de sus páginas, así que es OK solo si
 * todas sus páginas lo están.
 */
export function buildModuleConformityMatrix({ findings, urls, includeExtended = false, axeResults = [] }) {
  const byUrl = buildConformityMatrix({ findings, urls, includeExtended, axeResults });
  const urlToModule = new Map(urls.map((url) => [url, classifyModule(url)]));
  const modules = [...new Set(urls.map((url) => urlToModule.get(url)))];
  const rows = byUrl.rows.map(({ cells, manual_review: _mr, ...row }) => ({
    ...row,
    cells: Object.fromEntries(modules.map((module) => {
      const statuses = urls.filter((u) => urlToModule.get(u) === module).map((u) => cells[u]);
      return [module, statuses.reduce((worst, st) => (STATUS_RANK[st] > STATUS_RANK[worst] ? st : worst), 'no_aplica')];
    }))
  }));
  return { modules, rows };
}

/**
 * Vista secundaria (SPEC §8.4): grilla severidad × impacto, con conteo de hallazgos por
 * cuadrante y los ids de esos findings para el drill-down al inventario.
 */
export function buildSeverityImpactGrid(findings) {
  const grid = [];
  for (const severity of SEVERITY_ORDER) {
    for (const impacto of IMPACT_ORDER) {
      const matching = findings.filter((f) => f.severity === severity && impactoFor({ inScope: f.in_scope, level: f.wcag_level }) === impacto);
      grid.push({
        severity,
        severity_label: SEVERITY_LABEL_ES[severity],
        impacto,
        impacto_label: IMPACT_LABEL_ES[impacto],
        findings_count: matching.length,
        finding_ids: matching.map((f) => f.id)
      });
    }
  }
  return grid;
}

export function buildMatrizJson({ jobId, channel, conformity, moduleConformity, severityImpactGrid }) {
  return {
    job_id: jobId,
    channel: channel ?? null,
    generated_at: new Date().toISOString(),
    conformity_matrix: conformity,
    module_conformity_matrix: moduleConformity ?? null,
    severity_impact_grid: severityImpactGrid
  };
}

function escapeHtml(value) {
  return String(value ?? '').replace(/[&<>"']/g, (char) => ({
    '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;'
  }[char]));
}

function conformityTableHtml({ columns, rows, labels }) {
  const headerCells = columns.map((column) => `<th title="${escapeHtml(column)}">${escapeHtml(labels?.get(column) ?? column)}</th>`).join('');
  const bodyRows = rows.map((row) => {
    const cells = columns.map((column) => {
      const status = row.cells[column];
      return `<td class="status-${status}">${STATUS_LABEL_ES[status] ?? status}</td>`;
    }).join('');
    return `<tr>
      <td>${escapeHtml(row.wcag_criterion)}</td>
      <td>${escapeHtml(row.level)}</td>
      <td>${escapeHtml(row.description)}${row.in_scope === 'extended_22' ? ' <small>(WCAG 2.1/2.2, no exigido)</small>' : ''}${row.manual_review ? `<br><span class="review-tag ${row.manual_review.assistive ? 'at' : 'manual'}">${escapeHtml(manualReviewLabel(row.wcag_criterion))}</span>` : ''}</td>
      ${cells}
    </tr>`;
  }).join('\n');

  return `<div class="card table-wrap"><table>
    <thead><tr><th>Criterio</th><th>Nivel</th><th>Descripción</th>${headerCells}</tr></thead>
    <tbody>${bodyRows}</tbody>
  </table></div>`;
}

function severityImpactTableHtml(grid) {
  const cell = (severity, impacto) => grid.find((c) => c.severity === severity && c.impacto === impacto)?.findings_count ?? 0;
  const total = grid.reduce((sum, c) => sum + c.findings_count, 0);
  const rows = SEVERITY_ORDER.map((severity) => `<tr>
    <th scope="row">${SEVERITY_LABEL_ES[severity]}</th>
    ${IMPACT_ORDER.map((impacto) => {
      const n = cell(severity, impacto);
      return `<td class="${n > 0 ? 'si-hit' : 'si-zero'}">${n}</td>`;
    }).join('')}
  </tr>`).join('\n');
  return `<div class="card table-wrap si-wrap"><table class="si-grid">
    <thead><tr><th>Severidad \\ Impacto</th>${IMPACT_ORDER.map((i) => `<th>${IMPACT_LABEL_ES[i]}</th>`).join('')}</tr></thead>
    <tbody>${rows}</tbody>
  </table></div>
  <p class="meta">Total: ${total} problema(s) distintos. Cada problema es un tipo de falla sobre un criterio; puede repetirse en varias páginas y elementos (ver Inventario de hallazgos).</p>`;
}

const LEYENDA_ESTADOS = `<ul class="legend">
  <li><span class="sw status-ok"></span><strong>OK:</strong> el agente verificó el criterio en la página y no encontró problemas.</li>
  <li><span class="sw status-nok"></span><strong>NOK:</strong> hay al menos un problema confirmado en esa página.</li>
  <li><span class="sw status-a_validar"></span><strong>A validar:</strong> el agente no pudo verificarlo en esa página (requiere tecnología asistiva o revisión manual, no había elementos a evaluar, o hay indicios que una persona tiene que revisar). No cuenta como OK.</li>
</ul>`;

export function buildMatrizHtml({ jobId, channel, conformity, severityImpactGrid }) {
  const labels = pageLabels(conformity.urls);

  return `<!doctype html>
<html lang="es">
<head>
<meta charset="utf-8">
<title>Matriz de criticidad WCAG 2.0 AA — ${escapeHtml(jobId)}</title>
<style>${DS_CSS}
  h2 { margin-top: 8px; }
  .table-wrap { overflow-x: auto; padding: 0; }
  table { font-size: 12px; }
  th { background: var(--navy); color: #fff; border-bottom: 0; }
  td.status-ok { background: var(--green-l); color: var(--green-text); font-weight: 600; }
  td.status-nok { background: var(--red-l); color: var(--red-text); font-weight: 600; }
  td.status-a_validar { background: var(--gray1); color: var(--text2); font-style: italic; }
  td.status-no_aplica { background: var(--gray2); color: var(--text2); }
  .legend { list-style: none; padding: 0; margin: 0 0 14px; font-size: 12px; color: var(--text2); display: grid; gap: 4px; }
  .legend .sw { display: inline-block; width: 12px; height: 12px; border-radius: 3px; margin-right: 6px; vertical-align: -2px; border: 1px solid var(--border); }
  .legend .status-ok { background: var(--green-l); } .legend .status-nok { background: var(--red-l); }
  .legend .status-a_validar { background: var(--gray1); }
  .review-tag { display: inline-block; margin-top: 3px; font-size: 10.5px; font-weight: 600; border-radius: 10px; padding: 1px 8px; }
  .review-tag.at { background: var(--blue-l, #E8EFFB); color: var(--nav-active, #1B3F8A); border: 1px solid var(--nav-active, #1B3F8A); }
  .review-tag.manual { background: var(--gray1); color: var(--text2); border: 1px solid var(--border); }
  table.si-grid { width: auto; min-width: 420px; }
  .si-wrap { display: inline-block; max-width: 100%; }
  td[class^="status-"] { white-space: nowrap; }
  .legend .sw { border-color: var(--text2); }
  table.si-grid th[scope=row] { background: var(--gray1); color: var(--text); text-align: left; }
  table.si-grid td { text-align: center; font-weight: 600; min-width: 90px; }
  td.si-hit { background: var(--red-l); color: var(--red-text); }
  td.si-zero { color: var(--text2); font-weight: 400; }
  dl.si-help { font-size: 12px; color: var(--text2); display: grid; grid-template-columns: max-content 1fr; gap: 4px 12px; margin: 0 0 12px; }
  dl.si-help dt { font-weight: 700; color: var(--text); } dl.si-help dd { margin: 0; }
</style>
</head>
<body>
  ${DS_FRAMED_SCRIPT}
  ${dsHeaderHtml('Matriz de criticidad WCAG 2.0 AA')}
  <main>
  <h1>Matriz de criticidad WCAG 2.0 AA</h1>
  <p class="meta">Job: ${escapeHtml(jobId)} · Generado: ${new Date().toISOString()}</p>
  <h2>Conformidad de cada criterio en cada página</h2>
  <p class="meta">Cada fila es un criterio de la Circular BCRA y cada columna una de las ${conformity.urls.length} página(s) auditadas. Muestra en qué páginas puntuales falla cada criterio.</p>
  ${LEYENDA_ESTADOS}
  ${conformityTableHtml({ columns: conformity.urls, rows: conformity.rows, labels })}

  <h2>Problemas por severidad e impacto en el usuario</h2>
  <p class="meta">Cruza qué tan grave es cada problema técnico con cuánto afecta a una persona con discapacidad. Sirve para ver de un vistazo dónde se concentra el riesgo: los problemas en la esquina superior izquierda (Crítico + Bloqueante) son los primeros a resolver.</p>
  <dl class="si-help">
    <dt>Severidad</dt><dd>Gravedad técnica que asigna el agente al problema (Crítico, Alto, Medio, Bajo).</dd>
    <dt>Bloqueante</dt><dd>Criterio de Nivel A: sin corregirlo, algunas personas no pueden usar la página.</dd>
    <dt>Degradado</dt><dd>Criterio de Nivel AA: la página se puede usar, pero con dificultad.</dd>
    <dt>Menor</dt><dd>Criterio de la capa extendida WCAG 2.1/2.2 (no exigida por la Circular BCRA).</dd>
  </dl>
  ${severityImpactTableHtml(severityImpactGrid)}
  </main>
  ${dsFooterHtml()}
</body>
</html>`;
}

function addConformitySheet(workbook, name, { columns, rows, labels }) {
  const sheet = workbook.addWorksheet(name);
  sheet.columns = [
    { header: 'Criterio WCAG', key: 'wcag_criterion', width: 14 },
    { header: 'Nivel', key: 'level', width: 8 },
    { header: 'Descripción', key: 'description', width: 32 },
    { header: 'Revisión requerida', key: 'manual_review', width: 42 },
    ...columns.map((column, index) => ({ header: labels?.get(column) ?? column, key: `col_${index}`, width: 18 }))
  ];
  sheet.addRows(rows.map((row) => {
    const rowData = { wcag_criterion: row.wcag_criterion, level: row.level, description: row.description, manual_review: row.manual_review ? manualReviewLabel(row.wcag_criterion) : '' };
    columns.forEach((column, index) => {
      rowData[`col_${index}`] = STATUS_LABEL_ES[row.cells[column]] ?? row.cells[column];
    });
    return rowData;
  }));
  return sheet;
}

export async function buildMatrizWorkbook({ conformity, moduleConformity, severityImpactGrid, bestPractices = null }) {
  const workbook = new ExcelJS.Workbook();

  if (moduleConformity) {
    addConformitySheet(workbook, 'Conformidad por módulo', { columns: moduleConformity.modules, rows: moduleConformity.rows });
  }
  addConformitySheet(workbook, 'Conformidad por página', { columns: conformity.urls, rows: conformity.rows, labels: pageLabels(conformity.urls) });

  const gridSheet = workbook.addWorksheet('Severidad x Impacto');
  gridSheet.columns = [
    { header: 'Severidad', key: 'severity_label', width: 14 },
    { header: 'Impacto', key: 'impacto_label', width: 14 },
    { header: 'Hallazgos', key: 'findings_count', width: 12 }
  ];
  gridSheet.addRows(severityImpactGrid);

  if (bestPractices?.rules?.length) {
    const BP_STATUS = { cumple: 'Cumple', mejora: 'Mejora sugerida', no_aplica: 'No aplica' };
    const bpSheet = workbook.addWorksheet('Buenas prácticas');
    bpSheet.columns = [
      { header: 'Regla', key: 'rule_id', width: 28 },
      { header: 'Qué pide', key: 'help', width: 50 },
      { header: 'Estado', key: 'status', width: 18 },
      { header: 'Impacto', key: 'impact', width: 12 },
      { header: 'Páginas con problemas', key: 'pages', width: 40 }
    ];
    const bpLabels = pageLabels(bestPractices.rules.flatMap((r) => r.affected_urls));
    bpSheet.addRows(bestPractices.rules.map((r) => ({
      rule_id: r.rule_id, help: r.help, status: BP_STATUS[r.status] ?? r.status,
      impact: SEVERITY_LABEL_ES[r.impact] ?? '', pages: r.affected_urls.map((u) => bpLabels.get(u) ?? u).join(', ')
    })));
  }

  return workbook;
}
