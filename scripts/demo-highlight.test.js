import { test } from 'node:test';
import assert from 'node:assert/strict';
import { buildHighlightTargets, buildBadgeText } from './demo-highlight.js';

test('buildHighlightTargets arma un target por nodo con el color de su severidad', () => {
  const violations = [
    { impact: 'critical', help: 'Falta texto alternativo', nodes: [{ target: ['img.logo'] }, { target: ['img.banner'] }] },
    { impact: 'moderate', help: 'Contraste insuficiente', nodes: [{ target: ['.footer-link'] }] }
  ];
  const targets = buildHighlightTargets(violations);
  assert.equal(targets.length, 3);
  assert.equal(targets[0].selector, 'img.logo');
  assert.equal(targets[0].color, '#d03b3b');
  assert.equal(targets[0].label, 'Falta texto alternativo');
  assert.equal(targets[2].selector, '.footer-link');
  assert.equal(targets[2].color, '#fab219');
});

test('buildHighlightTargets con severidad desconocida cae al color de "minor"', () => {
  const targets = buildHighlightTargets([{ impact: 'rara', help: 'x', nodes: [{ target: ['.x'] }] }]);
  assert.equal(targets[0].color, '#898781');
});

test('buildHighlightTargets sin violations devuelve lista vacía', () => {
  assert.deepEqual(buildHighlightTargets([]), []);
  assert.deepEqual(buildHighlightTargets(undefined), []);
});

test('buildBadgeText cuenta ocurrencias totales, no solo cantidad de reglas', () => {
  const violations = [{ impact: 'critical', nodes: [{}, {}] }, { impact: 'moderate', nodes: [{}] }];
  assert.match(buildBadgeText(violations), /^3 problemas/);
});

test('buildBadgeText usa singular cuando hay exactamente 1', () => {
  const violations = [{ impact: 'critical', nodes: [{}] }];
  assert.match(buildBadgeText(violations), /^1 problema /);
  assert.doesNotMatch(buildBadgeText(violations), /problemas/);
});

test('buildBadgeText sin violations da un mensaje positivo', () => {
  assert.match(buildBadgeText([]), /Sin problemas detectados/);
  assert.match(buildBadgeText(undefined), /Sin problemas detectados/);
});
