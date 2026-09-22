import { test } from 'node:test';
import assert from 'node:assert/strict';
import { runVisualAudit } from './visual-audit.js';

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

test('runVisualAudit requiere url y screenshot', async () => {
  await assert.rejects(() => runVisualAudit({ url: '', screenshot: 'x' }, { anthropicClient: fakeClient({ findings: [] }) }), /url/);
  await assert.rejects(() => runVisualAudit({ url: 'https://a.test', screenshot: '' }, { anthropicClient: fakeClient({ findings: [] }) }), /screenshot/);
});

test('runVisualAudit fuerza la tool report_findings y manda la screenshot como imagen', async () => {
  const client = fakeClient({ findings: [] });
  await runVisualAudit({ url: 'https://a.test', screenshot: 'ZmFrZS1wbmc=' }, { anthropicClient: client });

  const [params] = client.calls;
  assert.deepEqual(params.tool_choice, { type: 'tool', name: 'report_findings' });
  assert.equal(params.tools[0].name, 'report_findings');
  const content = params.messages[0].content;
  assert.ok(content.some((block) => block.type === 'image' && block.source.data === 'ZmFrZS1wbmc='));
  assert.ok(content.some((block) => block.type === 'text' && block.text.includes('a.test')));
});

test('runVisualAudit normaliza los findings del tool_use con source "visual_audit"', async () => {
  const client = fakeClient({
    findings: [{ wcag_criterion: '1.4.3', severity: 'serious', failure_summary: 'Contraste insuficiente', remediation_hint: 'Subir contraste' }]
  });
  const { visual_findings } = await runVisualAudit({ url: 'https://a.test', screenshot: 'ZmFrZQ==' }, { anthropicClient: client });

  assert.equal(visual_findings.length, 1);
  assert.equal(visual_findings[0].source, 'visual_audit');
  assert.equal(visual_findings[0].wcag_criterion, '1.4.3');
  assert.deepEqual(visual_findings[0].affected_urls, ['https://a.test']);
});

test('runVisualAudit devuelve visual_findings vacío si el modelo no reporta nada', async () => {
  const client = fakeClient({ findings: [] });
  const { visual_findings } = await runVisualAudit({ url: 'https://a.test', screenshot: 'ZmFrZQ==' }, { anthropicClient: client });
  assert.deepEqual(visual_findings, []);
});

test('runVisualAudit no incluye criterios extended_22 en la lista del prompt por default', async () => {
  const client = fakeClient({ findings: [] });
  await runVisualAudit({ url: 'https://a.test', screenshot: 'ZmFrZQ==' }, { anthropicClient: client });
  const [params] = client.calls;
  const text = params.messages[0].content.find((b) => b.type === 'text').text;
  assert.ok(!text.includes('extended_22'));
});

test('runVisualAudit incluye criterios extended_22 en el prompt cuando includeExtended:true', async () => {
  const client = fakeClient({ findings: [] });
  await runVisualAudit({ url: 'https://a.test', screenshot: 'ZmFrZQ==' }, { anthropicClient: client, includeExtended: true });
  const [params] = client.calls;
  const text = params.messages[0].content.find((b) => b.type === 'text').text;
  assert.ok(text.includes('extended_22'));
});

test('runVisualAudit rechaza una screenshot que supera el límite de trabajo', async () => {
  const client = fakeClient({ findings: [] });
  const oversized = 'a'.repeat(7_000_001);
  await assert.rejects(
    () => runVisualAudit({ url: 'https://a.test', screenshot: oversized }, { anthropicClient: client }),
    /supera el límite de trabajo/
  );
});

test('runVisualAudit marca truncated:true si la respuesta del modelo corta por max_tokens', async () => {
  const client = {
    messages: {
      create: async () => ({ stop_reason: 'max_tokens', content: [{ type: 'tool_use', name: 'report_findings', input: { findings: [] } }] })
    }
  };
  const { truncated } = await runVisualAudit({ url: 'https://a.test', screenshot: 'ZmFrZQ==' }, { anthropicClient: client });
  assert.equal(truncated, true);
});

test('runVisualAudit marca truncated:false cuando la respuesta no trae stop_reason', async () => {
  const client = fakeClient({ findings: [] });
  const { truncated } = await runVisualAudit({ url: 'https://a.test', screenshot: 'ZmFrZQ==' }, { anthropicClient: client });
  assert.equal(truncated, false);
});
