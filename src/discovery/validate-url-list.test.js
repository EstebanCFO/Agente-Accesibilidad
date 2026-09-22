import { test } from 'node:test';
import assert from 'node:assert/strict';
import { validateUrlList } from './validate-url-list.js';

test('validateUrlList separa URLs accesibles de las que devuelven error HTTP', async () => {
  const { validated_list, errors } = await validateUrlList([
    'https://example.com',
    'https://example.com/ruta-que-no-existe-test-404'
  ]);

  assert.deepEqual(validated_list, ['https://example.com']);
  assert.equal(errors.length, 1);
  assert.equal(errors[0].url, 'https://example.com/ruta-que-no-existe-test-404');
  assert.equal(errors[0].status, 404);
});

test('validateUrlList clasifica un dominio inexistente como error sin romper el resto', async () => {
  const { validated_list, errors } = await validateUrlList([
    'https://example.com',
    'https://este-dominio-no-existe.invalid'
  ]);

  assert.deepEqual(validated_list, ['https://example.com']);
  assert.equal(errors.length, 1);
  assert.equal(errors[0].url, 'https://este-dominio-no-existe.invalid');
});

test('validateUrlList clasifica un timeout muy corto como error sin romper el resto', async () => {
  const { validated_list, errors } = await validateUrlList(['https://example.com'], { timeout: 1 });
  assert.deepEqual(validated_list, []);
  assert.equal(errors[0].error, 'timeout');
});

test('validateUrlList requiere urlList no vacío', async () => {
  await assert.rejects(() => validateUrlList([]), /requiere "urlList"/);
});
