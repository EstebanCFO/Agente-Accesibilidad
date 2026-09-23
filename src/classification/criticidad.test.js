import { test } from 'node:test';
import assert from 'node:assert/strict';
import { derivePrincipio, deriveSeveridad, worseSeveridad } from './criticidad.js';

test('derivePrincipio mapea el primer dígito al principio WCAG correcto', () => {
  assert.equal(derivePrincipio('1.1.1'), 'Perceptible');
  assert.equal(derivePrincipio('2.4.7'), 'Operable');
  assert.equal(derivePrincipio('3.3.4'), 'Comprensible');
  assert.equal(derivePrincipio('4.1.2'), 'Robusto');
});

test('deriveSeveridad: Nivel A + critical da "critico"', () => {
  assert.equal(deriveSeveridad({ wcag_level: 'A', severity: 'critical', affected_urls: ['https://a.test'] }), 'critico');
});

test('deriveSeveridad: severity "minor" da "bajo" aunque el criterio sea AA', () => {
  assert.equal(deriveSeveridad({ wcag_level: 'AA', severity: 'minor', affected_urls: ['https://a.test'] }), 'bajo');
});

test('deriveSeveridad: Nivel A con serious/moderate da "alto"', () => {
  assert.equal(deriveSeveridad({ wcag_level: 'A', severity: 'serious', affected_urls: ['https://a.test'] }), 'alto');
  assert.equal(deriveSeveridad({ wcag_level: 'A', severity: 'moderate', affected_urls: ['https://a.test'] }), 'alto');
});

test('deriveSeveridad: afecta varias páginas da "alto" aunque sea AA (proxy de componente reutilizado)', () => {
  assert.equal(deriveSeveridad({ wcag_level: 'AA', severity: 'moderate', affected_urls: ['https://a.test', 'https://b.test'] }), 'alto');
});

test('deriveSeveridad: Nivel AA en una sola página da "medio"', () => {
  assert.equal(deriveSeveridad({ wcag_level: 'AA', severity: 'serious', affected_urls: ['https://a.test'] }), 'medio');
});

test('worseSeveridad devuelve el peor de dos niveles', () => {
  assert.equal(worseSeveridad('bajo', 'critico'), 'critico');
  assert.equal(worseSeveridad('alto', 'medio'), 'alto');
  assert.equal(worseSeveridad('medio', 'medio'), 'medio');
  assert.equal(worseSeveridad('critico', 'bajo'), 'critico');
});
