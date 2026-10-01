import { test } from 'node:test';
import assert from 'node:assert/strict';
import { computeWcagSection } from './wcag-section.js';

const pass = (id, tags) => ({ id, tags });
const page = (url, { passes = [], inapplicable = [] } = {}) => ({ url, violations: [], incomplete: [], passes, inapplicable });
const finding = (criterion, reviewStatus, inScope = 'onti') => ({ source: 'axe-core', wcag_criterion: criterion, in_scope: inScope, review_status: reviewStatus });
const statusOf = (section, criterion) => section.by_criterion.find((c) => c.wcag_criterion === criterion)?.status;

test('computeWcagSection: criterio con regla que pasó y sin hallazgos queda OK', () => {
  const section = computeWcagSection([], { axeResults: [page('https://a.test', { passes: [pass('image-alt', ['wcag2a', 'wcag111'])] })] });
  assert.equal(statusOf(section, '1.1.1'), 'ok');
});

test('computeWcagSection: una violación confirmada deja el criterio NOK', () => {
  const section = computeWcagSection([finding('1.4.3', 'confirmado')], { axeResults: [page('https://a.test')] });
  assert.equal(statusOf(section, '1.4.3'), 'nok');
});

test('computeWcagSection: violación en una página e incomplete en otra queda NOK', () => {
  const section = computeWcagSection(
    [finding('1.4.3', 'requiere_revision'), finding('1.4.3', 'confirmado')],
    { axeResults: [page('https://a.test'), page('https://b.test')] }
  );
  assert.equal(statusOf(section, '1.4.3'), 'nok');
});

test('computeWcagSection: solo incomplete (aunque otra regla del criterio pase) queda A validar', () => {
  const section = computeWcagSection([finding('1.4.3', 'requiere_revision')], {
    axeResults: [page('https://a.test', { passes: [pass('color-contrast', ['wcag2aa', 'wcag143'])] })]
  });
  assert.equal(statusOf(section, '1.4.3'), 'a_validar');
});

test('computeWcagSection: criterio sin ninguna regla evaluada queda A validar y no cuenta como OK', () => {
  const section = computeWcagSection([], { axeResults: [page('https://a.test')] });
  assert.equal(statusOf(section, '2.4.7'), 'a_validar');
  assert.equal(section.ok, 0);
  assert.equal(section.a_validar, 38);
});

test('computeWcagSection: sin audio ni video los criterios 1.2.x quedan A validar, nunca No aplica', () => {
  const section = computeWcagSection([], {
    axeResults: [page('https://a.test', { inapplicable: [pass('video-caption', ['wcag2a', 'wcag122'])] })]
  });
  for (const c of ['1.2.1', '1.2.2', '1.2.3', '1.2.4', '1.2.5']) assert.equal(statusOf(section, c), 'a_validar', c);
  assert.equal(section.no_aplica, 0);
  assert.equal(section.total, 38);
});

test('computeWcagSection: un finding real deja NOK un criterio multimedia aunque no se detecte video', () => {
  const section = computeWcagSection([finding('1.2.2', 'confirmado')], {
    axeResults: [page('https://a.test', { inapplicable: [pass('video-caption', ['wcag2a', 'wcag122'])] })]
  });
  assert.equal(statusOf(section, '1.2.2'), 'nok');
});

test('computeWcagSection: los hallazgos complementarios no cambian ningún estado', () => {
  const section = computeWcagSection([{ ...finding('2.4.7', 'confirmado'), source: 'keyboard_review' }], { axeResults: [page('https://a.test')] });
  assert.equal(statusOf(section, '2.4.7'), 'a_validar');
});

test('computeWcagSection: sin includeExtended evalúa 38; con includeExtended suma los 18 de 2.1/2.2', () => {
  assert.equal(computeWcagSection([], { axeResults: [page('https://a.test')] }).by_criterion.length, 38);
  const extended = computeWcagSection([finding('2.5.8', 'confirmado', 'extended_22')], { axeResults: [page('https://a.test')], includeExtended: true });
  assert.equal(extended.by_criterion.length, 56);
  assert.equal(statusOf(extended, '2.5.8'), 'nok');
});

test('computeWcagSection: los conteos suman el total más los No aplica', () => {
  const section = computeWcagSection([finding('1.4.3', 'confirmado')], {
    axeResults: [page('https://a.test', { passes: [pass('image-alt', ['wcag2a', 'wcag111'])] })]
  });
  assert.equal(section.ok + section.nok + section.a_validar, section.total);
  assert.equal(section.total + section.no_aplica, 38);
});

const reasonOf = (section, criterion) => section.by_criterion.find((c) => c.wcag_criterion === criterion)?.reason;

test('reason: OK verificado automáticamente', () => {
  const section = computeWcagSection([], { axeResults: [page('https://a.test', { passes: [pass('image-alt', ['wcag2a', 'wcag111'])] })] });
  assert.deepEqual(reasonOf(section, '1.1.1'), { code: 'verificado', text: 'Verificado automáticamente, sin problemas' });
});

test('reason: NOK cuenta las páginas afectadas', () => {
  const nok = { ...finding('1.4.3', 'confirmado'), affected_urls: ['https://a.test', 'https://b.test'] };
  const section = computeWcagSection([nok], { axeResults: [page('https://a.test'), page('https://b.test')] });
  assert.deepEqual(reasonOf(section, '1.4.3'), { code: 'con_problemas', text: 'Problemas en 2 páginas' });
});

test('reason: A validar por incomplete dice que el agente no pudo determinarlo', () => {
  const section = computeWcagSection([finding('1.4.3', 'requiere_revision')], { axeResults: [page('https://a.test')] });
  assert.equal(reasonOf(section, '1.4.3').code, 'indeterminado');
  assert.equal(reasonOf(section, '1.4.3').text, 'El agente no pudo determinarlo automáticamente');
});

test('reason: criterio sin reglas automáticas requiere tecnología asistiva o revisión manual', () => {
  const section = computeWcagSection([], { axeResults: [page('https://a.test')] });
  assert.deepEqual(reasonOf(section, '2.4.7'), { code: 'requiere_asistiva', text: 'Requiere tecnología asistiva: navegación solo con teclado' });
  assert.equal(reasonOf(section, '1.4.5').code, 'requiere_manual');
  assert.match(reasonOf(section, '1.4.5').text, /^Requiere revisión manual/);
});

test('reason: criterio con reglas pero sin elementos en las páginas queda A validar sin_elementos', () => {
  const section = computeWcagSection([], { axeResults: [page('https://a.test'), page('https://b.test')] });
  assert.equal(statusOf(section, '1.1.1'), 'a_validar');
  assert.deepEqual(reasonOf(section, '1.1.1'), {
    code: 'sin_elementos',
    text: 'Sin elementos evaluables: las reglas automáticas no encontraron elementos a revisar en las 2 páginas evaluadas'
  });
});

test('reason: sin audio ni video, todos los 1.2.x piden confirmarlo con el mismo motivo', () => {
  const section = computeWcagSection([], {
    axeResults: [page('https://a.test', { inapplicable: [pass('video-caption', ['wcag2a', 'wcag122'])] }), page('https://b.test')]
  });
  const expected = { code: 'sin_multimedia', text: 'No se detectó audio ni video en las 2 páginas evaluadas: confirmar manualmente que el sitio no tiene contenido multimedia' };
  for (const c of ['1.2.1', '1.2.2', '1.2.3', '1.2.4', '1.2.5']) assert.deepEqual(reasonOf(section, c), expected, c);
});

test('reason: con video en la página, los 1.2.x sin reglas conservan su método de revisión', () => {
  const section = computeWcagSection([], {
    axeResults: [page('https://a.test', { passes: [pass('video-caption', ['wcag2a', 'wcag122'])] })]
  });
  assert.equal(statusOf(section, '1.2.2'), 'ok');
  assert.equal(reasonOf(section, '1.2.3').code, 'requiere_manual');
});

test('computeWcagSection: un finding sin review_status (datos viejos) cuenta como confirmado', () => {
  const section = computeWcagSection([{ wcag_criterion: '1.1.1', in_scope: 'onti' }], { axeResults: [page('https://a.test')] });
  assert.equal(statusOf(section, '1.1.1'), 'nok');
});
