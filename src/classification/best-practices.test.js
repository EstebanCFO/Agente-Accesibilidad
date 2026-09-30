import { test } from 'node:test';
import assert from 'node:assert/strict';
import { computeBestPractices, IMPACT_WEIGHT } from './best-practices.js';

const BP = ['cat.keyboard', 'best-practice'];
const violation = (id, impact) => ({ id, impact, tags: BP, help: `ayuda ${id}`, node_count: 1 });
const rule = (id) => ({ id, tags: BP });
const page = (url, parts = {}) => ({ url, violations: [], incomplete: [], passes: [], inapplicable: [], rule_impacts: {}, ...parts });
const ruleOf = (bp, id) => bp.rules.find((r) => r.rule_id === id);

test('IMPACT_WEIGHT pondera crítico 4, serio 3, moderado 2, menor 1', () => {
  assert.deepEqual(IMPACT_WEIGHT, { critical: 4, serious: 3, moderate: 2, minor: 1 });
});

test('computeBestPractices: regla que pasa en todas las páginas cumple', () => {
  const bp = computeBestPractices([page('https://a.test', { passes: [rule('region')], rule_impacts: { region: 'moderate' } })]);
  assert.equal(ruleOf(bp, 'region').status, 'cumple');
  assert.equal(bp.score, 100);
});

test('computeBestPractices: falla en una página y pasa en otra es mejora sugerida', () => {
  const bp = computeBestPractices([
    page('https://a.test', { violations: [violation('region', 'moderate')] }),
    page('https://b.test', { passes: [rule('region')] })
  ]);
  assert.equal(ruleOf(bp, 'region').status, 'mejora');
  assert.deepEqual(ruleOf(bp, 'region').affected_urls, ['https://a.test']);
});

test('computeBestPractices: incomplete cuenta como mejora sugerida', () => {
  const bp = computeBestPractices([page('https://a.test', { incomplete: [violation('heading-order', 'moderate')] })]);
  assert.equal(ruleOf(bp, 'heading-order').status, 'mejora');
});

test('computeBestPractices: solo inapplicable no aplica y queda fuera del puntaje', () => {
  const bp = computeBestPractices([page('https://a.test', {
    inapplicable: [rule('skip-link')], passes: [rule('region')], rule_impacts: { region: 'moderate', 'skip-link': 'moderate' }
  })]);
  assert.equal(ruleOf(bp, 'skip-link').status, 'no_aplica');
  assert.equal(bp.no_aplica, 1);
  assert.equal(bp.score, 100);
});

test('computeBestPractices: el puntaje pondera por impacto', () => {
  // cumple: region (moderate=2); mejora: landmark-one-main (serious=3) → 2 / 5 = 40%
  const bp = computeBestPractices([page('https://a.test', {
    passes: [rule('region')], violations: [violation('landmark-one-main', 'serious')], rule_impacts: { region: 'moderate' }
  })]);
  assert.equal(bp.score, 40);
  assert.equal(bp.cumple, 1);
  assert.equal(bp.mejora, 1);
});

test('computeBestPractices: impacto desconocido pesa como moderado', () => {
  const bp = computeBestPractices([page('https://a.test', { passes: [rule('region')] })]);
  assert.equal(ruleOf(bp, 'region').weight, 2);
});

test('computeBestPractices: ignora reglas con criterio WCAG aunque tengan tag best-practice', () => {
  const bp = computeBestPractices([page('https://a.test', { violations: [{ ...violation('color-contrast', 'serious'), tags: ['wcag2aa', 'wcag143', 'best-practice'] }] })]);
  assert.equal(bp.rules.length, 0);
});

test('computeBestPractices: sin reglas aplicables el puntaje es null', () => {
  assert.equal(computeBestPractices([page('https://a.test', { inapplicable: [rule('skip-link')] })]).score, null);
  assert.equal(computeBestPractices([]).score, null);
});

test('computeBestPractices: ignora resultados con error', () => {
  assert.equal(computeBestPractices([{ url: 'https://x.test', error: { type: 'timeout' } }]).rules.length, 0);
});
