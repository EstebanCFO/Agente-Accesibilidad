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

test('buildRoadmapItems deja afuera lo que axe no pudo decidir (queda a validar, no es un NOK)', () => {
  const items = buildRoadmapItems([finding({ review_status: 'requiere_revision' }), finding({ wcag_criterion: '1.4.3', review_status: 'confirmado' })]);
  assert.deepEqual(items.map((i) => i.wcag_criterion), ['1.4.3']);
});

test('buildRoadmapItems deja afuera los hallazgos complementarios del Agente', () => {
  const items = buildRoadmapItems([finding({ source: 'keyboard_review' }), finding({ wcag_criterion: '1.4.3', source: 'axe-core' })]);
  assert.deepEqual(items.map((i) => i.wcag_criterion), ['1.4.3']);
});

test('buildRoadmapItems ya no marca quick win regulatorio (no hay umbral)', () => {
  assert.equal('quick_win_regulatorio' in buildRoadmapItems([finding()])[0], false);
});

test('buildRoadmapHtml lista las buenas prácticas a mejorar en una sección aparte', () => {
  const bestPractices = { score: 60, cumple: 3, mejora: 1, no_aplica: 2, rules: [
    { rule_id: 'region', help: 'Todo el contenido debe estar dentro de regiones', impact: 'moderate', weight: 2, status: 'mejora', affected_urls: ['https://a.test'] },
    { rule_id: 'skip-link', help: 'x', impact: 'moderate', weight: 2, status: 'cumple', affected_urls: [] }
  ] };
  const html = buildRoadmapHtml({ jobId: 'job-1', channel: 'home_banking', items: buildRoadmapItems([finding()]), bestPractices });
  assert.match(html, /Mejoras sugeridas/);
  assert.match(html, /Todo el contenido debe estar dentro de regiones/);
  assert.doesNotMatch(html, /skip-link/);
  assert.doesNotMatch(html, /Quick win/);
});
