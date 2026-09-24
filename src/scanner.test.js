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

test('scanUrl con wcagTags explícito restringe exactamente a esos tags, no al default', async () => {
  const result = await scanUrl({ url: 'https://example.com', wcagTags: ['wcag2a'] });
  const allItems = [...result.violations, ...result.incomplete, ...result.passes, ...result.inapplicable];
  assert.ok(allItems.length > 0);
  for (const item of allItems) {
    assert.ok(item.tags.includes('wcag2a'), `la regla "${item.id}" no tiene el tag wcag2a (tags: ${item.tags.join(', ')})`);
  }
});

test('scanUrl sin wcag_tags restringe por default a WCAG 2.0/2.1/2.2 (A/AA) + best-practice - nunca corre reglas AAA/deprecadas', async () => {
  const DEFAULT_TAGS = ['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa', 'wcag22aa', 'best-practice'];
  const result = await scanUrl({ url: 'https://www.w3.org/WAI/demos/bad/after/home.html' });
  const allItems = [...result.violations, ...result.incomplete, ...result.passes, ...result.inapplicable];
  assert.ok(allItems.length > 0);
  for (const item of allItems) {
    assert.ok(
      item.tags.some((tag) => DEFAULT_TAGS.includes(tag)),
      `la regla "${item.id}" no tiene ningún tag del set default (tags: ${item.tags.join(', ')})`
    );
  }
});

test('scanUrl aplica el locale oficial en español de axe-core (help/failure_summary en español, no en inglés)', async () => {
  const result = await scanUrl({ url: 'https://example.com' });
  const landmarkViolation = result.violations.find((v) => v.id === 'landmark-one-main');
  assert.equal(landmarkViolation.help, 'El documento debe tener un punto de referencia main');
  assert.match(landmarkViolation.nodes[0].failure_summary, /Corregir/);
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

test('scanUrl con captureScreenshot:true agrega una screenshot base64 no vacía', async () => {
  const result = await scanUrl({ url: 'https://example.com', captureScreenshot: true });
  assert.equal(typeof result.screenshot, 'string');
  assert.ok(result.screenshot.length > 100);
});

test('scanUrl con captureHtml:true agrega el HTML completo de la página', async () => {
  const result = await scanUrl({ url: 'https://example.com', captureHtml: true });
  assert.match(result.html, /<html/i);
  assert.match(result.html, /Example Domain/);
});

test('scanUrl sin capture flags no agrega screenshot ni html', async () => {
  const result = await scanUrl({ url: 'https://example.com' });
  assert.equal(result.screenshot, undefined);
  assert.equal(result.html, undefined);
});

test('scanUrl captura incomplete[], passes[] e inapplicable[] con su forma completa', async () => {
  const result = await scanUrl({ url: 'https://example.com' });

  assert.ok(Array.isArray(result.incomplete));
  assert.ok(Array.isArray(result.passes));
  assert.ok(Array.isArray(result.inapplicable));
  assert.ok(result.passes.length > 0, 'example.com tiene reglas que pasan');
  assert.ok(result.inapplicable.length > 0, 'example.com tiene reglas que no aplican (ej. sin <video>)');

  const somePass = result.passes[0];
  assert.ok(typeof somePass.id === 'string');
  assert.ok(Array.isArray(somePass.tags));

  const someInapplicable = result.inapplicable[0];
  assert.ok(typeof someInapplicable.id === 'string');
  assert.ok(Array.isArray(someInapplicable.tags));
});
