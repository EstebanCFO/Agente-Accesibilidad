import 'dotenv/config';
import path from 'node:path';
import http from 'node:http';
import { readFile } from 'node:fs/promises';
import { createInterface } from 'node:readline/promises';
import Anthropic from '@anthropic-ai/sdk';
import { chromium } from 'playwright';
import { scanUrl } from '../src/scanner.js';
import { classifyFindings } from '../src/classification/classify-findings.js';
import { calculateScore } from '../src/classification/calculate-score.js';
import { runVisualAudit } from '../src/visual-review/visual-audit.js';
import { runUxComplianceReview } from '../src/visual-review/ux-compliance-review.js';
import { generateDeliverable } from '../src/reporter/generate-deliverable.js';
import { resolveTargetUrl } from './demo-site-selection.js';
import { buildHighlightTargets, buildBadgeText } from './demo-highlight.js';

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
  console.log(`Navegando a: ${targetUrl}`);
  await page.goto(targetUrl, { waitUntil: 'domcontentloaded' });
  console.log('Página cargada. (En una corrida real, acá el agente recorrería todo el sitio buscando cada pantalla a auditar.)');
  await pause('Escanear la página con el motor de accesibilidad');

  header(2, 'Escanear');
  console.log('Corriendo el escaneo automático de accesibilidad...');
  const axeResult = await scanUrl({ url: targetUrl, captureScreenshot: true, captureHtml: true });
  console.log(`Escaneo terminado: ${axeResult.violation_count} problema(s) técnico(s) detectado(s), ${axeResult.pass_count} chequeo(s) aprobado(s).`);
  await page.goto(targetUrl, { waitUntil: 'domcontentloaded' });
  await highlightOnPage(page, axeResult.violations);
  console.log('Los problemas quedaron marcados directamente sobre la página (rojo = crítico, naranja = serio, amarillo = moderado).');
  await pause('Clasificar los hallazgos contra la normativa argentina (ONTI/BCRA)');

  header(3, 'Clasificar contra ONTI/BCRA');
  const { findings } = classifyFindings([axeResult]);
  const scores = calculateScore(findings, { axeResults: [axeResult] });
  console.log(`Criterios ONTI evaluados: ${scores.summary.onti_criteria_evaluated}. Conformes: ${scores.summary.onti_criteria_compliant}. Score: ${scores.summary.onti_compliance_percentage}%.`);
  await pause('Revisión visual con inteligencia artificial (contraste, spacing, touch targets)');

  header(4, 'Revisión visual con IA');
  console.log('Mandando la captura de pantalla a la IA con visión (esto puede tardar unos segundos)...');
  const { visual_findings: visualFindings } = await runVisualAudit(
    { url: targetUrl, screenshot: axeResult.screenshot },
    { anthropicClient }
  );
  console.log(`La IA encontró ${visualFindings.length} hallazgo(s) visual(es) adicional(es) que el escaneo automático no puede ver por sí solo.`);
  for (const f of visualFindings.slice(0, 3)) console.log(`  • [${f.severity}] ${f.failure_summary}`);
  await pause('Revisión de experiencia de usuario con IA');

  header(5, 'Revisión de UX con IA');
  console.log('Mandando el HTML de la página a la IA...');
  const { ux_findings: uxFindings } = await runUxComplianceReview(
    { url: targetUrl, html: axeResult.html },
    { anthropicClient }
  );
  console.log(`La IA encontró ${uxFindings.length} hallazgo(s) de experiencia de usuario adicional(es).`);
  for (const f of uxFindings.slice(0, 3)) console.log(`  • [${f.severity}] ${f.failure_summary}`);
  await pause('Generar el dashboard ejecutivo final');

  header(6, 'Generar el dashboard ejecutivo');
  const allFindings = [...findings, ...visualFindings, ...uxFindings];
  const finalScores = calculateScore(allFindings, { axeResults: [axeResult] });
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
