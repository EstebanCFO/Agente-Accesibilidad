import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createToolRegistry, NotImplementedError } from './tool-registry.js';
import { JobStore } from '../job-store.js';

const CORE_TOOL_NAMES = [
  'validate_config', 'crawl_site', 'validate_url_list', 'scan_url', 'scan_batch',
  'classify_findings', 'calculate_score', 'generate_deliverable', 'consolidate_jobs',
  'request_clarification', 'log_progress'
];

function setup() {
  const jobStore = new JobStore();
  jobStore.createJob({ job_id: 'job-1', target: { channel: 'home_banking', mode: 'url_list', urls: ['https://x.test'] } });
  const registry = createToolRegistry({ jobStore });
  return { jobStore, registry };
}

test('expone un schema por cada tool del Tool Set (SPEC §6.1)', () => {
  const { registry } = setup();
  const names = registry.schemas.map((s) => s.name);
  for (const toolName of CORE_TOOL_NAMES) {
    assert.ok(names.includes(toolName), `falta el schema de ${toolName}`);
  }
  for (const schema of registry.schemas) {
    assert.equal(schema.input_schema.type, 'object');
  }
});

test('log_progress agrega una entrada al log del job', async () => {
  const { jobStore, registry } = setup();
  const result = await registry.execute('log_progress', { message: 'escaneando', level: 'info' }, 'job-1');
  assert.deepEqual(result, { logged: true });
  const job = jobStore.getJob('job-1');
  assert.equal(job.logs.length, 1);
  assert.equal(job.logs[0].message, 'escaneando');
});

test('request_clarification bloquea el job y guarda la pregunta', async () => {
  const { jobStore, registry } = setup();
  const result = await registry.execute('request_clarification', { question: '¿Hay MFA en el HB?' }, 'job-1');
  assert.equal(result.status, 'blocked');
  const job = jobStore.getJob('job-1');
  assert.equal(job.status, 'blocked');
  assert.match(job.current_action, /MFA/);
});

test('validate_config delega en validateConfig', async () => {
  const { registry } = setup();
  const result = await registry.execute('validate_config', {
    config: { target: { channel: 'home_banking', mode: 'url_list', urls: ['https://x.test'] } }
  }, 'job-1');
  assert.equal(result.valid, true);
});

test('las tools de dominio no implementadas lanzan NotImplementedError', async () => {
  const { registry } = setup();
  await assert.rejects(
    () => registry.execute('crawl_site', { root_url: 'https://x.test' }, 'job-1'),
    NotImplementedError
  );
  await assert.rejects(
    () => registry.execute('scan_batch', { url_list: ['https://x.test'] }, 'job-1'),
    NotImplementedError
  );
});

test('execute lanza error para un nombre de tool desconocido', async () => {
  const { registry } = setup();
  await assert.rejects(() => registry.execute('tool_inexistente', {}, 'job-1'), /Unknown tool/);
});
