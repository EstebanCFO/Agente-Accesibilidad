import { test } from 'node:test';
import assert from 'node:assert/strict';
import { JobStore } from './job-store.js';

function sampleConfig(overrides = {}) {
  return { job_id: 'job-1', target: { channel: 'home_banking', mode: 'url_list', urls: ['https://x.test'] }, ...overrides };
}

test('createJob crea un job con status pending y phase INIT', () => {
  const store = new JobStore();
  const job = store.createJob(sampleConfig());
  assert.equal(job.job_id, 'job-1');
  assert.equal(job.status, 'pending');
  assert.equal(job.phase, 'INIT');
  assert.equal(job.iterations, 0);
  assert.deepEqual(job.progress, { urls_total: 0, urls_scanned: 0, urls_failed: 0, urls_enriched: 0, percentage: 0 });
  assert.deepEqual(job.reports, []);
  assert.deepEqual(job.logs, []);
  assert.equal(job.stop_reason, null);
  assert.ok(job.started_at);
});

test('getJob devuelve undefined para un id desconocido', () => {
  const store = new JobStore();
  assert.equal(store.getJob('no-existe'), undefined);
});

test('updateJob mergea campos de primer nivel y progress anidado', () => {
  const store = new JobStore();
  store.createJob(sampleConfig());
  const updated = store.updateJob('job-1', { status: 'running', progress: { urls_total: 8 } });
  assert.equal(updated.status, 'running');
  assert.equal(updated.progress.urls_total, 8);
  assert.equal(updated.progress.urls_scanned, 0);
});

test('updateJob lanza error para un job desconocido', () => {
  const store = new JobStore();
  assert.throws(() => store.updateJob('no-existe', { status: 'running' }), /no-existe/);
});

test('appendLog agrega una entrada con timestamp', () => {
  const store = new JobStore();
  store.createJob(sampleConfig());
  const job = store.appendLog('job-1', { level: 'info', message: 'iniciando' });
  assert.equal(job.logs.length, 1);
  assert.equal(job.logs[0].level, 'info');
  assert.equal(job.logs[0].message, 'iniciando');
  assert.ok(job.logs[0].timestamp);
});

test('appendLog lanza error para un job desconocido', () => {
  const store = new JobStore();
  assert.throws(() => store.appendLog('no-existe', { level: 'info', message: 'x' }), /no-existe/);
});

test('listJobs devuelve todos los jobs creados', () => {
  const store = new JobStore();
  store.createJob(sampleConfig());
  store.createJob(sampleConfig({ job_id: 'job-2' }));
  const jobs = store.listJobs();
  assert.equal(jobs.length, 2);
  assert.deepEqual(jobs.map((j) => j.job_id).sort(), ['job-1', 'job-2']);
});
