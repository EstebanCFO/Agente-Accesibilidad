# Agente F1 — Sub-plan A: Fundación (Config, Job Store, Tool Registry, Agent Loop, REST API) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Levantar el esqueleto ejecutable del Agente F1 — validación de config, Job Store, registro de herramientas (tool-use), el loop autónomo Observe→Plan→Act→Evaluate→Adjust contra Claude, y la REST API mínima (`POST /api/jobs`, `GET /api/jobs/:id`, `GET /api/health`) — como primera porción vertical, testeable de punta a punta sin depender todavía de crawler, scanner, classifier ni reporters reales.

**Architecture:** Node.js 20+ ESM. `validate-config.js` normaliza y valida el contrato de entrada (SPEC §7). `JobStore` es un Map en memoria con el estado de job (SPEC §10). `tool-registry.js` expone los 11 tool schemas del Tool Set (SPEC §6.1) en formato Anthropic tool-use; implementa de verdad `validate_config`, `log_progress` y `request_clarification`, y registra el resto (`crawl_site`, `validate_url_list`, `scan_url`, `scan_batch`, `classify_findings`, `calculate_score`, `generate_deliverable`, `consolidate_jobs`) como stubs que lanzan `NotImplementedError` — se implementan en sub-planes posteriores (B: crawler+scanner, C: classifier+score, D: reporters, E: skills externos+consolidator). `AgentLoop` llama a `anthropic.messages.create` con esos tools, ejecuta el `tool_use` que el modelo pida vía el registry, y actualiza el Job Store con el resultado real (nunca asume éxito). La API es una fina capa Express sobre estos tres componentes, con inyección de dependencias para poder testear sin pegarle a la API de Anthropic real.

**Tech Stack:** Node.js >=20 (ESM, `"type": "module"`), Express, `@anthropic-ai/sdk`, `uuid`, `dotenv`, `node:test` + `node:assert/strict` (runner de tests nativo, cero dependencias extra), `supertest` (solo devDependency, para las rutas).

**Spec:** `docs/reference/SPEC-agente-f1-compliance-v0.3.md` (copiada al repo en la Tarea 1) — ver también `docs/reference/PLAN-CONSTRUCCION-agente-f1-v1.1.md` (Fase 2, Sección 2.2). Este plan implementa el subconjunto de la Fase 2 necesario para tener un loop real y una API real; los tools de dominio (crawler, scanner, classifier, reporter, skills) quedan en sub-planes B–E.

## Global Constraints

- Cerebro del agente: modelo `claude-sonnet-5` (decisión D2, SPEC §12) — nunca hardcodear otro modelo por defecto.
- Base normativa: WCAG 2.0 A+AA = 38 criterios ONTI (25 A + 13 AA), umbral de conformidad ≥ 30/38 (decisión D6). El campo `wcag.conformance_threshold` default es `30`; `wcag.extended_22` default es `false` (decisión D7).
- `ANTHROPIC_API_KEY` se inyecta solo por variable de entorno, nunca en el JSON de config de un job (SPEC §14).
- Las credenciales de `auth` (usuario/password/tokens/cookies) nunca se persisten en logs ni en el Job Store en texto plano — este sub-plan no implementa auth real todavía, pero ningún handler debe loguear `input.auth` completo tal cual.
- El agente **nunca asume éxito**: toda actualización de estado en el Job Store se basa en el resultado real devuelto por una tool (SPEC §4.2/4.4).
- El job por defecto corre **un canal por job** (`target.channel` ∈ `home_banking | app_ios | app_android`); la consolidación multi-canal (`consolidate_jobs`) es un tool stub en este sub-plan (decisión D5, implementación real en sub-plan E).
- No se agrega lógica de negocio (crawler, axe-core, classification, XLSX, skills externos) en este plan — eso es explícitamente de sub-planes posteriores. Este plan es solo la fundación: config, job store, tool registry, agent loop, API.

---

## Task 1: Project Scaffold & Reference Docs

**Files:**
- Create: `package.json`
- Create: `.gitignore`
- Create: `.env.example`
- Create: `docs/reference/SPEC-agente-f1-compliance-v0.3.md` (copia de `C:\Users\CFOTech\Downloads\SPEC-agente-f1-compliance-v0.3.md`)
- Create: `docs/reference/PLAN-CONSTRUCCION-agente-f1-v1.1.md` (copia de `C:\Users\CFOTech\Downloads\PLAN-CONSTRUCCION-agente-f1-v1.1.md`)
- Create dirs: `src/config/`, `src/tools/`, `src/api/`, `src/reporter/`, `references/`, `tests/fixtures/`

**Interfaces:**
- Produces: proyecto Node inicializado con `npm install` funcional y `node --test` corriendo (sin tests todavía); repo git inicializado con primer commit.

- [ ] **Step 1: Crear estructura de directorios**

```bash
cd "C:/Esteban CFOTech/Agente Accesibilidad"
mkdir -p src/config src/tools src/api src/reporter references tests/fixtures docs/reference
```

- [ ] **Step 2: Escribir `package.json`**

```json
{
  "name": "f1-compliance-agent",
  "version": "0.1.0",
  "private": true,
  "type": "module",
  "engines": { "node": ">=20" },
  "scripts": {
    "start": "node src/api/server.js",
    "test": "node --test"
  },
  "dependencies": {
    "@anthropic-ai/sdk": "^0.32.0",
    "dotenv": "^16.4.5",
    "express": "^4.19.2",
    "uuid": "^9.0.1"
  },
  "devDependencies": {
    "supertest": "^7.0.0"
  }
}
```

- [ ] **Step 3: Escribir `.gitignore`**

```
node_modules/
.env
reports/
*.log
```

- [ ] **Step 4: Escribir `.env.example`**

```bash
# Requerida
ANTHROPIC_API_KEY=sk-ant-...

# Opcionales
PORT=3000
LOG_LEVEL=info
MAX_CONCURRENT_JOBS=3
REPORTS_PATH=./reports
```

- [ ] **Step 5: Copiar la SPEC y el PLAN de construcción como referencia versionada del repo**

```bash
cp "/c/Users/CFOTech/Downloads/SPEC-agente-f1-compliance-v0.3.md" "docs/reference/SPEC-agente-f1-compliance-v0.3.md"
cp "/c/Users/CFOTech/Downloads/PLAN-CONSTRUCCION-agente-f1-v1.1.md" "docs/reference/PLAN-CONSTRUCCION-agente-f1-v1.1.md"
```

- [ ] **Step 6: Instalar dependencias**

Run: `npm install`
Expected: `node_modules/` creado sin errores, `package-lock.json` generado.

- [ ] **Step 7: Verificar que el test runner corre sin tests**

Run: `npm test`
Expected: exit code 0, salida tipo "tests 0, pass 0, fail 0" (no hay archivos `*.test.js` todavía).

- [ ] **Step 8: Inicializar git y primer commit**

```bash
git init
git add package.json package-lock.json .gitignore .env.example docs/reference
git commit -m "chore: scaffold f1-compliance-agent project"
```

---

## Task 2: Config Validation Module

**Files:**
- Create: `src/config/validate-config.js`
- Test: `src/config/validate-config.test.js`

**Interfaces:**
- Produces: `validateConfig(rawConfig: object) -> { valid: boolean, errors: string[], config: object|null }`. `config` es el objeto normalizado con defaults del SPEC §7 aplicados; es `null` si `valid` es `false`. Usado por Task 4 (tool `validate_config`) y Task 6 (`POST /api/jobs`).

- [ ] **Step 1: Escribir los tests que fallan**

```javascript
// src/config/validate-config.test.js
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { validateConfig } from './validate-config.js';

test('acepta un config url_list mínimo y aplica defaults', () => {
  const { valid, errors, config } = validateConfig({
    target: { channel: 'home_banking', mode: 'url_list', urls: ['https://banco.test/login'] }
  });
  assert.equal(valid, true);
  assert.deepEqual(errors, []);
  assert.equal(config.wcag.baseline, 'onti_2019');
  assert.deepEqual(config.wcag.levels, ['A', 'AA']);
  assert.equal(config.wcag.conformance_threshold, 30);
  assert.equal(config.wcag.extended_22, false);
  assert.equal(config.scope.max_urls, 100);
  assert.equal(config.scope.parallel_workers, 3);
  assert.equal(config.agent.max_iterations, 30);
  assert.equal(config.agent.model, 'claude-sonnet-5');
  assert.match(config.job_id, /^[0-9a-f-]{36}$/);
});

test('respeta job_id y conformance_threshold provistos por el operador', () => {
  const { valid, config } = validateConfig({
    job_id: 'job-fijo-123',
    target: { channel: 'app_ios', mode: 'url_list', urls: ['https://app.test/home'] },
    wcag: { conformance_threshold: 32 }
  });
  assert.equal(valid, true);
  assert.equal(config.job_id, 'job-fijo-123');
  assert.equal(config.wcag.conformance_threshold, 32);
});

test('rechaza config sin target.channel', () => {
  const { valid, errors, config } = validateConfig({ target: { mode: 'url_list', urls: ['https://x.test'] } });
  assert.equal(valid, false);
  assert.equal(config, null);
  assert.ok(errors.some((e) => e.includes('target.channel')));
});

test('rechaza target.channel con valor fuera del enum', () => {
  const { valid, errors } = validateConfig({ target: { channel: 'desktop_app', mode: 'url_list', urls: ['https://x.test'] } });
  assert.equal(valid, false);
  assert.ok(errors.some((e) => e.includes('target.channel')));
});

test('rechaza mode=crawl sin root_url', () => {
  const { valid, errors } = validateConfig({ target: { channel: 'home_banking', mode: 'crawl' } });
  assert.equal(valid, false);
  assert.ok(errors.some((e) => e.includes('target.root_url')));
});

test('rechaza mode=url_list con urls vacío', () => {
  const { valid, errors } = validateConfig({ target: { channel: 'home_banking', mode: 'url_list', urls: [] } });
  assert.equal(valid, false);
  assert.ok(errors.some((e) => e.includes('target.urls')));
});

test('rechaza config sin target', () => {
  const { valid, errors } = validateConfig({});
  assert.equal(valid, false);
  assert.ok(errors.some((e) => e.includes('target')));
});
```

- [ ] **Step 2: Correr los tests y verificar que fallan**

Run: `npm test`
Expected: FAIL — `Cannot find module './validate-config.js'` (el archivo todavía no existe).

- [ ] **Step 3: Implementar `validate-config.js`**

```javascript
// src/config/validate-config.js
import { randomUUID } from 'node:crypto';

const VALID_CHANNELS = ['home_banking', 'app_ios', 'app_android'];
const VALID_MODES = ['url_list', 'crawl'];

function buildDefaults() {
  return {
    auth: { type: 'none', config: {} },
    wcag: {
      baseline: 'onti_2019',
      levels: ['A', 'AA'],
      base_tags: ['wcag2a', 'wcag2aa'],
      conformance_threshold: 30,
      extended_22: false,
      extended_22_tags: ['wcag21a', 'wcag21aa', 'wcag22aa']
    },
    scope: {
      max_urls: 100,
      timeout_per_url: 30000,
      parallel_workers: 3,
      wait_for: 'networkidle',
      viewport: {
        desktop: { width: 1280, height: 800 },
        mobile: { width: 390, height: 844, is_mobile: true }
      },
      include_patterns: [],
      exclude_patterns: []
    },
    skills: { visual_audit: true, ux_compliance_review: true, generate_remediation_plan: true },
    output: { formats: ['html', 'json', 'xlsx'], path: './reports', include_screenshots: true, language: 'es' },
    agent: { max_iterations: 30, log_level: 'info', model: 'claude-sonnet-5' }
  };
}

function deepMerge(defaults, overrides) {
  if (overrides === undefined || overrides === null) return defaults;
  if (typeof defaults !== 'object' || Array.isArray(defaults)) return overrides;
  const merged = { ...defaults };
  for (const key of Object.keys(overrides)) {
    merged[key] = deepMerge(defaults[key], overrides[key]);
  }
  return merged;
}

export function validateConfig(rawConfig) {
  const errors = [];
  const raw = rawConfig && typeof rawConfig === 'object' ? rawConfig : {};

  if (!raw.target || typeof raw.target !== 'object') {
    errors.push('target es requerido');
    return { valid: false, errors, config: null };
  }

  const { channel, mode, root_url: rootUrl, urls } = raw.target;

  if (!channel || !VALID_CHANNELS.includes(channel)) {
    errors.push(`target.channel es requerido y debe ser uno de: ${VALID_CHANNELS.join(', ')}`);
  }
  if (!mode || !VALID_MODES.includes(mode)) {
    errors.push(`target.mode es requerido y debe ser uno de: ${VALID_MODES.join(', ')}`);
  }
  if (mode === 'crawl' && (!rootUrl || typeof rootUrl !== 'string' || rootUrl.trim() === '')) {
    errors.push('target.root_url es requerido cuando target.mode=crawl');
  }
  if (mode === 'url_list' && (!Array.isArray(urls) || urls.length === 0)) {
    errors.push('target.urls debe ser un array no vacío cuando target.mode=url_list');
  }

  if (errors.length > 0) {
    return { valid: false, errors, config: null };
  }

  const defaults = buildDefaults();
  const config = {
    job_id: raw.job_id || randomUUID(),
    description: raw.description || '',
    target: { channel, mode, root_url: rootUrl ?? null, urls: urls ?? [] },
    auth: deepMerge(defaults.auth, raw.auth),
    wcag: deepMerge(defaults.wcag, raw.wcag),
    scope: deepMerge(defaults.scope, raw.scope),
    skills: deepMerge(defaults.skills, raw.skills),
    output: deepMerge(defaults.output, raw.output),
    agent: deepMerge(defaults.agent, raw.agent)
  };

  return { valid: true, errors: [], config };
}
```

- [ ] **Step 4: Correr los tests y verificar que pasan**

Run: `npm test`
Expected: PASS — 7 tests, 0 fallas.

- [ ] **Step 5: Commit**

```bash
git add src/config/validate-config.js src/config/validate-config.test.js
git commit -m "feat: add config validation for job input contract (SPEC §7)"
```

---

## Task 3: Job Store

**Files:**
- Create: `src/job-store.js`
- Test: `src/job-store.test.js`

**Interfaces:**
- Consumes: nada de tareas anteriores (módulo independiente).
- Produces: clase `JobStore` con métodos `createJob(config)`, `getJob(jobId)`, `updateJob(jobId, patch)`, `appendLog(jobId, { level, message })`, `listJobs()`. El objeto job tiene la forma: `{ job_id, status, phase, progress: { urls_total, urls_scanned, urls_failed, urls_enriched, percentage }, current_action, iterations, started_at, estimated_completion, reports, stop_reason, logs, config }`. Usado por Task 4, 5 y 6.

- [ ] **Step 1: Escribir los tests que fallan**

```javascript
// src/job-store.test.js
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
```

- [ ] **Step 2: Correr los tests y verificar que fallan**

Run: `npm test`
Expected: FAIL — `Cannot find module './job-store.js'`.

- [ ] **Step 3: Implementar `job-store.js`**

```javascript
// src/job-store.js
function assertJobExists(job, jobId) {
  if (!job) {
    throw new Error(`Job no encontrado: ${jobId}`);
  }
}

export class JobStore {
  constructor() {
    this.jobs = new Map();
  }

  createJob(config) {
    const job = {
      job_id: config.job_id,
      status: 'pending',
      phase: 'INIT',
      progress: { urls_total: 0, urls_scanned: 0, urls_failed: 0, urls_enriched: 0, percentage: 0 },
      current_action: null,
      iterations: 0,
      started_at: new Date().toISOString(),
      estimated_completion: null,
      reports: [],
      stop_reason: null,
      logs: [],
      config
    };
    this.jobs.set(job.job_id, job);
    return job;
  }

  getJob(jobId) {
    return this.jobs.get(jobId);
  }

  updateJob(jobId, patch) {
    const job = this.jobs.get(jobId);
    assertJobExists(job, jobId);
    const updated = { ...job, ...patch };
    if (patch.progress) {
      updated.progress = { ...job.progress, ...patch.progress };
    }
    this.jobs.set(jobId, updated);
    return updated;
  }

  appendLog(jobId, { level, message }) {
    const job = this.jobs.get(jobId);
    assertJobExists(job, jobId);
    job.logs.push({ timestamp: new Date().toISOString(), level, message });
    return job;
  }

  listJobs() {
    return Array.from(this.jobs.values());
  }
}
```

- [ ] **Step 4: Correr los tests y verificar que pasan**

Run: `npm test`
Expected: PASS — 14 tests acumulados (7 de Task 2 + 7 de Task 3), 0 fallas.

- [ ] **Step 5: Commit**

```bash
git add src/job-store.js src/job-store.test.js
git commit -m "feat: add in-memory Job Store (SPEC §10 job state shape)"
```

---

## Task 4: Tool Registry

**Files:**
- Create: `src/tools/tool-registry.js`
- Test: `src/tools/tool-registry.test.js`

**Interfaces:**
- Consumes: `validateConfig` de `../config/validate-config.js` (Task 2); `JobStore` de `../job-store.js` (Task 3).
- Produces: `createToolRegistry({ jobStore }) -> { schemas: Array<{name, description, input_schema}>, execute: (toolName: string, input: object, jobId: string) => Promise<object> }`; clase `NotImplementedError`. Usado por Task 5 (`AgentLoop`).

- [ ] **Step 1: Escribir los tests que fallan**

```javascript
// src/tools/tool-registry.test.js
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
```

- [ ] **Step 2: Correr los tests y verificar que fallan**

Run: `npm test`
Expected: FAIL — `Cannot find module './tool-registry.js'`.

- [ ] **Step 3: Implementar `tool-registry.js`**

```javascript
// src/tools/tool-registry.js
import { validateConfig } from '../config/validate-config.js';

export class NotImplementedError extends Error {
  constructor(toolName) {
    super(`Tool "${toolName}" aún no está implementada (pendiente de un sub-plan posterior de construcción).`);
    this.name = 'NotImplementedError';
    this.toolName = toolName;
  }
}

const TOOL_SCHEMAS = [
  { name: 'validate_config', description: 'Verifica que la config del job sea completa y coherente', input_schema: { type: 'object', properties: { config: { type: 'object', description: 'Config JSON completa a validar' } }, required: ['config'] } },
  { name: 'crawl_site', description: 'Descubre todas las URLs del canal desde una raíz', input_schema: { type: 'object', properties: { root_url: { type: 'string' }, options: { type: 'object' } }, required: ['root_url'] } },
  { name: 'validate_url_list', description: 'Verifica accesibilidad HTTP de cada URL antes de escanear', input_schema: { type: 'object', properties: { url_list: { type: 'array', items: { type: 'string' } } }, required: ['url_list'] } },
  { name: 'scan_url', description: 'Escanea una URL con axe-core vía Playwright', input_schema: { type: 'object', properties: { url: { type: 'string' }, wcag_tags: { type: 'array', items: { type: 'string' } }, auth: { type: 'object' } }, required: ['url'] } },
  { name: 'scan_batch', description: 'Escanea múltiples URLs en paralelo', input_schema: { type: 'object', properties: { url_list: { type: 'array', items: { type: 'string' } }, wcag_tags: { type: 'array', items: { type: 'string' } }, workers: { type: 'number' } }, required: ['url_list'] } },
  { name: 'classify_findings', description: 'Deduplica, agrupa por criterio WCAG y asigna severidad', input_schema: { type: 'object', properties: { axe_results: { type: 'array' } }, required: ['axe_results'] } },
  { name: 'calculate_score', description: 'Calcula % de cumplimiento por canal y por criterio', input_schema: { type: 'object', properties: { classified_findings: { type: 'array' } }, required: ['classified_findings'] } },
  { name: 'generate_deliverable', description: 'Genera uno de los 5 entregables de F1 en sus formatos', input_schema: { type: 'object', properties: { type: { type: 'string' }, data: { type: 'object' } }, required: ['type', 'data'] } },
  { name: 'consolidate_jobs', description: 'Agrega los resultados de varios jobs en un dashboard ejecutivo unificado', input_schema: { type: 'object', properties: { job_ids: { type: 'array', items: { type: 'string' } } }, required: ['job_ids'] } },
  { name: 'request_clarification', description: 'Pausa y solicita decisión al operador', input_schema: { type: 'object', properties: { question: { type: 'string' }, context: { type: 'object' } }, required: ['question'] } },
  { name: 'log_progress', description: 'Registra estado en el log del job', input_schema: { type: 'object', properties: { message: { type: 'string' }, level: { type: 'string' } }, required: ['message'] } }
];

const NOT_IMPLEMENTED_TOOLS = [
  'crawl_site', 'validate_url_list', 'scan_url', 'scan_batch',
  'classify_findings', 'calculate_score', 'generate_deliverable', 'consolidate_jobs'
];

export function createToolRegistry({ jobStore }) {
  const handlers = {
    validate_config: (input) => validateConfig(input.config),
    log_progress: (input, jobId) => {
      jobStore.appendLog(jobId, { level: input.level || 'info', message: input.message });
      return { logged: true };
    },
    request_clarification: (input, jobId) => {
      jobStore.updateJob(jobId, { status: 'blocked', current_action: `Esperando respuesta: ${input.question}` });
      return { status: 'blocked', question: input.question };
    }
  };

  for (const toolName of NOT_IMPLEMENTED_TOOLS) {
    handlers[toolName] = () => {
      throw new NotImplementedError(toolName);
    };
  }

  return {
    schemas: TOOL_SCHEMAS,
    async execute(toolName, input, jobId) {
      const handler = handlers[toolName];
      if (!handler) {
        throw new Error(`Unknown tool: ${toolName}`);
      }
      return handler(input, jobId);
    }
  };
}
```

- [ ] **Step 4: Correr los tests y verificar que pasan**

Run: `npm test`
Expected: PASS — 20 tests acumulados, 0 fallas.

- [ ] **Step 5: Commit**

```bash
git add src/tools/tool-registry.js src/tools/tool-registry.test.js
git commit -m "feat: add tool registry with SPEC §6.1 tool schemas and core handlers"
```

---

## Task 5: Agent Loop

**Files:**
- Create: `src/agent-loop.js`
- Test: `src/agent-loop.test.js`

**Interfaces:**
- Consumes: `JobStore` (Task 3, métodos `getJob`/`updateJob`); `createToolRegistry` (Task 4, forma `{ schemas, execute(toolName, input, jobId) }`).
- Produces: clase `AgentLoop` con constructor `new AgentLoop({ anthropicClient, toolRegistry, jobStore, maxIterations = 30, model = 'claude-sonnet-5' })` y método `async run(jobId) -> job`. `anthropicClient` es cualquier objeto con forma `{ messages: { create(params) => Promise<{ content: Array<{type: 'text'|'tool_use', ...}> }> } }` (la forma real de `@anthropic-ai/sdk`, inyectada en producción; falsa en tests). Usado por Task 6.

- [ ] **Step 1: Escribir los tests que fallan**

```javascript
// src/agent-loop.test.js
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { AgentLoop } from './agent-loop.js';
import { JobStore } from './job-store.js';
import { createToolRegistry } from './tools/tool-registry.js';

function setup() {
  const jobStore = new JobStore();
  jobStore.createJob({ job_id: 'job-1', target: { channel: 'home_banking', mode: 'url_list', urls: ['https://x.test'] } });
  const toolRegistry = createToolRegistry({ jobStore });
  return { jobStore, toolRegistry };
}

class FakeAnthropicClient {
  constructor(responses) {
    this.responses = responses;
    this.calls = 0;
  }
  get messages() {
    return {
      create: async () => {
        const response = this.responses[Math.min(this.calls, this.responses.length - 1)];
        this.calls += 1;
        return response;
      }
    };
  }
}

test('finaliza con status completed cuando Claude no pide más tools', async () => {
  const { jobStore, toolRegistry } = setup();
  const anthropicClient = new FakeAnthropicClient([
    { content: [{ type: 'text', text: 'Listo, no hay más pasos.' }] }
  ]);
  const loop = new AgentLoop({ anthropicClient, toolRegistry, jobStore, maxIterations: 5 });
  const job = await loop.run('job-1');
  assert.equal(job.status, 'completed');
  assert.equal(job.iterations, 1);
  assert.equal(anthropicClient.calls, 1);
});

test('ejecuta un tool_use vía el tool registry y continúa el loop', async () => {
  const { jobStore, toolRegistry } = setup();
  const anthropicClient = new FakeAnthropicClient([
    { content: [{ type: 'tool_use', id: 'call_1', name: 'log_progress', input: { message: 'arrancando' } }] },
    { content: [{ type: 'text', text: 'Listo.' }] }
  ]);
  const loop = new AgentLoop({ anthropicClient, toolRegistry, jobStore, maxIterations: 5 });
  const job = await loop.run('job-1');
  assert.equal(job.status, 'completed');
  assert.equal(job.iterations, 2);
  assert.equal(job.logs.length, 1);
  assert.equal(job.logs[0].message, 'arrancando');
});

test('se detiene con status blocked cuando request_clarification bloquea el job', async () => {
  const { jobStore, toolRegistry } = setup();
  const anthropicClient = new FakeAnthropicClient([
    { content: [{ type: 'tool_use', id: 'call_1', name: 'request_clarification', input: { question: '¿Hay MFA?' } }] },
    { content: [{ type: 'text', text: 'no debería llegar acá' }] }
  ]);
  const loop = new AgentLoop({ anthropicClient, toolRegistry, jobStore, maxIterations: 5 });
  const job = await loop.run('job-1');
  assert.equal(job.status, 'blocked');
  assert.equal(anthropicClient.calls, 1);
});

test('se detiene con status failed y stop_reason max_iterations_reached al agotar iteraciones', async () => {
  const { jobStore, toolRegistry } = setup();
  const anthropicClient = new FakeAnthropicClient([
    { content: [{ type: 'tool_use', id: 'call_1', name: 'log_progress', input: { message: 'sigo' } }] }
  ]);
  const loop = new AgentLoop({ anthropicClient, toolRegistry, jobStore, maxIterations: 1 });
  const job = await loop.run('job-1');
  assert.equal(job.status, 'failed');
  assert.equal(job.stop_reason, 'max_iterations_reached');
  assert.equal(anthropicClient.calls, 1);
});

test('propaga un error de tool como tool_result con is_error sin frenar el loop', async () => {
  const { jobStore, toolRegistry } = setup();
  const anthropicClient = new FakeAnthropicClient([
    { content: [{ type: 'tool_use', id: 'call_1', name: 'crawl_site', input: { root_url: 'https://x.test' } }] },
    { content: [{ type: 'text', text: 'Entendido, sigo sin crawler.' }] }
  ]);
  const loop = new AgentLoop({ anthropicClient, toolRegistry, jobStore, maxIterations: 5 });
  const job = await loop.run('job-1');
  assert.equal(job.status, 'completed');
  assert.equal(anthropicClient.calls, 2);
});
```

- [ ] **Step 2: Correr los tests y verificar que fallan**

Run: `npm test`
Expected: FAIL — `Cannot find module './agent-loop.js'`.

- [ ] **Step 3: Implementar `agent-loop.js`**

```javascript
// src/agent-loop.js
function buildInitialPrompt(config) {
  return [
    `Sos el cerebro del Agente F1 de compliance de accesibilidad digital.`,
    `Canal: ${config.target.channel}. Modo: ${config.target.mode}.`,
    `Base normativa: ONTI Disp. 6/2019 (38 criterios WCAG 2.0 A+AA, umbral ${config.wcag.conformance_threshold}/38).`,
    `Config completa: ${JSON.stringify(config)}`,
    `Decidí la próxima herramienta a ejecutar. Nunca asumas éxito: evaluá siempre el resultado real de la herramienta anterior.`
  ].join('\n');
}

export class AgentLoop {
  constructor({ anthropicClient, toolRegistry, jobStore, maxIterations = 30, model = 'claude-sonnet-5' }) {
    this.anthropicClient = anthropicClient;
    this.toolRegistry = toolRegistry;
    this.jobStore = jobStore;
    this.maxIterations = maxIterations;
    this.model = model;
  }

  async run(jobId) {
    const initialJob = this.jobStore.getJob(jobId);
    if (!initialJob) {
      throw new Error(`Job no encontrado: ${jobId}`);
    }
    this.jobStore.updateJob(jobId, { status: 'running' });

    const messages = [{ role: 'user', content: buildInitialPrompt(initialJob.config) }];

    while (true) {
      const job = this.jobStore.getJob(jobId);
      if (job.iterations >= this.maxIterations) {
        this.jobStore.updateJob(jobId, { status: 'failed', stop_reason: 'max_iterations_reached' });
        break;
      }

      const response = await this.anthropicClient.messages.create({
        model: this.model,
        max_tokens: 1024,
        tools: this.toolRegistry.schemas,
        messages
      });

      this.jobStore.updateJob(jobId, { iterations: job.iterations + 1 });
      messages.push({ role: 'assistant', content: response.content });

      const toolUseBlocks = response.content.filter((block) => block.type === 'tool_use');

      if (toolUseBlocks.length === 0) {
        const finalJob = this.jobStore.getJob(jobId);
        if (finalJob.status !== 'blocked') {
          this.jobStore.updateJob(jobId, { status: 'completed' });
        }
        break;
      }

      const toolResults = [];
      for (const block of toolUseBlocks) {
        try {
          const result = await this.toolRegistry.execute(block.name, block.input, jobId);
          toolResults.push({ type: 'tool_result', tool_use_id: block.id, content: JSON.stringify(result) });
        } catch (err) {
          toolResults.push({ type: 'tool_result', tool_use_id: block.id, content: JSON.stringify({ error: err.message }), is_error: true });
        }
      }
      messages.push({ role: 'user', content: toolResults });

      if (this.jobStore.getJob(jobId).status === 'blocked') {
        break;
      }
    }

    return this.jobStore.getJob(jobId);
  }
}
```

- [ ] **Step 4: Correr los tests y verificar que pasan**

Run: `npm test`
Expected: PASS — 25 tests acumulados, 0 fallas.

- [ ] **Step 5: Commit**

```bash
git add src/agent-loop.js src/agent-loop.test.js
git commit -m "feat: add Observe-Plan-Act-Evaluate-Adjust agent loop over Claude tool-use"
```

---

## Task 6: REST API (server + routes)

**Files:**
- Create: `src/api/routes.js`
- Create: `src/api/server.js`
- Test: `src/api/routes.test.js`

**Interfaces:**
- Consumes: `validateConfig` (Task 2), `JobStore` (Task 3), `AgentLoop` (Task 5).
- Produces: `createApp({ jobStore, agentLoopFactory }) -> express.Application`, donde `agentLoopFactory: () => { run(jobId): Promise<object> }` se inyecta para poder testear sin pegarle a Anthropic. `server.js` exporta `createApp` reexportada y, si se ejecuta como script principal, hace el bootstrap real (dotenv + `@anthropic-ai/sdk` + `app.listen`).

- [ ] **Step 1: Escribir los tests que fallan**

```javascript
// src/api/routes.test.js
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
```

- [ ] **Step 2: Correr los tests y verificar que fallan**

Run: `npm test`
Expected: FAIL — `Cannot find module './server.js'`.

- [ ] **Step 3: Implementar `routes.js`**

```javascript
// src/api/routes.js
import { Router } from 'express';
import { validateConfig } from '../config/validate-config.js';

export function createRouter({ jobStore, agentLoopFactory }) {
  const router = Router();

  router.get('/health', (req, res) => {
    res.status(200).json({ status: 'ok' });
  });

  router.post('/jobs', (req, res) => {
    const { valid, errors, config } = validateConfig(req.body);
    if (!valid) {
      return res.status(400).json({ error: 'invalid_config', details: errors });
    }
    const job = jobStore.createJob(config);
    const agentLoop = agentLoopFactory();
    agentLoop.run(job.job_id).catch((err) => {
      jobStore.updateJob(job.job_id, { status: 'failed', stop_reason: err.message });
    });
    return res.status(201).json({ job_id: job.job_id, status: job.status });
  });

  router.get('/jobs/:id', (req, res) => {
    const job = jobStore.getJob(req.params.id);
    if (!job) {
      return res.status(404).json({ error: 'job_not_found' });
    }
    return res.status(200).json({
      job_id: job.job_id,
      status: job.status,
      phase: job.phase,
      progress: job.progress,
      current_action: job.current_action,
      iterations: job.iterations,
      started_at: job.started_at,
      estimated_completion: job.estimated_completion,
      reports: job.reports
    });
  });

  return router;
}
```

- [ ] **Step 4: Implementar `server.js`**

```javascript
// src/api/server.js
import express from 'express';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import { createRouter } from './routes.js';

export function createApp({ jobStore, agentLoopFactory }) {
  const app = express();
  app.use(express.json());
  app.use('/api', createRouter({ jobStore, agentLoopFactory }));
  return app;
}

async function bootstrap() {
  const dotenv = await import('dotenv');
  dotenv.config();
  const { default: Anthropic } = await import('@anthropic-ai/sdk');
  const { JobStore } = await import('../job-store.js');
  const { createToolRegistry } = await import('../tools/tool-registry.js');
  const { AgentLoop } = await import('../agent-loop.js');

  const jobStore = new JobStore();
  const toolRegistry = createToolRegistry({ jobStore });
  const anthropicClient = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });

  const app = createApp({
    jobStore,
    agentLoopFactory: () => new AgentLoop({ anthropicClient, toolRegistry, jobStore })
  });

  const port = process.env.PORT || 3000;
  app.listen(port, () => {
    console.log(`f1-compliance-agent escuchando en puerto ${port}`);
  });
}

const isMainModule = Boolean(process.argv[1]) && fileURLToPath(import.meta.url) === path.resolve(process.argv[1]);
if (isMainModule) {
  bootstrap();
}
```

- [ ] **Step 5: Correr los tests y verificar que pasan**

Run: `npm test`
Expected: PASS — 30 tests acumulados, 0 fallas.

- [ ] **Step 6: Commit**

```bash
git add src/api/routes.js src/api/server.js src/api/routes.test.js
git commit -m "feat: add REST API skeleton (POST /api/jobs, GET /api/jobs/:id, GET /api/health)"
```

---

## Task 7: Wire Production Bootstrap & Manual Smoke Test

**Files:**
- Modify: `docs/reference/PLAN-CONSTRUCCION-agente-f1-v1.1.md` (nota de estado, no se reescribe el contenido original)
- Create: `docs/superpowers/plans/README.md` — **NO crear este archivo**; en su lugar solo agregar una nota al final del plan actual (este mismo archivo) marcando la Tarea 7 como smoke test manual.

**Interfaces:**
- Ninguna nueva interfaz de código. Esta tarea es verificación manual del bootstrap real (`npm start`) y registro de qué sigue.

- [ ] **Step 1: Verificar que la suite completa pasa de punta a punta**

Run: `npm test`
Expected: PASS — 30 tests, 0 fallas (Tasks 2–6 combinadas).

- [ ] **Step 2 (manual, requiere `ANTHROPIC_API_KEY` real — opcional, no bloquea el resto del plan): smoke test del servidor real**

```bash
cp .env.example .env
# Editar .env y pegar una ANTHROPIC_API_KEY real
npm start
```

En otra terminal:

```bash
curl -s http://localhost:3000/api/health
curl -s -X POST http://localhost:3000/api/jobs \
  -H "Content-Type: application/json" \
  -d '{"target":{"channel":"home_banking","mode":"url_list","urls":["https://example.com"]}}'
```

Expected: `/api/health` devuelve `{"status":"ok"}`; `POST /api/jobs` devuelve `201` con `job_id` y `status`. El loop real va a terminar rápido en `failed`/`max_iterations_reached` o pidiendo `request_clarification`, porque las tools de dominio (`crawl_site`, `scan_batch`, etc.) todavía son stubs — **es el comportamiento esperado de este sub-plan**, no un bug.

- [ ] **Step 3: Agregar nota de estado al final de `docs/reference/PLAN-CONSTRUCCION-agente-f1-v1.1.md`**

Agregar, sin tocar el resto del documento, al final del archivo:

```markdown

---

**Nota de estado (post Sub-plan A — Fundación):** Implementados y testeados: `validate-config.js`, `JobStore`, `tool-registry.js` (schemas de las 11 tools + `validate_config`/`log_progress`/`request_clarification` reales, resto como stubs `NotImplementedError`), `agent-loop.js` (loop real contra Claude tool-use) y la REST API mínima (`POST /api/jobs`, `GET /api/jobs/:id`, `GET /api/health`). Pendientes como sub-planes siguientes de la Fase 2: **B** crawler (`crawlee`) + scanner (`axe-core`+Playwright), **C** classifier (mapeo a los 38 ONTI) + calculate_score, **D** reporters (score/dashboard/inventario/matriz/roadmap + `xlsx-builder`), **E** skill-runner (skills externos ui-skills.com) + `consolidate_jobs` + rutas `GET /api/jobs/:id/reports`, `DELETE /api/jobs/:id`, `POST /api/jobs/consolidate`.
```

- [ ] **Step 4: Commit final**

```bash
git add docs/reference/PLAN-CONSTRUCCION-agente-f1-v1.1.md
git commit -m "docs: mark foundation sub-plan (A) as done, list remaining Fase 2 sub-plans"
```

---

## Self-Review Notes

- **Cobertura de SPEC en este sub-plan:** §4.2 (loop OBSERVAR→PLANIFICAR→ACTUAR→EVALUAR→AJUSTAR) → Task 5. §4.3 (criterio de parada por `max_iterations`) → Task 5. §4.4 (transparencia: log de cada iteración) → Task 4 (`log_progress`) + Task 5. §6.1 (tool set completo) → Task 4. §7 (input contract) → Task 2. §10 (API REST, subconjunto: `POST /jobs`, `GET /jobs/:id`, `GET /health`) → Task 6. §12 (stack: Node 20+, Express, `@anthropic-ai/sdk`, `claude-sonnet-5`) → Task 1/5/6. §14 (API key solo por env, nunca en config) → Task 6 (`bootstrap()` lee `process.env.ANTHROPIC_API_KEY`, nunca del body). El resto de la SPEC (§3, §6.2, §8, §9 pasos DISCOVER/SCAN/ENRICH/ANALYZE/GENERATE, §15, §16, §18) queda explícitamente fuera de este sub-plan y se cubre en los sub-planes B–E listados en la Tarea 7.
- **Placeholders:** ninguno — cada step tiene código completo y ejecutable; los "stubs" de `tool-registry.js` son comportamiento final e intencional de este sub-plan (lanzan `NotImplementedError`, están testeados), no TODOs.
- **Consistencia de tipos:** `validateConfig` devuelve siempre `{ valid, errors, config }` (Task 2, 4, 6). `JobStore` siempre expone `job_id`, `status`, `phase`, `progress`, `iterations`, `logs`, `reports`, `stop_reason` (Task 3, usado igual en 4, 5, 6). `AgentLoop.run(jobId)` siempre devuelve el job final vía `jobStore.getJob(jobId)` (Task 5, usado en Task 6 solo para el fire-and-forget). `createToolRegistry({ jobStore }).execute(name, input, jobId)` es la única forma de invocar una tool (Task 4, consumida en Task 5).
