import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createDemoServer, DemoCancelledError } from './demo-server.js';

test('cancelPending corta la pregunta en curso y también las siguientes (se cerró el panel)', async () => {
  const server = createDemoServer();
  const pending = server.askPanel({ kind: 'buttons', text: 'Continuar', options: [] });

  server.cancelPending(new DemoCancelledError());

  await assert.rejects(pending, DemoCancelledError);
  assert.throws(() => server.throwIfCancelled(), DemoCancelledError);
  await assert.rejects(server.askPanel({ kind: 'buttons', text: 'Otra', options: [] }), DemoCancelledError);
});
