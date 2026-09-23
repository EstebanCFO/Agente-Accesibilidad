import { test } from 'node:test';
import assert from 'node:assert/strict';
import { computeWindowLayout } from './demo-window-layout.js';

test('computeWindowLayout ubica el panel arriba y el navegador de prueba justo debajo, sin superponerse', () => {
  const layout = computeWindowLayout(1920, 1080, 260);
  assert.deepEqual(layout.panel, { left: 0, top: 0, width: 1920, height: 260 });
  assert.deepEqual(layout.test, { left: 0, top: 260, width: 1920, height: 820 });
});

test('computeWindowLayout usa el ancho completo de la pantalla para ambas ventanas', () => {
  const layout = computeWindowLayout(1280, 720, 260);
  assert.equal(layout.panel.width, 1280);
  assert.equal(layout.test.width, 1280);
});

test('computeWindowLayout tira un error claro si la pantalla es demasiado chica para el layout', () => {
  assert.throws(() => computeWindowLayout(1280, 500, 260), /Pantalla demasiado chica/);
});

test('computeWindowLayout acepta un panelHeight tal que el navegador de prueba queda justo en el mínimo permitido', () => {
  const layout = computeWindowLayout(1280, 560, 260);
  assert.equal(layout.test.height, 300);
});
