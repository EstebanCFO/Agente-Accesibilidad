import { test } from 'node:test';
import assert from 'node:assert/strict';
import { runWithConcurrency } from './demo-concurrency.js';

const delay = (ms) => new Promise((r) => setTimeout(r, ms));

test('runWithConcurrency nunca supera el límite de tareas simultáneas', async () => {
  let active = 0;
  let peak = 0;
  const tasks = Array.from({ length: 7 }, (_, i) => async () => {
    active += 1; peak = Math.max(peak, active);
    await delay(10 + (i % 3) * 5);
    active -= 1;
    return i;
  });
  const results = await Promise.all(runWithConcurrency(tasks, 3));
  assert.equal(peak, 3);
  assert.deepEqual(results.map((r) => r.value), [0, 1, 2, 3, 4, 5, 6]);
});

test('runWithConcurrency no corta las demás tareas si una falla', async () => {
  const results = await Promise.all(runWithConcurrency([
    async () => 'a',
    async () => { throw new Error('falló'); },
    async () => 'c'
  ], 2));
  assert.deepEqual(results.map((r) => r.ok), [true, false, true]);
  assert.equal(results[1].error.message, 'falló');
});

test('runWithConcurrency en paralelo tarda como la más lenta, no como la suma', async () => {
  const start = Date.now();
  await Promise.all(runWithConcurrency(Array.from({ length: 4 }, () => () => delay(50)), 4));
  assert.ok(Date.now() - start < 150);
});

test('createLimiter acepta tareas de a una y nunca supera el límite', async () => {
  const { createLimiter } = await import('./demo-concurrency.js');
  const limiter = createLimiter(2);
  let active = 0;
  let peak = 0;
  const task = (value) => async () => {
    active += 1; peak = Math.max(peak, active);
    await new Promise((r) => setTimeout(r, 20));
    active -= 1;
    if (value === 'x') throw new Error('falla');
    return value;
  };
  const first = limiter.run(task('a'));
  const rest = [limiter.run(task('x')), limiter.run(task('c'))];
  const outcomes = await Promise.all([first, ...rest]);
  assert.equal(peak, 2);
  assert.deepEqual(outcomes.map((o) => o.ok), [true, false, true]);
  assert.equal(outcomes[2].value, 'c');
});
