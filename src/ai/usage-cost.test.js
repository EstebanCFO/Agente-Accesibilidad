import { test } from 'node:test';
import assert from 'node:assert/strict';
import { usageFromResponse, addUsage, emptyUsage, totalTokens, resolvePricing, estimateCostUsd } from './usage-cost.js';

test('usageFromResponse lee los cuatro contadores y tolera usage ausente', () => {
  assert.deepEqual(usageFromResponse({ usage: { input_tokens: 10, output_tokens: 5, cache_creation_input_tokens: 3, cache_read_input_tokens: 2 } }),
    { calls: 1, inputTokens: 10, outputTokens: 5, cacheWriteTokens: 3, cacheReadTokens: 2 });
  assert.deepEqual(usageFromResponse({}), { calls: 1, inputTokens: 0, outputTokens: 0, cacheWriteTokens: 0, cacheReadTokens: 0 });
});

test('addUsage suma y totalTokens cuenta todos los tipos', () => {
  const sum = addUsage(usageFromResponse({ usage: { input_tokens: 10, output_tokens: 5 } }), usageFromResponse({ usage: { input_tokens: 1, cache_read_input_tokens: 4 } }));
  assert.equal(sum.calls, 2);
  assert.equal(totalTokens(sum), 20);
  assert.deepEqual(addUsage(null, null), emptyUsage());
});

test('estimateCostUsd usa el precio de claude-sonnet-5 (US$ 2 entrada / 10 salida por millón)', () => {
  const pricing = resolvePricing('claude-sonnet-5');
  const cost = estimateCostUsd({ inputTokens: 1_000_000, outputTokens: 100_000, cacheWriteTokens: 0, cacheReadTokens: 0 }, pricing);
  assert.equal(cost, 3);
});

test('resolvePricing acepta ids con fecha, overrides por entorno y devuelve null si no conoce el modelo', () => {
  assert.equal(resolvePricing('claude-sonnet-5-20260115').input, 2);
  assert.equal(resolvePricing('claude-sonnet-5', { AI_PRICE_OUTPUT: '12' }).output, 12);
  assert.equal(resolvePricing('modelo-desconocido'), null);
  assert.equal(resolvePricing('modelo-desconocido', { AI_PRICE_INPUT: '1' }).input, 1);
  assert.equal(estimateCostUsd(emptyUsage(), null), null);
});
