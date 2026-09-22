import { test } from 'node:test';
import assert from 'node:assert/strict';
import { buildConformityMatrix, buildModuleConformityMatrix, buildSeverityImpactGrid, buildMatrizHtml } from './matriz-deliverable.js';

function finding(overrides) {
  return {
    id: `f-${Math.random()}`,
    wcag_criterion: '1.1.1',
    wcag_level: 'A',
    wcag_description: 'Contenido no textual',
    in_scope: 'onti',
    severity: 'critical',
    affected_urls: ['https://a.test'],
    occurrences: 1,
    ...overrides
  };
}

test('buildConformityMatrix cubre los 38 criterios ONTI y usa URLs como columnas', () => {
  const { rows, urls } = buildConformityMatrix({ findings: [], urls: ['https://a.test', 'https://b.test'] });
  assert.equal(rows.length, 38);
  assert.deepEqual(urls, ['https://a.test', 'https://b.test']);
  for (const row of rows) {
    assert.equal(row.cells['https://a.test'], 'conforme');
    assert.equal(row.cells['https://b.test'], 'conforme');
  }
});

test('buildConformityMatrix marca no_conforme solo en la URL afectada por el finding', () => {
  const findings = [finding({ affected_urls: ['https://a.test'] })];
  const { rows } = buildConformityMatrix({ findings, urls: ['https://a.test', 'https://b.test'] });
  const criterio111 = rows.find((r) => r.wcag_criterion === '1.1.1');
  assert.equal(criterio111.cells['https://a.test'], 'no_conforme');
  assert.equal(criterio111.cells['https://b.test'], 'conforme');
});

test('buildConformityMatrix agrega la capa extendida solo si includeExtended=true', () => {
  const sinExtendida = buildConformityMatrix({ findings: [], urls: [], includeExtended: false });
  assert.equal(sinExtendida.rows.length, 38);

  const conExtendida = buildConformityMatrix({ findings: [], urls: [], includeExtended: true });
  assert.equal(conExtendida.rows.length, 56);
  assert.ok(conExtendida.rows.some((r) => r.in_scope === 'extended_22'));
});

test('buildConformityMatrix ignora findings de la capa extendida si includeExtended=false', () => {
  const findings = [finding({ wcag_criterion: '2.5.8', wcag_level: 'AA', in_scope: 'extended_22', affected_urls: ['https://a.test'] })];
  const { rows } = buildConformityMatrix({ findings, urls: ['https://a.test'], includeExtended: false });
  // ningún criterio ONTI de los 38 debería quedar no_conforme por este finding
  assert.ok(rows.every((r) => r.cells['https://a.test'] === 'conforme'));
});

test('buildSeverityImpactGrid cubre las 12 combinaciones severidad x impacto', () => {
  const grid = buildSeverityImpactGrid([]);
  assert.equal(grid.length, 12);
  assert.ok(grid.every((cell) => cell.findings_count === 0));
});

test('buildSeverityImpactGrid: un finding ONTI nivel A cae en bloqueante', () => {
  const findings = [finding({ in_scope: 'onti', wcag_level: 'A', severity: 'critical' })];
  const grid = buildSeverityImpactGrid(findings);
  const cell = grid.find((c) => c.severity === 'critical' && c.impacto === 'bloqueante');
  assert.equal(cell.findings_count, 1);
  assert.deepEqual(cell.finding_ids, [findings[0].id]);
});

test('buildSeverityImpactGrid: un finding ONTI nivel AA cae en degradado, y extended_22 en menor', () => {
  const findings = [
    finding({ in_scope: 'onti', wcag_level: 'AA', severity: 'serious' }),
    finding({ in_scope: 'extended_22', wcag_level: 'AA', severity: 'serious' })
  ];
  const grid = buildSeverityImpactGrid(findings);
  assert.equal(grid.find((c) => c.severity === 'serious' && c.impacto === 'degradado').findings_count, 1);
  assert.equal(grid.find((c) => c.severity === 'serious' && c.impacto === 'menor').findings_count, 1);
});

test('buildMatrizHtml incluye la vista por módulo además de la vista por URL', () => {
  const conformity = buildConformityMatrix({ findings: [], urls: ['https://a.test'] });
  const moduleConformity = buildModuleConformityMatrix({ findings: [], urls: ['https://a.test'] });
  const grid = buildSeverityImpactGrid([]);
  const html = buildMatrizHtml({ jobId: 'job-1', channel: 'home_banking', conformity, moduleConformity, severityImpactGrid: grid });
  assert.match(html, /Matriz de Criticidad/);
  assert.match(html, /módulo/i);
});

test('buildModuleConformityMatrix agrupa URLs del mismo módulo y hereda no_conforme de cualquiera de ellas', () => {
  const findings = [finding({ affected_urls: ['https://a.test/home-banking/pago'] })];
  const urls = ['https://a.test/home-banking/pago', 'https://a.test/home-banking/transferencias', 'https://a.test/onboarding/paso1'];

  const { modules, rows } = buildModuleConformityMatrix({ findings, urls });

  assert.deepEqual([...modules].sort(), ['home-banking', 'onboarding']);
  const criterio111 = rows.find((r) => r.wcag_criterion === '1.1.1');
  assert.equal(criterio111.cells['home-banking'], 'no_conforme');
  assert.equal(criterio111.cells['onboarding'], 'conforme');
});
