import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createPromptBroker } from './demo-prompt-broker.js';

test('ask() devuelve un id de texto y una promise, y marca hasPending() true', () => {
  const broker = createPromptBroker();
  const { id, promise } = broker.ask();
  assert.equal(typeof id, 'string');
  assert.ok(promise instanceof Promise);
  assert.equal(broker.hasPending(), true);
});

test('ask() tira si ya hay un prompt pendiente sin responder', () => {
  const broker = createPromptBroker();
  broker.ask();
  assert.throws(() => broker.ask(), /Ya hay un prompt pendiente/);
});

test('answer() con el id correcto resuelve la promise con el value y devuelve true', async () => {
  const broker = createPromptBroker();
  const { id, promise } = broker.ask();
  const ok = broker.answer(id, 'sitio-1');
  assert.equal(ok, true);
  assert.equal(await promise, 'sitio-1');
});

test('answer() con un id que no coincide devuelve false y no resuelve nada', () => {
  const broker = createPromptBroker();
  broker.ask();
  const ok = broker.answer('id-viejo-que-no-existe', 'x');
  assert.equal(ok, false);
  assert.equal(broker.hasPending(), true);
});

test('answer() sin ningún prompt pendiente devuelve false', () => {
  const broker = createPromptBroker();
  assert.equal(broker.answer('cualquier-id', 'x'), false);
});

test('después de un answer() exitoso, hasPending() vuelve a false y se puede pedir otro ask()', async () => {
  const broker = createPromptBroker();
  const first = broker.ask();
  broker.answer(first.id, 'a');
  await first.promise;
  assert.equal(broker.hasPending(), false);
  const second = broker.ask();
  assert.notEqual(second.id, first.id);
});

test('cancelPending(reason) rechaza la promise pendiente y devuelve true', async () => {
  const broker = createPromptBroker();
  const { promise } = broker.ask();
  const ok = broker.cancelPending(new Error('se cerró la ventana'));
  assert.equal(ok, true);
  await assert.rejects(promise, /se cerró la ventana/);
  assert.equal(broker.hasPending(), false);
});

test('cancelPending() sin nada pendiente devuelve false', () => {
  const broker = createPromptBroker();
  assert.equal(broker.cancelPending(new Error('x')), false);
});

test('cancelPending() acepta un string en vez de un Error y lo envuelve', async () => {
  const broker = createPromptBroker();
  const { promise } = broker.ask();
  broker.cancelPending('motivo en texto');
  await assert.rejects(promise, /motivo en texto/);
});
