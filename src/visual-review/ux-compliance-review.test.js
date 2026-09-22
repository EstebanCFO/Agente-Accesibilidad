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
  const text = params.messages[0].content.find((b) => b.type === 'text').text;
  assert.ok(text.includes('INICIO HTML DE LA PÁGINA'));
  assert.ok(text.includes('FIN HTML DE LA PÁGINA'));
});

test('runUxComplianceReview no incluye criterios extended_22 en el prompt por default', async () => {
  const client = fakeClient({ findings: [] });
  await runUxComplianceReview({ url: 'https://a.test', html: SAMPLE_HTML }, { anthropicClient: client });
  const [params] = client.calls;
  const text = params.messages[0].content.find((b) => b.type === 'text').text;
  assert.ok(!text.includes('extended_22'));
});

test('runUxComplianceReview incluye criterios extended_22 en el prompt cuando includeExtended:true', async () => {
  const client = fakeClient({ findings: [] });
  await runUxComplianceReview({ url: 'https://a.test', html: SAMPLE_HTML }, { anthropicClient: client, includeExtended: true });
  const [params] = client.calls;
  const text = params.messages[0].content.find((b) => b.type === 'text').text;
  assert.ok(text.includes('extended_22'));
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
