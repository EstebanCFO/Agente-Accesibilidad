import { test } from 'node:test';
import assert from 'node:assert/strict';
import request from 'supertest';
import { createApp } from './server.js';
import { JobStore } from '../job-store.js';

function setup() {
  const jobStore = new JobStore();
  const runCalls = [];
  const agentLoopFactory = () => ({
    run: async (jobId) => {
      runCalls.push(jobId);
      return jobStore.getJob(jobId);
    }
  });
  const app = createApp({ jobStore, agentLoopFactory });
  return { app, jobStore, runCalls };
}

const VALID_CONFIG = {
  target: { channel: 'home_banking', mode: 'url_list', urls: ['https://banco.test/login'] }
};

test('GET /api/health responde ok', async () => {
  const { app } = setup();
  const res = await request(app).get('/api/health');
  assert.equal(res.status, 200);
  assert.deepEqual(res.body, { status: 'ok' });
});

test('POST /api/jobs con config válida crea el job y dispara el agent loop', async () => {
  const { app, jobStore, runCalls } = setup();
  const res = await request(app).post('/api/jobs').send(VALID_CONFIG);
  assert.equal(res.status, 201);
  assert.match(res.body.job_id, /^[0-9a-f-]{36}$/);
  assert.ok(['pending', 'running'].includes(res.body.status));
  assert.ok(jobStore.getJob(res.body.job_id));
  await new Promise((resolve) => setImmediate(resolve));
  assert.deepEqual(runCalls, [res.body.job_id]);
});

test('POST /api/jobs con config inválida responde 400 con detalle de errores', async () => {
  const { app } = setup();
  const res = await request(app).post('/api/jobs').send({ target: { mode: 'url_list', urls: [] } });
  assert.equal(res.status, 400);
  assert.equal(res.body.error, 'invalid_config');
  assert.ok(Array.isArray(res.body.details));
  assert.ok(res.body.details.length > 0);
});

test('GET /api/jobs/:id devuelve el estado del job creado', async () => {
  const { app } = setup();
  const created = await request(app).post('/api/jobs').send(VALID_CONFIG);
  const res = await request(app).get(`/api/jobs/${created.body.job_id}`);
  assert.equal(res.status, 200);
  assert.equal(res.body.job_id, created.body.job_id);
  assert.ok('phase' in res.body);
  assert.ok('progress' in res.body);
});

test('GET /api/jobs/:id con id desconocido responde 404', async () => {
  const { app } = setup();
  const res = await request(app).get('/api/jobs/no-existe');
  assert.equal(res.status, 404);
  assert.equal(res.body.error, 'job_not_found');
});
