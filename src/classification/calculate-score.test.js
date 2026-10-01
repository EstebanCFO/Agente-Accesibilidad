import { test } from 'node:test';
import assert from 'node:assert/strict';
import { calculateScore } from './calculate-score.js';

function finding(wcagCriterion, level, inScope, affectedUrls, reviewStatus = 'confirmado') {
  return {
    id: `finding-${wcagCriterion}`,
    source: 'axe-core',
    wcag_criterion: wcagCriterion,
    wcag_level: level,
    onti_criterion: inScope === 'onti',
    in_scope: inScope,
    severity: 'serious',
    review_status: reviewStatus,
    rule_id: `rule-${wcagCriterion}`,
    affected_urls: affectedUrls,
    occurrences: affectedUrls.length
  };
}

const page = (url, extra = {}) => ({ url, violation_count: 0, incomplete_count: 0, violations: [], incomplete: [], passes: [], inapplicable: [], ...extra });
const passes = (...pairs) => pairs.map(([id, tags]) => ({ id, tags }));

test('calculateScore: el summary es un conteo OK/NOK/a validar de los 38 criterios, sin veredicto ni porcentaje', () => {
  const axeResults = [page('https://a.test', { passes: passes(['html-has-lang', ['wcag2a', 'wcag311']]) })];
  const { summary } = calculateScore([finding('1.1.1', 'A', 'onti', ['https://a.test'])], { axeResults });
  assert.equal(summary.total_urls_evaluated, 1);
  assert.equal(summary.total, 38);
  assert.equal(summary.ok, 1);
  assert.equal(summary.nok, 1);
  assert.equal(summary.a_validar, 36);
  assert.equal(summary.no_aplica, 0);
  for (const removed of ['onti_conformance', 'conformance_threshold', 'effective_conformance_threshold', 'onti_compliance_percentage', 'onti_criteria_compliant', 'score_level_a']) {
    assert.equal(removed in summary, false, removed);
  }
});

test('calculateScore: el summary coincide con la Sección 1 (sin la capa 2.2)', () => {
  const axeResults = [page('https://a.test')];
  const result = calculateScore([finding('2.5.8', 'AA', 'extended_22', ['https://a.test'])], { axeResults, includeExtended: true });
  const onti = result.wcag_section.by_criterion.filter((c) => c.in_scope === 'onti');
  assert.equal(result.summary.a_validar, onti.filter((c) => c.status === 'a_validar').length);
  assert.equal(result.summary.nok, 0);
});

test('calculateScore: niveles A y AA como conteos', () => {
  const axeResults = [page('https://a.test', { passes: passes(['color-contrast', ['wcag2aa', 'wcag143']]) })];
  const { summary } = calculateScore([finding('1.1.1', 'A', 'onti', ['https://a.test'])], { axeResults });
  assert.deepEqual(summary.level_a, { total: 25, ok: 0, nok: 1, a_validar: 24 });
  assert.deepEqual(summary.level_aa, { total: 13, ok: 1, nok: 0, a_validar: 12 });
});

test('calculateScore: extended_22 cuenta la capa 2.1/2.2 solo con includeExtended', () => {
  const findings = [finding('2.5.8', 'AA', 'extended_22', ['https://a.test'])];
  assert.equal(calculateScore(findings, { axeResults: [page('https://a.test')] }).extended_22, null);
  const { extended_22: ext } = calculateScore(findings, { axeResults: [page('https://a.test')], includeExtended: true });
  assert.equal(ext.total, 18);
  assert.equal(ext.nok, 1);
  assert.equal(ext.ok + ext.nok + ext.a_validar, 18);
});

test('calculateScore: by_url cuenta criterios con problemas por página, sin porcentaje', () => {
  const findings = [finding('1.4.3', 'AA', 'onti', ['https://a.test'])];
  const axeResults = [page('https://a.test', { violation_count: 1 }), page('https://b.test')];
  const { by_url } = calculateScore(findings, { axeResults });
  const a = by_url.find((e) => e.url === 'https://a.test');
  const b = by_url.find((e) => e.url === 'https://b.test');
  assert.equal(a.criterios_con_problemas, 1);
  assert.equal(b.criterios_con_problemas, 0);
  assert.equal(a.violations, 1);
  assert.equal('onti_compliance_percentage' in a, false);
});

test('calculateScore: un incomplete no cuenta como criterio con problemas en la página', () => {
  const findings = [finding('1.4.3', 'AA', 'onti', ['https://a.test'], 'requiere_revision')];
  const { by_url, summary } = calculateScore(findings, { axeResults: [page('https://a.test')] });
  assert.equal(by_url[0].criterios_con_problemas, 0);
  assert.equal(summary.nok, 0);
});

test('calculateScore: sin axeResults, aproxima total_urls_evaluated con la unión de affected_urls', () => {
  const findings = [
    finding('1.1.1', 'A', 'onti', ['https://a.test']),
    finding('1.4.3', 'AA', 'onti', ['https://b.test', 'https://c.test'])
  ];
  assert.equal(calculateScore(findings).summary.total_urls_evaluated, 3);
});

test('calculateScore: lista vacía de findings y sin axeResults no rompe', () => {
  const { summary, by_url } = calculateScore([]);
  assert.equal(summary.total_urls_evaluated, 0);
  assert.equal(summary.a_validar, 38);
  assert.deepEqual(by_url, []);
});

test('calculateScore: by_url trae el módulo real derivado de la URL', () => {
  const { by_url } = calculateScore([], { axeResults: [page('https://a.test/home-banking/pago')] });
  assert.equal(by_url[0].module, 'home-banking');
});

test('calculateScore: by_module agrega URLs del mismo módulo (peor caso)', () => {
  const findings = [finding('1.1.1', 'A', 'onti', ['https://a.test/home-banking/pago'])];
  const axeResults = [
    page('https://a.test/home-banking/pago', { violation_count: 1 }),
    page('https://a.test/home-banking/transferencias'),
    page('https://a.test/onboarding/paso1')
  ];
  const { by_module } = calculateScore(findings, { axeResults });
  const hb = by_module.find((m) => m.module === 'home-banking');
  assert.equal(hb.url_count, 2);
  assert.equal(hb.criterios_con_problemas, 1);
  assert.equal(hb.violations, 1);
  assert.equal(by_module.find((m) => m.module === 'onboarding').criterios_con_problemas, 0);
});

test('calculateScore: los hallazgos complementarios no cuentan', () => {
  const agente = { ...finding('1.4.3', 'AA', 'onti', ['https://a.test']), source: 'keyboard_review' };
  const { summary, by_url } = calculateScore([agente], { axeResults: [page('https://a.test')] });
  assert.equal(summary.nok, 0);
  assert.equal(by_url[0].criterios_con_problemas, 0);
});

test('calculateScore: expone wcag_section y best_practices', () => {
  const axeResults = [page('https://a.test', { passes: [{ id: 'region', tags: ['best-practice'] }], rule_impacts: { region: 'moderate' } })];
  const result = calculateScore([], { axeResults });
  assert.equal(result.wcag_section.a_validar, 38);
  assert.equal(result.best_practices.score, 100);
});
