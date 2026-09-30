import 'dotenv/config';
import path from 'node:path';
import http from 'node:http';
import { writeFile, mkdir } from 'node:fs/promises';
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
import { runVisualAudit, detectImageMediaType } from '../src/visual-review/visual-audit.js';
import { runUxComplianceReview } from '../src/visual-review/ux-compliance-review.js';
import { generateDeliverable } from '../src/reporter/generate-deliverable.js';
import { emptyUsage, addUsage, totalTokens, resolvePricing, estimateCostUsd, PRICING_SOURCE_DATE } from '../src/visual-review/usage-cost.js';
import { resolveSelectedPages } from './demo-page-selection.js';
import { buildConfigFields, buildConfigSummary, defaultConfigValues, validateDemoConfig, previewTarget, MAX_PAGES_LIMIT } from './demo-config.js';
import { countViolationsByImpact, isWcagViolation, buildWcagCard, buildBestPracticesCard, buildSeverityCard, buildAiCard, buildUsageCard } from './demo-results.js';
import { runWithConcurrency } from './demo-concurrency.js';
import { buildReportViewerHtml } from './demo-report-viewer.js';
import { isLocalPath, listHtmlFiles, toFileUrl } from './demo-local-source.js';
import { buildHighlightTargets, buildBadgeText } from './demo-highlight.js';
import { createDemoServer, DemoCancelledError } from './demo-server.js';


/**
 * Demo guionada para audiencia C-level: pasos fijos y controlados por el presentador (no el
 * loop autónomo del agente, que decide su propio flujo - acá queremos previsibilidad). El
 * control (configuración, selección de páginas y avance de los 6 pasos) es el panel web; esta
 * función solo imprime el banner en la terminal como respaldo/debug.
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

// El informe se acota a tres entregables: Score de cumplimiento inicial (vista del dashboard +
// score-compliance.json), Inventario de hallazgos y Matriz de criticidad; el PDF los consolida.
const DELIVERABLES = [
  { type: 'score', label: 'Score de cumplimiento (datos)' },
  { type: 'dashboard', key: 'dashboard', label: 'Score de cumplimiento inicial', open: 'dashboard.html' },
  { type: 'inventario', key: 'inventario', label: 'Inventario de hallazgos', open: 'inventario-hallazgos.html' },
  { type: 'matriz', key: 'matriz', label: 'Matriz de criticidad WCAG 2.0 AA', open: 'matriz-criticidad.html' },
  { type: 'informe-pdf', key: 'pdf', label: 'Informe PDF consolidado', open: 'informe-consolidado.pdf' }
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

function shortUrl(url) {
  try {
    const u = new URL(url);
    return u.protocol === 'file:' ? path.basename(decodeURIComponent(u.pathname)) : (u.hostname + u.pathname).replace(/\/$/, '');
  } catch {
    return url;
  }
}

/**
 * Recorre una URL una sola vez y guarda el resultado: el formulario lo usa para autocompletar
 * "Máx. de páginas" con el total encontrado, y el paso 1 lo reutiliza sin volver a recorrer.
 * Siempre devuelve la principal primero, sin duplicados.
 */
const discoveryCache = new Map();
function discoverSite(url) {
  if (!discoveryCache.has(url)) {
    const promise = crawlSite(url, { maxUrls: MAX_PAGES_LIMIT })
      .then((urls) => [url, ...new Set(urls.filter((u) => u !== url))])
      .catch((error) => {
        discoveryCache.delete(url);
        throw error;
      });
    discoveryCache.set(url, promise);
  }
  return discoveryCache.get(url);
}

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
    if (discoveryCache.has(mainUrl) || config.selectedPages.length > 0) {
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
 * Lanza en paralelo todas las revisiones con IA habilitadas (visual y UX por página), acumula
 * hallazgos y consumo de tokens, y actualiza las tarjetas del panel a medida que terminan.
 */
function startAiReviews(ui, axeResults, config, anthropicClient) {
  const pricing = resolvePricing(AI_MODEL, process.env);
  const state = { visualFindings: [], uxFindings: [], usage: emptyUsage(), attempts: 0, failures: 0, byKind: { visual: [], ux: [] },
    visualDone: new Map(), visualListeners: [] };
  const refreshCards = () => {
    ui.pushResult(buildAiCard(state.visualFindings.length, state.uxFindings.length, { unavailable: state.attempts > 0 && state.failures === state.attempts }));
    ui.pushResult(buildUsageCard(state.usage, estimateCostUsd(state.usage, pricing)));
  };
  const options = { anthropicClient, model: AI_MODEL, includeExtended: config.includeExtended };

  const specs = [];
  for (const r of axeResults) {
    if (config.visualAudit && r.screenshot) specs.push({ kind: 'visual', url: r.url, run: () => runVisualAudit({ url: r.url, screenshot: r.screenshot }, options) });
    if (config.uxReview && r.html) specs.push({ kind: 'ux', url: r.url, run: () => runUxComplianceReview({ url: r.url, html: r.html }, options) });
  }
  if (specs.length > 0) ui.pushLog(`Revisión del Agente iniciada en segundo plano: ${specs.length} consulta(s), hasta ${AI_CONCURRENCY} a la vez.`);

  const promises = runWithConcurrency(specs.map((spec) => spec.run), AI_CONCURRENCY);
  specs.forEach((spec, i) => {
    state.attempts += 1;
    const done = promises[i].then(({ ok, value, error }) => {
      const label = spec.kind === 'visual' ? 'visual' : 'de UX';
      if (ok) {
        const found = spec.kind === 'visual' ? value.visual_findings : value.ux_findings;
        (spec.kind === 'visual' ? state.visualFindings : state.uxFindings).push(...found);
        state.usage = addUsage(state.usage, value.usage);
        const saved = value.html_chars && value.html_chars.original > 0
          ? ` (HTML reducido ${Math.round((1 - value.html_chars.sent / value.html_chars.original) * 100)}%)` : '';
        ui.pushLog(`${shortUrl(spec.url)}: ${found.length} hallazgo(s) ${label}${saved}.`, 'ok');
      } else {
        state.failures += 1;
        ui.pushLog(`Revisión ${label} no disponible para ${shortUrl(spec.url)}: ${friendlyError(error)}. Se sigue sin ella.`, 'warn');
      }
      if (spec.kind === 'visual') {
        state.visualDone.set(spec.url, ok ? 'done' : 'failed');
        state.visualListeners.forEach((fn) => fn());
      }
      refreshCards();
    });
    state.byKind[spec.kind].push(done);
  });

  return {
    get visualFindings() { return state.visualFindings; },
    get uxFindings() { return state.uxFindings; },
    /** Estado de la revisión visual de una página: 'pending', 'done', 'failed' o 'none' (sin captura). */
    visualStatus(url) {
      if (!specs.some((sp) => sp.kind === 'visual' && sp.url === url)) return 'none';
      return state.visualDone.get(url) ?? 'pending';
    },
    visualNotes(url) {
      return state.visualFindings
        .filter((f) => (f.affected_urls || []).includes(url))
        .map((f) => ({ text: f.failure_summary || f.wcag_description, criterion: `${f.wcag_criterion} ${f.wcag_description ?? ''}`.trim() }));
    },
    onVisualProgress(listener) { state.visualListeners.push(listener); },
    /** Espera las revisiones de un tipo mostrando cuántas van terminadas. */
    async waitFor(kind, label) {
      const list = state.byKind[kind];
      let finished = 0;
      const show = () => ui.pushProgress(label, finished, list.length);
      list.forEach((p) => p.then(() => { finished += 1; show(); }));
      await Promise.resolve();
      show();
      await Promise.all(list);
      ui.throwIfCancelled();
    },
    usageReport() {
      return {
        model: AI_MODEL,
        pricing_usd_per_mtok: pricing,
        pricing_source_date: PRICING_SOURCE_DATE,
        ...state.usage,
        total_tokens: totalTokens(state.usage),
        estimated_cost_usd: estimateCostUsd(state.usage, pricing),
        note: 'Costo estimado a partir de la tabla de precios pública; el valor facturado es el de la consola de Anthropic.'
      };
    }
  };
}

/** Pausa entre pasos: deja claro qué terminó y qué viene. */
async function gate(ui, doneText, nextText) {
  await ui.askPanel({
    kind: 'buttons',
    text: doneText,
    subtitle: `A continuación: ${nextText}`,
    options: [{ label: 'Continuar', value: 'continue', workingText: 'Procesando…' }]
  });
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

  while (true) {
    ui.goToStep(0);
    ui.pushStage({ type: 'clear' });
    ({ config, values: formValues } = await configure(ui, formValues));
    ui.setSkipped([!config.visualAudit && 4, !config.uxReview && 5].filter(Boolean));
    ui.goToStep(1, 'Relevar páginas');
    pagesToAudit = await discoverPages(ui, config);
    if (pagesToAudit) break;
  }

  const anthropicClient = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });
  const jobId = `demo-${Date.now()}`;
  const outputDir = path.join('./reports', jobId);
  ui.pushLog(`Se van a auditar ${pagesToAudit.length} página(s).`, 'ok');

  // Paso 2: escanear
  ui.goToStep(2, 'Escanear');
  // "Confirmar páginas" ya es la confirmación del presentador: el escaneo arranca directo.
  ui.pushLog('El agente de accesibilidad revisa cada página contra los 38 criterios de la normativa BCRA y marca los problemas sobre la propia página.');
  const axeResults = [];
  for (const [i, url] of pagesToAudit.entries()) {
    ui.throwIfCancelled();
    ui.pushProgress(`Escaneando ${shortUrl(url)}`, i + 1, pagesToAudit.length);
    try {
      // waitFor:'load' en vez de 'networkidle' - varios sitios reales (analytics, chat widgets,
      // polling) nunca llegan a red inactiva y cuelgan el escaneo en una demo en vivo.
      const axeResult = await scanUrl({
        url, wcagTags: config.wcagTags, auth: config.auth, viewport: config.viewport,
        captureScreenshot: config.visualAudit, captureHtml: config.uxReview, waitFor: 'load'
      });
      axeResults.push(axeResult);
      // El log, la tarjeta y el resaltado cuentan solo WCAG (las buenas prácticas van en su propia sección).
      const wcagScope = { includeExtended: config.includeExtended };
      const wcagViolations = axeResult.violations.filter((v) => isWcagViolation(v, wcagScope));
      ui.pushLog(`${shortUrl(url)}: ${wcagViolations.length} problema(s) WCAG, ${axeResult.pass_count} chequeo(s) aprobado(s).`, wcagViolations.length ? 'warn' : 'ok');
      ui.pushResult(buildSeverityCard(countViolationsByImpact(axeResults, wcagScope), wcagScope));
      try {
        // La página escaneada se muestra embebida en el panel con los problemas marcados.
        const image = await stage.capture(url, (p) => highlightOnPage(p, wcagViolations));
        ui.pushStage({ type: 'image', src: image, caption: shortUrl(url) });
      } catch {
        // El resaltado es solo visual para la audiencia: si falla, la auditoría sigue.
      }
    } catch (error) {
      ui.pushLog(`No se pudo escanear ${shortUrl(url)}: ${friendlyError(error)}`, 'error');
    }
  }
  if (axeResults.length === 0) throw new Error('No se pudo escanear ninguna de las páginas seleccionadas.');
  if (axeResults.length < pagesToAudit.length * 0.8) {
    ui.pushLog(`Solo se escaneó ${axeResults.length} de ${pagesToAudit.length} páginas: el resultado es parcial.`, 'warn');
  }
  // Las revisiones con IA arrancan YA, en segundo plano y en paralelo (hasta AI_CONCURRENCY a la
  // vez): mientras el presentador comenta el escaneo y la clasificación, la IA ya está
  // trabajando. Los pasos 4 y 5 después solo esperan lo que falte.
  const ai = startAiReviews(ui, axeResults, config, anthropicClient);
  await gate(ui, `Escaneo terminado: ${axeResults.length} página(s) revisadas`, 'clasificar los hallazgos contra la normativa ONTI/BCRA.');

  // Paso 3: clasificar
  ui.goToStep(3, 'Clasificar ONTI/BCRA');
  ui.pushProgress('Clasificando hallazgos contra los 38 criterios ONTI…');
  const { findings } = classifyFindings(axeResults, { includeExtended: config.includeExtended });
  const scores = calculateScore(findings, { axeResults, includeExtended: config.includeExtended });
  ui.pushResult(buildWcagCard(scores.wcag_section, { includeExtended: config.includeExtended }));
  ui.pushResult(buildBestPracticesCard(scores.best_practices));
  const s = scores.wcag_section;
  ui.pushLog(`Compliance WCAG: ${s.ok} OK, ${s.nok} NOK, ${s.a_validar} a validar (de ${s.total}).`, s.nok ? 'warn' : 'ok');

  const nextAfterClassify = config.visualAudit ? 'revisión visual del agente donde se analiza contraste, espaciado, tamaño de botones, tamaño y legibilidad del texto, visibilidad del foco y animaciones sin pausa.'
    : config.uxReview ? 'revisión de experiencia de usuario agéntica.' : 'generar los informes.';
  await gate(ui, 'Clasificación terminada', nextAfterClassify);

  // Pasos 4 y 5: esperar las revisiones con IA ya lanzadas (opcionales; si fallan, se sigue sin ellas).
  if (config.visualAudit) {
    ui.goToStep(4, 'Revisión visual del Agente');
    // Se muestran las capturas que analiza el Agente, página por página, con sus observaciones.
    const shots = axeResults.filter((r) => r.screenshot);
    const showGallery = () => ui.pushStage({
      type: 'gallery',
      caption: 'Capturas que analiza el Agente',
      items: shots.map((r) => ({
        src: `data:${detectImageMediaType(r.screenshot)};base64,${r.screenshot}`,
        caption: shortUrl(r.url),
        status: ai.visualStatus(r.url),
        notes: ai.visualNotes(r.url)
      }))
    });
    if (shots.length > 0) {
      showGallery();
      ai.onVisualProgress(showGallery);
    }
    await ai.waitFor('visual', 'El Agente revisa las capturas');
    await gate(ui, 'Revisión visual terminada', config.uxReview ? 'revisión de experiencia de usuario agéntica.' : 'generar los informes.');
  } else {
    ui.pushLog('Revisión visual del Agente omitida por configuración.');
  }
  if (config.uxReview) {
    ui.goToStep(5, 'Revisión de UX con Agente');
    await ai.waitFor('ux', 'El Agente revisa formularios y mensajes');
    await gate(ui, 'Revisión de UX terminada', 'generar los informes.');
  } else {
    ui.pushLog('Revisión de UX con Agente omitida por configuración.');
  }
  const { visualFindings, uxFindings } = ai;
  if (visualFindings.length + uxFindings.length > 0) {
    ui.pushLog('La revisión del Agente es un análisis complementario: se muestra aparte en los informes y no modifica el puntaje, que se basa solo en axe-core.');
  }
  const usageReport = ai.usageReport();
  await mkdir(outputDir, { recursive: true });
  await writeFile(path.join(outputDir, 'consumo-ia.json'), JSON.stringify(usageReport, null, 2));
  if (usageReport.calls > 0) {
    const cost = usageReport.estimated_cost_usd === null ? 'sin precio conocido' : `≈ US$ ${usageReport.estimated_cost_usd.toLocaleString('es-AR', { minimumFractionDigits: 4, maximumFractionDigits: 4 })}`;
    ui.pushLog(`Consumo de IA: ${usageReport.total_tokens.toLocaleString('es-AR')} tokens en ${usageReport.calls} llamada(s), ${cost}.`, 'ok');
  }

  // Paso 6: informes
  ui.goToStep(6, 'Informes');
  // Puntaje e informes: solo axe-core. La revisión del Agente va como análisis complementario.
  const complementaryFindings = [...visualFindings, ...uxFindings];
  const finalScores = calculateScore(findings, { axeResults, includeExtended: config.includeExtended });
  ui.pushResult(buildWcagCard(finalScores.wcag_section, { includeExtended: config.includeExtended }));
  ui.pushResult(buildBestPracticesCard(finalScores.best_practices));
  const data = {
    jobId, channel: config.channel, scores: finalScores, findings, complementaryFindings, axeResults,
    urls: axeResults.map((r) => r.url), includeExtended: config.includeExtended,
    ontiCriteriaCompliant: finalScores.summary.onti_criteria_compliant,
    conformanceThreshold: finalScores.summary.effective_conformance_threshold ?? finalScores.summary.conformance_threshold
  };
  const generated = [];
  for (const [i, deliverable] of DELIVERABLES.entries()) {
    ui.pushProgress(`Generando: ${deliverable.label}`, i + 1, DELIVERABLES.length);
    try {
      await generateDeliverable(deliverable.type, data, { outputDir });
      generated.push(deliverable);
      ui.pushLog(`${deliverable.label}: listo.`, 'ok');
    } catch (error) {
      ui.pushLog(`No se pudo generar ${deliverable.label}: ${friendlyError(error)}`, 'error');
    }
  }
  if (!generated.some((d) => d.type === 'dashboard')) throw new Error('No se pudo generar el score de cumplimiento inicial.');
  ui.goToStep(7);
  ui.pushLog(`Informes guardados en ${path.resolve(outputDir)}`, 'ok');

  // Una sola página con los informes embebidos: botones arriba, el informe elegido debajo.
  const viewable = generated.filter((d) => d.open);
  await writeFile(path.join(outputDir, 'informes.html'), buildReportViewerHtml({
    reports: viewable.map((d) => ({ key: d.key, label: d.label, file: d.open }))
  }));

  // Los informes se ven embebidos en el mismo panel (sin abrir otra ventana): botones arriba y
  // el informe elegido debajo.
  ui.serveReports(path.resolve(outputDir));
  ui.pushStage({ type: 'frame', src: `/informes/informes.html?embed=1#${viewable[0].key}`, caption: 'Informes de la auditoría' });
  await ui.askPanel({
    kind: 'buttons',
    final: true,
    text: 'Auditoría terminada · elegí un informe para verlo debajo',
    subtitle: `Todos los archivos, incluidos los Excel, quedaron en ${path.resolve(outputDir)}`,
    options: [{ label: 'Cerrar demo', value: 'close' }]
  });
}

async function main() {
  if (!process.env.ANTHROPIC_API_KEY) {
    console.error('Falta ANTHROPIC_API_KEY en el entorno - la demo necesita llamar a Claude para los pasos 4 y 5.');
    process.exit(1);
  }

  const server = createDemoServer();
  server.setDiscoverHandler(async (url) => ({ urls: await discoverSite(url) }));
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

  // Estado del stepper compartido por todos los pasos (paso actual + pasos omitidos por config).
  let currentStep = 0;
  let skippedSteps = [];
  const ui = {
    ...server,
    setSkipped(steps) { skippedSteps = steps; },
    goToStep(n, title) {
      currentStep = n;
      if (title) header(n, title);
      server.pushStep(n, { skippedSteps });
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
      server.pushStep(currentStep, { skippedSteps, failed: true });
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
