import { chromium, errors as playwrightErrors } from 'playwright';
import AxeBuilder from '@axe-core/playwright';
import axeCore from 'axe-core';
import esLocale from 'axe-core/locales/es.json' with { type: 'json' };

// axe-core corre con su locale oficial en español (80 reglas / 92 checks traducidos por Deque)
// para que help/failure_summary salgan nativos en los reportes en español, en vez del inglés
// crudo por default. Verificado en vivo contra un sitio real: mismo conteo de violaciones,
// solo cambia el idioma del texto. AxeBuilder reinyecta este mismo source en cada .analyze()
// (incluso en la blank page interna de finishRun), así que el locale queda configurado siempre.
const AXE_SOURCE_ES = `${axeCore.source};axe.configure({ locale: ${JSON.stringify(esLocale)} });`;

// axe-core por default corre TODAS sus reglas, incluidas 5 que son puro ruido para este proyecto
// (wcag2aaa/'deprecated' - color-contrast-enhanced, identical-links-same-purpose,
// meta-refresh-no-exceptions, duplicate-id, duplicate-id-active). Verificado con axe.getRules():
// restringir a este set solo excluye esas 5 - las ~30 reglas 'best-practice' sin tag WCAG
// numerado (landmark-one-main, region, heading-order, skip-link, etc.) siguen corriendo, porque
// se usan hoy en el scan crudo (conteos y resaltado en vivo del demo), aunque classify-findings.js
// las marque out_of_scope para el compliance ONTI. No se restringe a solo tags WCAG numerados
// -eso se probó primero y rompía justamente esas ~30 reglas best-practice.
const DEFAULT_WCAG_TAGS = ['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa', 'wcag22aa', 'best-practice'];

export class AuthRequiredError extends Error {
  constructor(url, status) {
    super(`La URL ${url} requiere autenticación (HTTP ${status})`);
    this.name = 'AuthRequiredError';
    this.url = url;
    this.status = status;
  }
}

async function applyBearerAuth(context, config) {
  await context.setExtraHTTPHeaders({ Authorization: `Bearer ${config.bearer_token}` });
}

async function applyCookieAuth(context, config) {
  const cookies = (config.cookies || []).map((cookie) => ({ path: '/', ...cookie }));
  await context.addCookies(cookies);
}

async function applyFormAuth(page, config) {
  await page.goto(config.login_url, { waitUntil: 'domcontentloaded' });
  await page.fill(config.username_selector, config.username);
  await page.fill(config.password_selector, config.password);
  await page.click(config.submit_selector);
  await page.waitForLoadState('networkidle');
}

async function createContext(browser, auth, viewport) {
  const contextOptions = {};
  if (viewport) contextOptions.viewport = viewport;
  if (auth?.type === 'basic') {
    contextOptions.httpCredentials = { username: auth.config.username, password: auth.config.password };
  }
  const context = await browser.newContext(contextOptions);
  if (auth?.type === 'bearer') await applyBearerAuth(context, auth.config);
  if (auth?.type === 'cookie') await applyCookieAuth(context, auth.config);
  return context;
}

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
    })),
    incomplete: results.incomplete.map((item) => ({
      id: item.id,
      impact: item.impact,
      tags: item.tags,
      help: item.help,
      help_url: item.helpUrl,
      node_count: item.nodes.length,
      nodes: item.nodes.map((node) => ({
        target: node.target,
        html: node.html,
        failure_summary: node.failureSummary
      }))
    })),
    passes: results.passes.map((item) => ({ id: item.id, tags: item.tags })),
    inapplicable: results.inapplicable.map((item) => ({ id: item.id, tags: item.tags }))
  };
  if (extras.screenshot) base.screenshot = extras.screenshot;
  if (extras.html) base.html = extras.html;
  return base;
}

/**
 * Corre axe-core sobre una URL usando un browser ya lanzado (compartido entre workers en scanBatch,
 * o de un solo uso en scanUrl). Cada llamada abre y cierra su propio context, para que auth/cookies
 * no se mezclen entre URLs concurrentes.
 */
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

    const axeBuilder = new AxeBuilder({ page, axeSource: AXE_SOURCE_ES });
    const tagsToUse = Array.isArray(wcagTags) && wcagTags.length > 0 ? wcagTags : DEFAULT_WCAG_TAGS;
    axeBuilder.withTags(tagsToUse);
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

export async function scanUrl({ url, wcagTags, auth, viewport, timeout, waitFor, captureScreenshot, captureHtml }) {
  if (!url) throw new Error('scanUrl requiere "url"');

  const browser = await chromium.launch();
  try {
    return await scanOne(browser, { url, wcagTags, auth, viewport, timeout, waitFor, captureScreenshot, captureHtml });
  } finally {
    await browser.close();
  }
}

/**
 * Clasifica el error de un scan individual dentro del batch para que el agente (dueño de su propio
 * flujo, SPEC §4.1) decida qué hacer: reintentar en timeout, pedir clarificación en auth_required, etc.
 * scanBatch nunca reintenta por su cuenta ni llama a otras tools.
 */
function classifyError(error) {
  if (error instanceof AuthRequiredError) {
    return { type: 'auth_required', message: error.message, status: error.status };
  }
  if (error instanceof playwrightErrors.TimeoutError) {
    return { type: 'timeout', message: error.message };
  }
  return { type: 'unknown', message: error.message };
}

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
