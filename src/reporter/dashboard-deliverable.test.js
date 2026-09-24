import { test } from 'node:test';
import assert from 'node:assert/strict';
import { buildDashboardHtml } from './dashboard-deliverable.js';

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

test('buildDashboardHtml muestra CONFORME en verde cuando onti_conformance=true', () => {
  const html = buildDashboardHtml({ jobId: 'job-1', channel: 'home_banking', scores: baseScores(), findings: [] });
  assert.match(html, /CONFORME/);
  assert.doesNotMatch(html, /NO CONFORME/);
});

test('buildDashboardHtml muestra NO CONFORME cuando onti_conformance=false', () => {
  const scores = baseScores({ summary: { ...baseScores().summary, onti_conformance: false, onti_criteria_compliant: 20 } });
  const html = buildDashboardHtml({ jobId: 'job-1', channel: 'home_banking', scores, findings: [] });
  assert.match(html, /NO CONFORME/);
});

test('buildDashboardHtml muestra el umbral efectivo y la cantidad de criterios N/A cuando hay alguno', () => {
  const scores = baseScores({ summary: { ...baseScores().summary, onti_criteria_na: 2, effective_conformance_threshold: 28, onti_criteria_evaluated: 36 } });
  const html = buildDashboardHtml({ jobId: 'job-1', channel: 'home_banking', scores, findings: [] });
  assert.match(html, /ajustado a ≥ 28\/36/);
  assert.match(html, /2 criterio\(s\) no aplican/);
});

test('buildDashboardHtml omite el bloque de capa extendida cuando extended_22 es null', () => {
  const html = buildDashboardHtml({ jobId: 'job-1', channel: 'home_banking', scores: baseScores(), findings: [] });
  assert.doesNotMatch(html, /Capa extendida WCAG 2\.2/);
});

test('buildDashboardHtml incluye el bloque de capa extendida rotulado como no exigido', () => {
  const scores = baseScores({ extended_22: { criteria_evaluated: 18, criteria_compliant: 18, compliance_percentage: 100, by_criterion: [] } });
  const html = buildDashboardHtml({ jobId: 'job-1', channel: 'home_banking', scores, findings: [] });
  assert.match(html, /Capa extendida WCAG 2\.2/);
  assert.match(html, /No exigida por BCRA\/ONTI/);
});

test('buildDashboardHtml muestra el resumen de cumplimiento de los 38 criterios ONTI (BCRA)', () => {
  const findings = [
    { wcag_criterion: '1.1.1', wcag_description: 'Contenido no textual', in_scope: 'onti', severity: 'critical', occurrences: 1 }
  ];
  const html = buildDashboardHtml({ jobId: 'job-1', channel: 'home_banking', scores: baseScores(), findings });
  assert.match(html, /Cumplimiento de los 38 criterios ONTI \(BCRA\)/);
  assert.match(html, /Conformes<\/td><td>37<\/td>/);
  assert.match(html, /No conformes<\/td><td>1<\/td>/);
  assert.doesNotMatch(html, />No aplica</);
});

test('buildDashboardHtml: findings de la capa extendida no afectan el cumplimiento de los 38 criterios ONTI', () => {
  const findings = [
    { wcag_criterion: '2.5.8', wcag_description: 'Target size', in_scope: 'extended_22', severity: 'moderate', occurrences: 99 }
  ];
  const html = buildDashboardHtml({ jobId: 'job-1', channel: 'home_banking', scores: baseScores(), findings });
  assert.match(html, /Conformes<\/td><td>38<\/td>/);
  assert.match(html, /No conformes<\/td><td>0<\/td>/);
});

test('buildDashboardHtml muestra la fila "No aplica" solo cuando hay criterios N/A', () => {
  const html = buildDashboardHtml({ jobId: 'job-1', channel: 'home_banking', scores: baseScores(), findings: [], naCriteria: ['1.2.1', '1.2.2'] });
  assert.match(html, />No aplica</);
  assert.match(html, /No aplica<\/td><td>2<\/td>/);
  assert.match(html, /Conformes<\/td><td>36<\/td>/);
});

test('buildDashboardHtml: un criterio con un finding real nunca queda "No aplica" aunque esté en naCriteria', () => {
  const findings = [
    { wcag_criterion: '1.2.1', wcag_description: 'Solo audio', in_scope: 'onti', severity: 'moderate', occurrences: 1 }
  ];
  const html = buildDashboardHtml({ jobId: 'job-1', channel: 'home_banking', scores: baseScores(), findings, naCriteria: ['1.2.1'] });
  assert.match(html, /No conformes<\/td><td>1<\/td>/);
  assert.doesNotMatch(html, />No aplica</);
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

test('buildDashboardHtml incluye la distribución por módulo', () => {
  const html = buildDashboardHtml({ jobId: 'job-1', channel: 'home_banking', scores: baseScores(), findings: [] });
  assert.match(html, /Distribución por módulo/);
  assert.match(html, /home-banking/);
});

test('buildDashboardHtml muestra conteos reales cuando hay findings de visual_audit/ux_review', () => {
  const findings = [
    { wcag_criterion: '1.4.3', wcag_description: 'Contraste', in_scope: 'onti', severity: 'serious', occurrences: 1, source: 'visual_audit' },
    { wcag_criterion: '3.3.1', wcag_description: 'Identificación de errores', in_scope: 'onti', severity: 'moderate', occurrences: 1, source: 'ux_review' }
  ];
  const html = buildDashboardHtml({ jobId: 'job-1', channel: 'home_banking', scores: baseScores(), findings });
  assert.doesNotMatch(html, /No disponible — los skills externos/);
  assert.match(html, /Visual \(rams\)/);
});
