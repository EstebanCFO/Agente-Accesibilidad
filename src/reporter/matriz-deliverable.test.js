import { test } from 'node:test';
import assert from 'node:assert/strict';
import { buildConformityMatrix, buildModuleConformityMatrix, buildSeverityImpactGrid, buildMatrizHtml, buildMatrizWorkbook } from './matriz-deliverable.js';
import { criteriaWithoutAutomatedRules } from './report-helpers.js';

const SIN_REGLAS = criteriaWithoutAutomatedRules().missing;

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

// Página donde la regla image-alt (1.1.1) se evaluó y pasó.
const pagina = (url, passes = [{ id: 'image-alt', tags: ['wcag2a', 'wcag111'] }]) => ({ url, violations: [], incomplete: [], passes, inapplicable: [] });
const cell = (conformity, criterion, column) => conformity.rows.find((r) => r.wcag_criterion === criterion).cells[column];

test('buildConformityMatrix cubre los 38 criterios ONTI y usa URLs como columnas', () => {
  const { urls, rows } = buildConformityMatrix({ findings: [], urls: ['https://a.test', 'https://b.test'] });
  assert.deepEqual(urls, ['https://a.test', 'https://b.test']);
  assert.equal(rows.length, 38);
});

test('buildConformityMatrix: NOK solo en la página afectada; OK donde la regla pasó; a validar si no se verificó', () => {
  const conformity = buildConformityMatrix({
    findings: [finding()], urls: ['https://a.test', 'https://b.test', 'https://c.test'],
    axeResults: [pagina('https://a.test'), pagina('https://b.test'), pagina('https://c.test', [])]
  });
  assert.equal(cell(conformity, '1.1.1', 'https://a.test'), 'nok');
  assert.equal(cell(conformity, '1.1.1', 'https://b.test'), 'ok');
  assert.equal(cell(conformity, '1.1.1', 'https://c.test'), 'a_validar');
});

test('buildConformityMatrix: sin datos de escaneo nada se da por OK', () => {
  const conformity = buildConformityMatrix({ findings: [], urls: ['https://a.test'] });
  assert.ok(conformity.rows.every((r) => r.cells['https://a.test'] === 'a_validar'));
});

test('buildConformityMatrix: incomplete queda a validar y un NOK en la misma celda gana', () => {
  const soloRevision = buildConformityMatrix({ findings: [finding({ review_status: 'requiere_revision' })], urls: ['https://a.test'], axeResults: [pagina('https://a.test')] });
  assert.equal(cell(soloRevision, '1.1.1', 'https://a.test'), 'a_validar');
  const ambos = buildConformityMatrix({ findings: [finding({ review_status: 'requiere_revision' }), finding({ review_status: 'confirmado' })], urls: ['https://a.test'], axeResults: [pagina('https://a.test')] });
  assert.equal(cell(ambos, '1.1.1', 'https://a.test'), 'nok');
});

test('buildConformityMatrix trata un review_status desconocido como confirmado (nunca asumir éxito)', () => {
  const conformity = buildConformityMatrix({ findings: [finding({ review_status: undefined })], urls: ['https://a.test'] });
  assert.equal(cell(conformity, '1.1.1', 'https://a.test'), 'nok');
});

test('buildConformityMatrix: criterios sin reglas automáticas quedan a validar con su método', () => {
  if (SIN_REGLAS.length === 0) return;
  const conformity = buildConformityMatrix({ findings: [], urls: ['https://a.test'], axeResults: [pagina('https://a.test')] });
  const row = conformity.rows.find((r) => r.wcag_criterion === SIN_REGLAS[0]);
  assert.equal(row.cells['https://a.test'], 'a_validar');
  assert.ok(row.manual_review);
});

test('buildConformityMatrix agrega la capa extendida solo si includeExtended=true', () => {
  assert.equal(buildConformityMatrix({ findings: [], urls: ['https://a.test'], includeExtended: true }).rows.length, 56);
});

test('buildConformityMatrix ignora findings de la capa extendida si includeExtended=false', () => {
  const conformity = buildConformityMatrix({ findings: [finding({ wcag_criterion: '2.5.8', in_scope: 'extended_22' })], urls: ['https://a.test'] });
  assert.ok(conformity.rows.every((r) => r.cells['https://a.test'] !== 'nok'));
});

test('buildModuleConformityMatrix: peor caso entre las páginas del módulo; OK solo si todas lo están', () => {
  const urls = ['https://a.test/home-banking/pago', 'https://a.test/home-banking/cuentas', 'https://a.test/onboarding/paso1'];
  const axeResults = [pagina(urls[0]), pagina(urls[1], []), pagina(urls[2])];
  const conError = buildModuleConformityMatrix({ findings: [finding({ affected_urls: [urls[0]] })], urls, axeResults });
  assert.equal(cell(conError, '1.1.1', 'home-banking'), 'nok');
  assert.equal(cell(conError, '1.1.1', 'onboarding'), 'ok');
  const sinError = buildModuleConformityMatrix({ findings: [], urls, axeResults });
  assert.equal(cell(sinError, '1.1.1', 'home-banking'), 'a_validar');
});

test('buildMatrizHtml: una sola vista por página (path), sin columna Alcance ni datos técnicos', () => {
  const conformity = buildConformityMatrix({ findings: [], urls: ['https://a.test/', 'https://a.test/cuentas'] });
  const html = buildMatrizHtml({ jobId: 'job-1', channel: 'home_banking', conformity, severityImpactGrid: buildSeverityImpactGrid([]) });
  assert.match(html, /Matriz de criticidad WCAG 2\.0 AA/);
  assert.match(html, /<th title="https:\/\/a\.test\/cuentas">\/cuentas<\/th>/);
  assert.match(html, /Problemas por severidad e impacto en el usuario/);
  assert.doesNotMatch(html, /<th>Alcance<\/th>/);
});

test('buildMatrizHtml usa OK / NOK / A validar, sin Conforme, Parcial ni N/A', () => {
  const conformity = buildConformityMatrix({ findings: [finding()], urls: ['https://a.test', 'https://b.test'], axeResults: [pagina('https://a.test'), pagina('https://b.test')] });
  const html = buildMatrizHtml({ jobId: 'job-1', channel: 'home_banking', conformity, severityImpactGrid: buildSeverityImpactGrid([]) });
  assert.match(html, /class="status-nok">NOK</);
  assert.match(html, /class="status-ok">OK</);
  assert.match(html, /class="status-a_validar">A validar</);
  assert.doesNotMatch(html, /Conforme|Parcial|N\/A|No evaluado/);
});

test('buildMatrizWorkbook agrega una hoja de Buenas prácticas', async () => {
  const conformity = buildConformityMatrix({ findings: [], urls: ['https://a.test'] });
  const bestPractices = { score: 50, cumple: 1, mejora: 1, no_aplica: 0, rules: [
    { rule_id: 'region', help: 'Regiones', impact: 'moderate', weight: 2, status: 'mejora', affected_urls: ['https://a.test'] },
    { rule_id: 'skip-link', help: 'Saltar', impact: 'moderate', weight: 2, status: 'cumple', affected_urls: [] }
  ] };
  const workbook = await buildMatrizWorkbook({ conformity, severityImpactGrid: buildSeverityImpactGrid([]), bestPractices });
  const sheet = workbook.getWorksheet('Buenas prácticas');
  assert.ok(sheet);
  assert.equal(sheet.rowCount, 3);
  assert.equal(sheet.getRow(2).getCell(1).value, 'region');
  assert.equal(sheet.getRow(2).getCell(3).value, 'Mejora sugerida');
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
