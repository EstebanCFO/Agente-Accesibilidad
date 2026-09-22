import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFile, mkdtemp } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { createToolRegistry } from './tool-registry.js';
import { JobStore } from '../job-store.js';

const CORE_TOOL_NAMES = [
  'validate_config', 'crawl_site', 'validate_url_list', 'scan_url', 'scan_batch',
  'classify_findings', 'calculate_score', 'generate_deliverable', 'consolidate_jobs',
  'request_clarification', 'log_progress'
];

async function setup({ outputPath } = {}) {
  const jobStore = new JobStore();
  jobStore.createJob({
    job_id: 'job-1',
    target: { channel: 'home_banking', mode: 'url_list', urls: ['https://x.test'] },
    output: { path: outputPath ?? await mkdtemp(path.join(tmpdir(), 'f1-reports-')) }
  });
  const registry = createToolRegistry({ jobStore });
  return { jobStore, registry };
}

test('expone un schema por cada tool del Tool Set (SPEC §6.1)', async () => {
  const { registry } = await setup();
  const names = registry.schemas.map((s) => s.name);
  for (const toolName of CORE_TOOL_NAMES) {
    assert.ok(names.includes(toolName), `falta el schema de ${toolName}`);
  }
  for (const schema of registry.schemas) {
    assert.equal(schema.input_schema.type, 'object');
  }
});

test('log_progress agrega una entrada al log del job', async () => {
  const { jobStore, registry } = await setup();
  const result = await registry.execute('log_progress', { message: 'escaneando', level: 'info' }, 'job-1');
  assert.deepEqual(result, { logged: true });
  const job = jobStore.getJob('job-1');
  assert.equal(job.logs.length, 1);
  assert.equal(job.logs[0].message, 'escaneando');
});

test('request_clarification bloquea el job y guarda la pregunta', async () => {
  const { jobStore, registry } = await setup();
  const result = await registry.execute('request_clarification', { question: '¿Hay MFA en el HB?' }, 'job-1');
  assert.equal(result.status, 'blocked');
  const job = jobStore.getJob('job-1');
  assert.equal(job.status, 'blocked');
  assert.match(job.current_action, /MFA/);
});

test('validate_config delega en validateConfig', async () => {
  const { registry } = await setup();
  const result = await registry.execute('validate_config', {
    config: { target: { channel: 'home_banking', mode: 'url_list', urls: ['https://x.test'] } }
  }, 'job-1');
  assert.equal(result.valid, true);
});

test('generate_deliverable("score", ...) escribe score-compliance.json y lo agrega a job.reports', async () => {
  const outputPath = await mkdtemp(path.join(tmpdir(), 'f1-reports-'));
  const { jobStore, registry } = await setup({ outputPath });

  const scores = {
    summary: {
      total_urls_evaluated: 1,
      onti_criteria_evaluated: 38,
      onti_criteria_compliant: 37,
      onti_compliance_percentage: 97.37,
      onti_conformance: true,
      conformance_threshold: 30,
      score_level_a: 96,
      score_level_aa: 100
    },
    extended_22: null,
    by_url: [{ url: 'https://x.test', module: null, onti_compliance_percentage: 97.37, violations: 1, incomplete: 0 }]
  };

  const result = await registry.execute('generate_deliverable', { type: 'score', data: { scores } }, 'job-1');

  assert.equal(result.file_path.length, 1);
  const [filePath] = result.file_path;
  assert.match(filePath, /score-compliance\.json$/);

  const written = JSON.parse(await readFile(filePath, 'utf8'));
  assert.equal(written.job_id, 'job-1');
  assert.equal(written.channel, 'home_banking');
  assert.equal(written.summary.onti_criteria_compliant, 37);
  assert.equal(written.baseline, 'ONTI 6/2019 — WCAG 2.0 A+AA (38 criterios)');

  const job = jobStore.getJob('job-1');
  assert.ok(job.reports.includes('score-compliance.json'));
});

test('generate_deliverable rechaza un tipo no implementado todavía', async () => {
  const { registry } = await setup();
  await assert.rejects(
    () => registry.execute('generate_deliverable', { type: 'tipo-que-no-existe', data: {} }, 'job-1'),
    /no implementado/
  );
});

test('consolidate_jobs agrega 2 jobs completed en un dashboard consolidado', async () => {
  const outputPath = await mkdtemp(path.join(tmpdir(), 'f1-reports-'));
  const jobStore = new JobStore();
  jobStore.createJob({ job_id: 'job-hb', target: { channel: 'home_banking', mode: 'url_list', urls: ['https://x.test'] }, output: { path: outputPath } });
  jobStore.createJob({ job_id: 'job-ios', target: { channel: 'app_ios', mode: 'url_list', urls: ['https://x.test'] }, output: { path: outputPath } });
  const registry = createToolRegistry({ jobStore });

  const scoresHb = {
    summary: { total_urls_evaluated: 10, onti_criteria_evaluated: 38, onti_criteria_compliant: 38, onti_compliance_percentage: 100, onti_conformance: true, conformance_threshold: 30, score_level_a: 100, score_level_aa: 100 },
    extended_22: null, by_url: []
  };
  const scoresIos = {
    summary: { total_urls_evaluated: 5, onti_criteria_evaluated: 38, onti_criteria_compliant: 20, onti_compliance_percentage: 52.63, onti_conformance: false, conformance_threshold: 30, score_level_a: 60, score_level_aa: 30 },
    extended_22: null, by_url: []
  };

  await registry.execute('generate_deliverable', { type: 'score', data: { scores: scoresHb } }, 'job-hb');
  await registry.execute('generate_deliverable', { type: 'score', data: { scores: scoresIos } }, 'job-ios');
  jobStore.updateJob('job-hb', { status: 'completed' });
  jobStore.updateJob('job-ios', { status: 'completed' });

  const result = await registry.execute('consolidate_jobs', { job_ids: ['job-hb', 'job-ios'] }, 'job-hb');

  assert.equal(result.channels.length, 2);
  assert.equal(result.global.channels_total, 2);
  assert.equal(result.global.channels_conformant, 1);
  const expected = Math.round(((100 * 10 + 52.63 * 5) / 15) * 100) / 100;
  assert.equal(result.global.weighted_onti_compliance_percentage, expected);

  const consolidatedHtml = await readFile(path.join(outputPath, 'consolidated', 'dashboard-consolidado.html'), 'utf8');
  assert.match(consolidatedHtml, /Dashboard Ejecutivo Consolidado/);
  const consolidatedJson = JSON.parse(await readFile(path.join(outputPath, 'consolidated', 'score-consolidado.json'), 'utf8'));
  assert.equal(consolidatedJson.channels.length, 2);
});

test('consolidate_jobs rechaza si algún job no está completed', async () => {
  const { jobStore, registry } = await setup();
  const outputPath = jobStore.getJob('job-1').config.output.path;
  jobStore.createJob({ job_id: 'job-2', target: { channel: 'app_ios', mode: 'url_list', urls: ['https://x.test'] }, output: { path: outputPath } });

  await assert.rejects(
    () => registry.execute('consolidate_jobs', { job_ids: ['job-1', 'job-2'] }, 'job-1'),
    /deben estar "completed"/
  );
});

test('consolidate_jobs requiere job_ids no vacío', async () => {
  const { registry } = await setup();
  await assert.rejects(() => registry.execute('consolidate_jobs', { job_ids: [] }, 'job-1'), /requiere "job_ids"/);
});

test('execute lanza error para un nombre de tool desconocido', async () => {
  const { registry } = await setup();
  await assert.rejects(() => registry.execute('tool_inexistente', {}, 'job-1'), /Unknown tool/);
});
