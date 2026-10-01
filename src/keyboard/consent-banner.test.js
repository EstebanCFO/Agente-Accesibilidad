import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';
import { pathToFileURL, fileURLToPath } from 'node:url';
import { chromium } from 'playwright';
import { dismissConsentBanner } from './consent-banner.js';
import { walkKeyboard } from './keyboard-walk.js';

const FIXTURES = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../tests/fixtures/keyboard');
const fixtureUrl = (name) => pathToFileURL(path.join(FIXTURES, name)).href;

let browser;
before(async () => { browser = await chromium.launch(); });
after(async () => { await browser.close(); });

async function withPage(name, fn) {
  const context = await browser.newContext({ viewport: { width: 1000, height: 700 } });
  try {
    const page = await context.newPage();
    await page.goto(fixtureUrl(name));
    return await fn(page);
  } finally {
    await context.close();
  }
}

test('dismissConsentBanner cierra el banner prefiriendo Rechazar', async () => {
  const result = await withPage('banner-cookies.html', async (page) => {
    const r = await dismissConsentBanner(page);
    assert.equal(await page.locator('#cookie-consent').count(), 0);
    return r;
  });
  assert.deepEqual(result, { detected: true, dismissed: true, action: 'Rechazar' });
});

test('con el banner cerrado, el recorrido con Tab llega a la página', async () => {
  const names = await withPage('banner-cookies.html', async (page) => {
    await dismissConsentBanner(page);
    return (await walkKeyboard(page, { resetStart: true })).stops.map((s) => s.name);
  });
  assert.deepEqual(names, ['Inicio', 'Productos', 'Contacto']);
});

test('dismissConsentBanner usa Aceptar si es la única salida', async () => {
  const result = await withPage('banner-solo-aceptar.html', (page) => dismissConsentBanner(page));
  assert.deepEqual(result, { detected: true, dismissed: true, action: 'Aceptar' });
});

test('dismissConsentBanner no toca una página sin banner', async () => {
  const result = await withPage('orden-ok.html', (page) => dismissConsentBanner(page));
  assert.deepEqual(result, { detected: false, dismissed: false, action: null });
});

test('dismissConsentBanner da por cerrado un banner que queda vacío (0 px) tras una animación', async () => {
  const result = await withPage('banner-colapsa.html', (page) => dismissConsentBanner(page));
  assert.deepEqual(result, { detected: true, dismissed: true, action: 'Rechazar' });
});
