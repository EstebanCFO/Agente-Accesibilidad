import ExcelJS from 'exceljs';

const SEVERITY_ORDER = ['critical', 'serious', 'moderate', 'minor'];

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
