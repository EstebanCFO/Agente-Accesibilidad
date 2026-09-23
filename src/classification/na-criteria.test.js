import { test } from 'node:test';
import assert from 'node:assert/strict';
import { computeNaCriteria } from './na-criteria.js';

test('computeNaCriteria marca un criterio N/A cuando su única regla es inapplicable en todas las URLs', () => {
  const axeResults = [
    { url: 'https://a.test', violations: [], incomplete: [], passes: [], inapplicable: [{ id: 'video-caption', tags: ['wcag2a', 'wcag122'] }] },
    { url: 'https://b.test', violations: [], incomplete: [], passes: [], inapplicable: [{ id: 'video-caption', tags: ['wcag2a', 'wcag122'] }] }
  ];
  const naCriteria = computeNaCriteria(axeResults);
  assert.ok(naCriteria.includes('1.2.2'));
});

test('computeNaCriteria no marca N/A si la regla fue aplicable (pasó) en alguna URL', () => {
  const axeResults = [
    { url: 'https://a.test', violations: [], incomplete: [], passes: [{ id: 'video-caption', tags: ['wcag2a', 'wcag122'] }], inapplicable: [] },
    { url: 'https://b.test', violations: [], incomplete: [], passes: [], inapplicable: [{ id: 'video-caption', tags: ['wcag2a', 'wcag122'] }] }
  ];
  const naCriteria = computeNaCriteria(axeResults);
  assert.ok(!naCriteria.includes('1.2.2'));
});

test('computeNaCriteria no marca N/A si hubo una violación real en algún lado', () => {
  const axeResults = [
    { url: 'https://a.test', violations: [{ id: 'video-caption', tags: ['wcag2a', 'wcag122'] }], incomplete: [], passes: [], inapplicable: [] }
  ];
  const naCriteria = computeNaCriteria(axeResults);
  assert.ok(!naCriteria.includes('1.2.2'));
});

test('computeNaCriteria no marca N/A si hubo un "incomplete" en algún lado (la regla sí encontró contenido)', () => {
  const axeResults = [
    { url: 'https://a.test', violations: [], incomplete: [{ id: 'video-caption', tags: ['wcag2a', 'wcag122'] }], passes: [], inapplicable: [] }
  ];
  const naCriteria = computeNaCriteria(axeResults);
  assert.ok(!naCriteria.includes('1.2.2'));
});

test('computeNaCriteria no marca N/A un criterio que axe-core nunca evalúa (sin reglas propias, ej. 1.2.3)', () => {
  const axeResults = [
    { url: 'https://a.test', violations: [], incomplete: [], passes: [], inapplicable: [] }
  ];
  const naCriteria = computeNaCriteria(axeResults);
  assert.ok(!naCriteria.includes('1.2.3'));
});

test('computeNaCriteria incluye criterios de la capa extendida solo cuando includeExtended:true', () => {
  const axeResults = [
    { url: 'https://a.test', violations: [], incomplete: [], passes: [], inapplicable: [{ id: 'target-size', tags: ['wcag22aa', 'wcag258'] }] }
  ];
  const sinExtendida = computeNaCriteria(axeResults, { includeExtended: false });
  assert.ok(!sinExtendida.includes('2.5.8'));

  const conExtendida = computeNaCriteria(axeResults, { includeExtended: true });
  assert.ok(conExtendida.includes('2.5.8'));
});

test('computeNaCriteria con lista vacía o resultados con error no rompe y devuelve []', () => {
  assert.deepEqual(computeNaCriteria([]), []);
  assert.deepEqual(computeNaCriteria([{ url: 'https://roto.test', error: { type: 'timeout' } }]), []);
  assert.deepEqual(computeNaCriteria(undefined), []);
});
