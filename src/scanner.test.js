import { test } from 'node:test';
import assert from 'node:assert/strict';
import { scanUrl, scanBatch } from './scanner.js';

test('scanUrl escanea una URL real y devuelve axe_results con la forma esperada', async () => {
  const result = await scanUrl({ url: 'https://example.com' });

  assert.equal(result.url, 'https://example.com');
  assert.ok(result.scanned_at);
  assert.ok(result.violation_count >= 2);
  assert.ok(Array.isArray(result.violations));

  const ids = result.violations.map((v) => v.id);
  assert.ok(ids.includes('landmark-one-main'));
  assert.ok(ids.includes('region'));

  for (const violation of result.violations) {
    assert.ok(violation.node_count > 0);
    assert.equal(violation.node_count, violation.nodes.length);
  }
});

test('scanUrl filtra por wcag_tags cuando se especifican', async () => {
  const result = await scanUrl({ url: 'https://example.com', wcagTags: ['wcag2a'] });
  assert.ok(Array.isArray(result.violations));
});

test('scanUrl requiere url', async () => {
  await assert.rejects(() => scanUrl({}), /requiere "url"/);
});

test('scanBatch escanea varias URLs en paralelo y devuelve resultados en el mismo orden', async () => {
  const urlList = [
    'https://example.com',
    'https://www.w3.org/WAI/demos/bad/after/home.html'
  ];
  const results = await scanBatch({ urlList, workers: 2 });

  assert.equal(results.length, 2);
  assert.equal(results[0].url, 'https://example.com');
  assert.equal(results[1].url, 'https://www.w3.org/WAI/demos/bad/after/home.html');
  for (const result of results) {
    assert.ok(Array.isArray(result.violations));
  }
});

test('scanBatch no aborta el batch si una URL falla: la marca con un error clasificado', async () => {
  const urlList = ['https://example.com', 'https://este-dominio-no-existe.invalid'];
  const results = await scanBatch({ urlList, workers: 2, timeout: 10000 });

  assert.equal(results.length, 2);
  assert.ok(Array.isArray(results[0].violations));
  assert.equal(results[1].url, 'https://este-dominio-no-existe.invalid');
  assert.ok(results[1].error);
  assert.equal(results[1].error.type, 'unknown');
});

test('scanBatch clasifica un timeout como error de tipo "timeout" sin frenar el resto del batch', async () => {
  const urlList = ['https://example.com', 'https://www.w3.org/WAI/demos/bad/after/home.html'];
  const results = await scanBatch({ urlList, workers: 2, timeout: 1 });

  for (const result of results) {
    assert.ok(result.error, `esperaba timeout para ${result.url}`);
    assert.equal(result.error.type, 'timeout');
  }
});

test('scanBatch requiere urlList no vacío', async () => {
  await assert.rejects(() => scanBatch({ urlList: [] }), /requiere "urlList"/);
});
