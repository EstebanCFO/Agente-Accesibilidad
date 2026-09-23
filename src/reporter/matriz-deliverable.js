import ExcelJS from 'exceljs';
import { ontiCriteria, extendedCriteria } from '../classification/wcag-map.js';
import { classifyModule } from '../classification/module-classifier.js';

const SEVERITY_ORDER = ['critical', 'serious', 'moderate', 'minor'];
const IMPACT_ORDER = ['bloqueante', 'degradado', 'menor'];
const SEVERITY_LABEL_ES = { critical: 'Crítico', serious: 'Alto', moderate: 'Medio', minor: 'Bajo' };
const IMPACT_LABEL_ES = { bloqueante: 'Bloqueante', degradado: 'Degradado', menor: 'Menor' };
const STATUS_LABEL_ES = { conforme: 'Conforme', no_conforme: 'No conforme', parcialmente_conforme: 'Parcial', no_aplica: 'N/A' };

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
 * Vista detallada de conformidad criterio × URL individual (complementa la vista por
 * módulo de `buildModuleConformityMatrix`). 4 estados por celda: 'no_aplica' si el criterio de esa
 * fila está en `naCriteria` (propiedad del criterio para todo el canal, no de una URL puntual);
 * si no, 'no_conforme' si hay un finding review_status:'confirmado' afectando esa URL;
 * si no, 'parcialmente_conforme' si hay uno review_status:'requiere_revision'; si no, 'conforme'.
 */
export function buildConformityMatrix({ findings, urls, includeExtended = false, naCriteria = [] }) {
  const naSet = new Set(naCriteria);
  const confirmed = new Set();
  const review = new Set();

  for (const finding of findings) {
    if (finding.in_scope !== 'onti' && !(includeExtended && finding.in_scope === 'extended_22')) continue;
    const target = (finding.review_status ?? 'confirmado') === 'confirmado' ? confirmed : review;
    for (const url of finding.affected_urls || []) {
      target.add(`${url}::${finding.wcag_criterion}`);
    }
  }

  const rows = taggedCriteria(includeExtended).map((criterion) => ({
    wcag_criterion: criterion.wcag_criterion,
    level: criterion.level,
    in_scope: criterion.in_scope,
    description: criterion.description,
    cells: Object.fromEntries(urls.map((url) => {
      if (naSet.has(criterion.wcag_criterion)) return [url, 'no_aplica'];
      const key = `${url}::${criterion.wcag_criterion}`;
      if (confirmed.has(key)) return [url, 'no_conforme'];
      if (review.has(key)) return [url, 'parcialmente_conforme'];
      return [url, 'conforme'];
    }))
  }));

  return { urls, rows };
}

/**
 * Vista adicional: mismo criterio de conformidad que `buildConformityMatrix`, pero agrupando
 * columnas por módulo (primer segmento de path, ver module-classifier.js) en vez de por URL
 * individual. Un módulo hereda el peor estado de cualquiera de sus URLs
 * (no_conforme > parcialmente_conforme > conforme), mismo criterio que ya usa calculate-score.js
 * para by_module. 'no_aplica' es una propiedad del criterio para todo el canal, no depende de
 * qué URLs caen en cada módulo.
 */
export function buildModuleConformityMatrix({ findings, urls, includeExtended = false, naCriteria = [] }) {
  const urlToModule = new Map(urls.map((url) => [url, classifyModule(url)]));
  const modules = [...new Set(urls.map((url) => urlToModule.get(url)))];
  const naSet = new Set(naCriteria);

  const confirmed = new Set();
  const review = new Set();

  for (const finding of findings) {
    if (finding.in_scope !== 'onti' && !(includeExtended && finding.in_scope === 'extended_22')) continue;
    const target = (finding.review_status ?? 'confirmado') === 'confirmado' ? confirmed : review;
    for (const url of finding.affected_urls || []) {
      const module = urlToModule.get(url) ?? classifyModule(url);
      target.add(`${module}::${finding.wcag_criterion}`);
    }
  }

  const rows = taggedCriteria(includeExtended).map((criterion) => ({
    wcag_criterion: criterion.wcag_criterion,
    level: criterion.level,
    in_scope: criterion.in_scope,
    description: criterion.description,
    cells: Object.fromEntries(modules.map((module) => {
      if (naSet.has(criterion.wcag_criterion)) return [module, 'no_aplica'];
      const key = `${module}::${criterion.wcag_criterion}`;
      if (confirmed.has(key)) return [module, 'no_conforme'];
      if (review.has(key)) return [module, 'parcialmente_conforme'];
      return [module, 'conforme'];
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

function conformityTableHtml({ columns, rows }) {
  const headerCells = columns.map((column) => `<th>${escapeHtml(column)}</th>`).join('');
  const bodyRows = rows.map((row) => {
    const cells = columns.map((column) => {
      const status = row.cells[column];
      return `<td class="status-${status}">${STATUS_LABEL_ES[status] ?? status}</td>`;
    }).join('');
    return `<tr>
      <td>${escapeHtml(row.wcag_criterion)}</td>
      <td>${escapeHtml(row.level)}</td>
      <td>${row.in_scope === 'onti' ? 'ONTI' : 'Extendida 2.1/2.2'}</td>
      <td>${escapeHtml(row.description)}</td>
      ${cells}
    </tr>`;
  }).join('\n');

  return `<table>
    <thead><tr><th>Criterio</th><th>Nivel</th><th>Alcance</th><th>Descripción</th>${headerCells}</tr></thead>
    <tbody>${bodyRows}</tbody>
  </table>`;
}

function severityImpactTableHtml(grid) {
  const rows = grid.map((cell) => `<tr>
    <td>${cell.severity_label}</td>
    <td>${cell.impacto_label}</td>
    <td>${cell.findings_count}</td>
  </tr>`).join('\n');
  return `<table>
    <thead><tr><th>Severidad</th><th>Impacto</th><th>Hallazgos</th></tr></thead>
    <tbody>${rows}</tbody>
  </table>`;
}

export function buildMatrizHtml({ jobId, channel, conformity, moduleConformity, severityImpactGrid }) {
  const moduleSectionHtml = moduleConformity ? `
  <h2>Vista por módulo — Conformidad por criterio × módulo</h2>
  <p class="meta">Módulo derivado del primer segmento del path de cada URL escaneada (ver <code>module-classifier.js</code>). Un módulo hereda "No conforme" si cualquiera de sus URLs lo está.</p>
  ${conformityTableHtml({ columns: moduleConformity.modules, rows: moduleConformity.rows })}` : '';

  return `<!doctype html>
<html lang="es">
<head>
<meta charset="utf-8">
<title>Matriz de Criticidad — ${escapeHtml(jobId)}</title>
<style>
  body { font-family: Arial, Helvetica, sans-serif; margin: 2rem; color: #1a1a1a; }
  h1 { font-size: 1.4rem; }
  h2 { font-size: 1.1rem; margin-top: 2.5rem; }
  .meta { color: #555; margin-bottom: 1rem; }
  table { border-collapse: collapse; width: 100%; font-size: 0.8rem; margin-bottom: 2rem; }
  th, td { border: 1px solid #ddd; padding: 5px 7px; text-align: left; }
  th { background: #14213d; color: #fff; }
  td.status-conforme { background: #e6f4ea; color: #1e7a34; }
  td.status-no_conforme { background: #fdecea; color: #a01818; }
  td.status-parcialmente_conforme { background: #fff4e0; color: #8a5a00; }
  td.status-no_aplica { background: #eeeeee; color: #666; }
</style>
</head>
<body>
  <h1>Matriz de Criticidad</h1>
  <p class="meta">Job: ${escapeHtml(jobId)} · Canal: ${escapeHtml(channel ?? 'N/D')} · Generado: ${new Date().toISOString()}</p>
  ${moduleSectionHtml}
  <h2>Vista detallada — Conformidad por criterio × URL</h2>
  ${conformityTableHtml({ columns: conformity.urls, rows: conformity.rows })}

  <h2>Vista secundaria — Severidad × Impacto</h2>
  ${severityImpactTableHtml(severityImpactGrid)}
</body>
</html>`;
}

function addConformitySheet(workbook, name, { columns, rows }) {
  const sheet = workbook.addWorksheet(name);
  sheet.columns = [
    { header: 'Criterio WCAG', key: 'wcag_criterion', width: 14 },
    { header: 'Nivel', key: 'level', width: 8 },
    { header: 'Alcance', key: 'in_scope', width: 14 },
    { header: 'Descripción', key: 'description', width: 32 },
    ...columns.map((column, index) => ({ header: column, key: `col_${index}`, width: 18 }))
  ];
  sheet.addRows(rows.map((row) => {
    const rowData = { wcag_criterion: row.wcag_criterion, level: row.level, in_scope: row.in_scope, description: row.description };
    columns.forEach((column, index) => {
      rowData[`col_${index}`] = STATUS_LABEL_ES[row.cells[column]] ?? row.cells[column];
    });
    return rowData;
  }));
  return sheet;
}

export async function buildMatrizWorkbook({ conformity, moduleConformity, severityImpactGrid }) {
  const workbook = new ExcelJS.Workbook();

  if (moduleConformity) {
    addConformitySheet(workbook, 'Conformidad por módulo', { columns: moduleConformity.modules, rows: moduleConformity.rows });
  }
  addConformitySheet(workbook, 'Conformidad', { columns: conformity.urls, rows: conformity.rows });

  const gridSheet = workbook.addWorksheet('Severidad x Impacto');
  gridSheet.columns = [
    { header: 'Severidad', key: 'severity_label', width: 14 },
    { header: 'Impacto', key: 'impacto_label', width: 14 },
    { header: 'Hallazgos', key: 'findings_count', width: 12 }
  ];
  gridSheet.addRows(severityImpactGrid);

  return workbook;
}
