import { test } from 'node:test';
import assert from 'node:assert/strict';
import { buildInventarioJson, buildInventarioWorkbook } from './inventario-deliverable.js';

function finding(overrides) {
  return {
    id: `id-${Math.random()}`,
    source: 'axe-core',
    wcag_criterion: '1.1.1',
    wcag_level: 'A',
    wcag_description: 'Contenido no textual',
    onti_criterion: true,
    in_scope: 'onti',
    severity: 'critical',
    rule_id: 'image-alt',
    affected_urls: ['https://a.test'],
    occurrences: 3,
    element_sample: '<img>',
    failure_summary: 'falta alt',
    remediation_hint: 'agregar alt',
    ...overrides
  };
}

test('buildInventarioJson envuelve los findings con job_id y total_findings', () => {
  const findings = [finding()];
  const doc = buildInventarioJson({ jobId: 'job-1', findings });
  assert.equal(doc.job_id, 'job-1');
  assert.equal(doc.total_findings, 1);
  assert.deepEqual(doc.findings, findings);
});

test('buildInventarioWorkbook genera las 4 hojas que pide la SPEC §8.3', async () => {
  const findings = [
    finding({ wcag_criterion: '1.1.1', in_scope: 'onti', severity: 'critical', occurrences: 3 }),
    finding({ wcag_criterion: '1.1.1', in_scope: 'onti', severity: 'minor', occurrences: 1, affected_urls: ['https://b.test'] }),
    finding({ wcag_criterion: '2.5.8', in_scope: 'extended_22', onti_criterion: false, severity: 'moderate', occurrences: 2 })
  ];

  const workbook = await buildInventarioWorkbook(findings);
  const sheetNames = workbook.worksheets.map((ws) => ws.name);
  assert.deepEqual(sheetNames, ['Hallazgos', 'Pivot por criterio WCAG', 'Solo ONTI', 'Resumen']);

  const hallazgos = workbook.getWorksheet('Hallazgos');
  assert.equal(hallazgos.rowCount - 1, 3); // -1 por la fila de header

  const pivot = workbook.getWorksheet('Pivot por criterio WCAG');
  assert.equal(pivot.rowCount - 1, 2); // dos criterios distintos: 1.1.1 y 2.5.8
  const filaOnti = pivot.getRow(2);
  assert.equal(filaOnti.getCell('findings_count').value, 2);
  assert.equal(filaOnti.getCell('total_occurrences').value, 4);
  assert.equal(filaOnti.getCell('worst_severity').value, 'critical');

  const soloOnti = workbook.getWorksheet('Solo ONTI');
  assert.equal(soloOnti.rowCount - 1, 2); // descarta el finding extended_22

  const resumen = workbook.getWorksheet('Resumen');
  assert.ok(resumen.rowCount > 1);
});
