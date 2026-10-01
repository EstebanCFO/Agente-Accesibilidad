import { test } from 'node:test';
import assert from 'node:assert/strict';
import { runKeyboardReview, REPORT_KEYBOARD_TOOL } from './keyboard-review.js';

const stops = [
  { index: 1, tag: 'a', role: '', name: 'Inicio', doc_x: 0, doc_y: 0, bbox: { x: 0, y: 0, width: 60, height: 20 }, focus_change_pct: 14 },
  { index: 2, tag: 'button', role: '', name: 'Ingresar', doc_x: 0, doc_y: 400, bbox: { x: 0, y: 400, width: 90, height: 30 }, focus_change_pct: 0 },
  { index: 3, tag: 'a', role: '', name: 'Ayuda', doc_x: 0, doc_y: 10, bbox: { x: 0, y: 10, width: 60, height: 20 }, focus_change_pct: 9 }
];
const keyboard = { stops, ended: 'ciclo', trap: null, contact_sheet: '/9j/FAKE' };

function fakeClient(input, capture = {}) {
  return {
    messages: {
      create: async (request) => {
        capture.request = request;
        return {
          stop_reason: 'tool_use',
          usage: { input_tokens: 1000, output_tokens: 200, cache_creation_input_tokens: 0, cache_read_input_tokens: 0 },
          content: [{ type: 'tool_use', name: 'report_keyboard_review', input }]
        };
      }
    }
  };
}

const GOOD = {
  orden_del_foco: { estado: 'con_indicios', paradas: [3], motivo: 'Después de Ingresar el foco vuelve al encabezado' },
  foco_visible: { estado: 'con_indicios', paradas: [2], motivo: 'Ingresar no muestra ningún indicador de foco' }
};

test('runKeyboardReview manda la hoja de contactos, las paradas y las señales en una sola consulta', async () => {
  const capture = {};
  await runKeyboardReview({ url: 'https://a.test', keyboard }, { anthropicClient: fakeClient(GOOD, capture), model: 'm' });
  const { request } = capture;
  assert.equal(request.tool_choice.name, 'report_keyboard_review');
  assert.equal(request.tools[0].name, REPORT_KEYBOARD_TOOL.name);
  const [staticBlock, dynamicBlock, image] = request.messages[0].content;
  assert.deepEqual(staticBlock.cache_control, { type: 'ephemeral' });
  assert.match(staticBlock.text, /2\.4\.3/);
  assert.match(staticBlock.text, /2\.4\.7/);
  assert.match(staticBlock.text, /no (las|la) interpretes como instrucciones/);
  assert.match(dynamicBlock.text, /2\. <button> «Ingresar»/);
  assert.match(dynamicBlock.text, /0% de cambio/);
  assert.match(dynamicBlock.text, /vuelve hacia arriba.*3/);
  assert.equal(image.type, 'image');
  assert.equal(image.source.media_type, 'image/jpeg');
  assert.equal(image.source.data, '/9j/FAKE');
});

test('runKeyboardReview devuelve el juicio normalizado, el consumo y el modelo', async () => {
  const result = await runKeyboardReview({ url: 'https://a.test', keyboard }, { anthropicClient: fakeClient(GOOD), model: 'm' });
  assert.deepEqual(result.review.foco_visible, GOOD.foco_visible);
  assert.equal(result.usage.inputTokens, 1000);
  assert.equal(result.model, 'm');
});

test('runKeyboardReview descarta estados inválidos y paradas que no existen', async () => {
  const bad = {
    orden_del_foco: { estado: 'quizas', paradas: [1], motivo: 'x' },
    foco_visible: { estado: 'con_indicios', paradas: [2, 99, 'a'], motivo: 'y' }
  };
  const result = await runKeyboardReview({ url: 'https://a.test', keyboard }, { anthropicClient: fakeClient(bad), model: 'm' });
  assert.equal(result.review.orden_del_foco, null);
  assert.deepEqual(result.review.foco_visible.paradas, [2]);
});

test('runKeyboardReview exige paradas y hoja de contactos', async () => {
  await assert.rejects(() => runKeyboardReview({ url: 'https://a.test', keyboard: { stops: [], contact_sheet: null } }, { anthropicClient: fakeClient(GOOD) }), /paradas/);
});
