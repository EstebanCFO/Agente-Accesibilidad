import { test } from 'node:test';
import assert from 'node:assert/strict';
import { buildInformeNarrativo, buildInformeNarrativoJson, buildInformeNarrativoHtml } from './informe-narrativo-deliverable.js';
import { criteriaWithoutAutomatedRules } from './report-helpers.js';
const SIN_REGLAS = new Set(criteriaWithoutAutomatedRules().missing);


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

test('buildInformeNarrativo: un finding confirmado da la severidad correspondiente como estado', () => {
  const { criterios } = buildInformeNarrativo({ findings: [finding({ wcag_level: 'A', severity: 'critical' })] });
  assert.equal(criterios.find((c) => c.criterio === '1.1.1').estado, 'Crítico');
});

test('buildInformeNarrativo: un finding confirmado gana sobre uno requiere_revision del mismo criterio', () => {
  const findings = [
    finding({ review_status: 'requiere_revision' }),
    finding({ review_status: 'confirmado', severity: 'moderate' })
  ];
  const { criterios } = buildInformeNarrativo({ findings });
  assert.notEqual(criterios.find((c) => c.criterio === '1.1.1').estado, 'A validar');
});

test('buildInformeNarrativo: hallazgos mapea descripcion/herramientas/elementos desde el finding', () => {
  const { criterios } = buildInformeNarrativo({ findings: [finding()] });
  const hallazgo = criterios.find((c) => c.criterio === '1.1.1').hallazgos[0];
  assert.equal(hallazgo.descripcion, 'Falta alt');
  assert.deepEqual(hallazgo.herramientas, ['Agente']);
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
  assert.equal(resumen.conteo_por_estado['A validar'], 36);
  assert.equal(resumen.conteo_por_estado['Cumple'], undefined);
  assert.equal(resumen.conteo_por_estado['No evaluado'], undefined);
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
  assert.match(html, /Informe general/);
  assert.match(html, /Anexo — Detalle por criterio/);
});

test('buildInformeNarrativoHtml resume con OK/NOK/a validar, sin veredicto ni umbral', async () => {
  const { buildInformeNarrativoHtml } = await import('./informe-narrativo-deliverable.js');
  const { calculateScore } = await import('../classification/calculate-score.js');
  const findings = [{ id: 'f', source: 'axe-core', wcag_criterion: '1.1.1', wcag_level: 'A', wcag_description: 'Contenido no textual', in_scope: 'onti', severity: 'critical', review_status: 'confirmado', affected_urls: ['https://a.test'], occurrences: 1, rule_id: 'image-alt' }];
  const html = buildInformeNarrativoHtml({ jobId: 'j', channel: 'home_banking', findings, urls: ['https://a.test'], scores: calculateScore(findings) });
  assert.match(html, /0 OK, 1 NOK y 37 a validar \(de 38\)/);
  assert.doesNotMatch(html, /CONFORME/);
  assert.doesNotMatch(html, /umbral regulatorio/i);
});

const pagina = (extra = {}) => ({ url: 'https://a.test', violations: [], incomplete: [], passes: [], inapplicable: [], ...extra });

test('buildInformeNarrativo: sin datos de escaneo nada queda OK; con una regla aprobada, OK', () => {
  assert.ok(buildInformeNarrativo({ findings: [] }).criterios.every((c) => c.estado === 'A validar'));
  const { criterios } = buildInformeNarrativo({ findings: [], axeResults: [pagina({ passes: [{ id: 'image-alt', tags: ['wcag2a', 'wcag111'] }] })] });
  assert.equal(criterios.find((c) => c.criterio === '1.1.1').estado, 'OK');
});

test('buildInformeNarrativo: cada criterio a validar explica el motivo', () => {
  const { criterios } = buildInformeNarrativo({ findings: [finding({ review_status: 'requiere_revision' })], axeResults: [pagina({ inapplicable: [{ id: 'video-caption', tags: ['wcag2a', 'wcag122'] }] })] });
  const c111 = criterios.find((c) => c.criterio === '1.1.1');
  assert.equal(c111.estado, 'A validar');
  assert.equal(c111.motivo, 'El agente no pudo determinarlo automáticamente');
  assert.match(criterios.find((c) => c.criterio === '1.2.2').motivo, /No se detectó audio ni video/);
  assert.ok(!criterios.some((c) => c.estado === 'No aplica' || c.estado === 'Cumple' || c.estado === 'No evaluado'));
});

test('buildInformeNarrativo: un criterio sin reglas automáticas indica la revisión que requiere', () => {
  const primero = [...SIN_REGLAS][0];
  if (!primero) return;
  const c = buildInformeNarrativo({ findings: [], axeResults: [pagina()] }).criterios.find((x) => x.criterio === primero);
  assert.equal(c.estado, 'A validar');
  assert.ok(c.revision_manual);
  assert.match(c.motivo, /^Requiere (tecnología asistiva|revisión manual)/);
});
