import { test } from 'node:test';
import assert from 'node:assert/strict';
import { chromium } from 'playwright';
import { buildContactSheetHtml, renderContactSheet } from './contact-sheet.js';

// PNG 1x1 transparente.
const PNG = 'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg==';
const stop = (index, name, pct = 12) => ({ index, name, tag: 'button', focus_change_pct: pct, focused_png: PNG, unfocused_png: PNG });

test('buildContactSheetHtml numera cada parada con sus dos recortes y el % de cambio', () => {
  const html = buildContactSheetHtml([stop(1, 'Ingresar'), stop(2, 'Ayuda', 0)]);
  assert.match(html, />1</);
  assert.match(html, /Ingresar/);
  assert.equal((html.match(/data:image\/png;base64,/g) || []).length, 4);
  assert.match(html, /Sin foco/);
  assert.match(html, /Con foco/);
  assert.match(html, /0% de cambio/);
});

test('buildContactSheetHtml escapa los nombres (el contenido del sitio no inyecta HTML)', () => {
  const html = buildContactSheetHtml([stop(1, '<img src=x onerror=alert(1)>')]);
  assert.ok(!html.includes('<img src=x onerror'));
});

test('buildContactSheetHtml omite recortes de paradas sin captura', () => {
  const html = buildContactSheetHtml([{ index: 1, name: 'Fuera de pantalla', tag: 'a', focus_change_pct: null }]);
  assert.match(html, /sin captura/);
});

test('renderContactSheet devuelve un JPEG en base64, o null sin paradas', async () => {
  const browser = await chromium.launch();
  try {
    const context = await browser.newContext();
    const jpeg = await renderContactSheet(context, [stop(1, 'Ingresar'), stop(2, 'Ayuda')]);
    assert.ok(jpeg.startsWith('/9j/'));
    assert.equal(await renderContactSheet(context, []), null);
    await context.close();
  } finally {
    await browser.close();
  }
});

// Alto de un JPEG leyendo su marcador SOF (sin dependencias).
function jpegHeight(base64) {
  const b = Buffer.from(base64, 'base64');
  for (let i = 2; i < b.length;) {
    const marker = b[i + 1];
    const len = b.readUInt16BE(i + 2);
    if (marker >= 0xc0 && marker <= 0xc3) return b.readUInt16BE(i + 5);
    i += 2 + len;
  }
  return null;
}

test('renderContactSheet recorta la imagen al contenido (sin blanco sobrante)', async () => {
  const browser = await chromium.launch();
  try {
    const context = await browser.newContext();
    const jpeg = await renderContactSheet(context, [stop(1, 'Ingresar')]);
    assert.ok(jpegHeight(jpeg) < 300, `alto ${jpegHeight(jpeg)}`);
    await context.close();
  } finally {
    await browser.close();
  }
});
