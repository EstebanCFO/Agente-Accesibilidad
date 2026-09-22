import { test } from 'node:test';
import assert from 'node:assert/strict';
import { classifyModule } from './module-classifier.js';

test('classifyModule toma el primer segmento del path como módulo', () => {
  assert.equal(classifyModule('https://banco.example.com/home-banking/transferencias/nueva'), 'home-banking');
});

test('classifyModule devuelve "raiz" para la URL raíz sin path', () => {
  assert.equal(classifyModule('https://banco.example.com/'), 'raiz');
  assert.equal(classifyModule('https://banco.example.com'), 'raiz');
});

test('classifyModule ignora query string y hash', () => {
  assert.equal(classifyModule('https://banco.example.com/onboarding/paso1?ref=email#top'), 'onboarding');
});

test('classifyModule devuelve la URL cruda si no se puede parsear', () => {
  assert.equal(classifyModule('no-es-una-url'), 'no-es-una-url');
});
