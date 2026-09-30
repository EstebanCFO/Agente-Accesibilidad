import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';
import { pathToFileURL, fileURLToPath } from 'node:url';
import { chromium } from 'playwright';
import { walkKeyboard } from './keyboard-walk.js';

const FIXTURES = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../tests/fixtures/keyboard');
const fixtureUrl = (name) => pathToFileURL(path.join(FIXTURES, name)).href;

let browser;
before(async () => { browser = await chromium.launch(); });
after(async () => { await browser.close(); });

async function walkFixture(name) {
  const context = await browser.newContext({ viewport: { width: 1000, height: 700 } });
  try {
    const page = await context.newPage();
    await page.goto(fixtureUrl(name));
    return await walkKeyboard(page);
  } finally {
    await context.close();
  }
}

test('walkKeyboard recorre los elementos en orden y termina al cerrar el ciclo', async () => {
  const walk = await walkFixture('orden-ok.html');
  assert.deepEqual(walk.stops.map((s) => s.name), ['Primero', 'Segundo', 'Tercero']);
  assert.equal(walk.ended, 'ciclo');
  assert.equal(walk.trap, null);
  assert.deepEqual(walk.stops.map((s) => s.index), [1, 2, 3]);
  assert.ok(walk.stops[1].doc_y > walk.stops[0].doc_y);
});

test('walkKeyboard mide el cambio visual al recibir el foco (con outline cambia, sin outline no)', async () => {
  const conFoco = await walkFixture('orden-ok.html');
  assert.ok(conFoco.stops.every((s) => s.focus_change_pct > 1), JSON.stringify(conFoco.stops.map((s) => s.focus_change_pct)));
  const sinFoco = await walkFixture('sin-foco-visible.html');
  assert.ok(sinFoco.stops.every((s) => s.focus_change_pct < 1), JSON.stringify(sinFoco.stops.map((s) => s.focus_change_pct)));
});

test('walkKeyboard guarda los recortes con y sin foco de cada parada', async () => {
  const walk = await walkFixture('orden-ok.html');
  for (const s of walk.stops) {
    assert.ok(s.focused_png?.length > 100);
    assert.ok(s.unfocused_png?.length > 100);
  }
});

test('walkKeyboard detecta una trampa de teclado', async () => {
  const walk = await walkFixture('trampa.html');
  assert.equal(walk.ended, 'trampa');
  assert.deepEqual(walk.trap.paradas.map((i) => walk.stops.find((s) => s.index === i).name).sort(), ['Campo A', 'Campo B']);
});

test('walkKeyboard respeta el orden real del Tab (tabindex positivo va primero)', async () => {
  const walk = await walkFixture('orden-roto.html');
  assert.deepEqual(walk.stops.map((s) => s.name), ['Abajo primero', 'Arriba', 'Medio']);
});

test('walkKeyboard corta y marca la parada que cambia la URL al recibir el foco', async () => {
  const walk = await walkFixture('cambio-al-foco.html');
  assert.equal(walk.ended, 'cambio_de_contexto');
  assert.equal(walk.stops.at(-1).context_change, 'url');
  assert.equal(walk.stops.at(-1).name, 'Buscar');
});

test('walkKeyboard en una página sin elementos enfocables no registra paradas', async () => {
  const walk = await walkFixture('sin-enfocables.html');
  assert.deepEqual(walk.stops, []);
  assert.equal(walk.ended, 'sin_enfocables');
});

test('walkKeyboard respeta el tope de paradas', async () => {
  const context = await browser.newContext();
  try {
    const page = await context.newPage();
    await page.goto(fixtureUrl('orden-ok.html'));
    const walk = await walkKeyboard(page, { maxStops: 2 });
    assert.equal(walk.stops.length, 2);
    assert.equal(walk.ended, 'tope');
  } finally {
    await context.close();
  }
});
