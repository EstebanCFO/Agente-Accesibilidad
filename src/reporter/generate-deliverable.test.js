import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFile, mkdtemp } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import ExcelJS from 'exceljs';
import { generateDeliverable } from './generate-deliverable.js';

const SAMPLE_SCORES = {
  summary: {
    total_urls_evaluated: 2,
    onti_criteria_evaluated: 38,
    onti_criteria_compliant: 30,
    onti_compliance_percentage: 78.95,
    onti_conformance: true,
    conformance_threshold: 30,
    score_level_a: 80,
    score_level_aa: 76.92
  },
  extended_22: null,
  by_url: [],
  by_module: [{ module: 'home-banking', url_count: 2, onti_compliance_percentage: 78.95, violations: 4, incomplete: 0 }]
};

test('generateDeliverable("score") escribe score-compliance.json con el envelope de job', async () => {
  const outputDir = await mkdtemp(path.join(tmpdir(), 'f1-deliverable-'));
  const filePaths = await generateDeliverable('score', {
    jobId: 'job-42',
    channel: 'app_ios',
    scores: SAMPLE_SCORES
  }, { outputDir });

  assert.equal(filePaths.length, 1);
  const doc = JSON.parse(await readFile(filePaths[0], 'utf8'));
  assert.equal(doc.job_id, 'job-42');
  assert.equal(doc.channel, 'app_ios');
  assert.ok(doc.generated_at);
  assert.deepEqual(doc.summary, SAMPLE_SCORES.summary);
  assert.equal(doc.extended_22, null);
  assert.deepEqual(doc.by_module, SAMPLE_SCORES.by_module);
});

test('generateDeliverable("inventario") escribe json + html + xlsx con las 4 hojas', async () => {
  const outputDir = await mkdtemp(path.join(tmpdir(), 'f1-deliverable-'));
  const findings = [
    {
      id: 'f1', source: 'axe-core', wcag_criterion: '1.1.1', wcag_level: 'A',
      wcag_description: 'Contenido no textual', onti_criterion: true, in_scope: 'onti',
      severity: 'critical', rule_id: 'image-alt', affected_urls: ['https://a.test'],
      occurrences: 2, element_sample: '<img>', failure_summary: 'falta alt', remediation_hint: 'agregar alt'
    }
  ];

  const filePaths = await generateDeliverable('inventario', { jobId: 'job-9', findings }, { outputDir });

  assert.equal(filePaths.length, 3);
  const jsonPath = filePaths.find((p) => p.endsWith('.json'));
  const xlsxPath = filePaths.find((p) => p.endsWith('.xlsx'));
  const htmlPath = filePaths.find((p) => p.endsWith('.html'));
  assert.equal(path.basename(htmlPath), 'inventario-hallazgos.html');
  assert.match(await readFile(htmlPath, 'utf8'), /Inventario de hallazgos/);

  const jsonDoc = JSON.parse(await readFile(jsonPath, 'utf8'));
  assert.equal(jsonDoc.job_id, 'job-9');
  assert.equal(jsonDoc.total_findings, 1);

  const workbook = new ExcelJS.Workbook();
  await workbook.xlsx.readFile(xlsxPath);
  assert.deepEqual(workbook.worksheets.map((ws) => ws.name), ['Hallazgos', 'Pivot por criterio WCAG', 'Solo ONTI', 'Resumen']);
});

test('generateDeliverable("roadmap") escribe json + html + xlsx priorizados', async () => {
  const outputDir = await mkdtemp(path.join(tmpdir(), 'f1-deliverable-'));
  const findings = [
    {
      wcag_criterion: '1.4.3', wcag_level: 'AA', wcag_description: 'Contraste (mínimo)', in_scope: 'onti',
      severity: 'serious', affected_urls: ['https://a.test'], occurrences: 2, remediation_hint: 'ajustar contraste'
    },
    {
      wcag_criterion: '1.1.1', wcag_level: 'A', wcag_description: 'Contenido no textual', in_scope: 'onti',
      severity: 'critical', affected_urls: ['https://a.test', 'https://b.test'], occurrences: 5, remediation_hint: 'agregar alt'
    }
  ];

  const filePaths = await generateDeliverable('roadmap', {
    jobId: 'job-7', channel: 'home_banking', findings, ontiCriteriaCompliant: 29, conformanceThreshold: 30
  }, { outputDir });

  assert.equal(filePaths.length, 3);
  const jsonPath = filePaths.find((p) => p.endsWith('.json'));
  const htmlPath = filePaths.find((p) => p.endsWith('.html'));

  const jsonDoc = JSON.parse(await readFile(jsonPath, 'utf8'));
  assert.equal(jsonDoc.items[0].wcag_criterion, '1.1.1'); // nivel A + critical va primero que AA + serious
  assert.equal(jsonDoc.items[0].quick_win_regulatorio, true); // compliant=29, threshold=30 -> falta 1

  const html = await readFile(htmlPath, 'utf8');
  assert.match(html, /Roadmap Preliminar de Remediación/);
  assert.match(html, /Quick win regulatorio/);
});

test('generateDeliverable("matriz") escribe json + html + xlsx con la vista por página', async () => {
  const outputDir = await mkdtemp(path.join(tmpdir(), 'f1-deliverable-'));
  const findings = [
    {
      id: 'f1', wcag_criterion: '1.1.1', wcag_level: 'A', wcag_description: 'Contenido no textual',
      in_scope: 'onti', severity: 'critical', affected_urls: ['https://a.test'], occurrences: 2
    }
  ];

  const filePaths = await generateDeliverable('matriz', {
    jobId: 'job-3', channel: 'home_banking', findings, urls: ['https://a.test', 'https://b.test']
  }, { outputDir });

  assert.equal(filePaths.length, 3);
  const jsonPath = filePaths.find((p) => p.endsWith('.json'));
  const htmlPath = filePaths.find((p) => p.endsWith('.html'));
  const xlsxPath = filePaths.find((p) => p.endsWith('.xlsx'));

  const jsonDoc = JSON.parse(await readFile(jsonPath, 'utf8'));
  assert.equal(jsonDoc.conformity_matrix.rows.length, 38);
  const criterio111 = jsonDoc.conformity_matrix.rows.find((r) => r.wcag_criterion === '1.1.1');
  assert.equal(criterio111.cells['https://a.test'], 'no_conforme');
  assert.equal(criterio111.cells['https://b.test'], 'conforme');
  assert.equal(jsonDoc.severity_impact_grid.length, 12);
  assert.equal(jsonDoc.module_conformity_matrix, null);

  const html = await readFile(htmlPath, 'utf8');
  assert.match(html, /Matriz de criticidad WCAG 2\.0 AA/);
  assert.match(html, /Conformidad de cada criterio en cada página/);

  const workbook = new ExcelJS.Workbook();
  await workbook.xlsx.readFile(xlsxPath);
  assert.deepEqual(workbook.worksheets.map((ws) => ws.name), ['Conformidad por página', 'Severidad x Impacto']);
});

test('generateDeliverable("matriz") marca no_aplica cuando se pasan axe_results con un criterio N/A', async () => {
  const outputDir = await mkdtemp(path.join(tmpdir(), 'f1-deliverable-'));
  const axeResults = [
    { url: 'https://a.test', violations: [], incomplete: [], passes: [], inapplicable: [{ id: 'video-caption', tags: ['wcag2a', 'wcag122'] }] }
  ];

  const filePaths = await generateDeliverable('matriz', {
    jobId: 'job-na', channel: 'home_banking', findings: [], urls: ['https://a.test'], axeResults
  }, { outputDir });

  const jsonPath = filePaths.find((p) => p.endsWith('.json'));
  const jsonDoc = JSON.parse(await readFile(jsonPath, 'utf8'));
  const criterio122 = jsonDoc.conformity_matrix.rows.find((r) => r.wcag_criterion === '1.2.2');
  assert.equal(criterio122.cells['https://a.test'], 'no_aplica');
});

test('generateDeliverable("matriz") no marca no_aplica si el criterio tiene un finding real de otra fuente', async () => {
  const outputDir = await mkdtemp(path.join(tmpdir(), 'f1-deliverable-'));
  const findings = [{
    id: 'f1', wcag_criterion: '1.2.2', wcag_level: 'A', wcag_description: 'Subtítulos (grabado)',
    in_scope: 'onti', severity: 'serious', review_status: 'confirmado', affected_urls: ['https://a.test'], occurrences: 1
  }];
  const axeResults = [
    { url: 'https://a.test', violations: [], incomplete: [], passes: [], inapplicable: [{ id: 'video-caption', tags: ['wcag2a', 'wcag122'] }] }
  ];

  const filePaths = await generateDeliverable('matriz', {
    jobId: 'job-c3', channel: 'home_banking', findings, urls: ['https://a.test'], axe_results: axeResults
  }, { outputDir });

  const jsonPath = filePaths.find((p) => p.endsWith('.json'));
  const jsonDoc = JSON.parse(await readFile(jsonPath, 'utf8'));
  const criterio122 = jsonDoc.conformity_matrix.rows.find((r) => r.wcag_criterion === '1.2.2');
  assert.equal(criterio122.cells['https://a.test'], 'no_conforme', 'debe reflejar el finding real, no ocultarlo detrás de no_aplica');
});

test('generateDeliverable("dashboard") escribe dashboard.html con las secciones de la SPEC §8.2', async () => {
  const outputDir = await mkdtemp(path.join(tmpdir(), 'f1-deliverable-'));
  const scores = {
    summary: {
      total_urls_evaluated: 2, onti_criteria_evaluated: 38, onti_criteria_compliant: 29,
      onti_compliance_percentage: 76.32, onti_conformance: false, conformance_threshold: 30,
      score_level_a: 80, score_level_aa: 69.23
    },
    extended_22: { total: 18, ok: 3, nok: 1, a_validar: 14 },
    by_url: [
      { url: 'https://a.test/home-banking/pago', module: 'home-banking', onti_compliance_percentage: 76.32, violations: 3, incomplete: 0 },
      { url: 'https://b.test', module: 'raiz', onti_compliance_percentage: 100, violations: 0, incomplete: 0 }
    ],
    by_module: [
      { module: 'home-banking', url_count: 1, onti_compliance_percentage: 76.32, violations: 3, incomplete: 0 },
      { module: 'raiz', url_count: 1, onti_compliance_percentage: 100, violations: 0, incomplete: 0 }
    ]
  };
  const findings = [
    {
      id: 'f1', wcag_criterion: '1.1.1', wcag_level: 'A', wcag_description: 'Contenido no textual',
      in_scope: 'onti', severity: 'critical', affected_urls: ['https://a.test'], occurrences: 3
    }
  ];

  const filePaths = await generateDeliverable('dashboard', { jobId: 'job-5', channel: 'home_banking', scores, findings }, { outputDir });

  assert.equal(filePaths.length, 1);
  const html = await readFile(filePaths[0], 'utf8');
  assert.match(html, /Score de cumplimiento inicial/);
  assert.match(html, /0 OK · 1 NOK/);
  assert.doesNotMatch(html, /CONFORME/);
  assert.match(html, /Capa extendida WCAG 2\.2/);
  assert.match(html, /Cumplimiento de los 38 criterios WCAG — Circular BCRA/);
  assert.match(html, /Cumplimiento por Principio y Pauta WCAG/);
  assert.match(html, /Resultado por página/);
  assert.match(html, /\/home-banking\/pago/);
  assert.match(html, /No se ejecutaron las pruebas de teclado del Agente/);
});

test('generateDeliverable("dashboard") usa axe_results: sección WCAG y anexo de reglas por página', async () => {
  const outputDir = await mkdtemp(path.join(tmpdir(), 'f1-deliverable-'));
  const axeResults = [{ url: 'https://a.test/', violations: [], incomplete: [],
    passes: [{ id: 'html-has-lang', tags: ['wcag2a', 'wcag311'] }], inapplicable: [] }];
  const scores = { summary: { total_urls_evaluated: 1 }, extended_22: null, by_url: [], by_module: [] };
  const [file] = await generateDeliverable('dashboard', { jobId: 'job-6', channel: 'home_banking', scores, findings: [], axeResults }, { outputDir });
  const html = await readFile(file, 'utf8');
  assert.match(html, /1 OK · 0 NOK/);
  assert.match(html, /Reglas evaluadas por página/);
});

test('generateDeliverable("dashboard") incluye las pruebas de teclado que llegan en keyboardResults', async () => {
  const outputDir = await mkdtemp(path.join(tmpdir(), 'f1-deliverable-'));
  const estado = (e) => ({ estado: e, paradas: [], motivo: 'm', fuente: 'reglas' });
  const keyboardResults = [{ url: 'https://a.test/', criteria: { '2.1.2': estado('sin_indicios'), '2.4.3': estado('sin_indicios'), '2.4.7': estado('con_indicios'), '3.2.1': estado('sin_indicios') } }];
  const scores = { summary: { total_urls_evaluated: 1 }, extended_22: null, by_url: [], by_module: [] };
  const [file] = await generateDeliverable('dashboard', { jobId: 'job-7', channel: 'home_banking', scores, findings: [], keyboardResults }, { outputDir });
  const html = await readFile(file, 'utf8');
  assert.match(html, /75%/);
  assert.doesNotMatch(html, /No se ejecutaron las pruebas de teclado/);
});

test('generateDeliverable("dashboard-consolidado") escribe score-consolidado.json + dashboard-consolidado.html', async () => {
  const outputDir = await mkdtemp(path.join(tmpdir(), 'f1-deliverable-'));
  const channels = [
    { job_id: 'job-hb', channel: 'home_banking', onti_criteria_compliant: 35, onti_criteria_evaluated: 38, onti_compliance_percentage: 92.1, onti_conformance: true, total_urls_evaluated: 10 },
    { job_id: 'job-ios', channel: 'app_ios', onti_criteria_compliant: 20, onti_criteria_evaluated: 38, onti_compliance_percentage: 52.6, onti_conformance: false, total_urls_evaluated: 5 }
  ];
  const global = { weighted_onti_compliance_percentage: 79.2, weighting_method: 'total_urls_evaluated', channels_conformant: 1, channels_total: 2, total_urls_evaluated: 15 };

  const filePaths = await generateDeliverable('dashboard-consolidado', { generated_at: new Date().toISOString(), channels, global }, { outputDir });

  assert.equal(filePaths.length, 2);
  const jsonPath = filePaths.find((p) => p.endsWith('.json'));
  const htmlPath = filePaths.find((p) => p.endsWith('.html'));

  const jsonDoc = JSON.parse(await readFile(jsonPath, 'utf8'));
  assert.equal(jsonDoc.channels.length, 2);
  assert.equal(jsonDoc.global.weighted_onti_compliance_percentage, 79.2);

  const html = await readFile(htmlPath, 'utf8');
  assert.match(html, /Dashboard Ejecutivo Consolidado/);
  assert.match(html, /Home Banking/);
  assert.match(html, /App iOS/);
});

test('generateDeliverable("informe-narrativo") escribe json + html con los 38 criterios y el resumen', async () => {
  const outputDir = await mkdtemp(path.join(tmpdir(), 'f1-deliverable-'));
  const findings = [
    {
      id: 'f1', wcag_criterion: '1.1.1', wcag_level: 'A', in_scope: 'onti', severity: 'critical',
      review_status: 'confirmado', source: 'axe-core', affected_urls: ['https://a.test'], occurrences: 1,
      element_sample: '<img>', failure_summary: 'Falta alt', remediation_hint: 'Agregar alt'
    }
  ];

  const filePaths = await generateDeliverable('informe-narrativo', {
    jobId: 'job-narrativo', channel: 'home_banking', findings
  }, { outputDir });

  assert.equal(filePaths.length, 2);
  const jsonPath = filePaths.find((p) => p.endsWith('.json'));
  const htmlPath = filePaths.find((p) => p.endsWith('.html'));

  const jsonDoc = JSON.parse(await readFile(jsonPath, 'utf8'));
  assert.equal(jsonDoc.criterios.length, 38);
  assert.equal(jsonDoc.criterios.find((c) => c.criterio === '1.1.1').estado, 'Crítico');
  assert.equal(jsonDoc.resumen.conteo_por_estado['Crítico'], 1);

  const html = await readFile(htmlPath, 'utf8');
  assert.match(html, /Informe Narrativo de Accesibilidad/);
  assert.match(html, /Informe general/);
});

test('generateDeliverable("informe-narrativo") marca no_aplica en el JSON cuando se pasan axe_results con un criterio N/A', async () => {
  const outputDir = await mkdtemp(path.join(tmpdir(), 'f1-deliverable-'));
  const axeResults = [
    { url: 'https://a.test', violations: [], incomplete: [], passes: [], inapplicable: [{ id: 'video-caption', tags: ['wcag2a', 'wcag122'] }] }
  ];

  const filePaths = await generateDeliverable('informe-narrativo', {
    jobId: 'job-na', channel: 'home_banking', findings: [], axe_results: axeResults
  }, { outputDir });

  const jsonPath = filePaths.find((p) => p.endsWith('.json'));
  const jsonDoc = JSON.parse(await readFile(jsonPath, 'utf8'));
  assert.equal(jsonDoc.criterios.find((c) => c.criterio === '1.2.2').estado, 'No aplica');
});

test('generateDeliverable rechaza un tipo no implementado', async () => {
  const outputDir = await mkdtemp(path.join(tmpdir(), 'f1-deliverable-'));
  await assert.rejects(
    () => generateDeliverable('tipo-que-no-existe', {}, { outputDir }),
    /no implementado/
  );
});

test('generateDeliverable requiere outputDir', async () => {
  await assert.rejects(
    () => generateDeliverable('score', { jobId: 'x', scores: SAMPLE_SCORES }, {}),
    /requiere "outputDir"/
  );
});

test('generateDeliverable: los hallazgos del Agente (visual/UX) no entran en los informes, solo como complementarios', async () => {
  const outputDir = await mkdtemp(path.join(tmpdir(), 'complementario-'));
  const axe = { id: 'x1', wcag_criterion: '1.1.1', wcag_level: 'A', wcag_description: 'Contenido no textual', in_scope: 'onti', severity: 'critical', source: 'axe-core', affected_urls: ['https://a.test'], occurrences: 1, rule_id: 'image-alt', review_status: 'confirmado' };
  const agente = { id: 'v1', wcag_criterion: '1.4.3', wcag_level: 'AA', wcag_description: 'Contraste', in_scope: 'onti', severity: 'serious', source: 'visual_audit', affected_urls: ['https://a.test'], occurrences: 1, failure_summary: 'Texto gris claro', remediation_hint: 'Oscurecer', rule_id: 'visual_audit:texto-gris' };

  const [jsonPath] = await generateDeliverable('inventario', { jobId: 'job-1', findings: [axe, agente] }, { outputDir });
  const inventario = JSON.parse(await readFile(jsonPath, 'utf8'));
  assert.deepEqual(inventario.findings.map((f) => f.id), ['x1']);
  assert.deepEqual(inventario.complementary_findings.map((f) => f.id), ['v1']);

  const [, htmlPath] = await generateDeliverable('roadmap', { jobId: 'job-1', channel: 'home_banking', findings: [axe, agente], ontiCriteriaCompliant: 37, conformanceThreshold: 30 }, { outputDir });
  const roadmapHtml = await readFile(htmlPath, 'utf8');
  assert.match(roadmapHtml, /1\.1\.1/);
  assert.doesNotMatch(roadmapHtml, /1\.4\.3/);

  const [, narrativoHtmlPath] = await generateDeliverable('informe-narrativo', { jobId: 'job-1', channel: 'home_banking', findings: [axe, agente] }, { outputDir });
  const narrativo = await readFile(narrativoHtmlPath, 'utf8');
  assert.match(narrativo, /Análisis complementario del Agente/);
  assert.match(narrativo, /Texto gris claro/);
});
