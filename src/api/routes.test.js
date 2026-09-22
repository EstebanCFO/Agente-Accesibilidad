import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import request from 'supertest';
import { createApp } from './server.js';
import { JobStore } from '../job-store.js';
import { AgentLoop } from '../agent-loop.js';
import { createToolRegistry } from '../tools/tool-registry.js';

async function waitForStatusChange(app, jobId, initialStatus, maxTries = 10) {
  let res;
  for (let i = 0; i < maxTries; i += 1) {
    res = await request(app).get(`/api/jobs/${jobId}`);
    if (res.body.status !== initialStatus) return res;
    await new Promise((resolve) => setImmediate(resolve));
  }
  return res;
}

class FakeAnthropicClient {
  constructor(responses) {
    this.responses = responses;
    this.calls = 0;
    this.lastModel = null;
  }
  get messages() {
    return {
      create: async (params) => {
        this.lastModel = params.model;
        const response = this.responses[Math.min(this.calls, this.responses.length - 1)];
        this.calls += 1;
        return response;
      }
    };
  }
}

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

function minimalScores(overrides = {}) {
  return {
    summary: {
      total_urls_evaluated: 1, onti_criteria_evaluated: 38, onti_criteria_compliant: 38,
      onti_compliance_percentage: 100, onti_conformance: true, conformance_threshold: 30,
      score_level_a: 100, score_level_aa: 100, ...overrides
    },
    extended_22: null,
    by_url: []
  };
}

async function setupWithRealToolRegistry() {
  const jobStore = new JobStore();
  const toolRegistry = createToolRegistry({ jobStore });
  const agentLoopFactory = () => ({ run: async (jobId) => jobStore.getJob(jobId) });
  const app = createApp({ jobStore, agentLoopFactory, toolRegistry });
  const outputPath = await mkdtemp(path.join(tmpdir(), 'f1-api-reports-'));
  return { app, jobStore, toolRegistry, outputPath };
}

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

test('POST /api/jobs con job_id repetido responde 409', async () => {
  const { app } = setup();
  const first = await request(app).post('/api/jobs').send({ ...VALID_CONFIG, job_id: 'job-dup' });
  assert.equal(first.status, 201);
  const second = await request(app).post('/api/jobs').send({ ...VALID_CONFIG, job_id: 'job-dup' });
  assert.equal(second.status, 409);
  assert.equal(second.body.error, 'job_already_exists');
});

test('POST /api/jobs con AgentLoop real llega a completed de punta a punta', async () => {
  const jobStore = new JobStore();
  const fakeClient = new FakeAnthropicClient([{ content: [{ type: 'text', text: 'listo' }] }]);
  const agentLoopFactory = (config) => new AgentLoop({
    anthropicClient: fakeClient,
    toolRegistry: createToolRegistry({ jobStore }),
    jobStore,
    maxIterations: config.agent.max_iterations,
    model: config.agent.model
  });
  const app = createApp({ jobStore, agentLoopFactory });
  const created = await request(app).post('/api/jobs').send(VALID_CONFIG);
  const res = await waitForStatusChange(app, created.body.job_id, 'pending');
  assert.equal(res.body.status, 'completed');
});

test('pasa agent.max_iterations y agent.model del config del job al AgentLoop real', async () => {
  const jobStore = new JobStore();
  const fakeClient = new FakeAnthropicClient([{ content: [{ type: 'tool_use', id: 'c1', name: 'log_progress', input: { message: 'sigo' } }] }]);
  const agentLoopFactory = (config) => new AgentLoop({
    anthropicClient: fakeClient,
    toolRegistry: createToolRegistry({ jobStore }),
    jobStore,
    maxIterations: config.agent.max_iterations,
    model: config.agent.model
  });
  const app = createApp({ jobStore, agentLoopFactory });
  const created = await request(app).post('/api/jobs').send({
    ...VALID_CONFIG,
    agent: { max_iterations: 1, model: 'claude-opus-5' }
  });
  const res = await waitForStatusChange(app, created.body.job_id, 'pending');
  assert.equal(res.body.status, 'failed');
  assert.equal(fakeClient.lastModel, 'claude-opus-5');
});

test('no persiste credenciales de auth en texto plano en el Job Store', async () => {
  const jobStore = new JobStore();
  const agentLoopFactory = () => ({ run: async () => {} });
  const app = createApp({ jobStore, agentLoopFactory });
  const res = await request(app).post('/api/jobs').send({
    ...VALID_CONFIG,
    auth: { type: 'basic', config: { username: 'admin', password: 'SUPERSECRET123' } }
  });
  const storedJob = jobStore.getJob(res.body.job_id);
  assert.equal(storedJob.config.auth.config.password, '[REDACTED]');
});

test('GET /api/jobs/:id/reports lista los entregables generados con su URL de descarga', async () => {
  const { app, jobStore, toolRegistry, outputPath } = await setupWithRealToolRegistry();
  jobStore.createJob({ job_id: 'job-r1', target: { channel: 'home_banking', mode: 'url_list', urls: ['https://x.test'] }, output: { path: outputPath } });
  await toolRegistry.execute('generate_deliverable', { type: 'score', data: { scores: minimalScores() } }, 'job-r1');

  const res = await request(app).get('/api/jobs/job-r1/reports');
  assert.equal(res.status, 200);
  assert.equal(res.body.reports.length, 1);
  assert.equal(res.body.reports[0].filename, 'score-compliance.json');
  assert.equal(res.body.reports[0].url, '/api/jobs/job-r1/reports/score-compliance.json');
});

test('GET /api/jobs/:id/reports con id desconocido responde 404', async () => {
  const { app } = await setupWithRealToolRegistry();
  const res = await request(app).get('/api/jobs/no-existe/reports');
  assert.equal(res.status, 404);
});

test('GET /api/jobs/:id/reports/:file descarga el contenido real del archivo', async () => {
  const { app, jobStore, toolRegistry, outputPath } = await setupWithRealToolRegistry();
  jobStore.createJob({ job_id: 'job-r2', target: { channel: 'home_banking', mode: 'url_list', urls: ['https://x.test'] }, output: { path: outputPath } });
  await toolRegistry.execute('generate_deliverable', { type: 'score', data: { scores: minimalScores() } }, 'job-r2');

  const res = await request(app).get('/api/jobs/job-r2/reports/score-compliance.json');
  assert.equal(res.status, 200);
  assert.match(res.headers['content-type'], /application\/json/);
  assert.equal(res.body.job_id, 'job-r2');
});

test('GET /api/jobs/:id/reports/:file responde 404 para un archivo que no está en job.reports (evita path traversal)', async () => {
  const { app, jobStore, outputPath } = await setupWithRealToolRegistry();
  jobStore.createJob({ job_id: 'job-r3', target: { channel: 'home_banking', mode: 'url_list', urls: ['https://x.test'] }, output: { path: outputPath } });

  const res = await request(app).get('/api/jobs/job-r3/reports/archivo-no-generado.json');
  assert.equal(res.status, 404);
  assert.equal(res.body.error, 'report_not_found');
});

test('POST /api/jobs/consolidate agrega 2 jobs completed en un dashboard consolidado', async () => {
  const { app, jobStore, toolRegistry, outputPath } = await setupWithRealToolRegistry();
  jobStore.createJob({ job_id: 'job-hb', target: { channel: 'home_banking', mode: 'url_list', urls: ['https://x.test'] }, output: { path: outputPath } });
  jobStore.createJob({ job_id: 'job-ios', target: { channel: 'app_ios', mode: 'url_list', urls: ['https://x.test'] }, output: { path: outputPath } });
  await toolRegistry.execute('generate_deliverable', { type: 'score', data: { scores: minimalScores() } }, 'job-hb');
  await toolRegistry.execute('generate_deliverable', { type: 'score', data: { scores: minimalScores({ onti_compliance_percentage: 50, onti_conformance: false }) } }, 'job-ios');
  jobStore.updateJob('job-hb', { status: 'completed' });
  jobStore.updateJob('job-ios', { status: 'completed' });

  const res = await request(app).post('/api/jobs/consolidate').send({ job_ids: ['job-hb', 'job-ios'] });
  assert.equal(res.status, 200);
  assert.equal(res.body.channels.length, 2);
  assert.equal(res.body.global.channels_total, 2);
});

test('POST /api/jobs/consolidate responde 422 si algún job no está completed', async () => {
  const { app, jobStore, outputPath } = await setupWithRealToolRegistry();
  jobStore.createJob({ job_id: 'job-pend', target: { channel: 'home_banking', mode: 'url_list', urls: ['https://x.test'] }, output: { path: outputPath } });

  const res = await request(app).post('/api/jobs/consolidate').send({ job_ids: ['job-pend'] });
  assert.equal(res.status, 422);
  assert.equal(res.body.error, 'consolidation_failed');
});

test('POST /api/jobs/consolidate responde 400 sin job_ids', async () => {
  const { app } = setup();
  const res = await request(app).post('/api/jobs/consolidate').send({});
  assert.equal(res.status, 400);
});

test('DELETE /api/jobs/:id cancela un job pending y no se puede volver a cancelar', async () => {
  const { app, jobStore } = setup();
  const created = await request(app).post('/api/jobs').send(VALID_CONFIG);

  const res = await request(app).delete(`/api/jobs/${created.body.job_id}`);
  assert.equal(res.status, 200);
  assert.equal(res.body.status, 'cancelled');
  assert.equal(jobStore.getJob(created.body.job_id).status, 'cancelled');

  const second = await request(app).delete(`/api/jobs/${created.body.job_id}`);
  assert.equal(second.status, 409);
  assert.equal(second.body.error, 'job_not_cancellable');
});

test('DELETE /api/jobs/:id con id desconocido responde 404', async () => {
  const { app } = setup();
  const res = await request(app).delete('/api/jobs/no-existe');
  assert.equal(res.status, 404);
});
