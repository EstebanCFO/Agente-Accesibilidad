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
