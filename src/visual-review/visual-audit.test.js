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
