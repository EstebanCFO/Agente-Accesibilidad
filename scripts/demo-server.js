import express from 'express';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createPromptBroker } from './demo-prompt-broker.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

// Etiquetas cortas y numeradas: a 1024px de ancho las largas se partían en dos líneas desparejas.
// Paso 1 = configuración + selección de páginas; paso 2 = auditoría en vivo (sin pausas, las
// estaciones de la pantalla muestran el avance); paso 3 = resumen ejecutivo.
export const STEP_LABELS = ['Relevar páginas', 'Auditoría en vivo', 'Resumen'];

const MAX_LOG_REPLAY = 60;

export class DemoCancelledError extends Error {
  constructor() {
    super('Auditoría cancelada por el presentador');
    this.name = 'DemoCancelledError';
  }
}

export function createDemoServer() {
  const app = express();
  app.use(express.json());
  const broker = createPromptBroker();
  const sseClients = new Set();

  // Último estado conocido: si el panel se conecta tarde o se recarga, se le re-envía todo
  // (antes, un evento emitido antes de que abriera el EventSource se perdía para siempre).
  const state = { step: null, prompt: null, progress: null, results: {}, logs: [], error: null, cancelled: false, stage: null, run: null };

  function writeFrame(res, type, data) {
    res.write(`event: ${type}\ndata: ${JSON.stringify(data)}\n\n`);
  }

  function pushEvent(type, data) {
    for (const res of sseClients) writeFrame(res, type, data);
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

    if (state.step) writeFrame(res, 'step', state.step);
    for (const entry of state.logs) writeFrame(res, 'log', entry);
    for (const card of Object.values(state.results)) writeFrame(res, 'result', card);
    if (state.progress) writeFrame(res, 'progress', state.progress);
    if (state.error) writeFrame(res, 'failure', state.error);
    if (state.stage) writeFrame(res, 'stage', state.stage);
    if (state.run) writeFrame(res, 'run', state.run);
    if (state.prompt) writeFrame(res, 'prompt', state.prompt);
  });

  app.post('/answer', (req, res) => {
    const { id, value } = req.body ?? {};
    const ok = broker.answer(id, value);
    if (ok) state.prompt = null;
    res.status(ok ? 200 : 409).json({ ok });
  });

  // Botón "Analizar sitio" del formulario: recorre la URL y devuelve sus páginas para elegir
  // cuáles auditar. La lógica real (crawl + caché) la inyecta demo.js.
  // Responde NDJSON (una línea JSON por evento) para que el panel muestre el avance:
  // { type: 'page', url } por cada página apenas se descubre, y al final
  // { type: 'done', ok: true, total, urls } o { type: 'error', ok: false, error }.
  let discoverHandler = null;
  app.post('/discover', async (req, res) => {
    const url = String(req.body?.url ?? '').trim();
    if (!discoverHandler || !/^https?:\/\/\S+$/i.test(url)) {
      res.status(400).json({ ok: false, error: 'URL inválida' });
      return;
    }
    res.writeHead(200, { 'Content-Type': 'application/x-ndjson; charset=utf-8', 'Cache-Control': 'no-cache' });
    // Si el panel se cierra a mitad del recorrido, el crawl sigue (queda en caché) pero no se escribe más.
    const send = (event) => { if (!res.writableEnded && !res.destroyed) res.write(`${JSON.stringify(event)}\n`); };
    try {
      const { urls } = await discoverHandler(url, (page) => send({ type: 'page', url: page }));
      send({ type: 'done', ok: true, total: urls.length, urls });
    } catch (error) {
      send({ type: 'error', ok: false, error: error.message });
    }
    res.end();
  });

  function setDiscoverHandler(handler) {
    discoverHandler = handler;
  }

  // Tilde verde/rojo al lado del campo URL: ¿se puede escanear y el sitio lo admite?
  // La lógica real (checkScannable) la inyecta demo.js.
  let checkHandler = null;
  app.post('/check-url', async (req, res) => {
    const url = String(req.body?.url ?? '').trim();
    if (!checkHandler) {
      res.status(503).json({ ok: false, reason: 'Validación no disponible' });
      return;
    }
    res.json(await checkHandler(url));
  });
  function setCheckHandler(handler) {
    checkHandler = handler;
  }

  // Vista previa del sitio a escanear, embebida en el formulario (captura headless: los sitios
  // que prohíben ser mostrados en un iframe igual se ven, y funciona también con carpetas locales).
  let previewHandler = null;
  app.post('/preview', async (req, res) => {
    if (!previewHandler) {
      res.status(503).json({ ok: false, error: 'Vista previa no disponible' });
      return;
    }
    try {
      const preview = await previewHandler(req.body ?? {});
      res.json({ ok: true, ...preview });
    } catch (error) {
      res.status(502).json({ ok: false, error: error.message });
    }
  });
  function setPreviewHandler(handler) {
    previewHandler = handler;
  }

  // Informes de la auditoría servidos por el mismo panel, para embeberlos sin abrir otra ventana.
  let reportsDir = null;
  app.use('/informes', (req, res, next) => (reportsDir ? express.static(reportsDir)(req, res, next) : next()));
  function serveReports(dir) {
    reportsDir = dir;
  }

  app.post('/cancel', (req, res) => {
    if (!state.cancelled) {
      state.cancelled = true;
      broker.cancelPending(new DemoCancelledError());
      pushLog('Cancelación solicitada: se detiene al terminar la página en curso.', 'warn');
    }
    res.json({ ok: true });
  });

  /** allowAfterCancel: solo para el mensaje final ("Auditoría cancelada · Cerrar demo"). */
  async function askPanel(spec, { allowAfterCancel = false } = {}) {
    if (!allowAfterCancel) throwIfCancelled();
    const { id, promise } = broker.ask();
    state.prompt = { id, ...spec };
    state.progress = null;
    pushEvent('prompt', state.prompt);
    return promise;
  }

  /** Marca el paso activo. skippedSteps: números de paso desactivados en la configuración. */
  function pushStep(activeStepNumber, { skippedSteps = [], failed = false } = {}) {
    const steps = STEP_LABELS.map((label, i) => {
      const n = i + 1;
      let status = n < activeStepNumber ? 'done' : n === activeStepNumber ? 'active' : 'pending';
      if (skippedSteps.includes(n) && status !== 'active') status = 'skipped';
      if (failed && n === activeStepNumber) status = 'failed';
      return { number: n, label, state: status };
    });
    state.step = { steps, active: activeStepNumber };
    pushEvent('step', state.step);
  }

  function pushLog(message, level = 'info') {
    const entry = { message, level, at: new Date().toISOString() };
    state.logs.push(entry);
    if (state.logs.length > MAX_LOG_REPLAY) state.logs.shift();
    pushEvent('log', entry);
  }

  /** Barra de avance: "Escaneando página 2 de 3". */
  function pushProgress(label, current, total) {
    state.progress = { label, current, total };
    pushEvent('progress', state.progress);
  }

  /** Tarjeta de resultado parcial (se reemplaza por key). */
  function pushResult(card) {
    if (!card) return;
    state.results[card.key] = card;
    pushEvent('result', card);
  }

  /** Área de visualización debajo del paso: { type: 'image'|'frame'|'clear', src, caption }. */
  function pushStage(stage) {
    state.stage = stage?.type === 'clear' ? null : stage;
    pushEvent('stage', stage);
  }

  /** Pantalla en vivo: { target, stations, summary, downloads? } (ver demo-summary.js). */
  function pushRun(run) {
    state.run = run;
    state.progress = null;
    pushEvent('run', run);
  }

  function pushFailure(message, hint) {
    state.error = { message, hint };
    pushEvent('failure', state.error);
  }

  function throwIfCancelled() {
    if (state.cancelled) throw new DemoCancelledError();
  }

  /** Sin panel no hay quién conteste: se corta la pregunta en curso y también las siguientes. */
  function cancelPending(reason) {
    state.cancelled = true;
    broker.cancelPending(reason);
  }

  return { app, askPanel, pushStep, pushLog, pushProgress, pushResult, pushFailure, throwIfCancelled, cancelPending, setDiscoverHandler, setCheckHandler, setPreviewHandler, serveReports, pushStage, pushRun };
}
