import { test } from 'node:test';
import assert from 'node:assert/strict';
import { buildInformeNarrativo, buildInformeNarrativoJson, buildInformeNarrativoHtml } from './informe-narrativo-deliverable.js';

function finding(overrides) {
  return {
    id: 'f1', wcag_criterion: '1.1.1', wcag_level: 'A', in_scope: 'onti',
    severity: 'critical', review_status: 'confirmado', source: 'axe-core',
    affected_urls: ['https://a.test'], occurrences: 1,
    element_sample: '<img>', failure_summary: 'Falta alt', remediation_hint: 'Agregar alt',
    ...overrides
  };
}

test('buildInformeNarrativo devuelve los 38 criterios ordenados numéricamente por Principio', () => {
  const { criterios } = buildInformeNarrativo({ findings: [] });
  assert.equal(criterios.length, 38);
  assert.equal(criterios[0].criterio, '1.1.1');
  assert.equal(criterios[0].principio, 'Perceptible');
  assert.equal(criterios[37].criterio, '4.1.2');
  assert.equal(criterios[37].principio, 'Robusto');
  for (let i = 1; i < criterios.length; i += 1) {
    const a = criterios[i - 1].criterio.split('.').map(Number);
    const b = criterios[i].criterio.split('.').map(Number);
    const menor = a[0] < b[0] || (a[0] === b[0] && (a[1] < b[1] || (a[1] === b[1] && a[2] < b[2])));
    assert.ok(menor, `${criterios[i - 1].criterio} debería ir antes que ${criterios[i].criterio}`);
  }
});

test('buildInformeNarrativo: sin findings, todos los criterios quedan "Cumple" con "Sin hallazgos"', () => {
  const { criterios } = buildInformeNarrativo({ findings: [] });
  assert.ok(criterios.every((c) => c.estado === 'Cumple'));
  assert.deepEqual(criterios[0].hallazgos, [{ descripcion: 'Sin hallazgos', herramientas: [], elementos_afectados: [], impacto_flujo: null }]);
});

test('buildInformeNarrativo: un criterio en naCriteria queda "No aplica" aunque tenga findings', () => {
  const { criterios } = buildInformeNarrativo({ findings: [finding()], naCriteria: ['1.1.1'] });
  assert.equal(criterios.find((c) => c.criterio === '1.1.1').estado, 'No aplica');
});

test('buildInformeNarrativo: un finding confirmado da la severidad correspondiente como estado', () => {
  const { criterios } = buildInformeNarrativo({ findings: [finding({ wcag_level: 'A', severity: 'critical' })] });
  assert.equal(criterios.find((c) => c.criterio === '1.1.1').estado, 'Crítico');
});

test('buildInformeNarrativo: solo un finding "requiere_revision" (sin confirmado) da "Requiere revisión"', () => {
  const { criterios } = buildInformeNarrativo({ findings: [finding({ review_status: 'requiere_revision' })] });
  assert.equal(criterios.find((c) => c.criterio === '1.1.1').estado, 'Requiere revisión');
});

test('buildInformeNarrativo: un finding confirmado gana sobre uno requiere_revision del mismo criterio', () => {
  const findings = [
    finding({ review_status: 'requiere_revision' }),
    finding({ review_status: 'confirmado', severity: 'moderate' })
  ];
  const { criterios } = buildInformeNarrativo({ findings });
  assert.notEqual(criterios.find((c) => c.criterio === '1.1.1').estado, 'Requiere revisión');
});

test('buildInformeNarrativo: hallazgos mapea descripcion/herramientas/elementos desde el finding', () => {
  const { criterios } = buildInformeNarrativo({ findings: [finding({ source: 'visual_audit' })] });
  const hallazgo = criterios.find((c) => c.criterio === '1.1.1').hallazgos[0];
  assert.equal(hallazgo.descripcion, 'Falta alt');
  assert.deepEqual(hallazgo.herramientas, ['IA (revisión visual)']);
  assert.deepEqual(hallazgo.elementos_afectados, ['<img>']);
  assert.match(hallazgo.impacto_flujo, /No determinado/);
});

test('buildInformeNarrativo: resumen cuenta por estado y prioriza Crítico+Alto', () => {
  const findings = [
    finding({ wcag_criterion: '1.1.1', wcag_level: 'A', severity: 'critical' }),
    finding({ wcag_criterion: '2.4.4', wcag_level: 'A', severity: 'serious' })
  ];
  const { resumen } = buildInformeNarrativo({ findings });
  assert.equal(resumen.conteo_por_estado['Crítico'], 1);
  assert.equal(resumen.conteo_por_estado['Alto'], 1);
  assert.equal(resumen.conteo_por_estado['Cumple'], 36);
  assert.equal(resumen.hallazgos_prioritarios.length, 2);
  assert.match(resumen.recomendacion_general, /1 criterio/);
});

test('buildInformeNarrativo: resumen.flujos_esenciales_afectados dice "No determinado" sin config de essential_flows', () => {
  const { resumen } = buildInformeNarrativo({ findings: [finding()] });
  assert.match(resumen.flujos_esenciales_afectados, /No determinado/);
});

test('buildInformeNarrativo: resumen.flujos_esenciales_afectados lista los flujos realmente afectados por un hallazgo', () => {
  const essentialFlows = [{ name: 'Login', url_pattern: 'https://a.test/*' }];
  const findings = [finding({ affected_urls: ['https://a.test/login'] })];
  const { resumen } = buildInformeNarrativo({ findings, essentialFlows });
  assert.match(resumen.flujos_esenciales_afectados, /Login/);
});

test('buildInformeNarrativo: resumen.flujos_esenciales_afectados dice que ninguno fue afectado si hay config pero ningún hallazgo cae en flujos', () => {
  const essentialFlows = [{ name: 'Login', url_pattern: 'https://otra.test/*' }];
  const { resumen } = buildInformeNarrativo({ findings: [], essentialFlows });
  assert.match(resumen.flujos_esenciales_afectados, /Ningún flujo esencial configurado/);
});

test('buildInformeNarrativoJson envuelve con job_id/channel/generated_at', () => {
  const doc = buildInformeNarrativoJson({ jobId: 'job-1', channel: 'home_banking', findings: [] });
  assert.equal(doc.job_id, 'job-1');
  assert.equal(doc.channel, 'home_banking');
  assert.ok(doc.generated_at);
  assert.equal(doc.criterios.length, 38);
});

test('buildInformeNarrativoHtml escapa HTML y documenta la exclusión de Lighthouse/WAVE/Accessibility Insights/ARC Toolkit', () => {
  const findings = [finding({ failure_summary: '<script>alert(1)</script>' })];
  const html = buildInformeNarrativoHtml({ jobId: 'job-1', channel: 'home_banking', findings });
  assert.ok(!html.includes('<script>alert(1)</script>'));
  assert.match(html, /Lighthouse/);
  assert.match(html, /WAVE/);
  assert.match(html, /Accessibility Insights/);
  assert.match(html, /ARC Toolkit/);
  assert.match(html, /Resumen final/);
});
