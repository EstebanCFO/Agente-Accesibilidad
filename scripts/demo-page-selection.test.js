import { test } from 'node:test';
import assert from 'node:assert/strict';
import { resolveAdditionalPageCount } from './demo-page-selection.js';

test('resolveAdditionalPageCount con respuesta vacía devuelve 0', () => {
  assert.equal(resolveAdditionalPageCount('', 5), 0);
  assert.equal(resolveAdditionalPageCount(undefined, 5), 0);
});

test('resolveAdditionalPageCount devuelve el número pedido si hay suficientes subpáginas', () => {
  assert.equal(resolveAdditionalPageCount('2', 5), 2);
});

test('resolveAdditionalPageCount tolera espacios alrededor del número', () => {
  assert.equal(resolveAdditionalPageCount(' 3 ', 5), 3);
});

test('resolveAdditionalPageCount recorta al máximo disponible si piden de más', () => {
  assert.equal(resolveAdditionalPageCount('10', 3), 3);
});

test('resolveAdditionalPageCount con 0 subpáginas disponibles siempre da 0', () => {
  assert.equal(resolveAdditionalPageCount('5', 0), 0);
  assert.equal(resolveAdditionalPageCount('', 0), 0);
});

test('resolveAdditionalPageCount rechaza texto no numérico', () => {
  assert.throws(() => resolveAdditionalPageCount('todas', 5), /Cantidad inválida/);
});

test('resolveAdditionalPageCount rechaza números negativos', () => {
  assert.throws(() => resolveAdditionalPageCount('-1', 5), /Cantidad inválida/);
});
