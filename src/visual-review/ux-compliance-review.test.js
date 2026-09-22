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
