import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  extractWcagCriteria,
  lookupOntiCriterion,
  lookupExtendedCriterion,
  classifyByWcagTags
} from './wcag-map.js';

test('extractWcagCriteria ignora tags de nivel y devuelve solo criterios con formato punto', () => {
  const tags = ['cat.text-alternatives', 'wcag2a', 'wcag111', 'section508'];
  assert.deepEqual(extractWcagCriteria(tags), ['1.1.1']);
});

test('extractWcagCriteria soporta criterios de dos dígitos en la tercera posición', () => {
  assert.deepEqual(extractWcagCriteria(['wcag1412']), ['1.4.12']);
  assert.deepEqual(extractWcagCriteria(['wcag258']), ['2.5.8']);
});

test('lookupOntiCriterion resuelve los 38 criterios de la ONTI', () => {
  assert.equal(lookupOntiCriterion('1.1.1').number, 1);
  assert.equal(lookupOntiCriterion('1.4.3').number, 28);
  assert.equal(lookupOntiCriterion('3.3.4').number, 38);
  assert.equal(lookupOntiCriterion('1.4.6'), null);
});

test('lookupExtendedCriterion resuelve los 18 criterios de la capa WCAG 2.1/2.2', () => {
  assert.equal(lookupExtendedCriterion('2.5.8').source, 'wcag22');
  assert.equal(lookupExtendedCriterion('1.3.5').source, 'wcag21');
  assert.equal(lookupExtendedCriterion('1.1.1'), null);
});

test('classifyByWcagTags: hallazgos reales de las 4 páginas de prueba caen en ONTI', () => {
  const casos = [
    { tags: ['wcag2a', 'wcag111'], criterioEsperado: 1 },       // image-alt
    { tags: ['wcag2aa', 'wcag143'], criterioEsperado: 28 },     // color-contrast
    { tags: ['wcag2a', 'wcag311'], criterioEsperado: 19 },      // html-has-lang
    { tags: ['wcag2a', 'wcag412'], criterioEsperado: 25 },      // select-name / button-name / frame-title
    { tags: ['wcag2a', 'wcag141'], criterioEsperado: 8 }        // link-in-text-block
  ];
  for (const { tags, criterioEsperado } of casos) {
    const result = classifyByWcagTags(tags);
    assert.equal(result.scope, 'onti');
    assert.ok(result.onti_criteria.some((c) => c.number === criterioEsperado));
  }
});

test('classifyByWcagTags: link-name toca dos criterios ONTI a la vez (2.4.4 y 4.1.2)', () => {
  const result = classifyByWcagTags(['wcag2a', 'wcag244', 'wcag412']);
  assert.equal(result.scope, 'onti');
  assert.deepEqual(result.onti_criteria.map((c) => c.number).sort(), [18, 25]);
});

test('classifyByWcagTags: reglas best-practice sin criterio WCAG quedan out_of_scope', () => {
  const result = classifyByWcagTags(['cat.semantics', 'best-practice']);
  assert.equal(result.scope, 'out_of_scope');
});

test('classifyByWcagTags: criterio AAA (fuera de ONTI y de la capa extendida) queda out_of_scope', () => {
  const result = classifyByWcagTags(['wcag146'], { includeExtended: true });
  assert.equal(result.scope, 'out_of_scope');
});

test('classifyByWcagTags: capa extendida solo cuenta si includeExtended=true (decisión D7)', () => {
  const tags = ['wcag21aa', 'wcag258']; // target-size, 2.5.8
  assert.equal(classifyByWcagTags(tags).scope, 'out_of_scope');
  assert.equal(classifyByWcagTags(tags, { includeExtended: true }).scope, 'extended_22');
});
