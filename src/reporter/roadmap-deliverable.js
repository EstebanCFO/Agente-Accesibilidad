import ExcelJS from 'exceljs';

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
 * "Quick win regulatorio" (SPEC §8.5): un criterio ONTI violado se marca así solo cuando
 * corregir CUALQUIERA de los criterios violados alcanza por sí solo el umbral de conformidad
 * (es decir, falta exactamente 1 criterio para cruzar de <30 a >=30/38). Si faltan 2 o más,
 * ningún criterio individual cruza el umbral por su cuenta, así que no se marca ninguno.
 */
function isQuickWinEligible(ontiCriteriaCompliant, conformanceThreshold) {
  return ontiCriteriaCompliant === conformanceThreshold - 1;
}

/**
 * estimated_effort queda siempre en null: la SPEC dice que lo genera el skill externo
 * `ibelick/improve-ui`, que todavía no está integrado (Sub-plan E). No se inventa un valor.
 * NOTA: si el canal tiene criterios N/A, "conformanceThreshold" debería ser el
 * effective_conformance_threshold de calculate_score (no el conformance_threshold crudo) para
 * que "quick win" compare contra el umbral realmente vigente esta corrida - queda a criterio
 * del agente al armar el input de este tool, no se fuerza en código.
 */
export function buildRoadmapItems(findings, { ontiCriteriaCompliant = 0, conformanceThreshold = 30 } = {}) {
  const quickWinEligible = isQuickWinEligible(ontiCriteriaCompliant, conformanceThreshold);

  const items = (findings || []).map((finding) => ({
    wcag_criterion: finding.wcag_criterion,
    wcag_level: finding.wcag_level,
    wcag_description: finding.wcag_description,
    in_scope: finding.in_scope,
    severity: finding.severity,
    review_status: finding.review_status ?? 'confirmado',
    affected_urls: finding.affected_urls || [],
    occurrences: finding.occurrences,
    quick_win_regulatorio: finding.in_scope === 'onti' && quickWinEligible,
    estimated_effort: null,
    remediation_hint: finding.remediation_hint
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

function itemRowHtml(item) {
  return `
    <tr class="severity-${item.severity}">
      <td>${item.priority_rank}</td>
      <td>${escapeHtml(item.wcag_criterion)}</td>
      <td>${escapeHtml(item.wcag_level)}</td>
      <td>${item.in_scope === 'onti' ? 'ONTI' : 'Extendida 2.1/2.2'}</td>
      <td>${SEVERITY_LABEL[item.severity] ?? escapeHtml(item.severity)}</td>
      <td>${item.quick_win_regulatorio ? '✔ Quick win regulatorio' : ''}</td>
      <td>${item.affected_urls.length}</td>
      <td>${item.occurrences}</td>
      <td>${escapeHtml(item.wcag_description)}</td>
      <td>${escapeHtml(item.remediation_hint)}</td>
    </tr>`;
}

export function buildRoadmapHtml({ jobId, channel, items }) {
  const rows = items.map(itemRowHtml).join('\n');
  return `<!doctype html>
<html lang="es">
<head>
<meta charset="utf-8">
<title>Roadmap de Remediación — ${escapeHtml(jobId)}</title>
<style>
  body { font-family: Arial, Helvetica, sans-serif; margin: 2rem; color: #1a1a1a; }
  h1 { font-size: 1.4rem; }
  .meta { color: #555; margin-bottom: 1.5rem; }
  table { border-collapse: collapse; width: 100%; font-size: 0.85rem; }
  th, td { border: 1px solid #ddd; padding: 6px 8px; text-align: left; vertical-align: top; }
  th { background: #14213d; color: #fff; position: sticky; top: 0; }
  tr.severity-critical { background: #fdecea; }
  tr.severity-serious { background: #fff4e5; }
  tr.severity-moderate { background: #fffbea; }
</style>
</head>
<body>
  <h1>Roadmap Preliminar de Remediación</h1>
  <p class="meta">Job: ${escapeHtml(jobId)} · Canal: ${escapeHtml(channel ?? 'N/D')} · Generado: ${new Date().toISOString()}</p>
  <table>
    <thead>
      <tr>
        <th>#</th><th>Criterio</th><th>Nivel</th><th>Alcance</th><th>Severidad</th>
        <th>Quick win</th><th>URLs afectadas</th><th>Ocurrencias</th><th>Descripción</th><th>Sugerencia</th>
      </tr>
    </thead>
    <tbody>
      ${rows}
    </tbody>
  </table>
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
    { header: 'Alcance', key: 'in_scope', width: 14 },
    { header: 'Severidad', key: 'severity', width: 12 },
    { header: 'Estado de revisión', key: 'review_status', width: 18 },
    { header: 'Quick win regulatorio', key: 'quick_win_regulatorio', width: 20 },
    { header: 'URLs afectadas', key: 'affected_urls_count', width: 16 },
    { header: 'Ocurrencias', key: 'occurrences', width: 12 },
    { header: 'Descripción', key: 'wcag_description', width: 32 },
    { header: 'Esfuerzo estimado', key: 'estimated_effort', width: 16 },
    { header: 'Sugerencia de remediación', key: 'remediation_hint', width: 50 }
  ];
  sheet.addRows(items.map((item) => ({ ...item, affected_urls_count: item.affected_urls.length })));
  return workbook;
}
