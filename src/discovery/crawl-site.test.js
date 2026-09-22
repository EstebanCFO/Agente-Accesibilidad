import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { crawlSite } from './crawl-site.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const FIXTURES_DIR = path.join(__dirname, 'fixtures');
const CONTENT_TYPES = { '.html': 'text/html', '.css': 'text/css' };

let server;
let baseUrl;

before(async () => {
  server = createServer(async (req, res) => {
    const filePath = path.join(FIXTURES_DIR, decodeURIComponent(req.url));
    try {
      const content = await readFile(filePath);
      res.writeHead(200, { 'Content-Type': CONTENT_TYPES[path.extname(filePath)] ?? 'application/octet-stream' });
      res.end(content);
    } catch {
      res.writeHead(404);
      res.end('not found');
    }
  });
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  const { port } = server.address();
  baseUrl = `http://127.0.0.1:${port}`;
});

after(async () => {
  await new Promise((resolve) => server.close(resolve));
});

test('crawlSite descubre las páginas enlazadas del mismo host, excluyendo assets y links externos', async () => {
  const urlList = await crawlSite(`${baseUrl}/index.html`, { maxUrls: 20 });

  const paths = urlList.map((url) => new URL(url).pathname).sort();
  assert.deepEqual(paths, ['/a.html', '/b.html', '/c.html', '/index.html', '/out/skip.html']);
  assert.ok(!urlList.some((url) => url.includes('example.com')), 'no debe seguir el link externo');
  assert.ok(!urlList.some((url) => url.endsWith('.css')), 'no debe enqueuear el asset .css');
});

test('crawlSite respeta maxUrls como tope', async () => {
  const urlList = await crawlSite(`${baseUrl}/index.html`, { maxUrls: 2 });
  assert.equal(urlList.length, 2);
});

test('crawlSite respeta includePatterns: excluye la subcarpeta /out/ con un glob de un solo nivel', async () => {
  const urlList = await crawlSite(`${baseUrl}/index.html`, {
    maxUrls: 20,
    includePatterns: [`${baseUrl}/*.html`]
  });

  const paths = urlList.map((url) => new URL(url).pathname).sort();
  assert.deepEqual(paths, ['/a.html', '/b.html', '/c.html', '/index.html']);
});

test('crawlSite con excludePatterns que bloquea todo solo devuelve la raíz', async () => {
  const urlList = await crawlSite(`${baseUrl}/index.html`, { maxUrls: 20, excludePatterns: ['**/*'] });
  assert.deepEqual(urlList, [`${baseUrl}/index.html`]);
});

test('crawlSite requiere rootUrl', async () => {
  await assert.rejects(() => crawlSite(), /requiere "rootUrl"/);
});
