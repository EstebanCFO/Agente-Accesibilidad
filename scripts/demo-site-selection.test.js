import { test } from 'node:test';
import assert from 'node:assert/strict';
import { resolveTargetUrl, resolveReferenceSiteUrl, REFERENCE_SITES } from './demo-site-selection.js';

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
  assert.equal(resolveTargetUrl('2', '  https://banco.example.com  '), 'https://banco.example.com');
});

test('resolveTargetUrl ya no resuelve la opción 1 directamente - eso lo maneja resolveReferenceSiteUrl', () => {
  assert.throws(() => resolveTargetUrl('1'), /Opción inválida/);
});

test('REFERENCE_SITES tiene los 3 sitios de referencia con label y url', () => {
  assert.equal(REFERENCE_SITES.length, 3);
  for (const site of REFERENCE_SITES) {
    assert.ok(site.label);
    assert.ok(site.url.startsWith('https://'));
  }
});

test('resolveReferenceSiteUrl devuelve la URL del sitio elegido por número', () => {
  assert.equal(resolveReferenceSiteUrl('1'), REFERENCE_SITES[0].url);
  assert.equal(resolveReferenceSiteUrl('2'), REFERENCE_SITES[1].url);
  assert.equal(resolveReferenceSiteUrl('3'), REFERENCE_SITES[2].url);
});

test('resolveReferenceSiteUrl tolera espacios alrededor del número', () => {
  assert.equal(resolveReferenceSiteUrl(' 1 '), REFERENCE_SITES[0].url);
});

test('resolveReferenceSiteUrl rechaza un número fuera de rango, no numérico o vacío', () => {
  assert.throws(() => resolveReferenceSiteUrl('0'), /Opción inválida/);
  assert.throws(() => resolveReferenceSiteUrl('4'), /Opción inválida/);
  assert.throws(() => resolveReferenceSiteUrl('abc'), /Opción inválida/);
  assert.throws(() => resolveReferenceSiteUrl(''), /Opción inválida/);
});
