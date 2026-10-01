import { test } from 'node:test';
import assert from 'node:assert/strict';
import { detectOrderJumps, lowVisibilityStops, buildKeyboardCriteria, computeKeyboardScore, MIN_FOCUS_CHANGE_PCT } from './keyboard-criteria.js';

const stop = (index, docY, { docX = 0, height = 20, pct = 10, context = null } = {}) => ({
  index, tag: 'a', role: '', name: `link ${index}`, selector: `#s${index}`, doc_x: docX, doc_y: docY,
  bbox: { x: docX, y: docY, width: 80, height }, focus_change_pct: pct, context_change: context
});
const walk = (stops, extra = {}) => ({ stops, ended: 'ciclo', trap: null, ...extra });

test('detectOrderJumps marca las paradas donde el foco vuelve hacia arriba en la pantalla', () => {
  const jumps = detectOrderJumps([stop(1, 0), stop(2, 100), stop(3, 20), stop(4, 200)]);
  assert.deepEqual(jumps, [{ from: 2, to: 3 }]);
});

test('detectOrderJumps tolera elementos de la misma fila', () => {
  assert.deepEqual(detectOrderJumps([stop(1, 100), stop(2, 95, { docX: 200 })]), []);
});

test('lowVisibilityStops devuelve las paradas cuyo aspecto casi no cambia al recibir el foco', () => {
  const stops = [stop(1, 0, { pct: 12 }), stop(2, 50, { pct: 0 }), stop(3, 90, { pct: null })];
  assert.deepEqual(lowVisibilityStops(stops), [2]);
  assert.ok(MIN_FOCUS_CHANGE_PCT > 0);
});

test('buildKeyboardCriteria sin indicios con reglas solas cuando todo está bien', () => {
  const criteria = buildKeyboardCriteria(walk([stop(1, 0), stop(2, 50)]));
  for (const c of ['2.1.2', '2.4.3', '2.4.7', '3.2.1']) assert.equal(criteria[c].estado, 'sin_indicios', c);
  assert.equal(criteria['2.4.7'].fuente, 'reglas');
});

test('buildKeyboardCriteria: trampa de teclado da indicios en 2.1.2', () => {
  const criteria = buildKeyboardCriteria(walk([stop(1, 0), stop(2, 50), stop(3, 90)], { ended: 'trampa', trap: { paradas: [2, 3] } }));
  assert.equal(criteria['2.1.2'].estado, 'con_indicios');
  assert.deepEqual(criteria['2.1.2'].paradas, [2, 3]);
});

test('buildKeyboardCriteria: cambio de contexto al recibir el foco da indicios en 3.2.1', () => {
  const criteria = buildKeyboardCriteria(walk([stop(1, 0), stop(2, 50, { context: 'url' })], { ended: 'cambio_de_contexto' }));
  assert.equal(criteria['3.2.1'].estado, 'con_indicios');
  assert.deepEqual(criteria['3.2.1'].paradas, [2]);
});

test('buildKeyboardCriteria: sin IA, saltos y foco invisible dan indicios y se aclara la fuente', () => {
  const criteria = buildKeyboardCriteria(walk([stop(1, 100), stop(2, 0, { pct: 0 })]), { aiFailed: true });
  assert.equal(criteria['2.4.3'].estado, 'con_indicios');
  assert.equal(criteria['2.4.7'].estado, 'con_indicios');
  assert.equal(criteria['2.4.7'].fuente, 'reglas (sin interpretación del Agente)');
});

test('buildKeyboardCriteria usa el juicio de la IA para 2.4.3 y 2.4.7 cuando está', () => {
  const ai = {
    orden_del_foco: { estado: 'sin_indicios', paradas: [], motivo: 'El salto es a un menú lateral, orden lógico' },
    foco_visible: { estado: 'con_indicios', paradas: [1], motivo: 'El borde de foco apenas se distingue' }
  };
  const criteria = buildKeyboardCriteria(walk([stop(1, 100), stop(2, 0)]), { ai });
  assert.equal(criteria['2.4.3'].estado, 'sin_indicios');
  assert.equal(criteria['2.4.3'].fuente, 'Agente');
  assert.equal(criteria['2.4.7'].motivo, 'El borde de foco apenas se distingue');
});

test('buildKeyboardCriteria: página sin enfocables o recorrido fallido queda no evaluable', () => {
  const vacia = buildKeyboardCriteria(walk([], { ended: 'sin_enfocables' }));
  assert.equal(vacia['2.4.7'].estado, 'no_evaluable');
  assert.match(vacia['2.4.7'].motivo, /no tiene elementos que reciban el foco/);
  const fallida = buildKeyboardCriteria(null, { error: 'Timeout' });
  assert.equal(fallida['2.1.2'].estado, 'no_evaluable');
  assert.match(fallida['2.1.2'].motivo, /Timeout/);
});

test('computeKeyboardScore: % de pares página×criterio sin indicios sobre los evaluables', () => {
  const ok = buildKeyboardCriteria(walk([stop(1, 0)]));
  const mal = buildKeyboardCriteria(walk([stop(1, 0, { pct: 0 })]), { aiFailed: true });
  const vacia = buildKeyboardCriteria(walk([], { ended: 'sin_enfocables' }));
  const score = computeKeyboardScore([{ criteria: ok }, { criteria: mal }, { criteria: vacia }]);
  assert.deepEqual(score, { score: 87.5, sin_indicios: 7, con_indicios: 1, no_evaluable: 4 });
});

test('computeKeyboardScore sin pares evaluables devuelve score null', () => {
  assert.equal(computeKeyboardScore([]).score, null);
});
