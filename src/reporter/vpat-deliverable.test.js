import { test } from 'node:test';
import assert from 'node:assert/strict';
import { buildVpatRows, resolveVpatInfo, buildVpatReportHtml, CONFORMANCE } from './vpat-deliverable.js';
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

const FECHA = new Date(2026, 9, 1);

test('resolveVpatInfo usa los datos cargados (recortados)', () => {
  const info = resolveVpatInfo(
    { product_name: '  Home Banking Banco X ', product_version: '3.2', description: 'Portal de clientes', contact: 'a11y@banco.test' },
    { target: 'https://hb.banco.test', channel: 'home_banking', date: FECHA }
  );
  assert.deepEqual(info, { productName: 'Home Banking Banco X', productVersion: '3.2', description: 'Portal de clientes', contact: 'a11y@banco.test' });
});

test('resolveVpatInfo sin datos completa con defaults', () => {
  const info = resolveVpatInfo(undefined, { target: 'https://hb.banco.test/inicio', channel: 'home_banking', date: FECHA });
  assert.equal(info.productName, 'hb.banco.test');
  assert.equal(info.productVersion, `Evaluado el ${FECHA.toLocaleDateString('es-AR')}`);
  assert.equal(info.description, 'Home Banking (web) — https://hb.banco.test/inicio');
  assert.equal(info.contact, 'CFOTech IT Global Services');
});

test('resolveVpatInfo: campos vacíos o no-texto usan el default', () => {
  const info = resolveVpatInfo({ product_name: '   ', contact: 42 }, { target: 'https://x.test', channel: 'app_ios', date: FECHA });
  assert.equal(info.productName, 'x.test');
  assert.equal(info.contact, 'CFOTech IT Global Services');
  assert.equal(info.description, 'App iOS (vista móvil) — https://x.test');
});

test('resolveVpatInfo con carpeta local o file: usa el nombre de la carpeta/archivo', () => {
  assert.equal(resolveVpatInfo(null, { target: 'C:\\sitios\\banco-demo', channel: 'home_banking', date: FECHA }).productName, 'banco-demo');
  assert.equal(resolveVpatInfo(null, { target: 'C:\\sitios\\banco-demo\\', channel: 'home_banking', date: FECHA }).productName, 'banco-demo');
  assert.equal(resolveVpatInfo(null, { target: 'file:///C:/sitios/mi%20banco/index.html', channel: 'home_banking', date: FECHA }).productName, 'index.html');
  assert.equal(resolveVpatInfo(null, { target: '', channel: 'home_banking', date: FECHA }).productName, 'Sitio auditado');
});

function reportData(extra = {}) {
  const axeResults = pages(2, [{ id: 'html-has-lang', tags: ['wcag2a', 'wcag311'] }]);
  return {
    jobId: 'job-vpat', channel: 'home_banking', axeResults, urls: axeResults.map((p) => p.url),
    findings: [finding('1.1.1', [axeResults[0].url], { rule_id: 'image-alt' })],
    target: 'https://a.test', keyboardResults: [{ url: axeResults[0].url }], ...extra
  };
}

test('buildVpatReportHtml arma encabezado, datos del producto, estándares, términos y las tres tablas', () => {
  const html = buildVpatReportHtml(reportData(), { date: FECHA });
  for (const t of [
    'Informe de Conformidad de Accesibilidad', 'VPAT® 2.5', 'Datos del producto', 'Métodos de evaluación utilizados',
    'Estándares aplicables', 'Términos', 'Tabla 1: Criterios de conformidad, Nivel A',
    'Tabla 2: Criterios de conformidad, Nivel AA', 'Tabla 3: Criterios de conformidad, Nivel AAA',
    'Not Evaluated (to validate)', 'Partially Supports', 'a.test'
  ]) assert.ok(html.includes(t), t);
  assert.match(html, /2 páginas evaluadas/);
  assert.match(html, /pruebas de teclado del Agente/);
  assert.doesNotMatch(html, /<script/);
});

test('buildVpatReportHtml: estándares aplicables según el check de 2.2', () => {
  const sin = buildVpatReportHtml(reportData(), { date: FECHA });
  const con = buildVpatReportHtml(reportData({ includeExtended: true }), { date: FECHA });
  assert.match(sin, /WCAG 2\.1<\/td><td>No<\/td>/);
  assert.match(sin, /WCAG 2\.2<\/td><td>No<\/td>/);
  assert.match(con, /WCAG 2\.1<\/td><td>Sí/);
  assert.match(con, /WCAG 2\.2<\/td><td>Sí/);
  assert.ok(con.includes('2.5.8'));
  assert.ok(!sin.includes('2.5.8'));
});

test('buildVpatReportHtml escapa los datos cargados por el usuario', () => {
  const html = buildVpatReportHtml(reportData({ vpat: { product_name: '<script>alert(1)</script> & "Co"' } }), { date: FECHA });
  assert.ok(html.includes('&lt;script&gt;alert(1)&lt;/script&gt; &amp; &quot;Co&quot;'));
  assert.doesNotMatch(html, /<script>alert/);
});

test('buildVpatReportHtml sin pruebas de teclado no las menciona en los métodos', () => {
  const html = buildVpatReportHtml(reportData({ keyboardResults: [] }), { date: FECHA });
  assert.doesNotMatch(html, /pruebas de teclado del Agente/);
});

test('buildVpatReportHtml sin target usa la primera URL evaluada', () => {
  const html = buildVpatReportHtml(reportData({ target: undefined }), { date: FECHA });
  assert.ok(html.includes('https://a.test/p1'));
});

test('buildVpatReportHtml acepta las claves snake_case del agente (classified_findings, keyboard_results)', () => {
  const base = reportData();
  const data = { ...base, findings: undefined, keyboardResults: undefined, classified_findings: base.findings, keyboard_results: base.keyboardResults };
  const html = buildVpatReportHtml(data, { date: FECHA });
  assert.match(html, /Problemas en 1 de 2 páginas: image-alt/);
  assert.match(html, /pruebas de teclado del Agente/);
});
