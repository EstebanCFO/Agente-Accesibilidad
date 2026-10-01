import { test } from 'node:test';
import assert from 'node:assert/strict';
import { buildVpatRows, CONFORMANCE } from './vpat-deliverable.js';
import { computeWcagSection } from '../classification/wcag-section.js';

const page = (url, passes = []) => ({ url, violations: [], incomplete: [], inapplicable: [], passes });
const pages = (n, passes = []) => Array.from({ length: n }, (_, i) => page(`https://a.test/p${i + 1}`, passes));
const finding = (criterion, urls, extra = {}) => ({
  id: `f-${criterion}`, wcag_criterion: criterion, wcag_level: 'A', in_scope: 'onti', source: 'axe-core',
  review_status: 'confirmado', rule_id: 'regla-x', affected_urls: urls, occurrences: urls.length, ...extra
});
const row = (rows, criterion) => [...rows.A, ...rows.AA, ...rows.AAA].find((r) => r.criterion === criterion);

test('buildVpatRows: un criterio OK se informa Supports', () => {
  const rows = buildVpatRows({ axeResults: pages(2, [{ id: 'html-has-lang', tags: ['wcag2a', 'wcag311'] }]) });
  const r = row(rows, '3.1.1');
  assert.equal(r.conformance, CONFORMANCE.supports);
  assert.equal(r.remarks, 'Verificado automáticamente, sin problemas');
  assert.equal(r.version, 'WCAG 2.0');
});

test('buildVpatRows: NOK en todas las páginas es Does Not Support y lista las reglas', () => {
  const axeResults = pages(2);
  const findings = [
    finding('1.1.1', axeResults.map((p) => p.url), { rule_id: 'image-alt' }),
    finding('1.1.1', [axeResults[0].url], { id: 'f2', rule_id: 'svg-img-alt' })
  ];
  const r = row(buildVpatRows({ findings, axeResults }), '1.1.1');
  assert.equal(r.conformance, CONFORMANCE.doesNot);
  assert.equal(r.remarks, 'Problemas en 2 de 2 páginas: image-alt, svg-img-alt');
});

test('buildVpatRows: NOK en algunas páginas es Partially Supports', () => {
  const axeResults = pages(5);
  const findings = [finding('1.1.1', [axeResults[0].url, axeResults[3].url], { rule_id: 'image-alt' })];
  const r = row(buildVpatRows({ findings, axeResults }), '1.1.1');
  assert.equal(r.conformance, CONFORMANCE.partial);
  assert.equal(r.remarks, 'Problemas en 2 de 5 páginas: image-alt');
});

test('buildVpatRows: NOK sin páginas afectadas registradas es Does Not Support sin "0 de N"', () => {
  const findings = [finding('1.1.1', [], { rule_id: 'image-alt' })];
  const r = row(buildVpatRows({ findings, axeResults: pages(3) }), '1.1.1');
  assert.equal(r.conformance, CONFORMANCE.doesNot);
  assert.equal(r.remarks, 'Problemas confirmados por las reglas automáticas: image-alt');
});

test('buildVpatRows: a validar se informa Not Evaluated (to validate) con el motivo del panel', () => {
  const axeResults = pages(1);
  const rows = buildVpatRows({ axeResults });
  const section = computeWcagSection([], { axeResults });
  const expected = section.by_criterion.find((c) => c.wcag_criterion === '2.4.7');
  const r = row(rows, '2.4.7');
  assert.equal(r.conformance, 'Not Evaluated (to validate)');
  assert.equal(r.remarks, expected.reason.text);
});

test('buildVpatRows: findings a revisar o de otras fuentes no vuelven NOK un criterio', () => {
  const axeResults = pages(2);
  const findings = [
    finding('1.4.3', [axeResults[0].url], { review_status: 'requiere_revision' }),
    finding('2.4.7', [axeResults[0].url], { source: 'keyboard_review' })
  ];
  const rows = buildVpatRows({ findings, axeResults });
  assert.equal(row(rows, '1.4.3').conformance, CONFORMANCE.toValidate);
  assert.equal(row(rows, '2.4.7').conformance, CONFORMANCE.toValidate);
});

test('buildVpatRows sin el check: solo WCAG 2.0 (25 A, 13 AA, 23 AAA)', () => {
  const rows = buildVpatRows({ axeResults: pages(1) });
  assert.equal(rows.A.length, 25);
  assert.equal(rows.AA.length, 13);
  assert.equal(rows.AAA.length, 23);
  assert.ok([...rows.A, ...rows.AA, ...rows.AAA].every((r) => r.version === 'WCAG 2.0'));
});

test('buildVpatRows con el check: suma 2.1 y 2.2 (32 A, 24 AA, 31 AAA) con su versión', () => {
  const rows = buildVpatRows({ axeResults: pages(1), includeExtended: true });
  assert.equal(rows.A.length, 32);
  assert.equal(rows.AA.length, 24);
  assert.equal(rows.AAA.length, 31);
  assert.equal(row(rows, '2.5.3').version, 'WCAG 2.1');
  assert.equal(row(rows, '2.5.8').version, 'WCAG 2.2');
  assert.equal(row(rows, '3.3.9').version, 'WCAG 2.2');
});

test('buildVpatRows: AAA siempre Not Evaluated, fuera del alcance', () => {
  const rows = buildVpatRows({ axeResults: pages(1), includeExtended: true });
  for (const r of rows.AAA) {
    assert.equal(r.conformance, 'Not Evaluated');
    assert.equal(r.remarks, 'Fuera del alcance de la evaluación (norma A+AA)');
  }
});

test('buildVpatRows: la nota de 4.1.1 obsoleto aparece solo con el check', () => {
  const sin = row(buildVpatRows({ axeResults: pages(1) }), '4.1.1');
  const con = row(buildVpatRows({ axeResults: pages(1), includeExtended: true }), '4.1.1');
  assert.doesNotMatch(sin.remarks, /Obsoleto/);
  assert.match(con.remarks, /Obsoleto en WCAG 2\.2; se considera satisfecho$/);
});

test('buildVpatRows: los conteos A/AA coinciden con computeWcagSection', () => {
  const axeResults = pages(4, [{ id: 'html-has-lang', tags: ['wcag2a', 'wcag311'] }]);
  const findings = [finding('1.1.1', [axeResults[0].url]), finding('1.4.3', axeResults.map((p) => p.url))];
  for (const includeExtended of [false, true]) {
    const rows = buildVpatRows({ findings, axeResults, includeExtended });
    const section = computeWcagSection(findings, { axeResults, includeExtended });
    const aaa = [...rows.A, ...rows.AA];
    const count = (...values) => aaa.filter((r) => values.includes(r.conformance)).length;
    assert.equal(count(CONFORMANCE.supports), section.ok);
    assert.equal(count(CONFORMANCE.partial, CONFORMANCE.doesNot), section.nok);
    assert.equal(count(CONFORMANCE.toValidate), section.a_validar);
  }
});

test('buildVpatRows sin páginas escaneadas: ningún Supports', () => {
  const rows = buildVpatRows({ findings: [], axeResults: [] });
  assert.ok([...rows.A, ...rows.AA].every((r) => r.conformance === CONFORMANCE.toValidate));
});

test('buildVpatRows ordena por número de criterio (2.4.10 después de 2.4.9)', () => {
  const ids = buildVpatRows({ axeResults: pages(1) }).AAA.map((r) => r.criterion);
  assert.ok(ids.indexOf('2.4.9') < ids.indexOf('2.4.10'));
  assert.equal(ids[0], '1.2.6');
});
