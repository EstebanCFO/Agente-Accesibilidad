import 'dotenv/config';
import path from 'node:path';
import http from 'node:http';
import { writeFile, mkdir } from 'node:fs/promises';
import Anthropic from '@anthropic-ai/sdk';
import { chromium } from 'playwright';
import { log as crawleeLog, LogLevel } from 'crawlee';
import { scanUrl } from '../src/scanner.js';
import { crawlSite } from '../src/discovery/crawl-site.js';
import { createSiteDiscovery } from './demo-discovery.js';
import { checkScannable } from '../src/discovery/check-scannable.js';

// crawlee imprime sus propios logs INFO ("Starting the crawler", stats de requests) - se ven
// técnicos para una demo de audiencia C-level. No se toca crawl-site.js (código de producción,
// ese logging es útil ahí); acá es solo cosmética de presentación.
crawleeLog.setLevel(LogLevel.OFF);
import { classifyFindings } from '../src/classification/classify-findings.js';
import { calculateScore } from '../src/classification/calculate-score.js';
import { computeWcagSection } from '../src/classification/wcag-section.js';
import { runKeyboardReview } from '../src/keyboard/keyboard-review.js';
import { buildKeyboardCriteria, KEYBOARD_CRITERIA } from '../src/keyboard/keyboard-criteria.js';
import { generateDeliverable } from '../src/reporter/generate-deliverable.js';
import { emptyUsage, addUsage, totalTokens, resolvePricing, estimateCostUsd, PRICING_SOURCE_DATE } from '../src/ai/usage-cost.js';
import { resolveSelectedPages } from './demo-page-selection.js';
import { buildConfigFields, buildConfigSummary, defaultConfigValues, validateDemoConfig, previewTarget, MAX_PAGES_LIMIT } from './demo-config.js';
import { isWcagViolation, formatPageCompliance } from './demo-results.js';
import { createLimiter } from './demo-concurrency.js';
import { buildRunSummary, buildStations, shortUrl } from './demo-summary.js';
import { buildReportViewerHtml } from './demo-report-viewer.js';
import { isLocalPath, listHtmlFiles, toFileUrl } from './demo-local-source.js';
import { buildHighlightTargets, buildBadgeText } from './demo-highlight.js';
import { createDemoServer, DemoCancelledError } from './demo-server.js';


/**
 * Demo guionada para audiencia C-level (no el loop autónomo del agente: acá queremos
 * previsibilidad). El presentador configura y elige las páginas; después la auditoría corre
 * sola en una pantalla en vivo que termina convertida en el resumen ejecutivo. Esta función solo
 * imprime el banner en la terminal como respaldo/debug.
 */
function header(n, title) {
  const line = '─'.repeat(60);
  console.log(`\n${line}\nPASO ${n}: ${title}\n${line}`);
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

// El informe se acota a dos entregables: Inventario de hallazgos y Matriz de criticidad; el PDF
// los consolida. El Score de cumplimiento inicial (dashboard.html) ya no se genera; sí sus datos
// (score-compliance.json). Además se genera el VPAT 2.5 (edición WCAG) en su propio PDF.
const DELIVERABLES = [
  { type: 'score', label: 'Score de cumplimiento (datos)' },
  { type: 'inventario', key: 'inventario', label: 'Inventario de hallazgos', open: 'inventario-hallazgos.html' },
  { type: 'matriz', key: 'matriz', label: 'Matriz de criticidad WCAG 2.0 AA', open: 'matriz-criticidad.html' },
  { type: 'informe-pdf', key: 'pdf', label: 'Informe PDF consolidado', open: 'informe-consolidado.pdf' },
  { type: 'vpat', key: 'vpat', label: 'VPAT_Informe De Accesibilidad', open: 'VPAT_Informe De Accesibilidad.pdf' }
];

/** Mensaje corto y legible para la audiencia (sin JSON crudo de la API ni stack traces). */
function friendlyError(error) {
  if (error?.status === 401) return 'la clave de la API de IA no es válida';
  if (error?.status === 429) return 'la API de IA está saturada, reintentá en unos minutos';
  if (error?.status >= 500) return 'el servicio de IA no respondió';
  if (/net::ERR_|Timeout \d+ms exceeded/.test(String(error?.message))) return 'el sitio no respondió (revisá la URL o la conexión)';
  if (error?.code === 'ENOENT') return `no se encontró la ruta ${error.path ?? ''}`.trim();
  if (error?.code === 'EACCES') return `no hay permiso para leer ${error.path ?? 'la ruta'}`;
  const firstLine = String(error?.message ?? error).split('\n')[0];
  return firstLine.length > 140 ? firstLine.slice(0, 137) + '…' : firstLine;
}


// "Analizar sitio" y el paso 1 comparten el recorrido (con caché): ver demo-discovery.js.
const discoverSite = createSiteDiscovery(crawlSite, { maxPages: MAX_PAGES_LIMIT });

/** Formulario → resumen → (volver) hasta tener una config válida confirmada. */
async function configure(ui, formValues) {
  let values = formValues;
  let errors = {};
  while (true) {
    const raw = await ui.askPanel({
      kind: 'config',
      text: 'Configurá la auditoría',
      subtitle: 'Definí qué auditar y con qué alcance. Debajo ves una vista previa de lo que se va a escanear.',
      fields: buildConfigFields(values),
      errors,
      submitLabel: 'Continuar'
    });
    values = { ...values, ...raw };
    const result = validateDemoConfig(values);
    if (!result.config) {
      errors = result.errors;
      continue;
    }
    return { config: result.config, values };
  }
}

/**
 * Paso 1: arma la lista de páginas y la muestra con casillas junto con la configuración elegida
 * (reemplaza al resumen previo). null = volver a configurar.
 */
async function discoverPages(ui, config) {
  let mainUrl;
  let candidates = [];
  let preselected = null; // null = todas marcadas

  if (config.source === 'local' || isLocalPath(config.target)) {
    ui.pushProgress(`Buscando archivos .html en ${config.target}`);
    const htmlFiles = await listHtmlFiles(config.target);
    if (htmlFiles.length === 0) throw new Error(`No se encontraron archivos .html en ${config.target}`);
    const urls = htmlFiles.slice(0, config.maxPages ?? htmlFiles.length).map(toFileUrl);
    [mainUrl, ...candidates] = urls;
    ui.pushLog(`Se encontraron ${htmlFiles.length} archivo(s) .html.`, 'ok');
  } else {
    // URL del cliente o sitio de referencia: se muestran las páginas que encontró "Analizar sitio"
    // (marcadas las elegidas en el formulario). Sin análisis previo, solo la principal.
    mainUrl = config.target;
    if (discoverSite.has(mainUrl) || config.selectedPages.length > 0) {
      try {
        candidates = (await discoverSite(mainUrl)).slice(1);
      } catch (error) {
        ui.pushLog(`No se pudo recuperar el análisis del sitio (${friendlyError(error)}). Se sigue solo con la principal.`, 'warn');
      }
    }
    preselected = new Set(config.selectedPages);
  }
  ui.throwIfCancelled();

  const answer = await ui.askPanel({
    kind: 'checklist',
    text: 'Elegí qué páginas auditar',
    summary: buildConfigSummary(config),
    items: [
      { value: mainUrl, label: shortUrl(mainUrl), checked: true, locked: true },
      ...candidates.map((url) => ({ value: url, label: shortUrl(url), checked: preselected ? preselected.has(url) : true }))
    ],
    submitLabel: 'Confirmar páginas',
    workingText: 'Escaneando…',
    backLabel: 'Volver a configurar'
  });
  if (answer?.action === 'back') return null;
  return resolveSelectedPages(mainUrl, candidates, answer?.selected);
}

// Llamadas simultáneas a la API de IA. 4 equilibra velocidad y límites de uso de la cuenta.
const AI_CONCURRENCY = Number(process.env.AI_CONCURRENCY) || 4;
const AI_MODEL = process.env.AI_MODEL || 'claude-sonnet-5';

/**
 * Pruebas de teclado del Agente: el recorrido con Tab ya se hizo durante el escaneo; la
 * interpretación con IA de cada página arranca apenas esa página termina de escanearse (hasta
 * AI_CONCURRENCY a la vez). Si la IA falla, se usan las reglas automáticas solas.
 */
function createKeyboardReviewer(ui, config, anthropicClient, onChange) {
  const pricing = resolvePricing(AI_MODEL, process.env);
  const limiter = createLimiter(AI_CONCURRENCY);
  const results = new Map();
  const done = [];
  let usage = emptyUsage();
  const setResult = (r, criteria, status) => {
    results.set(r.url, { url: r.url, criteria, status, consent_banner: r.keyboard?.consent_banner ?? null });
    onChange();
  };

  return {
    results,
    add(r) {
      if (!config.keyboardReview) return;
      const kb = r.keyboard;
      if (!kb) {
        setResult(r, buildKeyboardCriteria(null, { error: 'No se capturó el recorrido con teclado' }), 'done');
        return;
      }
      if (kb.consent_banner?.dismissed) ui.pushLog(`${shortUrl(r.url)}: se cerró un banner de cookies (${kb.consent_banner.action}) antes del recorrido con Tab.`);
      else if (kb.consent_banner?.detected) ui.pushLog(`${shortUrl(r.url)}: no se pudo cerrar el banner de cookies; el recorrido puede haber quedado dentro del banner.`, 'warn');
      if (kb.error || kb.stops.length === 0 || !kb.contact_sheet) {
        setResult(r, buildKeyboardCriteria(kb.error ? null : kb, { error: kb.error }), 'done');
        return;
      }
      done.push(limiter.run(() => runKeyboardReview({ url: r.url, keyboard: kb }, { anthropicClient, model: AI_MODEL })).then(({ ok, value, error }) => {
        if (ok) {
          usage = addUsage(usage, value.usage);
          setResult(r, buildKeyboardCriteria(kb, { ai: value.review }), 'done');
        } else {
          ui.pushLog(`Interpretación del Agente no disponible para ${shortUrl(r.url)}: ${friendlyError(error)}. Se usan las reglas automáticas.`, 'warn');
          setResult(r, buildKeyboardCriteria(kb, { aiFailed: true }), 'failed');
        }
        const con = KEYBOARD_CRITERIA.filter((c) => results.get(r.url).criteria[c.id].estado === 'con_indicios').length;
        ui.pushLog(`${shortUrl(r.url)}: teclado — ${con} de ${KEYBOARD_CRITERIA.length} criterios con indicios.`, con ? 'warn' : 'ok');
      }));
    },
    /** Espera todas las revisiones lanzadas (se llama después de terminar el escaneo). */
    async waitAll() {
      await Promise.all(done);
    },
    /** Resultados en el orden del escaneo (para los informes). */
    ordered(axeResults) {
      return axeResults.map((r) => results.get(r.url)).filter(Boolean);
    },
    usageInfo() {
      if (usage.calls === 0) return null;
      return { tokens: totalTokens(usage), calls: usage.calls, cost_usd: estimateCostUsd(usage, pricing) };
    },
    usageReport() {
      return {
        model: AI_MODEL,
        pricing_usd_per_mtok: pricing,
        pricing_source_date: PRICING_SOURCE_DATE,
        ...usage,
        total_tokens: totalTokens(usage),
        estimated_cost_usd: estimateCostUsd(usage, pricing),
        note: 'Costo estimado a partir de la tabla de precios pública; el valor facturado es el de la consola de Anthropic.'
      };
    }
  };
}

/**
 * Capturas para mostrar dentro del panel: abre la URL en un navegador invisible, opcionalmente
 * la prepara (ej: marcar problemas) y devuelve la captura como data URL JPEG. Caché por URL
 * para la vista previa (sin preparar) - no se vuelve a cargar el sitio si no cambió.
 */
function createStage(context) {
  const previews = new Map();
  async function shoot(url, prepare) {
    const page = await context.newPage();
    try {
      await page.goto(url, { waitUntil: 'load', timeout: 30000 });
      if (prepare) await prepare(page);
      await page.waitForTimeout(400);
      const buffer = await page.screenshot({ type: 'jpeg', quality: 70 });
      return `data:image/jpeg;base64,${buffer.toString('base64')}`;
    } finally {
      await page.close().catch(() => {});
    }
  }
  return {
    capture(url, prepare) {
      if (prepare) return shoot(url, prepare);
      if (!previews.has(url)) {
        previews.set(url, shoot(url).catch((error) => { previews.delete(url); throw error; }));
      }
      return previews.get(url);
    }
  };
}

async function runDemo(ui, { stage }) {
  let formValues = defaultConfigValues();
  let config;
  let pagesToAudit;

  // Paso 1: configurar, validar la URL y elegir páginas (se puede volver a configurar).
  while (true) {
    ui.goToStep(0);
    ui.pushStage({ type: 'clear' });
    ({ config, values: formValues } = await configure(ui, formValues));
    ui.goToStep(1, 'Relevar páginas');
    pagesToAudit = await discoverPages(ui, config);
    if (pagesToAudit) break;
  }

  // Paso 2: auditoría en vivo. Corre de punta a punta sin pausas: las estaciones de arriba
  // muestran el avance y los contadores de abajo se llenan con el resumen final.
  const anthropicClient = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });
  const jobId = `demo-${Date.now()}`;
  const outputDir = path.join('./reports', jobId);
  const wcagScope = { includeExtended: config.includeExtended };
  const pages = pagesToAudit.map((url) => ({ url, status: 'pending' }));
  let scanning = true;
  let reportsState = 'pending';
  let downloads = null;
  let keyboard = null;
  const publish = () => {
    const summary = buildRunSummary({
      pages, keyboardResults: keyboard.results, keyboardEnabled: config.keyboardReview,
      includeExtended: config.includeExtended, final: reportsState === 'done', usage: keyboard.usageInfo()
    });
    ui.pushRun({ target: shortUrl(config.target), stations: buildStations(summary, { scanning, reports: reportsState }), summary, downloads });
  };
  keyboard = createKeyboardReviewer(ui, config, anthropicClient, publish);

  ui.goToStep(2, 'Auditoría en vivo');
  ui.pushLog(`El agente revisa ${pages.length} página(s) contra los criterios de la normativa BCRA y marca los problemas sobre cada página.`);
  publish();
  for (const page of pages) {
    ui.throwIfCancelled();
    page.status = 'scanning';
    publish();
    try {
      // waitFor:'load' en vez de 'networkidle' - varios sitios reales (analytics, chat widgets,
      // polling) nunca llegan a red inactiva y cuelgan el escaneo en una demo en vivo.
      const axeResult = await scanUrl({
        url: page.url, wcagTags: config.wcagTags, auth: config.auth, viewport: config.viewport,
        captureKeyboard: config.keyboardReview, waitFor: 'load'
      });
      page.status = 'done';
      page.axeResult = axeResult;
      const pageSection = computeWcagSection(classifyFindings([axeResult], wcagScope).findings, { axeResults: [axeResult], ...wcagScope });
      ui.pushLog(`${shortUrl(page.url)}: ${formatPageCompliance(pageSection, wcagScope)}.`, pageSection.nok ? 'warn' : 'ok');
      keyboard.add(axeResult);
      publish();
      try {
        // La página escaneada se muestra en el centro con los problemas WCAG marcados.
        const wcagViolations = axeResult.violations.filter((v) => isWcagViolation(v, wcagScope));
        const image = await stage.capture(page.url, (p) => highlightOnPage(p, wcagViolations));
        ui.pushStage({ type: 'image', src: image, caption: `${shortUrl(page.url)} · problemas WCAG marcados sobre la página` });
      } catch {
        // El resaltado es solo visual para la audiencia: si falla, la auditoría sigue.
      }
    } catch (error) {
      page.status = 'failed';
      page.error = friendlyError(error);
      ui.pushLog(`No se pudo escanear ${shortUrl(page.url)}: ${page.error}`, 'error');
      publish();
    }
  }
  scanning = false;
  const axeResults = pages.filter((p) => p.status === 'done').map((p) => p.axeResult);
  if (axeResults.length === 0) throw new Error('No se pudo escanear ninguna de las páginas seleccionadas.');
  if (axeResults.length < pages.length * 0.8) {
    ui.pushLog(`Solo se escaneó ${axeResults.length} de ${pages.length} páginas: el resultado es parcial.`, 'warn');
  }
  publish();
  if (config.keyboardReview) await keyboard.waitAll();
  ui.throwIfCancelled();

  // Consolidación del sitio completo contra la normativa (informes y resumen usan la misma base).
  const { findings } = classifyFindings(axeResults, wcagScope);
  const scores = calculateScore(findings, { axeResults, ...wcagScope });
  const usageReport = keyboard.usageReport();
  await mkdir(outputDir, { recursive: true });
  await writeFile(path.join(outputDir, 'consumo-ia.json'), JSON.stringify(usageReport, null, 2));

  reportsState = 'active';
  publish();
  ui.pushLog('Generando los informes formales…');
  const data = {
    jobId, channel: config.channel, scores, findings, keyboardResults: keyboard.ordered(axeResults), axeResults,
    urls: axeResults.map((r) => r.url), includeExtended: config.includeExtended, target: config.target
  };
  const generated = [];
  for (const deliverable of DELIVERABLES) {
    try {
      await generateDeliverable(deliverable.type, data, { outputDir });
      generated.push(deliverable);
    } catch (error) {
      ui.pushLog(`No se pudo generar ${deliverable.label}: ${friendlyError(error)}`, 'error');
    }
  }
  const viewable = generated.filter((d) => d.open);
  if (viewable.length === 0) throw new Error('No se pudo generar ningún informe.');
  await writeFile(path.join(outputDir, 'informes.html'), buildReportViewerHtml({
    // encodeURIComponent: el VPAT lleva espacios en el nombre ("VPAT_Informe De Accesibilidad.pdf").
    reports: viewable.map((d) => ({ key: d.key, label: d.label, file: encodeURIComponent(d.open) }))
  }));
  ui.serveReports(path.resolve(outputDir));
  downloads = [
    { label: 'Ver todos los informes', href: '/informes/informes.html' },
    ...viewable.map((d) => ({ label: d.label, href: `/informes/${encodeURIComponent(d.open)}` }))
  ];
  ui.pushLog(`Informes guardados en ${path.resolve(outputDir)}`, 'ok');

  // Paso 3: la misma pantalla se reacomoda como resumen ejecutivo.
  reportsState = 'done';
  ui.pushStage({ type: 'clear' });
  ui.goToStep(3, 'Resumen');
  publish();
  await ui.askPanel({
    kind: 'buttons',
    final: true,
    text: `Auditoría terminada · ${shortUrl(config.target)}`,
    subtitle: `Todos los archivos, incluidos los Excel, quedaron en ${path.resolve(outputDir)}`,
    status: { text: 'Auditoría terminada', tone: 'ok' },
    options: [{ label: 'Cerrar demo', value: 'close', variant: 'secondary' }]
  });
}

async function main() {
  if (!process.env.ANTHROPIC_API_KEY) {
    console.error('Falta ANTHROPIC_API_KEY en el entorno - la demo necesita llamar a Claude para interpretar las pruebas de teclado.');
    process.exit(1);
  }

  const server = createDemoServer();
  server.setDiscoverHandler(async (url, onPage) => ({ urls: await discoverSite(url, onPage) }));
  server.setCheckHandler((url) => checkScannable(url));
  const controlServer = http.createServer(server.app);
  await new Promise((resolve) => controlServer.listen(0, resolve));
  const { port: controlPort } = controlServer.address();

  // Una sola ventana, a pantalla completa. Las capturas (vista previa y páginas escaneadas con
  // los problemas marcados) se sacan con un navegador invisible y se muestran dentro del panel.
  const panelBrowser = await chromium.launch({ headless: false, args: ['--start-fullscreen'] });
  const panelPage = await (await panelBrowser.newContext({ viewport: null })).newPage();
  await panelPage.goto(`http://localhost:${controlPort}/panel`);

  const stageBrowser = await chromium.launch();
  const stageContext = await stageBrowser.newContext({ viewport: { width: 1280, height: 800 } });
  const stage = createStage(stageContext);
  server.setPreviewHandler(async (values) => {
    const target = previewTarget(values);
    if (!target) throw new Error('Todavía no hay nada para mostrar');
    let url = target.target;
    if (target.kind === 'local') {
      const files = await listHtmlFiles(target.target);
      if (files.length === 0) throw new Error('La carpeta no tiene archivos .html');
      url = toFileUrl(files[0]);
    }
    try {
      return { url, image: await stage.capture(url) };
    } catch (error) {
      throw new Error(`No se pudo cargar la vista previa: ${friendlyError(error)}.`);
    }
  });

  // Cerrar la ventana no desconecta el navegador (Chromium de Playwright sigue vivo sin ventanas):
  // hay que escuchar también el cierre de la página, si no la demo queda esperando para siempre
  // y el portal la sigue viendo "en ejecución".
  let panelClosed = false;
  const onPanelClosed = () => {
    if (panelClosed) return;
    panelClosed = true;
    server.cancelPending(new DemoCancelledError());
  };
  panelBrowser.on('disconnected', onPanelClosed);
  panelPage.on('close', onPanelClosed);

  // Paso actual del encabezado (1 Relevar páginas · 2 Auditoría en vivo · 3 Resumen).
  let currentStep = 0;
  const ui = {
    ...server,
    goToStep(n, title) {
      currentStep = n;
      if (title) header(n, title);
      server.pushStep(n);
    }
  };

  console.log('=== Demo: Agente F1 de Compliance de Accesibilidad ===');
  try {
    await runDemo(ui, { stage });
  } catch (error) {
    const cancelled = error instanceof DemoCancelledError;
    if (cancelled && panelClosed) {
      console.log('\nSe cerró la ventana del panel: la demo termina.');
    } else if (cancelled) {
      console.log('\nAuditoría cancelada por el presentador.');
      ui.pushLog('Auditoría cancelada. No se generaron informes nuevos.', 'warn');
    } else {
      console.error('\nLa demo se interrumpió por un error:', error);
      ui.pushLog(friendlyError(error), 'error');
      server.pushStep(currentStep, { failed: true });
      ui.pushFailure(friendlyError(error), 'Revisá la configuración o la conexión y volvé a correr la demo.');
    }
    if (!panelClosed) {
      try {
        await server.askPanel({
          kind: 'buttons',
          final: true,
          text: cancelled ? 'Auditoría cancelada' : 'La auditoría se detuvo por un error',
          status: cancelled ? { text: 'Cancelada', tone: 'bad' } : { text: 'Con error', tone: 'bad' },
          options: [{ label: 'Cerrar demo', value: 'close' }]
        }, { allowAfterCancel: true });
      } catch {
        // El panel se cerró mientras se mostraba el mensaje final.
      }
    }
    if (!panelClosed) process.exitCode = 1;
  } finally {
    controlServer.close();
    await panelBrowser.close().catch(() => {});
    await stageBrowser.close().catch(() => {});
  }
}

// Salida explícita: el crawl de crawlee deja timers internos vivos que impedían que el proceso
// terminara solo después de "Cerrar demo".
main().then(() => process.exit(process.exitCode ?? 0), (error) => {
  console.error('\nLa demo se interrumpió por un error:', error.message);
  process.exit(1);
});
