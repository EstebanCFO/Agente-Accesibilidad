import 'dotenv/config';
import path from 'node:path';
import http from 'node:http';
import { readFile } from 'node:fs/promises';
import { createInterface } from 'node:readline/promises';
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
import { resolveTargetUrl } from './demo-site-selection.js';
import { resolveAdditionalPageCount } from './demo-page-selection.js';
import { buildHighlightTargets, buildBadgeText } from './demo-highlight.js';

// Con 10 páginas el crawl real tardó ~29s en pruebas en vivo (sin ningún aviso, se puede
// confundir con que la demo se colgó) - se recorta a 6 para que el paso 1 quede en ~15-20s.
const MAX_PAGES_TO_DISCOVER = 6;

/**
 * Demo guionada para audiencia C-level: pasos fijos y controlados por el presentador (no el
 * loop autónomo del agente, que decide su propio flujo - acá queremos previsibilidad), con
 * pausas manuales entre cada paso. Reusa los mismos módulos ya probados que usa el agente real.
 */

const rl = createInterface({ input: process.stdin, output: process.stdout });

async function pause(nextStepLabel) {
  await rl.question(`\n▶  Enter para continuar → ${nextStepLabel}\n`);
}

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

  console.log('=== Demo: Agente F1 de Compliance de Accesibilidad ===');
  const choice = await rl.question(
    '\n1) Sitio de demo (problemas reales, sin riesgo)\n2) Sitio del cliente (vas a pedir la URL)\n3) Otra URL\n\nElegí una opción: '
  );
  let customUrl;
  if (['2', '3'].includes(choice.trim())) {
    customUrl = await rl.question('Pegá la URL a auditar: ');
  }
  const targetUrl = resolveTargetUrl(choice, customUrl);

  const anthropicClient = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });
  const jobId = `demo-${Date.now()}`;
  const outputDir = path.join('./reports', jobId);

  const browser = await chromium.launch({ headless: false, args: ['--start-maximized'] });
  const context = await browser.newContext({ viewport: null });
  const page = await context.newPage();

  header(1, 'Descubrir');
  console.log(`Recorriendo el sitio desde: ${targetUrl}`);
  console.log('(Esto puede tardar unos 25-30 segundos reales - el agente está navegando el sitio de verdad, no es un valor simulado.)');
  let discoveredUrls = [];
  try {
    discoveredUrls = await crawlSite(targetUrl, { maxUrls: MAX_PAGES_TO_DISCOVER });
  } catch (error) {
    console.log(`No se pudo recorrer el sitio automáticamente (${error.message}) - se sigue solo con la página principal.`);
  }
  const subpages = discoveredUrls.filter((url) => url !== targetUrl);

  let pagesToAudit = [targetUrl];
  if (subpages.length > 0) {
    console.log(`Se encontraron ${subpages.length} subpágina(s) además de la principal:`);
    subpages.forEach((url, i) => console.log(`  ${i + 1}) ${url}`));
    const answer = await rl.question(`\n¿Cuántas de estas querés auditar además de la principal? (0-${subpages.length}, Enter = 0): `);
    const additionalCount = resolveAdditionalPageCount(answer, subpages.length);
    pagesToAudit = [targetUrl, ...subpages.slice(0, additionalCount)];
  } else {
    console.log('No se encontraron subpáginas adicionales (o el sitio no permitió recorrerlo) - se sigue solo con la página principal.');
  }
  console.log(`\nSe van a auditar ${pagesToAudit.length} página(s) en total.`);
  await pause('Escanear cada página con el motor de accesibilidad');

  header(2, 'Escanear');
  const axeResults = [];
  for (const url of pagesToAudit) {
    console.log(`\nEscaneando: ${url}`);
    // waitFor:'load' en vez del default 'networkidle' - varios sitios reales (analytics, chat
    // widgets, polling) nunca llegan a red inactiva y cuelgan el escaneo en una demo en vivo.
    const axeResult = await scanUrl({ url, captureScreenshot: true, captureHtml: true, waitFor: 'load' });
    console.log(`  ${axeResult.violation_count} problema(s) técnico(s) detectado(s), ${axeResult.pass_count} chequeo(s) aprobado(s).`);
    await page.goto(url, { waitUntil: 'domcontentloaded' });
    await highlightOnPage(page, axeResult.violations);
    await page.waitForTimeout(1200);
    axeResults.push(axeResult);
  }
  console.log('\nLos problemas quedaron marcados directamente sobre cada página (rojo = crítico, naranja = serio, amarillo = moderado).');
  await pause('Clasificar los hallazgos contra la normativa argentina (ONTI/BCRA)');

  header(3, 'Clasificar contra ONTI/BCRA');
  const { findings } = classifyFindings(axeResults);
  const scores = calculateScore(findings, { axeResults });
  console.log(`Páginas evaluadas: ${scores.summary.total_urls_evaluated}. Criterios ONTI evaluados: ${scores.summary.onti_criteria_evaluated}. Conformes: ${scores.summary.onti_criteria_compliant}. Score: ${scores.summary.onti_compliance_percentage}%.`);
  await pause('Revisión visual con inteligencia artificial (contraste, spacing, touch targets)');

  header(4, 'Revisión visual con IA');
  const visualFindings = [];
  for (const axeResult of axeResults) {
    console.log(`\nMandando la captura de ${axeResult.url} a la IA (esto puede tardar unos segundos)...`);
    const { visual_findings } = await runVisualAudit({ url: axeResult.url, screenshot: axeResult.screenshot }, { anthropicClient });
    console.log(`  ${visual_findings.length} hallazgo(s) visual(es) adicional(es).`);
    for (const f of visual_findings.slice(0, 3)) console.log(`    • [${f.severity}] ${f.failure_summary}`);
    visualFindings.push(...visual_findings);
  }
  await pause('Revisión de experiencia de usuario con IA');

  header(5, 'Revisión de UX con IA');
  const uxFindings = [];
  for (const axeResult of axeResults) {
    console.log(`\nMandando el HTML de ${axeResult.url} a la IA...`);
    const { ux_findings } = await runUxComplianceReview({ url: axeResult.url, html: axeResult.html }, { anthropicClient });
    console.log(`  ${ux_findings.length} hallazgo(s) de experiencia de usuario adicional(es).`);
    for (const f of ux_findings.slice(0, 3)) console.log(`    • [${f.severity}] ${f.failure_summary}`);
    uxFindings.push(...ux_findings);
  }
  await pause('Generar el dashboard ejecutivo final');

  header(6, 'Generar el dashboard ejecutivo');
  const allFindings = [...findings, ...visualFindings, ...uxFindings];
  const finalScores = calculateScore(allFindings, { axeResults });
  const [dashboardPath] = await generateDeliverable(
    'dashboard',
    { jobId, channel: 'demo', scores: finalScores, findings: allFindings },
    { outputDir }
  );
  console.log(`Dashboard generado en: ${dashboardPath}`);

  const server = serveDirectory(outputDir);
  await new Promise((resolve) => server.listen(0, resolve));
  const { port } = server.address();

  const dashboardTab = await context.newPage();
  await dashboardTab.goto(`http://localhost:${port}/`);
  console.log('\nDashboard abierto en el navegador. Esta es la vista que recibiría el directorio.');

  await rl.question('\nDemo terminada. Enter para cerrar el navegador y salir.\n');
  server.close();
  await browser.close();
  rl.close();
}

main().catch((error) => {
  console.error('\nLa demo se interrumpió por un error:', error.message);
  rl.close();
  process.exit(1);
});
