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

test('generateDeliverable("inventario") escribe json + xlsx con las 4 hojas', async () => {
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

  assert.equal(filePaths.length, 2);
  const jsonPath = filePaths.find((p) => p.endsWith('.json'));
  const xlsxPath = filePaths.find((p) => p.endsWith('.xlsx'));

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

test('generateDeliverable("matriz") escribe json + html + xlsx con las dos vistas', async () => {
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
  // https://a.test y https://b.test no tienen path -> ambas caen en el módulo 'raiz'.
  assert.deepEqual(jsonDoc.module_conformity_matrix.modules, ['raiz']);
  assert.equal(jsonDoc.module_conformity_matrix.rows.length, 38);
  assert.equal(jsonDoc.module_conformity_matrix.rows.find((r) => r.wcag_criterion === '1.1.1').cells.raiz, 'no_conforme');

  const html = await readFile(htmlPath, 'utf8');
  assert.match(html, /Matriz de Criticidad/);
  assert.match(html, /por módulo/i);

  const workbook = new ExcelJS.Workbook();
  await workbook.xlsx.readFile(xlsxPath);
  assert.deepEqual(workbook.worksheets.map((ws) => ws.name), ['Conformidad por módulo', 'Conformidad', 'Severidad x Impacto']);
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

test('generateDeliverable("dashboard") escribe dashboard.html con las secciones de la SPEC §8.2', async () => {
  const outputDir = await mkdtemp(path.join(tmpdir(), 'f1-deliverable-'));
  const scores = {
    summary: {
      total_urls_evaluated: 2, onti_criteria_evaluated: 38, onti_criteria_compliant: 29,
      onti_compliance_percentage: 76.32, onti_conformance: false, conformance_threshold: 30,
      score_level_a: 80, score_level_aa: 69.23
    },
    extended_22: { criteria_evaluated: 18, criteria_compliant: 17, compliance_percentage: 94.44, by_criterion: [] },
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
  assert.match(html, /Dashboard Ejecutivo/);
  assert.match(html, /NO CONFORME/);
  assert.match(html, /Capa extendida WCAG 2\.2/);
  assert.match(html, /Top 10 criterios ONTI más vulnerados/);
  assert.match(html, /Distribución por módulo/);
  assert.match(html, /home-banking/);
  assert.match(html, /No disponible — los skills externos/);
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
