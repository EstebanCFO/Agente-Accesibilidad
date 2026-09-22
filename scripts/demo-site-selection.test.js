import { test } from 'node:test';
import assert from 'node:assert/strict';
import { resolveTargetUrl, DEMO_SITE_URL } from './demo-site-selection.js';

test('resolveTargetUrl opción 1 devuelve el sitio de demo fijo', () => {
  assert.equal(resolveTargetUrl('1'), DEMO_SITE_URL);
});

test('resolveTargetUrl opción 2 devuelve la URL personalizada ingresada', () => {
  assert.equal(resolveTargetUrl('2', 'https://banco.example.com'), 'https://banco.example.com');
});

test('resolveTargetUrl opción 3 devuelve la URL personalizada ingresada', () => {
  assert.equal(resolveTargetUrl('3', 'https://otra.example.com'), 'https://otra.example.com');
});

test('resolveTargetUrl opción 2/3 sin URL tira error claro', () => {
  assert.throws(() => resolveTargetUrl('2', ''), /no se ingresó ninguna/);
  assert.throws(() => resolveTargetUrl('3', undefined), /no se ingresó ninguna/);
});

test('resolveTargetUrl opción inválida tira error claro', () => {
  assert.throws(() => resolveTargetUrl('9'), /Opción inválida/);
  assert.throws(() => resolveTargetUrl(''), /Opción inválida/);
});

test('resolveTargetUrl tolera espacios alrededor de la opción y la URL', () => {
  assert.equal(resolveTargetUrl(' 1 '), DEMO_SITE_URL);
  assert.equal(resolveTargetUrl('2', '  https://banco.example.com  '), 'https://banco.example.com');
});
