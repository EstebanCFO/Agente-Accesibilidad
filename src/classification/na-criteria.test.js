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

test('computeNaCriteria no marca N/A criterios de la capa extendida (fuera de la allowlist), ni siquiera con includeExtended:true', () => {
  // Antes del fix de la allowlist (Finding 1 de la revisión final), este test verificaba que
  // 2.5.8 se marcara N/A cuando su única regla (target-size) resultaba siempre inapplicable y
  // includeExtended:true. Eso era exactamente el problema que el fix corrige: 2.5.8 no está en
  // NA_ELIGIBLE_CRITERIA (solo 1.2.1/1.2.2 lo están), así que nunca debe marcarse N/A sin
  // importar includeExtended.
  const axeResults = [
    { url: 'https://a.test', violations: [], incomplete: [], passes: [], inapplicable: [{ id: 'target-size', tags: ['wcag22aa', 'wcag258'] }] }
  ];
  const sinExtendida = computeNaCriteria(axeResults, { includeExtended: false });
  assert.ok(!sinExtendida.includes('2.5.8'));

  const conExtendida = computeNaCriteria(axeResults, { includeExtended: true });
  assert.ok(!conExtendida.includes('2.5.8'), '2.5.8 no está en la allowlist NA_ELIGIBLE_CRITERIA');
});

test('computeNaCriteria con lista vacía o resultados con error no rompe y devuelve []', () => {
  assert.deepEqual(computeNaCriteria([]), []);
  assert.deepEqual(computeNaCriteria([{ url: 'https://roto.test', error: { type: 'timeout' } }]), []);
  assert.deepEqual(computeNaCriteria(undefined), []);
});

test('computeNaCriteria nunca marca N/A un criterio fuera de la allowlist, aunque su única regla sea siempre inapplicable', () => {
  const axeResults = [
    { url: 'https://a.test', violations: [], incomplete: [], passes: [], inapplicable: [{ id: 'meta-refresh', tags: ['wcag2a', 'wcag221'] }] }
  ];
  const naCriteria = computeNaCriteria(axeResults);
  assert.ok(!naCriteria.includes('2.2.1'), '2.2.1 no está en la allowlist - "inapplicable" en meta-refresh no significa que el canal no tenga límites de sesión');
});
