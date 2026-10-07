import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createDemoServer, DemoCancelledError } from './demo-server.js';

test('cancelPending corta la pregunta en curso y también las siguientes (se cerró el panel)', async () => {
  const server = createDemoServer();
  const pending = server.askPanel({ kind: 'buttons', text: 'Continuar', options: [] });

  server.cancelPending(new DemoCancelledError());

  await assert.rejects(pending, DemoCancelledError);
  assert.throws(() => server.throwIfCancelled(), DemoCancelledError);
  await assert.rejects(server.askPanel({ kind: 'buttons', text: 'Otra', options: [] }), DemoCancelledError);
});

const ndjson = (text) => text.trim().split('\n').map((line) => JSON.parse(line));

test('/discover va enviando cada página descubierta y al final la lista completa', async () => {
  const { default: request } = await import('supertest');
  const server = createDemoServer();
  server.setDiscoverHandler(async (url, onPage) => {
    onPage(`${url}a`);
    onPage(`${url}b`);
    return { urls: [url, `${url}a`, `${url}b`] };
  });
  const res = await request(server.app).post('/discover').send({ url: 'https://a.test/' });
  assert.equal(res.status, 200);
  assert.match(res.headers['content-type'], /ndjson/);
  assert.deepEqual(ndjson(res.text), [
    { type: 'page', url: 'https://a.test/a' },
    { type: 'page', url: 'https://a.test/b' },
    { type: 'done', ok: true, total: 3, urls: ['https://a.test/', 'https://a.test/a', 'https://a.test/b'] }
  ]);
});

test('/discover informa el error al final del stream si el recorrido falla', async () => {
  const { default: request } = await import('supertest');
  const server = createDemoServer();
  server.setDiscoverHandler(async (url, onPage) => { onPage(`${url}a`); throw new Error('timeout'); });
  const res = await request(server.app).post('/discover').send({ url: 'https://a.test/' });
  assert.deepEqual(ndjson(res.text), [
    { type: 'page', url: 'https://a.test/a' },
    { type: 'error', ok: false, error: 'timeout' }
  ]);
});

test('/discover rechaza una URL inválida con 400', async () => {
  const { default: request } = await import('supertest');
  const server = createDemoServer();
  server.setDiscoverHandler(async () => ({ urls: [] }));
  const res = await request(server.app).post('/discover').send({ url: 'nada' });
  assert.equal(res.status, 400);
  assert.equal(res.body.ok, false);
});

test('pushRun guarda la pantalla en vivo para reenviarla a un panel que se conecta tarde', async () => {
  const http = await import('node:http');
  const server = createDemoServer();
  server.pushRun({ target: 'https://a.test/', stations: [], summary: { final: false } });
  const srv = http.createServer(server.app);
  await new Promise((r) => srv.listen(0, r));
  const text = await new Promise((resolve) => {
    http.get(`http://localhost:${srv.address().port}/events`, (res) => {
      let buf = '';
      res.on('data', (chunk) => {
        buf += chunk;
        if (buf.includes('event: run')) { res.destroy(); resolve(buf); }
      });
    });
  });
  srv.close();
  assert.match(text, /event: run\ndata: \{"target":"https:\/\/a.test\/"/);
});
