import { test } from 'node:test';
import assert from 'node:assert/strict';
import { cleanHtmlForReview } from './clean-html.js';

test('cleanHtmlForReview elimina scripts, estilos, comentarios y metadatos', () => {
  const { html } = cleanHtmlForReview(`<html><head><meta charset="utf-8"><link rel="stylesheet" href="a.css">
    <style>.x{color:red}</style><script>alert(1)</script></head>
    <body><!-- comentario --><noscript>sin js</noscript><h1>Hola</h1></body></html>`);
  assert.ok(!html.includes('alert'));
  assert.ok(!html.includes('.x{'));
  assert.ok(!html.includes('comentario'));
  assert.ok(!html.includes('stylesheet'));
  assert.ok(!html.includes('sin js'));
  assert.ok(html.includes('<h1>Hola</h1>'));
});

test('cleanHtmlForReview conserva atributos de accesibilidad y descarta los de maquetación', () => {
  const { html } = cleanHtmlForReview('<label for="monto" class="lbl big" data-track="x">Monto</label><input id="monto" type="text" aria-describedby="ayuda" required onclick="hack()" class="form-control">');
  assert.ok(html.includes('for="monto"'));
  assert.ok(html.includes('aria-describedby="ayuda"'));
  assert.ok(html.includes('required'));
  assert.ok(!html.includes('class='));
  assert.ok(!html.includes('data-track'));
  assert.ok(!html.includes('onclick'));
});

test('cleanHtmlForReview conserva el style inline (color como única señal, criterio 1.4.1)', () => {
  const sample = '<form><input type="text"><span style="color:red">Error</span></form>';
  assert.equal(cleanHtmlForReview(sample).html, sample);
});

test('cleanHtmlForReview reduce los SVG a su título y recorta imágenes embebidas', () => {
  const { html } = cleanHtmlForReview(`<svg aria-label="Buscar" viewBox="0 0 24 24"><title>Buscar</title><path d="M1 2 L3 4 ${'L5 6 '.repeat(200)}"/></svg><img alt="" src="data:image/png;base64,${'A'.repeat(5000)}">`);
  assert.ok(html.includes('<svg aria-label="Buscar"><title>Buscar</title></svg>'));
  assert.ok(!html.includes('<path'));
  assert.ok(html.includes('src="data:…"'));
  assert.ok(html.length < 200);
});

test('cleanHtmlForReview informa el largo original y el final', () => {
  const raw = `<div class="a b c d e f">${'<script>x()</script>'.repeat(50)}Texto</div>`;
  const result = cleanHtmlForReview(raw);
  assert.equal(result.originalLength, raw.length);
  assert.equal(result.cleanedLength, result.html.length);
  assert.equal(result.html, '<div>Texto</div>');
});
