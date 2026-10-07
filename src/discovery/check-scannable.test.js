import { test } from 'node:test';
import assert from 'node:assert/strict';
import { checkScannable, detectBotProtection, robotsAllows, AUDIT_USER_AGENT } from './check-scannable.js';

const HTML = { 'content-type': 'text/html; charset=utf-8' };

/** fetch falso: rutas → { status, headers, body } (o una función que tira). */
function fakeFetch(routes, calls = []) {
  return async (url, init) => {
    calls.push({ url, init });
    const route = routes[url];
    if (!route) return new Response('not found', { status: 404 });
    if (typeof route === 'function') return route();
    return new Response(route.body ?? '', { status: route.status ?? 200, headers: route.headers ?? HTML });
  };
}

test('checkScannable da ok para una página HTML accesible sin robots.txt', async () => {
  const calls = [];
  const result = await checkScannable('https://banco.test/', { fetchImpl: fakeFetch({ 'https://banco.test/': { body: '<html></html>' } }, calls) });
  assert.equal(result.ok, true);
  assert.equal(calls[0].init.headers['User-Agent'], AUDIT_USER_AGENT);
});

test('checkScannable marca error HTTP con el código', async () => {
  const result = await checkScannable('https://banco.test/x', { fetchImpl: fakeFetch({}) });
  assert.equal(result.ok, false);
  assert.match(result.reason, /HTTP 404/);
});

test('checkScannable rechaza URLs inválidas sin hacer pedidos', async () => {
  const calls = [];
  const result = await checkScannable('ftp://banco.test', { fetchImpl: fakeFetch({}, calls) });
  assert.equal(result.ok, false);
  assert.equal(calls.length, 0);
});

test('checkScannable detecta protección anti-bots por cookie aunque responda 200', async () => {
  const fetchImpl = fakeFetch({ 'https://banco.test/': { headers: { ...HTML, 'set-cookie': '_abck=123; Path=/' }, body: '<html></html>' } });
  const result = await checkScannable('https://banco.test/', { fetchImpl });
  assert.equal(result.ok, false);
  assert.equal(result.protection, 'Akamai Bot Manager');
  assert.match(result.reason, /habilite la auditoría/);
});

test('checkScannable detecta una página de desafío de Cloudflare', async () => {
  const fetchImpl = fakeFetch({ 'https://banco.test/': { status: 403, body: '<title>Just a moment...</title>' } });
  const result = await checkScannable('https://banco.test/', { fetchImpl });
  assert.equal(result.ok, false);
  assert.equal(result.protection, 'Cloudflare (desafío)');
});

test('checkScannable no considera protección la sola presencia de un CDN', () => {
  assert.equal(detectBotProtection(new Headers({ 'cf-ray': 'abc', server: 'cloudflare' }), '<html></html>'), null);
});

test('checkScannable rechaza contenido que no es HTML', async () => {
  const fetchImpl = fakeFetch({ 'https://banco.test/doc.pdf': { headers: { 'content-type': 'application/pdf' } } });
  const result = await checkScannable('https://banco.test/doc.pdf', { fetchImpl });
  assert.equal(result.ok, false);
  assert.match(result.reason, /application\/pdf/);
});

test('checkScannable respeta robots.txt para la sub-URL', async () => {
  const robots = { headers: { 'content-type': 'text/plain' }, body: 'User-agent: *\nDisallow: /homebanking/' };
  const fetchImpl = fakeFetch({
    'https://banco.test/homebanking/login': { body: '<html></html>' },
    'https://banco.test/personas': { body: '<html></html>' },
    'https://banco.test/robots.txt': robots
  });
  assert.equal((await checkScannable('https://banco.test/homebanking/login', { fetchImpl })).ok, false);
  assert.equal((await checkScannable('https://banco.test/personas', { fetchImpl })).ok, true);
});

test('checkScannable informa la falla de conexión sin tirar', async () => {
  const fetchImpl = fakeFetch({ 'https://banco.test/': () => { throw new TypeError('fetch failed'); } });
  const result = await checkScannable('https://banco.test/', { fetchImpl });
  assert.equal(result.ok, false);
  assert.match(result.reason, /No se pudo conectar/);
});

test('robotsAllows aplica la coincidencia más larga y solo el grupo "*"', () => {
  const txt = 'User-agent: Googlebot\nDisallow: /\n\nUser-agent: *\nDisallow: /privado\nAllow: /privado/publico\n';
  assert.equal(robotsAllows(txt, '/'), true);
  assert.equal(robotsAllows(txt, '/privado/x'), false);
  assert.equal(robotsAllows(txt, '/privado/publico/y'), true);
  assert.equal(robotsAllows('User-agent: *\nDisallow: /*.php$', '/a.php'), false);
  assert.equal(robotsAllows('User-agent: *\nDisallow:', '/a'), true);
});
