import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFile, mkdtemp } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { buildConsolidatedReportHtml, scopeCss, criteriaWithoutAutomatedRules } from './pdf-report-deliverable.js';
import { generateDeliverable } from './generate-deliverable.js';
import { calculateScore } from '../classification/calculate-score.js';

const axe = { id: 'x1', wcag_criterion: '1.1.1', wcag_level: 'A', wcag_description: 'Contenido no textual', in_scope: 'onti', severity: 'critical', source: 'axe-core', affected_urls: ['https://a.test/cuentas'], occurrences: 2, rule_id: 'image-alt', review_status: 'confirmado', remediation_hint: 'Agregar alt' };
const agente = { id: 'v1', wcag_criterion: '1.4.3', wcag_level: 'AA', wcag_description: 'Contraste', in_scope: 'onti', severity: 'serious', source: 'visual_audit', affected_urls: ['https://a.test/cuentas'], occurrences: 1, failure_summary: 'Gris sobre gris ilegible', remediation_hint: 'Oscurecer', rule_id: 'visual_audit:gris' };

function data() {
  const findings = [axe, agente];
  return { jobId: 'job-pdf', channel: 'home_banking', findings, urls: ['https://a.test/cuentas'], scores: calculateScore(findings), axeResults: [] };
}

test('buildConsolidatedReportHtml arma portada, metodología, inventario y matriz (sin el Score de cumplimiento inicial)', () => {
  const html = buildConsolidatedReportHtml(data());
  for (const title of ['Informe de Auditoría de Accesibilidad Digital', 'Alcance y metodología', 'Inventario de hallazgos', 'Matriz de criticidad WCAG 2.0 AA']) {
    assert.ok(html.includes(title), title);
  }
  for (const removed of ['Roadmap de remediación', 'Informe general y detalle por criterio', 'Score de cumplimiento inicial', 'sec-dashboard']) {
    assert.ok(!html.includes(removed), removed);
  }
  const cover = html.slice(0, html.indexOf('Alcance y metodología'));
  assert.match(cover, /0 OK · 1 NOK/);
  assert.match(cover, /37 a validar \(de 38\)/);
  assert.doesNotMatch(html, /CONFORME/);
  assert.doesNotMatch(html, /umbral regulatorio/i);
  assert.doesNotMatch(html, /los sigue contando como conformes/);
  assert.doesNotMatch(html, /<script/);
});

test('buildConsolidatedReportHtml: la revisión del Agente aparece solo como complementaria', () => {
  const html = buildConsolidatedReportHtml(data());
  assert.match(html, /Análisis complementario del Agente/);
  assert.match(html, /Gris sobre gris ilegible/);
  // La tabla del inventario (basada en axe-core) no lista el criterio que solo marcó la IA.
  const inventario = html.slice(html.indexOf('<section class="pdf-section sec-inventario">'), html.indexOf('<section class="pdf-section sec-matriz">'));
  const tabla = inventario.slice(0, inventario.indexOf('Análisis complementario del Agente'));
  assert.match(tabla, /1\.1\.1/);
  assert.doesNotMatch(tabla, /1\.4\.3/);
});

test('buildConsolidatedReportHtml declara los criterios sin reglas automáticas', () => {
  const { missing } = criteriaWithoutAutomatedRules();
  const html = buildConsolidatedReportHtml(data());
  if (missing.length > 0) assert.match(html, new RegExp(`${missing.length} de los 38 criterios no tienen ninguna regla automática`));
});

test('scopeCss prefija selectores y respeta body', () => {
  assert.equal(scopeCss('table { a: 1; } body { b: 2; } td.x, th { c: 3; }', '.sec-m').replace(/\s+/g, ' ').trim(),
    '.sec-m table { a: 1; } .sec-m { b: 2; } .sec-m td.x, .sec-m th { c: 3; }');
});

test('generateDeliverable("informe-pdf") genera un PDF válido', { timeout: 60000 }, async () => {
  const outputDir = await mkdtemp(path.join(tmpdir(), 'pdf-'));
  const [pdfPath] = await generateDeliverable('informe-pdf', data(), { outputDir });
  const bytes = await readFile(pdfPath);
  assert.equal(bytes.subarray(0, 5).toString(), '%PDF-');
  assert.ok(bytes.length > 20000);
});

test('buildConsolidatedReportHtml: la metodología describe las pruebas de teclado, no la revisión visual/UX', () => {
  const html = buildConsolidatedReportHtml({ ...data(), findings: [axe] });
  // La metodología es la primera sección del PDF (antes del Inventario de hallazgos).
  const metodologia = html.slice(html.indexOf('<section class="pdf-section">'), html.indexOf('pdf-section sec-inventario'));
  assert.match(metodologia, /Pruebas de teclado del Agente/);
  assert.doesNotMatch(metodologia, /revisión visual y de UX/);
});
