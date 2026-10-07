import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createSiteDiscovery } from './demo-discovery.js';

/** Crawl falso: anuncia las páginas de a una y termina cuando se lo pide el test. */
function fakeCrawl(pages) {
  let finish;
  const calls = [];
  const crawl = (url, { onPage }) => {
    calls.push(url);
    for (const p of pages) onPage(p);
    return new Promise((resolve, reject) => { finish = { resolve: () => resolve(pages), reject }; });
  };
  return { crawl, calls, finish: () => finish.resolve(), fail: (e) => finish.reject(e) };
}

test('discover avisa cada página nueva, sin repetir la principal, y devuelve la principal primero', async () => {
  const fake = fakeCrawl(['https://a.test/x', 'https://a.test/', 'https://a.test/x', 'https://a.test/y']);
  const discover = createSiteDiscovery(fake.crawl, { maxPages: 50 });
  const seen = [];
  const pending = discover('https://a.test/', (u) => seen.push(u));
  fake.finish();
  assert.deepEqual(await pending, ['https://a.test/', 'https://a.test/x', 'https://a.test/y']);
  assert.deepEqual(seen, ['https://a.test/x', 'https://a.test/y']);
});

test('discover reutiliza el resultado: la segunda vez no recorre y repite las páginas al instante', async () => {
  const fake = fakeCrawl(['https://a.test/', 'https://a.test/x']);
  const discover = createSiteDiscovery(fake.crawl, { maxPages: 50 });
  const first = discover('https://a.test/', () => {});
  fake.finish();
  await first;
  const seen = [];
  assert.deepEqual(await discover('https://a.test/', (u) => seen.push(u)), ['https://a.test/', 'https://a.test/x']);
  assert.deepEqual(seen, ['https://a.test/x']);
  assert.equal(fake.calls.length, 1);
});

test('discover: un segundo pedido mientras recorre recibe lo ya encontrado y lo que sigue', async () => {
  let onPageOfCrawl;
  let resolveCrawl;
  const crawl = (url, { onPage }) => { onPageOfCrawl = onPage; return new Promise((r) => { resolveCrawl = r; }); };
  const discover = createSiteDiscovery(crawl, { maxPages: 50 });
  const a = []; const b = [];
  const first = discover('https://a.test/', (u) => a.push(u));
  onPageOfCrawl('https://a.test/x');
  const second = discover('https://a.test/', (u) => b.push(u));
  onPageOfCrawl('https://a.test/y');
  resolveCrawl(['https://a.test/x', 'https://a.test/y']);
  await Promise.all([first, second]);
  assert.deepEqual(a, ['https://a.test/x', 'https://a.test/y']);
  assert.deepEqual(b, ['https://a.test/x', 'https://a.test/y']);
});

test('discover: si el recorrido falla no queda en caché y el próximo pedido vuelve a recorrer', async () => {
  const fake = fakeCrawl([]);
  const discover = createSiteDiscovery(fake.crawl, { maxPages: 50 });
  const first = discover('https://a.test/', () => {});
  fake.fail(new Error('timeout'));
  await assert.rejects(first, /timeout/);
  discover('https://a.test/', () => {});
  assert.equal(fake.calls.length, 2);
});

test('discover pasa el tope de páginas al crawler', async () => {
  let options;
  const discover = createSiteDiscovery((url, o) => { options = o; return Promise.resolve([]); }, { maxPages: 7 });
  await discover('https://a.test/');
  assert.equal(options.maxUrls, 7);
});

test('has indica si la URL ya se analizó o se está analizando', async () => {
  const fake = fakeCrawl([]);
  const discover = createSiteDiscovery(fake.crawl, { maxPages: 50 });
  assert.equal(discover.has('https://a.test/'), false);
  const pending = discover('https://a.test/');
  assert.equal(discover.has('https://a.test/'), true);
  fake.finish();
  await pending;
  assert.equal(discover.has('https://a.test/'), true);
});
