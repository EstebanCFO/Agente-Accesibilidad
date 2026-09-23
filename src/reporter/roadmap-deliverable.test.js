import { test } from 'node:test';
import assert from 'node:assert/strict';
import { buildRoadmapItems, buildRoadmapJson, buildRoadmapHtml } from './roadmap-deliverable.js';

function finding(overrides) {
  return {
    wcag_criterion: '1.1.1',
    wcag_level: 'A',
    wcag_description: 'Contenido no textual',
    in_scope: 'onti',
    severity: 'critical',
    affected_urls: ['https://a.test'],
    occurrences: 1,
    remediation_hint: 'agregar alt',
    ...overrides
  };
}

test('buildRoadmapItems prioriza ONTI antes que la capa extendida', () => {
  const findings = [
    finding({ wcag_criterion: '2.5.8', in_scope: 'extended_22', severity: 'critical' }),
    finding({ wcag_criterion: '1.1.1', in_scope: 'onti', severity: 'minor' })
  ];
  const items = buildRoadmapItems(findings);
  assert.equal(items[0].wcag_criterion, '1.1.1');
  assert.equal(items[1].wcag_criterion, '2.5.8');
});

test('buildRoadmapItems prioriza Nivel A sobre AA dentro de ONTI', () => {
  const findings = [
    finding({ wcag_criterion: '1.4.3', wcag_level: 'AA', severity: 'critical' }),
    finding({ wcag_criterion: '2.1.1', wcag_level: 'A', severity: 'minor' })
  ];
  const items = buildRoadmapItems(findings);
  assert.equal(items[0].wcag_criterion, '2.1.1');
});

test('buildRoadmapItems prioriza severidad dentro del mismo nivel', () => {
  const findings = [
    finding({ wcag_criterion: '2.1.1', severity: 'minor' }),
    finding({ wcag_criterion: '2.1.2', severity: 'critical' })
  ];
  const items = buildRoadmapItems(findings);
  assert.equal(items[0].wcag_criterion, '2.1.2');
});

test('buildRoadmapItems prioriza más URLs afectadas ante un empate en lo anterior', () => {
  const findings = [
    finding({ wcag_criterion: '2.1.1', affected_urls: ['https://a.test'] }),
    finding({ wcag_criterion: '2.1.2', affected_urls: ['https://a.test', 'https://b.test', 'https://c.test'] })
  ];
  const items = buildRoadmapItems(findings);
  assert.equal(items[0].wcag_criterion, '2.1.2');
});

test('buildRoadmapItems asigna priority_rank consecutivo desde 1', () => {
  const items = buildRoadmapItems([finding(), finding({ wcag_criterion: '1.4.3' })]);
  assert.deepEqual(items.map((i) => i.priority_rank), [1, 2]);
});

test('quick_win_regulatorio: solo se marca cuando falta exactamente 1 criterio para el umbral', () => {
  const findings = [finding()];

  const faltaUno = buildRoadmapItems(findings, { ontiCriteriaCompliant: 29, conformanceThreshold: 30 });
  assert.equal(faltaUno[0].quick_win_regulatorio, true);

  const faltanVarios = buildRoadmapItems(findings, { ontiCriteriaCompliant: 20, conformanceThreshold: 30 });
  assert.equal(faltanVarios[0].quick_win_regulatorio, false);

  const yaConforme = buildRoadmapItems(findings, { ontiCriteriaCompliant: 35, conformanceThreshold: 30 });
  assert.equal(yaConforme[0].quick_win_regulatorio, false);
});

test('quick_win_regulatorio nunca se marca en la capa extendida', () => {
  const findings = [finding({ in_scope: 'extended_22' })];
  const items = buildRoadmapItems(findings, { ontiCriteriaCompliant: 29, conformanceThreshold: 30 });
  assert.equal(items[0].quick_win_regulatorio, false);
});

test('estimated_effort siempre null (pendiente del skill improve-ui, no se inventa)', () => {
  const items = buildRoadmapItems([finding()]);
  assert.equal(items[0].estimated_effort, null);
});

test('buildRoadmapJson envuelve los items con job_id y total_items', () => {
  const items = buildRoadmapItems([finding()]);
  const doc = buildRoadmapJson({ jobId: 'job-1', items });
  assert.equal(doc.job_id, 'job-1');
  assert.equal(doc.total_items, 1);
});

test('buildRoadmapItems conserva review_status de cada finding', () => {
  const findings = [{ wcag_criterion: '1.1.1', wcag_level: 'A', in_scope: 'onti', severity: 'critical', review_status: 'requiere_revision', affected_urls: ['https://a.test'], occurrences: 1 }];
  const items = buildRoadmapItems(findings);
  assert.equal(items[0].review_status, 'requiere_revision');
});

test('buildRoadmapItems usa "confirmado" si review_status no viene en el finding', () => {
  const findings = [{ wcag_criterion: '1.1.1', wcag_level: 'A', in_scope: 'onti', severity: 'critical', affected_urls: ['https://a.test'], occurrences: 1 }];
  const items = buildRoadmapItems(findings);
  assert.equal(items[0].review_status, 'confirmado');
});

test('buildRoadmapHtml escapa HTML en la descripción para evitar inyección', () => {
  const items = buildRoadmapItems([finding({ wcag_description: '<script>alert(1)</script>' })]);
  const html = buildRoadmapHtml({ jobId: 'job-1', channel: 'home_banking', items });
  assert.ok(!html.includes('<script>alert(1)</script>'));
  assert.match(html, /&lt;script&gt;/);
});
