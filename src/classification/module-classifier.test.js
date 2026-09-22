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

test('classifyModule devuelve "desconocido" si la URL no se puede parsear', () => {
  assert.equal(classifyModule('no-es-una-url'), 'desconocido');
  assert.equal(classifyModule('//host-relativo/path'), 'desconocido');
});

test('classifyModule decodifica el segmento (ej. acentos percent-encoded)', () => {
  assert.equal(classifyModule('https://banco.example.com/pr%C3%A9stamos/simular'), 'préstamos');
});

test('classifyModule cae al segmento crudo si el percent-encoding está mal formado', () => {
  assert.equal(classifyModule('https://banco.example.com/mal%formado/x'), 'mal%formado');
});
