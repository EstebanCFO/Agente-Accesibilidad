import { test } from 'node:test';
import assert from 'node:assert/strict';
import { pageLabels, analyzedTarget, criteriaWithoutAutomatedRules, manualReviewFor, manualReviewLabel } from './report-helpers.js';

test('pageLabels muestra el path de cada página del sitio', () => {
  const labels = pageLabels(['https://www.banco.test/', 'https://www.banco.test/cuentas.html', 'https://www.banco.test/a?x=1']);
  assert.equal(labels.get('https://www.banco.test/'), '/ (inicio)');
  assert.equal(labels.get('https://www.banco.test/cuentas.html'), '/cuentas.html');
  assert.equal(labels.get('https://www.banco.test/a?x=1'), '/a?x=1');
});

test('pageLabels antepone el dominio si hay más de uno y usa el archivo relativo en carpetas locales', () => {
  const multi = pageLabels(['https://a.test/x', 'https://b.test/']);
  assert.equal(multi.get('https://a.test/x'), 'a.test/x');
  assert.equal(multi.get('https://b.test/'), 'b.test/');
  const local = pageLabels(['file:///C:/sitio/inicio.html', 'file:///C:/sitio/sub/b.html']);
  assert.equal(local.get('file:///C:/sitio/inicio.html'), 'inicio.html');
  assert.equal(local.get('file:///C:/sitio/sub/b.html'), 'sub/b.html');
});

test('analyzedTarget y criteriaWithoutAutomatedRules', () => {
  assert.equal(analyzedTarget(['https://a.test/', 'https://a.test/b']).text, 'https://a.test');
  const { missing } = criteriaWithoutAutomatedRules();
  assert.ok(Array.isArray(missing));
});

test('manualReviewFor distingue criterios que requieren tecnología asistiva', () => {
  assert.equal(manualReviewFor('2.1.2').assistive, true);
  assert.match(manualReviewLabel('2.4.7'), /^Requiere tecnología asistiva: navegación solo con teclado/);
  assert.equal(manualReviewFor('1.4.5').assistive, false);
  assert.match(manualReviewLabel('1.4.5'), /^Requiere revisión manual/);
  for (const c of criteriaWithoutAutomatedRules().missing) assert.ok(manualReviewFor(c).method);
});
