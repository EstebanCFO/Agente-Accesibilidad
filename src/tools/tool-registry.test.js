import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFile, mkdtemp, writeFile, mkdir } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { createToolRegistry } from './tool-registry.js';
import { JobStore } from '../job-store.js';
import { calculateScore } from '../classification/calculate-score.js';

const CORE_TOOL_NAMES = [
  'validate_config', 'crawl_site', 'validate_url_list', 'scan_url', 'scan_batch',
  'classify_findings', 'calculate_score', 'generate_deliverable', 'consolidate_jobs',
  'request_clarification', 'log_progress', 'keyboard_review'
];

async function setup({ outputPath, anthropicClient } = {}) {
  const resolvedOutputPath = outputPath ?? await mkdtemp(path.join(tmpdir(), 'f1-reports-'));
  const jobStore = new JobStore();
  jobStore.createJob({
    job_id: 'job-1',
    target: { channel: 'home_banking', mode: 'url_list', urls: ['https://x.test'] },
    output: { path: resolvedOutputPath }
  });
  const registry = createToolRegistry({ jobStore, anthropicClient });
  return { jobStore, registry, outputPath: resolvedOutputPath };
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

  const page = (url, passes) => ({ url, violations: [], incomplete: [], passes, inapplicable: [] });
  const nok = { source: 'axe-core', wcag_criterion: '1.4.3', in_scope: 'onti', review_status: 'confirmado', affected_urls: ['https://x.test'] };
  const scoresHb = calculateScore([], { axeResults: [page('https://x.test', [{ id: 'color-contrast', tags: ['wcag2aa', 'wcag143'] }])] });
  const scoresIos = calculateScore([nok], { axeResults: [page('https://x.test', [])] });

  await registry.execute('generate_deliverable', { type: 'score', data: { scores: scoresHb } }, 'job-hb');
  await registry.execute('generate_deliverable', { type: 'score', data: { scores: scoresIos } }, 'job-ios');
  jobStore.updateJob('job-hb', { status: 'completed' });
  jobStore.updateJob('job-ios', { status: 'completed' });

  const result = await registry.execute('consolidate_jobs', { job_ids: ['job-hb', 'job-ios'] }, 'job-hb');

  assert.equal(result.channels.length, 2);
  assert.equal(result.global.channels_total, 2);
  assert.equal(result.global.channels_con_nok, 1);
  assert.equal(result.global.nok, 1);
  assert.equal(result.channels[0].ok, 1);

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

function fakeAnthropicClient(toolInput, capture = {}) {
  return {
    messages: {
      create: async (params) => {
        capture.params = params;
        return { content: [{ type: 'tool_use', name: 'report_keyboard_review', input: toolInput }] };
      }
    }
  };
}

const KEYBOARD = {
  stops: [
    { index: 1, tag: 'a', role: '', name: 'Inicio', doc_x: 0, doc_y: 0, bbox: { x: 0, y: 0, width: 50, height: 20 }, focus_change_pct: 10, context_change: null },
    { index: 2, tag: 'button', role: '', name: 'Ingresar', doc_x: 0, doc_y: 50, bbox: { x: 0, y: 50, width: 50, height: 20 }, focus_change_pct: 0, context_change: null }
  ],
  ended: 'ciclo', trap: null, contact_sheet: '/9j/FAKE'
};

async function writeCapture(outputPath, name, content) {
  const capturesDir = path.join(outputPath, 'job-1', 'captures');
  await mkdir(capturesDir, { recursive: true });
  const file = path.join(capturesDir, name);
  await writeFile(file, JSON.stringify(content));
  return file;
}

test('ya no expone las herramientas de revisión visual ni de UX', async () => {
  const { registry } = await setup();
  const names = registry.schemas.map((s) => s.name);
  assert.ok(!names.includes('visual_audit'));
  assert.ok(!names.includes('ux_compliance_review'));
  const scan = registry.schemas.find((s) => s.name === 'scan_url');
  assert.ok(scan.input_schema.properties.capture_keyboard);
  assert.equal(scan.input_schema.properties.capture_screenshot, undefined);
});

test('keyboard_review lee keyboard_path, consulta a la IA y devuelve los 4 criterios', async () => {
  const capture = {};
  const anthropicClient = fakeAnthropicClient({
    orden_del_foco: { estado: 'sin_indicios', paradas: [], motivo: 'Orden lógico' },
    foco_visible: { estado: 'con_indicios', paradas: [2], motivo: 'Ingresar no muestra foco' }
  }, capture);
  const { registry, outputPath } = await setup({ anthropicClient });
  const keyboardPath = await writeCapture(outputPath, 'kb.json', KEYBOARD);

  const result = await registry.execute('keyboard_review', { url: 'https://a.test', keyboard_path: keyboardPath }, 'job-1');

  assert.equal(result.url, 'https://a.test');
  assert.equal(result.criteria['2.4.7'].estado, 'con_indicios');
  assert.equal(result.criteria['2.4.7'].fuente, 'Agente');
  assert.equal(result.criteria['2.1.2'].estado, 'sin_indicios');
  assert.equal(capture.params.messages[0].content.find((b) => b.type === 'image').source.data, '/9j/FAKE');
});

test('keyboard_review usa las reglas solas si la IA falla', async () => {
  const anthropicClient = { messages: { create: async () => { throw new Error('caída'); } } };
  const { registry, outputPath } = await setup({ anthropicClient });
  const keyboardPath = await writeCapture(outputPath, 'kb.json', KEYBOARD);
  const result = await registry.execute('keyboard_review', { url: 'https://a.test', keyboard_path: keyboardPath }, 'job-1');
  assert.equal(result.criteria['2.4.7'].estado, 'con_indicios');
  assert.equal(result.criteria['2.4.7'].fuente, 'reglas (sin interpretación del Agente)');
});

test('keyboard_review rechaza un keyboard_path fuera del directorio de capturas del job', async () => {
  const { registry } = await setup();
  const outsideDir = await mkdtemp(path.join(tmpdir(), 'f1-outside-'));
  const outsidePath = path.join(outsideDir, 'secret.json');
  await writeFile(outsidePath, '{}');
  await assert.rejects(
    () => registry.execute('keyboard_review', { url: 'https://a.test', keyboard_path: outsidePath }, 'job-1'),
    /directorio de capturas/
  );
});

test('calculate_score ya no acepta umbral y devuelve conteos', async () => {
  const { registry } = await setup();
  const schema = registry.schemas.find((s) => s.name === 'calculate_score');
  assert.equal(schema.input_schema.properties.conformance_threshold, undefined);
  assert.doesNotMatch(schema.description, /%/);
  const result = await registry.execute('calculate_score', { classified_findings: [], axe_results: [] }, 'job-1');
  assert.equal(result.summary.a_validar, 38);
  assert.equal('onti_conformance' in result.summary, false);
});
