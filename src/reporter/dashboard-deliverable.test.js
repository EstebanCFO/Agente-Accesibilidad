import { test } from 'node:test';
import assert from 'node:assert/strict';
import { buildDashboardHtml, analyzedTarget } from './dashboard-deliverable.js';
import { computeWcagSection } from '../classification/wcag-section.js';
import { buildWcagCard } from '../../scripts/demo-results.js';


function baseScores(overrides = {}) {
  return {
    summary: {
      total_urls_evaluated: 1, onti_criteria_evaluated: 38, onti_criteria_compliant: 38,
      onti_compliance_percentage: 100, onti_conformance: true, conformance_threshold: 30,
      score_level_a: 100, score_level_a_evaluated: 25, score_level_aa: 100, score_level_aa_evaluated: 13
    },
    extended_22: null,
    by_url: [{ url: 'https://a.test/home-banking/pago', module: 'home-banking', onti_compliance_percentage: 100, violations: 0, incomplete: 0 }],
    by_module: [{ module: 'home-banking', url_count: 1, onti_compliance_percentage: 100, violations: 0, incomplete: 0 }],
    ...overrides
  };
}

test('buildDashboardHtml omite el bloque de capa extendida cuando extended_22 es null', () => {
  const html = buildDashboardHtml({ jobId: 'job-1', channel: 'home_banking', scores: baseScores(), findings: [] });
  assert.doesNotMatch(html, /Capa extendida WCAG 2\.2/);
});

test('buildDashboardHtml incluye el bloque de capa extendida rotulado como no exigido', () => {
  const scores = baseScores({ extended_22: { criteria_evaluated: 18, criteria_compliant: 18, compliance_percentage: 100, by_criterion: [] } });
  const html = buildDashboardHtml({ jobId: 'job-1', channel: 'home_banking', scores, findings: [] });
  assert.match(html, /Capa extendida WCAG 2\.2/);
  assert.match(html, /No exigida por la Circular BCRA/);
});

test('buildDashboardHtml no menciona "ONTI" en ningún lado (el dashboard hace referencia a la Circular BCRA)', () => {
  const html = buildDashboardHtml({ jobId: 'job-1', channel: 'home_banking', scores: baseScores(), findings: [] });
  assert.doesNotMatch(html, /ONTI/);
  assert.match(html, /Circular BCRA/);
});

test('buildDashboardHtml incluye los 4 Principios WCAG con sus Pautas', () => {
  const html = buildDashboardHtml({ jobId: 'job-1', channel: 'home_banking', scores: baseScores(), findings: [] });
  assert.match(html, /Cumplimiento por Principio y Pauta WCAG/);
  assert.match(html, /Principio 1: Perceptibilidad/);
  assert.match(html, /Principio 2: Operabilidad/);
  assert.match(html, /Principio 3: Comprensibilidad/);
  assert.match(html, /Principio 4: Robustez/);
  assert.match(html, /1\.1 Alternativas textuales/);
  assert.match(html, /4\.1 Compatible/);
});

test('buildDashboardHtml calcula el % de cumplimiento por Pauta a partir de los findings reales', () => {
  // La Pauta 1.1 tiene un solo criterio ONTI (1.1.1) - un finding ahí la deja en 0/1 (0%).
  const findings = [
    { wcag_criterion: '1.1.1', wcag_description: 'Contenido no textual', in_scope: 'onti', severity: 'critical', occurrences: 1 }
  ];
  const html = buildDashboardHtml({ jobId: 'job-1', channel: 'home_banking', scores: baseScores(), findings });
  assert.match(html, /1\.1 Alternativas textuales[\s\S]*?0\/1 \(0%\)/);
});

test('buildDashboardHtml escapa HTML en nombres de módulo/URL (sin inyección)', () => {
  const scores = baseScores({
    by_module: [{ module: '<img src=x onerror=alert(1)>', url_count: 1, onti_compliance_percentage: 0, violations: 1, incomplete: 0 }],
    by_url: [{ url: '<img src=x onerror=alert(2)>', module: 'raiz', onti_compliance_percentage: 0, violations: 1, incomplete: 0 }]
  });
  const html = buildDashboardHtml({ jobId: 'job-1', channel: 'home_banking', scores, findings: [] });
  assert.ok(!html.includes('<img src=x onerror=alert(1)>'));
  assert.ok(!html.includes('<img src=x onerror=alert(2)>'));
});

test('buildDashboardHtml no depende de red (sin <script src> ni <link> externos)', () => {
  const html = buildDashboardHtml({ jobId: 'job-1', channel: 'home_banking', scores: baseScores(), findings: [] });
  assert.doesNotMatch(html, /<script[^>]+src=/i);
  assert.doesNotMatch(html, /<link[^>]+href="https?:/i);
});

test('buildDashboardHtml muestra el resultado por página con el path (sin módulos)', () => {
  const findings = [{ wcag_criterion: '1.1.1', in_scope: 'onti', severity: 'critical', occurrences: 1, affected_urls: ['https://a.test/home-banking/pago'] }];
  const html = buildDashboardHtml({ jobId: 'job-1', channel: 'home_banking', scores: baseScores(), findings });
  assert.match(html, /Resultado por página/);
  assert.match(html, />\/home-banking\/pago<\/td>/);
  assert.doesNotMatch(html, /Distribución por módulo/);
});

test('buildDashboardHtml muestra conteos reales cuando hay findings de visual_audit/ux_review', () => {
  const findings = [
    { wcag_criterion: '1.4.3', wcag_description: 'Contraste', in_scope: 'onti', severity: 'serious', occurrences: 1, source: 'visual_audit' },
    { wcag_criterion: '3.3.1', wcag_description: 'Identificación de errores', in_scope: 'onti', severity: 'moderate', occurrences: 1, source: 'ux_review' }
  ];
  const html = buildDashboardHtml({ jobId: 'job-1', channel: 'home_banking', scores: baseScores(), findings });
  assert.doesNotMatch(html, /No se ejecutó la revisión visual/);
  assert.match(html, /Revisión visual<\/td><td>1<\/td>/);
});

test('analyzedTarget: una URL, varias del mismo sitio y carpeta local', () => {
  assert.deepEqual(analyzedTarget(['https://banco.test/cuentas']), { text: 'https://banco.test/cuentas', href: 'https://banco.test/cuentas' });
  assert.deepEqual(analyzedTarget(['https://banco.test/', 'https://banco.test/cuentas']), { text: 'https://banco.test', href: 'https://banco.test' });
  assert.deepEqual(analyzedTarget(['file:///C:/sitio/a.html', 'file:///C:/sitio/sub/b.html']), { text: 'C:/sitio/', href: null });
  assert.equal(analyzedTarget([]), null);
});

test('buildDashboardHtml muestra la URL analizada en el encabezado', () => {
  const html = buildDashboardHtml({ jobId: 'j', channel: 'home_banking', scores: baseScores(), findings: [] });
  assert.match(html, /URL analizada:<\/strong> <a href="https:\/\/a\.test\/home-banking\/pago">/);
});

// Página con 3.1.1 verificado (regla aprobada), 1.1.1 con un problema y 1.2.1 sin audio/video.
const PAGE = {
  url: 'https://a.test/home-banking/pago', violations: [], incomplete: [],
  passes: [{ id: 'html-has-lang', tags: ['wcag2a', 'wcag311'] }, { id: 'region', tags: ['best-practice'] }],
  inapplicable: [{ id: 'audio-caption', tags: ['wcag2a', 'wcag121'] }]
};
const NOK_111 = { wcag_criterion: '1.1.1', wcag_description: 'Contenido no textual', in_scope: 'onti', severity: 'critical', occurrences: 1, review_status: 'confirmado', affected_urls: [PAGE.url] };

function sectionScores(findings = [NOK_111]) {
  return baseScores({ wcag_section: computeWcagSection(findings, { axeResults: [PAGE] }) });
}

test('buildDashboardHtml: el bloque superior muestra los mismos números que la tarjeta del panel', () => {
  const scores = sectionScores();
  const card = buildWcagCard(scores.wcag_section);
  const html = buildDashboardHtml({ jobId: 'job-1', channel: 'home_banking', scores, findings: [NOK_111] });
  assert.match(html, /Score de cumplimiento — Circular BCRA/);
  assert.ok(html.includes(card.value), `falta "${card.value}"`);
  assert.ok(html.includes(card.detail), `falta "${card.detail}"`);
  assert.equal(card.value, '1 OK · 1 NOK');
});

test('buildDashboardHtml no emite veredicto, umbral ni porcentaje de cumplimiento', () => {
  const html = buildDashboardHtml({ jobId: 'job-1', channel: 'home_banking', scores: sectionScores(), findings: [NOK_111] });
  assert.doesNotMatch(html, /CONFORME/);
  assert.doesNotMatch(html, /umbral regulatorio/i);
  assert.doesNotMatch(html, /de criterios conformes/);
});

test('buildDashboardHtml desglosa los "a validar" por motivo en la tabla de los 38 criterios', () => {
  const scores = sectionScores();
  const html = buildDashboardHtml({ jobId: 'job-1', channel: 'home_banking', scores, findings: [NOK_111] });
  const count = (code) => scores.wcag_section.by_criterion.filter((c) => c.reason.code === code).length;
  assert.match(html, /OK<\/td><td>1<\/td>/);
  assert.match(html, /NOK<\/td><td>1<\/td>/);
  assert.match(html, new RegExp(`A validar — requiere tecnología asistiva</td><td>${count('requiere_asistiva')}</td>`));
  assert.match(html, new RegExp(`A validar — sin elementos evaluables</td><td>${count('sin_elementos')}</td>`));
  assert.match(html, /No aplica<\/td><td>1<\/td>/);
});

test('buildDashboardHtml lista cada criterio a validar o no aplicable con su motivo', () => {
  const html = buildDashboardHtml({ jobId: 'job-1', channel: 'home_banking', scores: sectionScores(), findings: [NOK_111] });
  assert.match(html, /Criterios a validar y no aplicables/);
  assert.match(html, /1\.2\.1[\s\S]*?No aplica[\s\S]*?No se encontró audio ni video en la página evaluada/);
  assert.match(html, /2\.4\.7[\s\S]*?Requiere tecnología asistiva: navegación solo con teclado/);
});

test('buildDashboardHtml calcula la sección desde findings y axeResults si scores no la trae', () => {
  const html = buildDashboardHtml({ jobId: 'job-1', channel: 'home_banking', scores: baseScores(), findings: [NOK_111], axeResults: [PAGE] });
  const card = buildWcagCard(computeWcagSection([NOK_111], { axeResults: [PAGE] }));
  assert.ok(html.includes(card.value));
  assert.ok(html.includes(card.detail));
});

test('buildDashboardHtml: findings de la capa extendida no cuentan en los 38 criterios', () => {
  const extended = { wcag_criterion: '2.5.8', in_scope: 'extended_22', severity: 'moderate', occurrences: 9, review_status: 'confirmado' };
  const html = buildDashboardHtml({ jobId: 'job-1', channel: 'home_banking', scores: sectionScores([extended]), findings: [extended] });
  assert.match(html, /NOK<\/td><td>0<\/td>/);
});

test('buildDashboardHtml incluye el anexo de reglas evaluadas por página cuando hay axeResults', () => {
  const html = buildDashboardHtml({ jobId: 'job-1', channel: 'home_banking', scores: sectionScores(), findings: [NOK_111], axeResults: [PAGE] });
  assert.match(html, /Reglas evaluadas por página/);
  assert.match(html, /\/home-banking\/pago[\s\S]*?<td>0<\/td><td>0<\/td><td>1<\/td><td>1<\/td><td>1<\/td>/);
});
