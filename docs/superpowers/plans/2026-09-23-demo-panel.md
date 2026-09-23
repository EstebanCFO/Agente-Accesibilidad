# Panel de Control Web para la Demo Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Reemplazar el control por terminal (`readline`) de `npm run demo` por un panel de control web (botones + stepper de 6 pasos + log en vivo), mientras el navegador que audita el sitio real se reposiciona debajo, sin superponerse.

**Architecture:** Un servidor Express nuevo (`demo-server.js`) sirve una página self-contained (`demo-panel.html`) y coordina preguntas/respuestas por Server-Sent Events + `POST /answer`, usando un broker de promesas en memoria (`demo-prompt-broker.js`). `demo.js` mantiene exactamente su secuencia actual de 6 pasos, pero cada `rl.question`/`pause` pasa a esperar una respuesta del panel en vez de stdin. Dos ventanas reales de Chromium (panel arriba, navegador de prueba abajo) se posicionan con CDP `Browser.setWindowBounds`, usando el cálculo de `demo-window-layout.js`.

**Tech Stack:** Node.js ESM, Express (ya es dependencia del proyecto), Server-Sent Events nativas (sin librería), Playwright + CDP.

**Spec:** `docs/superpowers/specs/2026-09-23-demo-panel-design.md` — léela completa antes de empezar. Contiene 2 bugs reales ya encontrados y resueltos en un spike visual (falta de `viewport:null`, y que `Browser.setWindowBounds` necesita 2 llamadas CDP) que cualquiera que toque este código tiene que conocer.

## Global Constraints

- **`PANEL_HEIGHT = 260`** (píxeles) — valor exacto validado visualmente en el spike, no cambiar sin volver a verificar en pantalla real.
- **Toda ventana headed de Playwright en este feature crea su context con `{ viewport: null }`**. Sin esto, Playwright fuerza un viewport emulado de 1280x720 desacoplado del tamaño real de la ventana OS, y el contenido de la página queda mal posicionado/invisible aunque la ventana se redimensione bien.
- **`Browser.setWindowBounds` de CDP se llama 2 veces, nunca 1 sola**: primero `{ windowState: 'normal' }` solo, después los bounds reales (`left`/`top`/`width`/`height`). Una sola llamada combinada es silenciosamente ignorada por Chromium en la práctica (CDP responde OK pero la ventana no cambia de tamaño en pantalla).
- **Sin tests automatizados para `demo-server.js`, `demo-panel.html` ni `demo.js`** — mismo acuerdo explícito ya vigente en este proyecto para toda la orquestación de `scripts/demo*.js` (`demo-site-selection.js`/`demo-page-selection.js`/`demo-highlight.js` sí tienen tests porque son lógica pura; la orquestación de terminal/navegador no). `demo-prompt-broker.js` y `demo-window-layout.js` SÍ son lógica pura y SÍ llevan tests con `node:test`.
- **`STEP_LABELS` (6 strings, exactos, en este orden) — usar textualmente en `demo-server.js`:**
  ```
  'Descubrir', 'Escanear', 'Clasificar contra ONTI/BCRA', 'Revisión visual con IA', 'Revisión de UX con IA', 'Generar el dashboard ejecutivo'
  ```
- Express ya es dependencia del proyecto (`package.json`) — no hace falta instalar nada nuevo.
- No se toca `demo-site-selection.js`, `demo-page-selection.js`, `demo-local-source.js` ni `demo-highlight.js` — sus funciones se siguen usando exactamente igual que hoy.

---

## Task 1: `demo-prompt-broker.js` — coordina preguntas/respuestas del panel

**Files:**
- Create: `scripts/demo-prompt-broker.js`
- Create: `scripts/demo-prompt-broker.test.js`

**Interfaces:**
- Produces: `createPromptBroker()` → `{ ask(): {id, promise}, answer(id, value): boolean, cancelPending(reason): boolean, hasPending(): boolean }`. Usado por Task 3 (`demo-server.js`).

- [ ] **Step 1: Escribir el test que falla**

Crear `scripts/demo-prompt-broker.test.js`:

```javascript
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createPromptBroker } from './demo-prompt-broker.js';

test('ask() devuelve un id de texto y una promise, y marca hasPending() true', () => {
  const broker = createPromptBroker();
  const { id, promise } = broker.ask();
  assert.equal(typeof id, 'string');
  assert.ok(promise instanceof Promise);
  assert.equal(broker.hasPending(), true);
});

test('ask() tira si ya hay un prompt pendiente sin responder', () => {
  const broker = createPromptBroker();
  broker.ask();
  assert.throws(() => broker.ask(), /Ya hay un prompt pendiente/);
});

test('answer() con el id correcto resuelve la promise con el value y devuelve true', async () => {
  const broker = createPromptBroker();
  const { id, promise } = broker.ask();
  const ok = broker.answer(id, 'sitio-1');
  assert.equal(ok, true);
  assert.equal(await promise, 'sitio-1');
});

test('answer() con un id que no coincide devuelve false y no resuelve nada', () => {
  const broker = createPromptBroker();
  broker.ask();
  const ok = broker.answer('id-viejo-que-no-existe', 'x');
  assert.equal(ok, false);
  assert.equal(broker.hasPending(), true);
});

test('answer() sin ningún prompt pendiente devuelve false', () => {
  const broker = createPromptBroker();
  assert.equal(broker.answer('cualquier-id', 'x'), false);
});

test('después de un answer() exitoso, hasPending() vuelve a false y se puede pedir otro ask()', async () => {
  const broker = createPromptBroker();
  const first = broker.ask();
  broker.answer(first.id, 'a');
  await first.promise;
  assert.equal(broker.hasPending(), false);
  const second = broker.ask();
  assert.notEqual(second.id, first.id);
});

test('cancelPending(reason) rechaza la promise pendiente y devuelve true', async () => {
  const broker = createPromptBroker();
  const { promise } = broker.ask();
  const ok = broker.cancelPending(new Error('se cerró la ventana'));
  assert.equal(ok, true);
  await assert.rejects(promise, /se cerró la ventana/);
  assert.equal(broker.hasPending(), false);
});

test('cancelPending() sin nada pendiente devuelve false', () => {
  const broker = createPromptBroker();
  assert.equal(broker.cancelPending(new Error('x')), false);
});

test('cancelPending() acepta un string en vez de un Error y lo envuelve', async () => {
  const broker = createPromptBroker();
  const { promise } = broker.ask();
  broker.cancelPending('motivo en texto');
  await assert.rejects(promise, /motivo en texto/);
});
```

- [ ] **Step 2: Correr el test y confirmar que falla**

Run: `node --test scripts/demo-prompt-broker.test.js`
Expected: FAIL con `Cannot find module './demo-prompt-broker.js'`.

- [ ] **Step 3: Implementar `demo-prompt-broker.js`**

```javascript
export function createPromptBroker() {
  let pending = null;
  let nextId = 1;

  function ask() {
    if (pending) throw new Error('Ya hay un prompt pendiente sin responder');
    const id = String(nextId++);
    let resolve, reject;
    const promise = new Promise((res, rej) => { resolve = res; reject = rej; });
    pending = { id, resolve, reject };
    return { id, promise };
  }

  function answer(id, value) {
    if (!pending || pending.id !== id) return false;
    const { resolve } = pending;
    pending = null;
    resolve(value);
    return true;
  }

  function cancelPending(reason) {
    if (!pending) return false;
    const { reject } = pending;
    pending = null;
    reject(reason instanceof Error ? reason : new Error(String(reason)));
    return true;
  }

  function hasPending() {
    return pending !== null;
  }

  return { ask, answer, cancelPending, hasPending };
}
```

- [ ] **Step 4: Correr el test y confirmar que pasa**

Run: `node --test scripts/demo-prompt-broker.test.js`
Expected: todos los tests PASAN.

- [ ] **Step 5: Commit**

```bash
git add scripts/demo-prompt-broker.js scripts/demo-prompt-broker.test.js
git commit -m "feat: add in-memory prompt/answer broker for the demo control panel"
```

---

## Task 2: `demo-window-layout.js` — calcula los 2 rects de ventana

**Files:**
- Create: `scripts/demo-window-layout.js`
- Create: `scripts/demo-window-layout.test.js`

**Interfaces:**
- Produces: `computeWindowLayout(screenWidth, screenHeight, panelHeight)` → `{ panel: {left,top,width,height}, test: {left,top,width,height} }`. Usado por Task 4 (`demo.js`).

- [ ] **Step 1: Escribir el test que falla**

Crear `scripts/demo-window-layout.test.js`:

```javascript
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { computeWindowLayout } from './demo-window-layout.js';

test('computeWindowLayout ubica el panel arriba y el navegador de prueba justo debajo, sin superponerse', () => {
  const layout = computeWindowLayout(1920, 1080, 260);
  assert.deepEqual(layout.panel, { left: 0, top: 0, width: 1920, height: 260 });
  assert.deepEqual(layout.test, { left: 0, top: 260, width: 1920, height: 820 });
});

test('computeWindowLayout usa el ancho completo de la pantalla para ambas ventanas', () => {
  const layout = computeWindowLayout(1280, 720, 260);
  assert.equal(layout.panel.width, 1280);
  assert.equal(layout.test.width, 1280);
});

test('computeWindowLayout tira un error claro si la pantalla es demasiado chica para el layout', () => {
  assert.throws(() => computeWindowLayout(1280, 500, 260), /Pantalla demasiado chica/);
});

test('computeWindowLayout acepta un panelHeight tal que el navegador de prueba queda justo en el mínimo permitido', () => {
  const layout = computeWindowLayout(1280, 560, 260);
  assert.equal(layout.test.height, 300);
});
```

- [ ] **Step 2: Correr el test y confirmar que falla**

Run: `node --test scripts/demo-window-layout.test.js`
Expected: FAIL con `Cannot find module './demo-window-layout.js'`.

- [ ] **Step 3: Implementar `demo-window-layout.js`**

```javascript
const MIN_TEST_WINDOW_HEIGHT = 300;

export function computeWindowLayout(screenWidth, screenHeight, panelHeight) {
  const testHeight = screenHeight - panelHeight;
  if (testHeight < MIN_TEST_WINDOW_HEIGHT) {
    throw new Error(`Pantalla demasiado chica para este layout: quedarían ${testHeight}px para el navegador de prueba (mínimo ${MIN_TEST_WINDOW_HEIGHT}px). Reducí PANEL_HEIGHT o usá una pantalla más grande.`);
  }
  return {
    panel: { left: 0, top: 0, width: screenWidth, height: panelHeight },
    test: { left: 0, top: panelHeight, width: screenWidth, height: testHeight }
  };
}
```

- [ ] **Step 4: Correr el test y confirmar que pasa**

Run: `node --test scripts/demo-window-layout.test.js`
Expected: todos los tests PASAN.

- [ ] **Step 5: Commit**

```bash
git add scripts/demo-window-layout.js scripts/demo-window-layout.test.js
git commit -m "feat: add window layout math for the demo panel + test browser"
```

---

## Task 3: `demo-server.js` + `demo-panel.html` — servidor del panel

**Files:**
- Create: `scripts/demo-server.js`
- Create: `scripts/demo-panel.html`

**Interfaces:**
- Consumes: `createPromptBroker` de `./demo-prompt-broker.js` (Task 1).
- Produces: `createDemoServer()` → `{ app, askPanel(spec): Promise<value>, pushStep(activeStepNumber): void, pushLog(message): void, cancelPending(reason): void }`. Usado por Task 4 (`demo.js`).
- Sin tests automatizados (Global Constraints) — se verifica manualmente con `curl`/`fetch` en el Step 2.

- [ ] **Step 1: Implementar `demo-server.js`**

```javascript
import express from 'express';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createPromptBroker } from './demo-prompt-broker.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

const STEP_LABELS = [
  'Descubrir', 'Escanear', 'Clasificar contra ONTI/BCRA',
  'Revisión visual con IA', 'Revisión de UX con IA', 'Generar el dashboard ejecutivo'
];

export function createDemoServer() {
  const app = express();
  app.use(express.json());
  const broker = createPromptBroker();
  const sseClients = new Set();

  function pushEvent(type, data) {
    const frame = `event: ${type}\ndata: ${JSON.stringify(data)}\n\n`;
    for (const res of sseClients) res.write(frame);
  }

  app.get('/panel', (req, res) => {
    res.sendFile(path.join(__dirname, 'demo-panel.html'));
  });

  app.get('/events', (req, res) => {
    res.writeHead(200, {
      'Content-Type': 'text/event-stream',
      'Cache-Control': 'no-cache',
      Connection: 'keep-alive'
    });
    res.write('\n');
    sseClients.add(res);
    req.on('close', () => sseClients.delete(res));
  });

  app.post('/answer', (req, res) => {
    const { id, value } = req.body ?? {};
    const ok = broker.answer(id, value);
    res.status(ok ? 200 : 409).json({ ok });
  });

  async function askPanel(spec) {
    const { id, promise } = broker.ask();
    pushEvent('prompt', { id, ...spec });
    return promise;
  }

  function pushStep(activeStepNumber) {
    const steps = STEP_LABELS.map((label, i) => ({
      label,
      state: i < activeStepNumber - 1 ? 'done' : i === activeStepNumber - 1 ? 'active' : 'pending'
    }));
    pushEvent('step', { steps });
  }

  function pushLog(message) {
    pushEvent('log', { message });
  }

  function cancelPending(reason) {
    broker.cancelPending(reason);
  }

  return { app, askPanel, pushStep, pushLog, cancelPending };
}
```

- [ ] **Step 2: Implementar `demo-panel.html`**

```html
<!doctype html>
<html lang="es">
<head>
<meta charset="utf-8">
<title>Agente F1 - Panel de Control</title>
<style>
  * { box-sizing: border-box; }
  body {
    margin: 0; font-family: Arial, Helvetica, sans-serif; background: #f4f6f9; color: #14213d;
    padding: 14px 24px;
  }
  .brand { font-size: 13px; font-weight: 700; color: #2a78d6; letter-spacing: 0.4px; margin-bottom: 8px; }
  .stepper { display: flex; align-items: center; gap: 6px; margin-bottom: 14px; }
  .step {
    flex: 1; text-align: center; padding: 6px 4px; border-radius: 6px; font-size: 12px; font-weight: 600;
    background: #e3e8f0; color: #8a94a6; transition: background 0.3s, color 0.3s;
  }
  .step.done { background: #0ca30c; color: #fff; }
  .step.active { background: #2a78d6; color: #fff; }
  .prompt-text { font-size: 13px; font-weight: 600; color: #14213d; margin-bottom: 8px; min-height: 18px; }
  .prompt-controls { display: flex; align-items: center; gap: 8px; flex-wrap: wrap; min-height: 36px; }
  .prompt-controls button {
    background: #14213d; color: #fff; border: none; border-radius: 6px;
    padding: 8px 16px; font-size: 13px; font-weight: 700; cursor: pointer;
  }
  .prompt-controls input {
    padding: 8px 10px; border: 1px solid #ccc; border-radius: 6px; font-size: 13px; min-width: 260px;
  }
  .working { font-size: 13px; color: #8a94a6; font-style: italic; }
  .log {
    font-size: 12px; color: #555; margin-top: 10px; font-family: Consolas, monospace;
    line-height: 1.5; max-height: 60px; overflow: hidden; white-space: pre-line;
  }
</style>
</head>
<body>
  <div class="brand">AGENTE F1 · PANEL DE CONTROL</div>
  <div class="stepper" id="stepper"></div>
  <div class="prompt-text" id="prompt-text"></div>
  <div class="prompt-controls" id="prompt-controls">
    <span class="working">Esperando conexión...</span>
  </div>
  <div class="log" id="log"></div>

  <script>
    const stepperEl = document.getElementById('stepper');
    const promptTextEl = document.getElementById('prompt-text');
    const promptControlsEl = document.getElementById('prompt-controls');
    const logEl = document.getElementById('log');
    const logLines = [];

    function renderSteps(steps) {
      stepperEl.innerHTML = '';
      for (const step of steps) {
        const div = document.createElement('div');
        div.className = 'step ' + step.state;
        div.textContent = step.label;
        stepperEl.appendChild(div);
      }
    }

    function sendAnswer(id, value) {
      fetch('/answer', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ id, value })
      });
      promptTextEl.textContent = '';
      promptControlsEl.innerHTML = '<span class="working">Trabajando...</span>';
    }

    function renderPrompt(prompt) {
      promptTextEl.textContent = prompt.text;
      promptControlsEl.innerHTML = '';
      if (prompt.kind === 'buttons') {
        for (const option of prompt.options) {
          const btn = document.createElement('button');
          btn.textContent = option.label;
          btn.onclick = () => sendAnswer(prompt.id, option.value);
          promptControlsEl.appendChild(btn);
        }
      } else if (prompt.kind === 'text') {
        const input = document.createElement('input');
        input.type = 'text';
        if (prompt.placeholder) input.placeholder = prompt.placeholder;
        const btn = document.createElement('button');
        btn.textContent = 'Enviar';
        btn.onclick = () => sendAnswer(prompt.id, input.value);
        input.addEventListener('keydown', (e) => { if (e.key === 'Enter') btn.click(); });
        promptControlsEl.appendChild(input);
        promptControlsEl.appendChild(btn);
        input.focus();
      }
    }

    function appendLog(message) {
      logLines.push(message);
      while (logLines.length > 6) logLines.shift();
      logEl.textContent = logLines.join('\n');
    }

    const events = new EventSource('/events');
    events.addEventListener('step', (e) => renderSteps(JSON.parse(e.data).steps));
    events.addEventListener('prompt', (e) => renderPrompt(JSON.parse(e.data)));
    events.addEventListener('log', (e) => appendLog(JSON.parse(e.data).message));
  </script>
</body>
</html>
```

- [ ] **Step 3: Verificar manualmente con un script descartable**

Crear un archivo temporal `scripts/_verify-demo-server.mjs` (se borra al final de este step, no se commitea):

```javascript
import http from 'node:http';
import { createDemoServer } from './demo-server.js';

const { app } = createDemoServer();
const server = http.createServer(app);
server.listen(0, async () => {
  const port = server.address().port;

  const panelRes = await fetch(`http://localhost:${port}/panel`);
  const html = await panelRes.text();
  console.log('GET /panel devuelve 200:', panelRes.status === 200);
  console.log('El HTML contiene "PANEL DE CONTROL":', html.includes('PANEL DE CONTROL'));

  const answerRes = await fetch(`http://localhost:${port}/answer`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ id: 'no-existe', value: 'x' })
  });
  console.log('POST /answer con id inexistente devuelve 409:', answerRes.status === 409);

  server.close();
});
```

Run: `cd "C:\Esteban CFOTech\Agente Accesibilidad" && node scripts/_verify-demo-server.mjs`
Expected: las 3 líneas impresas dicen `true`.

Después de confirmar, borrar el archivo: `rm scripts/_verify-demo-server.mjs`.

- [ ] **Step 4: Commit**

```bash
git add scripts/demo-server.js scripts/demo-panel.html
git commit -m "feat: add the Express + SSE server and page for the demo control panel"
```

---

## Task 4: Integrar el panel en `demo.js` — reemplazar `readline` por el panel, y las 2 ventanas posicionadas

**Files:**
- Modify: `scripts/demo.js` (reemplazo casi total del archivo)

**Interfaces:**
- Consumes: `createDemoServer` (Task 3), `computeWindowLayout` (Task 2).
- Sin tests automatizados (Global Constraints) — se verifica corriendo la demo real en el Step 2.

- [ ] **Step 1: Reemplazar el contenido completo de `scripts/demo.js`**

Leé primero el archivo actual para confirmar que no cambió desde que se escribió este plan (debería tener los mismos 6 pasos y las mismas funciones `highlightOnPage`/`serveDirectory` sin modificar). Reemplazar **todo el contenido del archivo** por:

```javascript
import 'dotenv/config';
import path from 'node:path';
import http from 'node:http';
import { readFile } from 'node:fs/promises';
import Anthropic from '@anthropic-ai/sdk';
import { chromium } from 'playwright';
import { log as crawleeLog, LogLevel } from 'crawlee';
import { scanUrl } from '../src/scanner.js';
import { crawlSite } from '../src/discovery/crawl-site.js';

// crawlee imprime sus propios logs INFO ("Starting the crawler", stats de requests) - se ven
// técnicos para una demo de audiencia C-level. No se toca crawl-site.js (código de producción,
// ese logging es útil ahí); acá es solo cosmética de presentación.
crawleeLog.setLevel(LogLevel.OFF);
import { classifyFindings } from '../src/classification/classify-findings.js';
import { calculateScore } from '../src/classification/calculate-score.js';
import { runVisualAudit } from '../src/visual-review/visual-audit.js';
import { runUxComplianceReview } from '../src/visual-review/ux-compliance-review.js';
import { generateDeliverable } from '../src/reporter/generate-deliverable.js';
import { resolveTargetUrl, resolveReferenceSiteUrl, REFERENCE_SITES } from './demo-site-selection.js';
import { resolveAdditionalPageCount } from './demo-page-selection.js';
import { isLocalPath, listHtmlFiles, toFileUrl } from './demo-local-source.js';
import { buildHighlightTargets, buildBadgeText } from './demo-highlight.js';
import { createDemoServer } from './demo-server.js';
import { computeWindowLayout } from './demo-window-layout.js';

// Con 10 páginas el crawl real tardó ~29s en pruebas en vivo (sin ningún aviso, se puede
// confundir con que la demo se colgó) - se recorta a 6 para que el paso 1 quede en ~15-20s.
const MAX_PAGES_TO_DISCOVER = 6;

// Validado visualmente en un spike real contra la pantalla del presentador - ver
// docs/superpowers/specs/2026-09-23-demo-panel-design.md antes de cambiar este valor.
const PANEL_HEIGHT = 260;

/**
 * Demo guionada para audiencia C-level: pasos fijos y controlados por el presentador (no el
 * loop autónomo del agente, que decide su propio flujo - acá queremos previsibilidad). El
 * control (selección de opciones + ver los 6 pasos avanzar) es el panel web; esta función solo
 * imprime el banner en la terminal como respaldo/debug y le avisa al panel qué paso está activo.
 */
function header(n, title, pushStep) {
  const line = '─'.repeat(60);
  console.log(`\n${line}\nPASO ${n}: ${title}\n${line}`);
  pushStep(n);
}

/**
 * CDP necesita 2 llamadas separadas: la primera fuerza windowState:'normal' (sin esto, una sola
 * llamada combinada con bounds reales fue silenciosamente ignorada en la práctica - CDP
 * respondía OK pero la ventana no cambiaba de tamaño en pantalla). Ver la spec para el detalle.
 */
async function setWindowBounds(page, bounds) {
  const client = await page.context().newCDPSession(page);
  const { windowId } = await client.send('Browser.getWindowForTarget');
  await client.send('Browser.setWindowBounds', { windowId, bounds: { windowState: 'normal' } });
  await client.send('Browser.setWindowBounds', { windowId, bounds });
}

async function highlightOnPage(page, violations) {
  const targets = buildHighlightTargets(violations);
  const badgeText = buildBadgeText(violations);
  await page.evaluate(({ targets, badgeText }) => {
    for (const t of targets) {
      const el = document.querySelector(t.selector);
      if (!el) continue;
      el.style.outline = `4px solid ${t.color}`;
      el.style.outlineOffset = '2px';
      el.title = t.label;
    }
    const badge = document.createElement('div');
    badge.textContent = badgeText;
    Object.assign(badge.style, {
      position: 'fixed', top: '16px', right: '16px', zIndex: 999999,
      background: '#14213d', color: '#fff', padding: '10px 16px', borderRadius: '8px',
      fontFamily: 'sans-serif', fontSize: '14px', fontWeight: '600',
      boxShadow: '0 4px 12px rgba(0,0,0,0.3)'
    });
    document.body.appendChild(badge);
  }, { targets, badgeText });
}

function serveDirectory(rootDir) {
  return http.createServer(async (req, res) => {
    const filePath = path.join(rootDir, req.url === '/' ? 'dashboard.html' : req.url);
    try {
      const data = await readFile(filePath);
      res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
      res.end(data);
    } catch {
      res.writeHead(404);
      res.end('No encontrado');
    }
  });
}

async function main() {
  if (!process.env.ANTHROPIC_API_KEY) {
    console.error('Falta ANTHROPIC_API_KEY en el entorno - la demo necesita llamar a Claude para los pasos 4 y 5.');
    process.exit(1);
  }

  const { app, askPanel, pushStep, pushLog, cancelPending } = createDemoServer();
  const controlServer = http.createServer(app);
  await new Promise((resolve) => controlServer.listen(0, resolve));
  const { port: controlPort } = controlServer.address();

  const panelBrowser = await chromium.launch({ headless: false });
  const panelPage = await (await panelBrowser.newContext({ viewport: null })).newPage();
  await panelPage.goto(`http://localhost:${controlPort}/panel`);

  const { width: screenWidth, height: screenHeight } = await panelPage.evaluate(() => ({
    width: window.screen.width,
    height: window.screen.height
  }));
  const layout = computeWindowLayout(screenWidth, screenHeight, PANEL_HEIGHT);
  await setWindowBounds(panelPage, layout.panel);
  pushStep(0);

  const browser = await chromium.launch({ headless: false });
  const context = await browser.newContext({ viewport: null });
  const page = await context.newPage();
  await setWindowBounds(page, layout.test);

  panelBrowser.on('disconnected', () => cancelPending(new Error('Se cerró la ventana del panel')));
  browser.on('disconnected', () => cancelPending(new Error('Se cerró el navegador de prueba')));

  console.log('=== Demo: Agente F1 de Compliance de Accesibilidad ===');
  const choice = await askPanel({
    kind: 'buttons',
    text: 'Elegí cómo vas a auditar',
    options: [
      { label: 'Sitio de referencia', value: '1' },
      { label: 'Sitio del cliente', value: '2' },
      { label: 'Otra URL o carpeta local', value: '3' }
    ]
  });

  let customInput;
  let referenceSiteUrl;
  if (choice === '1') {
    const subChoice = await askPanel({
      kind: 'buttons',
      text: 'Elegí un sitio de referencia',
      options: REFERENCE_SITES.map((site, i) => ({ label: site.label, value: String(i + 1) }))
    });
    referenceSiteUrl = resolveReferenceSiteUrl(subChoice);
  } else if (['2', '3'].includes(choice)) {
    customInput = await askPanel({
      kind: 'text',
      text: 'Pegá la URL o el path de una carpeta local',
      placeholder: 'https://... o C:\\...'
    });
  }

  const anthropicClient = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });
  const jobId = `demo-${Date.now()}`;
  const outputDir = path.join('./reports', jobId);

  header(1, 'Descubrir', pushStep);
  let pagesToAudit;

  if (choice === '3' && isLocalPath(customInput)) {
    console.log(`Buscando archivos .html en: ${customInput}`);
    const htmlFiles = await listHtmlFiles(customInput);
    console.log(`Se encontraron ${htmlFiles.length} archivo(s) .html:`);
    htmlFiles.forEach((f, i) => console.log(`  ${i + 1}) ${f}`));
    pushLog(`Se encontraron ${htmlFiles.length} archivo(s) .html en ${customInput}`);

    const mainUrl = toFileUrl(htmlFiles[0]);
    const rest = htmlFiles.slice(1).map(toFileUrl);
    if (rest.length > 0) {
      const answer = await askPanel({
        kind: 'text',
        text: `¿Cuántos de estos querés auditar además del primero? (0-${rest.length})`,
        placeholder: '0'
      });
      const additionalCount = resolveAdditionalPageCount(answer, rest.length);
      pagesToAudit = [mainUrl, ...rest.slice(0, additionalCount)];
    } else {
      pagesToAudit = [mainUrl];
    }
  } else {
    const targetUrl = choice === '1' ? referenceSiteUrl : resolveTargetUrl(choice, customInput);
    console.log(`Recorriendo el sitio desde: ${targetUrl}`);
    console.log('(Esto puede tardar unos 25-30 segundos reales - el agente está navegando el sitio de verdad, no es un valor simulado.)');
    pushLog(`Recorriendo el sitio desde: ${targetUrl}`);
    let discoveredUrls = [];
    try {
      discoveredUrls = await crawlSite(targetUrl, { maxUrls: MAX_PAGES_TO_DISCOVER });
    } catch (error) {
      console.log(`No se pudo recorrer el sitio automáticamente (${error.message}) - se sigue solo con la página principal.`);
      pushLog('No se pudo recorrer el sitio automáticamente - se sigue solo con la página principal.');
    }
    const subpages = discoveredUrls.filter((url) => url !== targetUrl);

    pagesToAudit = [targetUrl];
    if (subpages.length > 0) {
      console.log(`Se encontraron ${subpages.length} subpágina(s) además de la principal:`);
      subpages.forEach((url, i) => console.log(`  ${i + 1}) ${url}`));
      pushLog(`Se encontraron ${subpages.length} subpágina(s) además de la principal.`);
      const answer = await askPanel({
        kind: 'text',
        text: `¿Cuántas de estas querés auditar además de la principal? (0-${subpages.length})`,
        placeholder: '0'
      });
      const additionalCount = resolveAdditionalPageCount(answer, subpages.length);
      pagesToAudit = [targetUrl, ...subpages.slice(0, additionalCount)];
    } else {
      console.log('No se encontraron subpáginas adicionales (o el sitio no permitió recorrerlo) - se sigue solo con la página principal.');
      pushLog('No se encontraron subpáginas adicionales - se sigue solo con la página principal.');
    }
  }

  console.log(`\nSe van a auditar ${pagesToAudit.length} página(s) en total.`);
  pushLog(`Se van a auditar ${pagesToAudit.length} página(s) en total.`);
  await askPanel({
    kind: 'buttons',
    text: 'Escanear cada página con el motor de accesibilidad',
    options: [{ label: 'Siguiente paso →', value: 'continue' }]
  });

  header(2, 'Escanear', pushStep);
  const axeResults = [];
  for (const url of pagesToAudit) {
    console.log(`\nEscaneando: ${url}`);
    pushLog(`Escaneando: ${url}`);
    // waitFor:'load' en vez del default 'networkidle' - varios sitios reales (analytics, chat
    // widgets, polling) nunca llegan a red inactiva y cuelgan el escaneo en una demo en vivo.
    const axeResult = await scanUrl({ url, captureScreenshot: true, captureHtml: true, waitFor: 'load' });
    console.log(`  ${axeResult.violation_count} problema(s) técnico(s) detectado(s), ${axeResult.pass_count} chequeo(s) aprobado(s).`);
    pushLog(`  ${axeResult.violation_count} problema(s) detectado(s), ${axeResult.pass_count} chequeo(s) aprobado(s).`);
    await page.goto(url, { waitUntil: 'domcontentloaded' });
    await highlightOnPage(page, axeResult.violations);
    await page.waitForTimeout(1200);
    axeResults.push(axeResult);
  }
  console.log('\nLos problemas quedaron marcados directamente sobre cada página (rojo = crítico, naranja = serio, amarillo = moderado).');
  await askPanel({
    kind: 'buttons',
    text: 'Clasificar los hallazgos contra la normativa argentina (ONTI/BCRA)',
    options: [{ label: 'Siguiente paso →', value: 'continue' }]
  });

  header(3, 'Clasificar contra ONTI/BCRA', pushStep);
  const { findings } = classifyFindings(axeResults);
  const scores = calculateScore(findings, { axeResults });
  console.log(`Páginas evaluadas: ${scores.summary.total_urls_evaluated}. Criterios ONTI evaluados: ${scores.summary.onti_criteria_evaluated}. Conformes: ${scores.summary.onti_criteria_compliant}. Score: ${scores.summary.onti_compliance_percentage}%.`);
  pushLog(`Criterios ONTI evaluados: ${scores.summary.onti_criteria_evaluated}. Conformes: ${scores.summary.onti_criteria_compliant}. Score: ${scores.summary.onti_compliance_percentage}%.`);
  await askPanel({
    kind: 'buttons',
    text: 'Revisión visual con inteligencia artificial (contraste, spacing, touch targets)',
    options: [{ label: 'Siguiente paso →', value: 'continue' }]
  });

  header(4, 'Revisión visual con IA', pushStep);
  const visualFindings = [];
  for (const axeResult of axeResults) {
    console.log(`\nMandando la captura de ${axeResult.url} a la IA (esto puede tardar unos segundos)...`);
    pushLog(`Mandando la captura de ${axeResult.url} a la IA...`);
    const { visual_findings } = await runVisualAudit({ url: axeResult.url, screenshot: axeResult.screenshot }, { anthropicClient });
    console.log(`  ${visual_findings.length} hallazgo(s) visual(es) adicional(es).`);
    pushLog(`  ${visual_findings.length} hallazgo(s) visual(es) adicional(es).`);
    for (const f of visual_findings.slice(0, 3)) console.log(`    • [${f.severity}] ${f.failure_summary}`);
    visualFindings.push(...visual_findings);
  }
  await askPanel({
    kind: 'buttons',
    text: 'Revisión de experiencia de usuario con IA',
    options: [{ label: 'Siguiente paso →', value: 'continue' }]
  });

  header(5, 'Revisión de UX con IA', pushStep);
  const uxFindings = [];
  for (const axeResult of axeResults) {
    console.log(`\nMandando el HTML de ${axeResult.url} a la IA...`);
    pushLog(`Mandando el HTML de ${axeResult.url} a la IA...`);
    const { ux_findings } = await runUxComplianceReview({ url: axeResult.url, html: axeResult.html }, { anthropicClient });
    console.log(`  ${ux_findings.length} hallazgo(s) de experiencia de usuario adicional(es).`);
    pushLog(`  ${ux_findings.length} hallazgo(s) de experiencia de usuario adicional(es).`);
    for (const f of ux_findings.slice(0, 3)) console.log(`    • [${f.severity}] ${f.failure_summary}`);
    uxFindings.push(...ux_findings);
  }
  await askPanel({
    kind: 'buttons',
    text: 'Generar el dashboard ejecutivo final',
    options: [{ label: 'Siguiente paso →', value: 'continue' }]
  });

  header(6, 'Generar el dashboard ejecutivo', pushStep);
  const allFindings = [...findings, ...visualFindings, ...uxFindings];
  const finalScores = calculateScore(allFindings, { axeResults });
  const [dashboardPath] = await generateDeliverable(
    'dashboard',
    { jobId, channel: 'demo', scores: finalScores, findings: allFindings },
    { outputDir }
  );
  console.log(`Dashboard generado en: ${dashboardPath}`);
  pushLog('Dashboard ejecutivo generado.');
  pushStep(7);

  const dashboardServer = serveDirectory(outputDir);
  await new Promise((resolve) => dashboardServer.listen(0, resolve));
  const { port: dashboardPort } = dashboardServer.address();

  const dashboardTab = await context.newPage();
  await dashboardTab.goto(`http://localhost:${dashboardPort}/`);
  console.log('\nDashboard abierto en el navegador. Esta es la vista que recibiría el directorio.');

  await askPanel({
    kind: 'buttons',
    text: 'Demo terminada',
    options: [{ label: 'Cerrar demo', value: 'close' }]
  });

  dashboardServer.close();
  controlServer.close();
  await panelBrowser.close();
  await browser.close();
}

main().catch((error) => {
  console.error('\nLa demo se interrumpió por un error:', error.message);
  process.exit(1);
});
```

- [ ] **Step 2: Verificar corriendo la demo real**

Run: `npm run demo`

Checklist a confirmar en pantalla (mismo criterio que el spike ya validado, pero ahora integrado):
- Se abren 2 ventanas de Chrome: una franja arriba (panel, con el título "AGENTE F1 · PANEL DE CONTROL" y el stepper de 6 pasos) y el navegador de prueba justo debajo, sin superponerse.
- El primer prompt ("Elegí cómo vas a auditar") aparece como 3 botones en el panel; elegir "Sitio de referencia" muestra el submenú de los 3 sitios como botones.
- El stepper va marcando cada paso como activo (azul) y después como hecho (verde) a medida que avanza la demo real.
- Los logs de escaneo/hallazgos aparecen en la línea de log del panel, no solo en la terminal.
- Al final, el dashboard se abre como una pestaña nueva en la ventana de ABAJO (el navegador de prueba), no en el panel.
- Cerrar la ventana del panel a mitad de un prompt hace que la terminal muestre el mensaje de error ("Se cerró la ventana del panel") y el proceso termine, en vez de quedarse colgado para siempre.

Si algo de esto no se cumple, no marcar el step como completo - corregir antes de seguir.

- [ ] **Step 3: Correr la suite completa del repo**

Run: `npm test`
Expected: todos los tests PASAN (esta tarea no agrega tests nuevos, pero no debe romper ninguno existente).

- [ ] **Step 4: Commit**

```bash
git add scripts/demo.js
git commit -m "feat: control the demo from the web panel instead of the terminal"
```

---

## Nota final para quien ejecute este plan

Antes de dar por cerrado el plan, actualizar la memoria del proyecto con este cambio (nuevo flujo de demo, los 2 bugs de Playwright/CDP encontrados en el spike, y que la demo ahora depende de `scripts/demo-server.js`/`demo-panel.html` además de los módulos de `demo-site-selection.js` ya existentes).
