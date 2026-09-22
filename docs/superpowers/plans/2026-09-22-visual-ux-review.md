# Integración real de visual_audit y ux_compliance_review — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Implementar de verdad las tools `visual_audit` y `ux_compliance_review` del Tool Set (SPEC §6.1), que hoy no existen, usando una llamada real a un modelo con visión guiada por contenido de skill vendorizado, en vez de intentar invocar `antfu/rams`/el skill de UX como si fueran APIs deterministas (no lo son — ver spike documentado en el spec).

**Architecture:** `scanner.js` gana captura opt-in de screenshot/HTML. Un módulo nuevo `src/visual-review/` contiene la guía vendorizada, un helper compartido que fuerza (tool-use) la respuesta del modelo al schema de finding de SPEC §8.3, y los dos runners (`visual-audit.js`, `ux-compliance-review.js`) que llaman a un `anthropicClient` inyectado. `tool-registry.js` expone las dos tools nuevas y les pasa ese cliente; `server.js` construye el cliente antes de armar el registry.

**Tech Stack:** Node.js ESM, `@anthropic-ai/sdk` (ya dependencia), `playwright` (ya dependencia, para `page.screenshot()`/`page.content()`), `node:test` + `node:assert/strict`, `node:crypto` (`randomUUID`).

**Spec:** `docs/superpowers/specs/2026-09-22-visual-ux-review-design.md` (lee ese archivo completo antes de empezar — tiene el contexto de por qué esto no es una integración de API simple).

## Global Constraints

- Cerebro/modelo default: `claude-sonnet-5` (decisión D2 del proyecto) — nunca hardcodear otro modelo salvo que el caller lo pase explícito.
- Los 38 criterios ONTI viven en `src/classification/onti-38-criteria.json`, los 18 extendidos en `src/classification/wcag-extended-22.json`, ambos ya exportados como `ontiCriteria`/`extendedCriteria` desde `src/classification/wcag-map.js` junto con `lookupOntiCriterion(wcagCriterion)`/`lookupExtendedCriterion(wcagCriterion)` — **reusar estas, no reimplementar el lookup**.
- Forma exacta de finding (SPEC §8.3), la misma que ya produce `src/classification/classify-findings.js`: `{ id, source, wcag_criterion, wcag_level, wcag_description, onti_criterion, in_scope, severity, rule_id, affected_urls, occurrences, element_sample, failure_summary, remediation_hint }`. `severity` ∈ `critical|serious|moderate|minor`. `in_scope` ∈ `onti|extended_22` (nunca `out_of_scope` — esos se descartan, decisión D7).
- `randomUUID` viene de `node:crypto` (no de la dependencia `uuid` — así lo hace ya `classify-findings.js`).
- **Excepción de testing documentada:** esta es la única parte del repo donde se mockea una dependencia externa (`anthropicClient`) en tests automatizados — justificado por costo real de inferencia + no-determinismo de una llamada con visión. No agregar tests que llamen a la API real de Anthropic en `npm test`.
- No tocar `calculate-score.js`, `matriz-deliverable.js` ni `dashboard-deliverable.js` — ya procesan cualquier finding por `in_scope`/`severity` sin importar `source`, así que los findings de `visual_audit`/`ux_review` se integran sin cambios ahí (verificado leyendo `calculate-score.js`: filtra por `f.in_scope`, nunca por `f.source`).

---

## Task 1: Captura opcional de screenshot + HTML en el scanner

**Files:**
- Modify: `src/scanner.js`
- Modify: `src/scanner.test.js`

**Interfaces:**
- Produces: `scanUrl({ url, ..., captureScreenshot, captureHtml })` y `scanBatch({ urlList, ..., captureScreenshot, captureHtml })` — cuando `captureScreenshot: true`, el resultado gana `result.screenshot` (string base64 PNG). Cuando `captureHtml: true`, gana `result.html` (string, DOM completo vía `page.content()`). Sin esas opciones (default `false`), ningún campo nuevo aparece.

- [ ] **Step 1: Escribir el test que falla**

Agregar al final de `src/scanner.test.js`:

```javascript
test('scanUrl con captureScreenshot:true agrega una screenshot base64 no vacía', async () => {
  const result = await scanUrl({ url: 'https://example.com', captureScreenshot: true });
  assert.equal(typeof result.screenshot, 'string');
  assert.ok(result.screenshot.length > 100);
});

test('scanUrl con captureHtml:true agrega el HTML completo de la página', async () => {
  const result = await scanUrl({ url: 'https://example.com', captureHtml: true });
  assert.match(result.html, /<html/i);
  assert.match(result.html, /Example Domain/);
});

test('scanUrl sin capture flags no agrega screenshot ni html', async () => {
  const result = await scanUrl({ url: 'https://example.com' });
  assert.equal(result.screenshot, undefined);
  assert.equal(result.html, undefined);
});
```

- [ ] **Step 2: Correr los tests nuevos y confirmar que fallan**

Run: `node --test src/scanner.test.js`
Expected: los dos primeros tests nuevos FALLAN (`result.screenshot`/`result.html` son `undefined`); el tercero PASA ya (el comportamiento actual ya no agrega esos campos).

- [ ] **Step 3: Implementar la captura en `scanner.js`**

Reemplazar la función `toAxeResult` completa por:

```javascript
function toAxeResult(url, results, extras = {}) {
  const base = {
    url,
    scanned_at: new Date().toISOString(),
    violation_count: results.violations.length,
    pass_count: results.passes.length,
    incomplete_count: results.incomplete.length,
    violations: results.violations.map((violation) => ({
      id: violation.id,
      impact: violation.impact,
      tags: violation.tags,
      help: violation.help,
      help_url: violation.helpUrl,
      node_count: violation.nodes.length,
      nodes: violation.nodes.map((node) => ({
        target: node.target,
        html: node.html,
        failure_summary: node.failureSummary
      }))
    }))
  };
  if (extras.screenshot) base.screenshot = extras.screenshot;
  if (extras.html) base.html = extras.html;
  return base;
}
```

Reemplazar la firma y el cuerpo de `scanOne` (agregando `captureScreenshot`/`captureHtml` a la destructuración de opciones, y la captura entre `axeBuilder.analyze()` y el `return`):

```javascript
async function scanOne(browser, { url, wcagTags, auth, viewport, timeout, waitFor, captureScreenshot, captureHtml }) {
  const context = await createContext(browser, auth, viewport);
  try {
    const page = await context.newPage();

    if (auth?.type === 'form') {
      await applyFormAuth(page, auth.config);
    }

    const response = await page.goto(url, {
      waitUntil: waitFor || 'networkidle',
      timeout: timeout || 30000
    });

    if (response && [401, 403].includes(response.status())) {
      throw new AuthRequiredError(url, response.status());
    }

    const axeBuilder = new AxeBuilder({ page });
    if (Array.isArray(wcagTags) && wcagTags.length > 0) {
      axeBuilder.withTags(wcagTags);
    }
    const results = await axeBuilder.analyze();

    const extras = {};
    if (captureScreenshot) {
      const buffer = await page.screenshot({ fullPage: true });
      extras.screenshot = buffer.toString('base64');
    }
    if (captureHtml) {
      extras.html = await page.content();
    }

    return toAxeResult(url, results, extras);
  } finally {
    await context.close();
  }
}
```

Actualizar `scanUrl` y `scanBatch` para pasar las dos opciones nuevas (agregarlas a la destructuración de parámetros y al objeto que le pasan a `scanOne`):

```javascript
export async function scanUrl({ url, wcagTags, auth, viewport, timeout, waitFor, captureScreenshot, captureHtml }) {
  if (!url) throw new Error('scanUrl requiere "url"');

  const browser = await chromium.launch();
  try {
    return await scanOne(browser, { url, wcagTags, auth, viewport, timeout, waitFor, captureScreenshot, captureHtml });
  } finally {
    await browser.close();
  }
}
```

```javascript
export async function scanBatch({ urlList, wcagTags, auth, workers = 3, viewport, timeout, waitFor, captureScreenshot, captureHtml }) {
  if (!Array.isArray(urlList) || urlList.length === 0) {
    throw new Error('scanBatch requiere "urlList" no vacío');
  }

  const browser = await chromium.launch();
  try {
    const results = new Array(urlList.length);
    let nextIndex = 0;
    const workerCount = Math.max(1, Math.min(workers, urlList.length));

    async function runWorker() {
      while (nextIndex < urlList.length) {
        const index = nextIndex++;
        const url = urlList[index];
        try {
          results[index] = await scanOne(browser, { url, wcagTags, auth, viewport, timeout, waitFor, captureScreenshot, captureHtml });
        } catch (error) {
          results[index] = { url, error: classifyError(error) };
        }
      }
    }

    await Promise.all(Array.from({ length: workerCount }, runWorker));
    return results;
  } finally {
    await browser.close();
  }
}
```

- [ ] **Step 4: Correr los tests y confirmar que pasan**

Run: `node --test src/scanner.test.js`
Expected: todos los tests de `scanner.test.js` (viejos y nuevos) PASAN.

- [ ] **Step 5: Commit**

```bash
git add src/scanner.js src/scanner.test.js
git commit -m "feat: add opt-in screenshot/HTML capture to scanUrl/scanBatch"
```

---

## Task 2: Helper compartido — schema de tool-use + normalización de findings

**Files:**
- Create: `src/visual-review/report-findings-schema.js`
- Create: `src/visual-review/report-findings-schema.test.js`

**Interfaces:**
- Consumes: `ontiCriteria`, `extendedCriteria`, `lookupOntiCriterion(wcagCriterion)`, `lookupExtendedCriterion(wcagCriterion)` desde `../classification/wcag-map.js` (ya existen, ver Global Constraints).
- Produces: `REPORT_FINDINGS_TOOL` (objeto tool de Anthropic), `criteriaListText()` (string con los 38+18 criterios para el prompt), `normalizeReportedFindings(rawFindings, { url, source })` → array de findings con la forma exacta de SPEC §8.3. Usado por Task 3 y Task 4.

- [ ] **Step 1: Escribir el test que falla**

Crear `src/visual-review/report-findings-schema.test.js`:

```javascript
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { REPORT_FINDINGS_TOOL, criteriaListText, normalizeReportedFindings } from './report-findings-schema.js';

test('REPORT_FINDINGS_TOOL tiene el nombre y schema esperados por tool_choice', () => {
  assert.equal(REPORT_FINDINGS_TOOL.name, 'report_findings');
  assert.equal(REPORT_FINDINGS_TOOL.input_schema.type, 'object');
  assert.ok(REPORT_FINDINGS_TOOL.input_schema.properties.findings);
});

test('criteriaListText incluye criterios ONTI y extendidos con su descripción', () => {
  const text = criteriaListText();
  assert.match(text, /1\.1\.1/);
  assert.match(text, /Contenido no textual/);
  assert.match(text, /extended_22/);
});

test('normalizeReportedFindings arma un finding completo a partir de un item válido', () => {
  const raw = [{ wcag_criterion: '1.4.3', severity: 'serious', failure_summary: 'Contraste insuficiente en botón primario', remediation_hint: 'Subir contraste a 4.5:1', element_sample: '<button>Enviar</button>' }];
  const findings = normalizeReportedFindings(raw, { url: 'https://a.test', source: 'visual_audit' });

  assert.equal(findings.length, 1);
  const finding = findings[0];
  assert.equal(finding.source, 'visual_audit');
  assert.equal(finding.wcag_criterion, '1.4.3');
  assert.equal(finding.wcag_level, 'AA');
  assert.equal(finding.onti_criterion, true);
  assert.equal(finding.in_scope, 'onti');
  assert.equal(finding.severity, 'serious');
  assert.deepEqual(finding.affected_urls, ['https://a.test']);
  assert.equal(finding.occurrences, 1);
  assert.equal(finding.rule_id, 'visual_audit:contraste-insuficiente-en-boton-primario');
  assert.ok(finding.id);
});

test('normalizeReportedFindings descarta items sin wcag_criterion reconocido (D7)', () => {
  const raw = [{ severity: 'moderate', failure_summary: 'Algo raro', remediation_hint: 'x' }];
  const findings = normalizeReportedFindings(raw, { url: 'https://a.test', source: 'ux_review' });
  assert.deepEqual(findings, []);
});

test('normalizeReportedFindings cae a severity "moderate" si el modelo devuelve un valor fuera de la enum', () => {
  const raw = [{ wcag_criterion: '1.1.1', severity: 'catastrófico', failure_summary: 'x', remediation_hint: 'y' }];
  const findings = normalizeReportedFindings(raw, { url: 'https://a.test', source: 'visual_audit' });
  assert.equal(findings[0].severity, 'moderate');
});
```

- [ ] **Step 2: Correr el test y confirmar que falla**

Run: `node --test src/visual-review/report-findings-schema.test.js`
Expected: FAIL con `Cannot find module './report-findings-schema.js'`.

- [ ] **Step 3: Implementar `report-findings-schema.js`**

```javascript
import { randomUUID } from 'node:crypto';
import { ontiCriteria, extendedCriteria, lookupOntiCriterion, lookupExtendedCriterion } from '../classification/wcag-map.js';

const VALID_SEVERITIES = ['critical', 'serious', 'moderate', 'minor'];

export const REPORT_FINDINGS_TOOL = {
  name: 'report_findings',
  description: 'Reporta los hallazgos de accesibilidad/UX detectados en la revisión, uno por objeto.',
  input_schema: {
    type: 'object',
    properties: {
      findings: {
        type: 'array',
        items: {
          type: 'object',
          properties: {
            wcag_criterion: {
              type: 'string',
              description: 'Criterio WCAG más cercano de la lista provista (ej. "1.4.3"). Omitir el campo si ningún criterio de la lista aplica a este hallazgo.'
            },
            severity: { type: 'string', enum: VALID_SEVERITIES },
            failure_summary: { type: 'string', description: 'Descripción breve y concreta del problema encontrado' },
            remediation_hint: { type: 'string', description: 'Cómo corregirlo' },
            element_sample: { type: 'string', description: 'Fragmento de HTML o descripción del elemento afectado, si aplica' }
          },
          required: ['severity', 'failure_summary', 'remediation_hint']
        }
      }
    },
    required: ['findings']
  }
};

/**
 * Texto con los 38 criterios ONTI + 18 extendidos para que el modelo elija el más cercano
 * (o ninguno) al reportar un hallazgo — mismo marco normativo que ya usa el resto del pipeline.
 */
export function criteriaListText() {
  const onti = ontiCriteria.map((c) => `${c.wcag_criterion} (${c.level}, onti): ${c.description}`);
  const extended = extendedCriteria.map((c) => `${c.wcag_criterion} (${c.level}, extended_22): ${c.description}`);
  return [...onti, ...extended].join('\n');
}

function resolveCriterion(wcagCriterion) {
  if (!wcagCriterion) return null;
  const onti = lookupOntiCriterion(wcagCriterion);
  if (onti) return { ...onti, in_scope: 'onti' };
  const extended = lookupExtendedCriterion(wcagCriterion);
  if (extended) return { ...extended, in_scope: 'extended_22' };
  return null;
}

function slugify(text) {
  return (text || '')
    .toLowerCase()
    .normalize('NFD').replace(/[̀-ͯ]/g, '')
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/(^-|-$)/g, '')
    .slice(0, 50) || 'hallazgo';
}

/**
 * Normaliza los items crudos del tool_use de report_findings a la forma exacta de finding de
 * SPEC §8.3. Descarta (sin romper el resto) los items sin criterio WCAG reconocido - mismo
 * criterio D7 que ya usa classify-findings.js para axe-core - y defiende contra un `severity`
 * fuera de la enum en vez de dejarlo pasar tal cual (el modelo puede alucinar un valor).
 */
export function normalizeReportedFindings(rawFindings, { url, source }) {
  const findings = [];
  for (const raw of rawFindings || []) {
    const criterion = resolveCriterion(raw.wcag_criterion);
    if (!criterion) continue;

    const severity = VALID_SEVERITIES.includes(raw.severity) ? raw.severity : 'moderate';
    const failureSummary = raw.failure_summary || 'Hallazgo sin descripción provista por el modelo';

    findings.push({
      id: randomUUID(),
      source,
      wcag_criterion: criterion.wcag_criterion,
      wcag_level: criterion.level,
      wcag_description: criterion.description,
      onti_criterion: criterion.in_scope === 'onti',
      in_scope: criterion.in_scope,
      severity,
      rule_id: `${source}:${slugify(failureSummary)}`,
      affected_urls: [url],
      occurrences: 1,
      element_sample: raw.element_sample ?? '',
      failure_summary: failureSummary,
      remediation_hint: raw.remediation_hint || ''
    });
  }
  return findings;
}
```

- [ ] **Step 4: Correr el test y confirmar que pasa**

Run: `node --test src/visual-review/report-findings-schema.test.js`
Expected: todos los tests PASAN.

- [ ] **Step 5: Commit**

```bash
git add src/visual-review/report-findings-schema.js src/visual-review/report-findings-schema.test.js
git commit -m "feat: add shared report-findings tool schema and finding normalizer"
```

---

## Task 3: `visual_audit` — guía vendorizada + runner

**Files:**
- Create: `src/visual-review/references/rams-visual-guidelines.md`
- Create: `src/visual-review/visual-audit.js`
- Create: `src/visual-review/visual-audit.test.js`

**Interfaces:**
- Consumes: `REPORT_FINDINGS_TOOL`, `criteriaListText`, `normalizeReportedFindings` (Task 2).
- Produces: `runVisualAudit({ url, screenshot }, { anthropicClient, model })` → `Promise<{ visual_findings: Finding[] }>`. Usado por Task 5.

- [ ] **Step 1: Crear la guía vendorizada**

Crear `src/visual-review/references/rams-visual-guidelines.md`:

```markdown
# Guía de accesibilidad visual (snapshot 2026-09-22)

> Curación propia de criterios de accesibilidad visual inspirados en las categorías que cubre
> el skill `antfu/rams` (contraste, spacing, tipografía, touch targets) — no es una copia
> verbatim del contenido dinámico que ese skill trae en tiempo real desde su fuente remota.
> Ver contexto completo en `docs/superpowers/specs/2026-09-22-visual-ux-review-design.md`.

## Contraste
- Contraste "al límite" del mínimo técnico (ej. 4.5:1 justo para WCAG 1.4.3) puede seguir
  siendo ilegible en condiciones reales (brillo bajo, luz solar directa, baja visión). Marcá
  como hallazgo cualquier texto con contraste visualmente ajustado, aunque pase el mínimo.
- Texto sobre imágenes o gradientes sin overlay de contraste suficiente.

## Espaciado y touch targets
- Elementos interactivos (botones, links, checkboxes) con área táctil aparente menor a 44×44px.
- Elementos interactivos demasiado próximos entre sí, con riesgo de toque accidental.

## Tipografía
- Tamaño de fuente de cuerpo aparentemente menor a ~14px efectivos.
- Interlineado ajustado que dificulta la lectura de párrafos largos.
- Bajo contraste entre texto secundario/placeholder y su fondo.

## Foco e interacción
- Indicadores de foco (outline) ausentes o poco visibles en elementos interactivos.
- Estados hover/focus/active que no se distinguen visualmente entre sí.

## Movimiento
- Animaciones o contenido con auto-play sin mecanismo aparente de pausa.
```

- [ ] **Step 2: Escribir el test que falla**

Crear `src/visual-review/visual-audit.test.js`:

```javascript
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { runVisualAudit } from './visual-audit.js';

function fakeClient(toolInput) {
  const calls = [];
  return {
    calls,
    messages: {
      create: async (params) => {
        calls.push(params);
        return { content: [{ type: 'tool_use', name: 'report_findings', input: toolInput }] };
      }
    }
  };
}

test('runVisualAudit requiere url y screenshot', async () => {
  await assert.rejects(() => runVisualAudit({ url: '', screenshot: 'x' }, { anthropicClient: fakeClient({ findings: [] }) }), /url/);
  await assert.rejects(() => runVisualAudit({ url: 'https://a.test', screenshot: '' }, { anthropicClient: fakeClient({ findings: [] }) }), /screenshot/);
});

test('runVisualAudit fuerza la tool report_findings y manda la screenshot como imagen', async () => {
  const client = fakeClient({ findings: [] });
  await runVisualAudit({ url: 'https://a.test', screenshot: 'ZmFrZS1wbmc=' }, { anthropicClient: client });

  const [params] = client.calls;
  assert.deepEqual(params.tool_choice, { type: 'tool', name: 'report_findings' });
  assert.equal(params.tools[0].name, 'report_findings');
  const content = params.messages[0].content;
  assert.ok(content.some((block) => block.type === 'image' && block.source.data === 'ZmFrZS1wbmc='));
  assert.ok(content.some((block) => block.type === 'text' && block.text.includes('a.test')));
});

test('runVisualAudit normaliza los findings del tool_use con source "visual_audit"', async () => {
  const client = fakeClient({
    findings: [{ wcag_criterion: '1.4.3', severity: 'serious', failure_summary: 'Contraste insuficiente', remediation_hint: 'Subir contraste' }]
  });
  const { visual_findings } = await runVisualAudit({ url: 'https://a.test', screenshot: 'ZmFrZQ==' }, { anthropicClient: client });

  assert.equal(visual_findings.length, 1);
  assert.equal(visual_findings[0].source, 'visual_audit');
  assert.equal(visual_findings[0].wcag_criterion, '1.4.3');
  assert.deepEqual(visual_findings[0].affected_urls, ['https://a.test']);
});

test('runVisualAudit devuelve visual_findings vacío si el modelo no reporta nada', async () => {
  const client = fakeClient({ findings: [] });
  const { visual_findings } = await runVisualAudit({ url: 'https://a.test', screenshot: 'ZmFrZQ==' }, { anthropicClient: client });
  assert.deepEqual(visual_findings, []);
});
```

- [ ] **Step 3: Correr el test y confirmar que falla**

Run: `node --test src/visual-review/visual-audit.test.js`
Expected: FAIL con `Cannot find module './visual-audit.js'`.

- [ ] **Step 4: Implementar `visual-audit.js`**

```javascript
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import { REPORT_FINDINGS_TOOL, criteriaListText, normalizeReportedFindings } from './report-findings-schema.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const GUIDELINES = readFileSync(path.join(__dirname, 'references', 'rams-visual-guidelines.md'), 'utf8');

function buildPrompt(url) {
  return [
    `Sos un auditor de accesibilidad visual. Revisá la screenshot de "${url}" siguiendo esta guía:`,
    GUIDELINES,
    'Reportá cada hallazgo con la tool report_findings. Para "wcag_criterion" elegí el más cercano de esta lista (o omitilo si ninguno aplica):',
    criteriaListText()
  ].join('\n\n');
}

/**
 * Corre una revisión visual real vía un modelo con visión (no es axe-core: es la integración
 * real del skill antfu/rams, ver docs/superpowers/specs/2026-09-22-visual-ux-review-design.md).
 * `anthropicClient` se inyecta para poder mockearlo en tests (excepción documentada a la regla
 * de "sin mocks" del resto del repo, justificada por costo real + no-determinismo).
 */
export async function runVisualAudit({ url, screenshot }, { anthropicClient, model = 'claude-sonnet-5' }) {
  if (!url) throw new Error('runVisualAudit requiere "url"');
  if (!screenshot) throw new Error('runVisualAudit requiere "screenshot" (base64 PNG, ver scanUrl con captureScreenshot:true)');

  const response = await anthropicClient.messages.create({
    model,
    max_tokens: 2048,
    tools: [REPORT_FINDINGS_TOOL],
    tool_choice: { type: 'tool', name: 'report_findings' },
    messages: [{
      role: 'user',
      content: [
        { type: 'text', text: buildPrompt(url) },
        { type: 'image', source: { type: 'base64', media_type: 'image/png', data: screenshot } }
      ]
    }]
  });

  const toolUse = response.content.find((block) => block.type === 'tool_use');
  const rawFindings = toolUse?.input?.findings ?? [];
  return { visual_findings: normalizeReportedFindings(rawFindings, { url, source: 'visual_audit' }) };
}
```

- [ ] **Step 5: Correr el test y confirmar que pasa**

Run: `node --test src/visual-review/visual-audit.test.js`
Expected: todos los tests PASAN.

- [ ] **Step 6: Commit**

```bash
git add src/visual-review/references/rams-visual-guidelines.md src/visual-review/visual-audit.js src/visual-review/visual-audit.test.js
git commit -m "feat: implement visual_audit as a real vision-model call guided by vendored rules"
```

---

## Task 4: `ux_compliance_review` — guía vendorizada + runner

**Files:**
- Create: `src/visual-review/references/ux-interaction-guidelines.md`
- Create: `src/visual-review/ux-compliance-review.js`
- Create: `src/visual-review/ux-compliance-review.test.js`

**Interfaces:**
- Consumes: `REPORT_FINDINGS_TOOL`, `criteriaListText`, `normalizeReportedFindings` (Task 2).
- Produces: `runUxComplianceReview({ url, html, screenshot }, { anthropicClient, model })` → `Promise<{ ux_findings: Finding[] }>`. Usado por Task 5. `screenshot` es opcional (contexto visual adicional); `html` es el input principal.

- [ ] **Step 1: Crear la guía vendorizada**

Crear `src/visual-review/references/ux-interaction-guidelines.md`:

```markdown
# Guía de coherencia de navegación y UX (snapshot 2026-09-22)

> El repo "Leonxlnx/web-design-guidelines" nombrado en la SPEC v0.3 §19.2 no existe con ese
> nombre exacto (ver spike en `docs/superpowers/specs/2026-09-22-visual-ux-review-design.md`).
> Este archivo es una curación propia de criterios de UX/interacción relevantes a WCAG,
> pensada para aplicarse sobre el HTML/DOM de una página (no sobre una screenshot).

## Coherencia de navegación (WCAG 3.2.3, 3.2.4)
- Elementos de navegación repetidos (menú, breadcrumbs) que cambiarían de orden o ubicación
  entre páginas del mismo módulo sin razón aparente.
- Componentes con la misma función (ej. un botón "Confirmar") con etiquetas o iconografía
  inconsistente.

## Mensajes de error y validación de formularios (WCAG 3.3.1, 3.3.3)
- Errores de formulario que solo se comunican por color (sin texto ni ícono asociado en el DOM).
- Mensajes de error genéricos ("Error", "Campo inválido") sin indicar qué corregir.
- Errores sin asociación programática visible al campo que los originó (ej. sin `aria-describedby`
  ni texto adyacente identificable).

## Identificación de componentes (WCAG 4.1.2 aplicado a UX)
- Botones o links sin texto accesible claro sobre su destino o acción ("Click aquí", "Más").
- Campos de formulario sin `<label>` asociado o `aria-label` equivalente.

## Flujos de interacción
- Pasos de un flujo multi-página (alta de cliente, transferencia) sin indicación de progreso
  ni forma evidente de volver atrás sin perder datos ingresados.
```

- [ ] **Step 2: Escribir el test que falla**

Crear `src/visual-review/ux-compliance-review.test.js`:

```javascript
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { runUxComplianceReview } from './ux-compliance-review.js';

function fakeClient(toolInput) {
  const calls = [];
  return {
    calls,
    messages: {
      create: async (params) => {
        calls.push(params);
        return { content: [{ type: 'tool_use', name: 'report_findings', input: toolInput }] };
      }
    }
  };
}

const SAMPLE_HTML = '<form><input type="text"><span style="color:red">Error</span></form>';

test('runUxComplianceReview requiere url y html', async () => {
  await assert.rejects(() => runUxComplianceReview({ url: '', html: SAMPLE_HTML }, { anthropicClient: fakeClient({ findings: [] }) }), /url/);
  await assert.rejects(() => runUxComplianceReview({ url: 'https://a.test', html: '' }, { anthropicClient: fakeClient({ findings: [] }) }), /html/);
});

test('runUxComplianceReview manda el HTML como texto y no requiere screenshot', async () => {
  const client = fakeClient({ findings: [] });
  await runUxComplianceReview({ url: 'https://a.test', html: SAMPLE_HTML }, { anthropicClient: client });

  const [params] = client.calls;
  const content = params.messages[0].content;
  assert.ok(content.some((block) => block.type === 'text' && block.text.includes(SAMPLE_HTML)));
  assert.ok(!content.some((block) => block.type === 'image'));
});

test('runUxComplianceReview incluye la screenshot como bloque opcional si se pasa', async () => {
  const client = fakeClient({ findings: [] });
  await runUxComplianceReview({ url: 'https://a.test', html: SAMPLE_HTML, screenshot: 'ZmFrZQ==' }, { anthropicClient: client });

  const [params] = client.calls;
  const content = params.messages[0].content;
  assert.ok(content.some((block) => block.type === 'image' && block.source.data === 'ZmFrZQ=='));
});

test('runUxComplianceReview normaliza los findings del tool_use con source "ux_review"', async () => {
  const client = fakeClient({
    findings: [{ wcag_criterion: '3.3.1', severity: 'moderate', failure_summary: 'Error de color solo', remediation_hint: 'Agregar texto e ícono' }]
  });
  const { ux_findings } = await runUxComplianceReview({ url: 'https://a.test', html: SAMPLE_HTML }, { anthropicClient: client });

  assert.equal(ux_findings.length, 1);
  assert.equal(ux_findings[0].source, 'ux_review');
  assert.equal(ux_findings[0].wcag_criterion, '3.3.1');
});
```

- [ ] **Step 3: Correr el test y confirmar que falla**

Run: `node --test src/visual-review/ux-compliance-review.test.js`
Expected: FAIL con `Cannot find module './ux-compliance-review.js'`.

- [ ] **Step 4: Implementar `ux-compliance-review.js`**

```javascript
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import { REPORT_FINDINGS_TOOL, criteriaListText, normalizeReportedFindings } from './report-findings-schema.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const GUIDELINES = readFileSync(path.join(__dirname, 'references', 'ux-interaction-guidelines.md'), 'utf8');

function buildPrompt(url, html) {
  return [
    `Sos un revisor de coherencia de navegación y UX. Revisá el HTML de "${url}" siguiendo esta guía:`,
    GUIDELINES,
    'HTML de la página:',
    html,
    'Reportá cada hallazgo con la tool report_findings. Para "wcag_criterion" elegí el más cercano de esta lista (o omitilo si ninguno aplica):',
    criteriaListText()
  ].join('\n\n');
}

/**
 * Corre una revisión de UX/coherencia de navegación real vía modelo, usando el HTML ya
 * capturado por scanUrl/scanBatch (captureHtml:true) como stand-in simplificado de
 * "interaction_flows" (SPEC §19.2) - ver limitación documentada en el spec de diseño.
 * `anthropicClient` inyectado, mismo motivo que visual-audit.js.
 */
export async function runUxComplianceReview({ url, html, screenshot }, { anthropicClient, model = 'claude-sonnet-5' }) {
  if (!url) throw new Error('runUxComplianceReview requiere "url"');
  if (!html) throw new Error('runUxComplianceReview requiere "html" (ver scanUrl con captureHtml:true)');

  const content = [{ type: 'text', text: buildPrompt(url, html) }];
  if (screenshot) {
    content.push({ type: 'image', source: { type: 'base64', media_type: 'image/png', data: screenshot } });
  }

  const response = await anthropicClient.messages.create({
    model,
    max_tokens: 2048,
    tools: [REPORT_FINDINGS_TOOL],
    tool_choice: { type: 'tool', name: 'report_findings' },
    messages: [{ role: 'user', content }]
  });

  const toolUse = response.content.find((block) => block.type === 'tool_use');
  const rawFindings = toolUse?.input?.findings ?? [];
  return { ux_findings: normalizeReportedFindings(rawFindings, { url, source: 'ux_review' }) };
}
```

- [ ] **Step 5: Correr el test y confirmar que pasa**

Run: `node --test src/visual-review/ux-compliance-review.test.js`
Expected: todos los tests PASAN.

- [ ] **Step 6: Commit**

```bash
git add src/visual-review/references/ux-interaction-guidelines.md src/visual-review/ux-compliance-review.js src/visual-review/ux-compliance-review.test.js
git commit -m "feat: implement ux_compliance_review as a real model call over captured HTML"
```

---

## Task 5: Wiring en el Tool Set (`tool-registry.js`)

**Files:**
- Modify: `src/tools/tool-registry.js`
- Modify: `src/tools/tool-registry.test.js`

**Interfaces:**
- Consumes: `runVisualAudit` (Task 3), `runUxComplianceReview` (Task 4).
- Produces: `createToolRegistry({ jobStore, anthropicClient })` (segundo campo opcional); dos tools nuevas en `registry.schemas`/`registry.execute`: `visual_audit`, `ux_compliance_review`; `scan_url`/`scan_batch` ganan inputs opcionales `capture_screenshot`/`capture_html` en su schema.

- [ ] **Step 1: Escribir los tests que fallan**

En `src/tools/tool-registry.test.js`, agregar `visual_audit` y `ux_compliance_review` a `CORE_TOOL_NAMES`:

```javascript
const CORE_TOOL_NAMES = [
  'validate_config', 'crawl_site', 'validate_url_list', 'scan_url', 'scan_batch',
  'classify_findings', 'calculate_score', 'generate_deliverable', 'consolidate_jobs',
  'request_clarification', 'log_progress', 'visual_audit', 'ux_compliance_review'
];
```

Agregar un parámetro opcional `anthropicClient` a `setup()`:

```javascript
async function setup({ outputPath, anthropicClient } = {}) {
  const jobStore = new JobStore();
  jobStore.createJob({
    job_id: 'job-1',
    target: { channel: 'home_banking', mode: 'url_list', urls: ['https://x.test'] },
    output: { path: outputPath ?? await mkdtemp(path.join(tmpdir(), 'f1-reports-')) }
  });
  const registry = createToolRegistry({ jobStore, anthropicClient });
  return { jobStore, registry };
}
```

Agregar al final del archivo:

```javascript
function fakeAnthropicClient(toolInput) {
  return {
    messages: {
      create: async () => ({ content: [{ type: 'tool_use', name: 'report_findings', input: toolInput }] })
    }
  };
}

test('visual_audit delega en runVisualAudit y devuelve visual_findings normalizados', async () => {
  const anthropicClient = fakeAnthropicClient({
    findings: [{ wcag_criterion: '1.4.3', severity: 'serious', failure_summary: 'Contraste bajo', remediation_hint: 'Subir contraste' }]
  });
  const { registry } = await setup({ anthropicClient });

  const result = await registry.execute('visual_audit', { url: 'https://a.test', screenshot: 'ZmFrZQ==' }, 'job-1');

  assert.equal(result.visual_findings.length, 1);
  assert.equal(result.visual_findings[0].source, 'visual_audit');
});

test('ux_compliance_review delega en runUxComplianceReview y devuelve ux_findings normalizados', async () => {
  const anthropicClient = fakeAnthropicClient({
    findings: [{ wcag_criterion: '3.3.1', severity: 'moderate', failure_summary: 'Error solo por color', remediation_hint: 'Agregar texto' }]
  });
  const { registry } = await setup({ anthropicClient });

  const result = await registry.execute('ux_compliance_review', { url: 'https://a.test', html: '<form></form>' }, 'job-1');

  assert.equal(result.ux_findings.length, 1);
  assert.equal(result.ux_findings[0].source, 'ux_review');
});
```

- [ ] **Step 2: Correr los tests y confirmar que fallan**

Run: `node --test src/tools/tool-registry.test.js`
Expected: FAIL — el primer test de la suite (`expone un schema por cada tool...`) falla porque `visual_audit`/`ux_compliance_review` no están en `registry.schemas`; los dos tests nuevos fallan con `Unknown tool: visual_audit` / `Unknown tool: ux_compliance_review`.

- [ ] **Step 3: Implementar el wiring en `tool-registry.js`**

Agregar los imports al inicio del archivo:

```javascript
import { runVisualAudit } from '../visual-review/visual-audit.js';
import { runUxComplianceReview } from '../visual-review/ux-compliance-review.js';
```

Agregar `capture_screenshot`/`capture_html` a los schemas existentes de `scan_url`/`scan_batch`, y dos entradas nuevas al final de `TOOL_SCHEMAS` (antes del `];` de cierre):

```javascript
  { name: 'scan_url', description: 'Escanea una URL con axe-core vía Playwright', input_schema: { type: 'object', properties: { url: { type: 'string' }, wcag_tags: { type: 'array', items: { type: 'string' } }, auth: { type: 'object' }, capture_screenshot: { type: 'boolean', description: 'Captura una screenshot full-page en base64 (necesaria para visual_audit)' }, capture_html: { type: 'boolean', description: 'Captura el HTML completo de la página (necesario para ux_compliance_review)' } }, required: ['url'] } },
  { name: 'scan_batch', description: 'Escanea múltiples URLs en paralelo', input_schema: { type: 'object', properties: { url_list: { type: 'array', items: { type: 'string' } }, wcag_tags: { type: 'array', items: { type: 'string' } }, workers: { type: 'number' }, capture_screenshot: { type: 'boolean' }, capture_html: { type: 'boolean' } }, required: ['url_list'] } },
```

(Estas dos líneas reemplazan las dos entradas `scan_url`/`scan_batch` existentes en `TOOL_SCHEMAS` — mismo `name`/`description`, solo se agregan las dos propiedades nuevas al `input_schema.properties`.)

```javascript
  { name: 'visual_audit', description: 'Revisión visual real (contraste, spacing, touch targets) sobre una screenshot, vía modelo con visión guiado por la guía vendorizada de accesibilidad visual', input_schema: { type: 'object', properties: { url: { type: 'string' }, screenshot: { type: 'string', description: 'Screenshot base64 PNG, obtenida de scan_url/scan_batch con capture_screenshot:true' } }, required: ['url', 'screenshot'] } },
  { name: 'ux_compliance_review', description: 'Revisión de coherencia de navegación y UX (formularios, mensajes de error) sobre el HTML de la página, vía modelo guiado por la guía vendorizada de UX', input_schema: { type: 'object', properties: { url: { type: 'string' }, html: { type: 'string', description: 'HTML completo de la página, obtenido de scan_url/scan_batch con capture_html:true' }, screenshot: { type: 'string', description: 'Opcional: screenshot base64 PNG como contexto visual adicional' } }, required: ['url', 'html'] } }
```

Cambiar la firma de `createToolRegistry` para aceptar el cliente:

```javascript
export function createToolRegistry({ jobStore, anthropicClient }) {
```

Actualizar los handlers `scan_url`/`scan_batch` para pasar las dos opciones nuevas, y agregar los dos handlers nuevos dentro del objeto `handlers` (junto a los demás, antes del cierre `};` del objeto):

```javascript
    scan_url: (input) => scanUrl({ url: input.url, wcagTags: input.wcag_tags, auth: input.auth, captureScreenshot: input.capture_screenshot, captureHtml: input.capture_html }),
    scan_batch: (input) => scanBatch({ urlList: input.url_list, wcagTags: input.wcag_tags, workers: input.workers, captureScreenshot: input.capture_screenshot, captureHtml: input.capture_html }),
```

```javascript
    visual_audit: (input) => runVisualAudit({ url: input.url, screenshot: input.screenshot }, { anthropicClient }),
    ux_compliance_review: (input) => runUxComplianceReview({ url: input.url, html: input.html, screenshot: input.screenshot }, { anthropicClient }),
```

- [ ] **Step 4: Correr los tests y confirmar que pasan**

Run: `node --test src/tools/tool-registry.test.js`
Expected: todos los tests PASAN.

- [ ] **Step 5: Correr la suite completa del repo**

Run: `npm test`
Expected: todos los tests PASAN (incluidos los de `scanner.test.js`, `visual-review/*`, y el resto del repo sin regresiones).

- [ ] **Step 6: Commit**

```bash
git add src/tools/tool-registry.js src/tools/tool-registry.test.js
git commit -m "feat: wire visual_audit and ux_compliance_review into the tool registry"
```

---

## Task 6: Wiring en la API (`server.js`)

**Files:**
- Modify: `src/api/server.js`

**Interfaces:**
- Consumes: `createToolRegistry({ jobStore, anthropicClient })` (Task 5).
- Produces: ninguna interfaz nueva — solo reordena la construcción para que el `anthropicClient` exista antes de armar el tool registry.

- [ ] **Step 1: Reordenar `bootstrap()` en `server.js`**

Reemplazar el cuerpo de `bootstrap()` (las líneas entre `const jobStore = new JobStore();` y el `const app = createApp({...})`) por:

```javascript
  const jobStore = new JobStore();
  const anthropicClient = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });
  const toolRegistry = createToolRegistry({ jobStore, anthropicClient });
```

(Esto mueve la línea de `anthropicClient` de después de `createToolRegistry` a antes, y le agrega el segundo argumento a `createToolRegistry`. El resto de `bootstrap()` — el `agentLoopFactory` que ya usaba `anthropicClient` — no cambia.)

- [ ] **Step 2: Confirmar que la suite completa sigue verde**

Run: `npm test`
Expected: todos los tests PASAN (este archivo no tiene test directo — se ejercita indirectamente por `routes.test.js`, que ya pasa un `agentLoopFactory`/`toolRegistry` propios y no depende de `bootstrap()`).

- [ ] **Step 3: Commit**

```bash
git add src/api/server.js
git commit -m "fix: construct anthropicClient before the tool registry so visual_audit/ux_compliance_review can use it"
```

---

## Nota final para quien ejecute este plan

Después de la Task 6, hacer **una validación real manual** (no automatizada, no parte de `npm test`): correr `runVisualAudit`/`runUxComplianceReview` una vez contra una URL real con un `anthropicClient` real (`ANTHROPIC_API_KEY` en el entorno) y una screenshot/HTML reales (via `scanUrl` con `captureScreenshot`/`captureHtml` en `true`), para confirmar que el modelo de verdad devuelve hallazgos razonables y que el `tool_choice` forzado funciona como se espera contra la API real (no solo contra el mock). Documentar el resultado en memoria, mismo patrón que se usó para validar `scanUrl` con el prototipo MCP+axe-core antes de escribir `scanner.js`.
