import { test } from 'node:test';
import assert from 'node:assert/strict';
import { runUxComplianceReview } from './ux-compliance-review.js';

function fakeClient(toolInput) {
  const calls = [];
  return {
    calls,
    messages: {
      create: async (params) => {
        calls.push(params);
        return { content: [{ type: 'tool_use', name: 'report_findings', input: toolInput }] };
      }
    }
  };
}

const SAMPLE_HTML = '<form><input type="text"><span style="color:red">Error</span></form>';

// El prompt ahora se manda en más de un bloque de texto (estático cacheable + dinámico con el
// HTML) - esto concatena todos los bloques de texto para los checks de contenido que no les
// importa en qué bloque puntual cae el texto.
function allTextIn(content) {
  return content.filter((b) => b.type === 'text').map((b) => b.text).join('\n');
}

test('runUxComplianceReview requiere url y html', async () => {
  await assert.rejects(() => runUxComplianceReview({ url: '', html: SAMPLE_HTML }, { anthropicClient: fakeClient({ findings: [] }) }), /url/);
  await assert.rejects(() => runUxComplianceReview({ url: 'https://a.test', html: '' }, { anthropicClient: fakeClient({ findings: [] }) }), /html/);
});

test('runUxComplianceReview manda el HTML como texto y no requiere screenshot', async () => {
  const client = fakeClient({ findings: [] });
  await runUxComplianceReview({ url: 'https://a.test', html: SAMPLE_HTML }, { anthropicClient: client });

  const [params] = client.calls;
  const content = params.messages[0].content;
  assert.ok(content.some((block) => block.type === 'text' && block.text.includes(SAMPLE_HTML)));
  assert.ok(!content.some((block) => block.type === 'image'));
});

test('runUxComplianceReview incluye la screenshot como bloque opcional si se pasa', async () => {
  const client = fakeClient({ findings: [] });
  await runUxComplianceReview({ url: 'https://a.test', html: SAMPLE_HTML, screenshot: 'ZmFrZQ==' }, { anthropicClient: client });

  const [params] = client.calls;
  const content = params.messages[0].content;
  assert.ok(content.some((block) => block.type === 'image' && block.source.data === 'ZmFrZQ=='));
  assert.ok(content.some((block) => block.type === 'text' && block.text.includes(SAMPLE_HTML)));
});

test('runUxComplianceReview normaliza los findings del tool_use con source "ux_review"', async () => {
  const client = fakeClient({
    findings: [{ wcag_criterion: '3.3.1', severity: 'moderate', failure_summary: 'Error de color solo', remediation_hint: 'Agregar texto e ícono' }]
  });
  const { ux_findings } = await runUxComplianceReview({ url: 'https://a.test', html: SAMPLE_HTML }, { anthropicClient: client });

  assert.equal(ux_findings.length, 1);
  assert.equal(ux_findings[0].source, 'ux_review');
  assert.equal(ux_findings[0].wcag_criterion, '3.3.1');
});

test('runUxComplianceReview delimita el HTML de la página con marcadores explícitos (datos, no instrucciones)', async () => {
  const client = fakeClient({ findings: [] });
  await runUxComplianceReview({ url: 'https://a.test', html: SAMPLE_HTML }, { anthropicClient: client });
  const [params] = client.calls;
  const text = allTextIn(params.messages[0].content);
  assert.ok(text.includes('INICIO HTML DE LA PÁGINA'));
  assert.ok(text.includes('FIN HTML DE LA PÁGINA'));
});

test('runUxComplianceReview no incluye criterios extended_22 en el prompt por default', async () => {
  const client = fakeClient({ findings: [] });
  await runUxComplianceReview({ url: 'https://a.test', html: SAMPLE_HTML }, { anthropicClient: client });
  const [params] = client.calls;
  const text = allTextIn(params.messages[0].content);
  assert.ok(!text.includes('extended_22'));
});

test('runUxComplianceReview incluye criterios extended_22 en el prompt cuando includeExtended:true', async () => {
  const client = fakeClient({ findings: [] });
  await runUxComplianceReview({ url: 'https://a.test', html: SAMPLE_HTML }, { anthropicClient: client, includeExtended: true });
  const [params] = client.calls;
  const text = allTextIn(params.messages[0].content);
  assert.ok(text.includes('extended_22'));
});

test('runUxComplianceReview separa el prompt en un bloque estático cacheable (guía + criterios) y uno dinámico con el HTML', async () => {
  const client = fakeClient({ findings: [] });
  await runUxComplianceReview({ url: 'https://a.test', html: SAMPLE_HTML }, { anthropicClient: client });
  const [params] = client.calls;

  const [staticBlock, dynamicBlock] = params.messages[0].content;
  assert.equal(staticBlock.type, 'text');
  assert.deepEqual(staticBlock.cache_control, { type: 'ephemeral' });
  assert.ok(!staticBlock.text.includes(SAMPLE_HTML), 'el bloque estático no debe llevar el HTML de la página');

  assert.equal(dynamicBlock.type, 'text');
  assert.ok(dynamicBlock.text.includes(SAMPLE_HTML));
  assert.equal(dynamicBlock.cache_control, undefined, 'el bloque con el HTML cambia en cada llamada, no se cachea');
});

test('runUxComplianceReview rechaza un HTML que supera el límite de trabajo', async () => {
  const client = fakeClient({ findings: [] });
  const oversizedHtml = '<div>' + 'a'.repeat(300_001) + '</div>';
  await assert.rejects(
    () => runUxComplianceReview({ url: 'https://a.test', html: oversizedHtml }, { anthropicClient: client }),
    /supera el límite de trabajo/
  );
});

test('runUxComplianceReview marca truncated:true si la respuesta del modelo corta por max_tokens', async () => {
  const client = {
    messages: {
      create: async () => ({ stop_reason: 'max_tokens', content: [{ type: 'tool_use', name: 'report_findings', input: { findings: [] } }] })
    }
  };
  const { truncated } = await runUxComplianceReview({ url: 'https://a.test', html: SAMPLE_HTML }, { anthropicClient: client });
  assert.equal(truncated, true);
});

test('runUxComplianceReview marca truncated:false cuando la respuesta no trae stop_reason', async () => {
  const client = fakeClient({ findings: [] });
  const { truncated } = await runUxComplianceReview({ url: 'https://a.test', html: SAMPLE_HTML }, { anthropicClient: client });
  assert.equal(truncated, false);
});
