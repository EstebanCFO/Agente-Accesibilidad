import { test } from 'node:test';
import assert from 'node:assert/strict';
import { buildDashboardHtml } from './dashboard-deliverable.js';

function baseScores(overrides = {}) {
  return {
    summary: {
      total_urls_evaluated: 1, onti_criteria_evaluated: 38, onti_criteria_compliant: 38,
      onti_compliance_percentage: 100, onti_conformance: true, conformance_threshold: 30,
      score_level_a: 100, score_level_aa: 100
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

test('buildDashboardHtml top 10 criterios solo cuenta findings ONTI, no extended_22', () => {
  const findings = [
    { wcag_criterion: '1.1.1', wcag_description: 'Contenido no textual', in_scope: 'onti', severity: 'critical', occurrences: 5 },
    { wcag_criterion: '2.5.8', wcag_description: 'Target size', in_scope: 'extended_22', severity: 'moderate', occurrences: 99 }
  ];
  const html = buildDashboardHtml({ jobId: 'job-1', channel: 'home_banking', scores: baseScores(), findings });
  assert.match(html, /1\.1\.1/);
  assert.doesNotMatch(html, /2\.5\.8/);
});

test('buildDashboardHtml escapa HTML en descripciones de criterios (sin inyección)', () => {
  const findings = [
    { wcag_criterion: '1.1.1', wcag_description: '<img src=x onerror=alert(1)>', in_scope: 'onti', severity: 'critical', occurrences: 1 }
  ];
  const html = buildDashboardHtml({ jobId: 'job-1', channel: 'home_banking', scores: baseScores(), findings });
  assert.ok(!html.includes('<img src=x onerror=alert(1)>'));
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
