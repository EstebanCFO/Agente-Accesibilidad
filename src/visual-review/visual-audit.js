import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import { REPORT_FINDINGS_TOOL, criteriaListText, normalizeReportedFindings } from './report-findings-schema.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const GUIDELINES = readFileSync(path.join(__dirname, 'references', 'rams-visual-guidelines.md'), 'utf8');

function buildPrompt(url) {
  return [
    `Sos un auditor de accesibilidad visual. Revisá la screenshot de "${url}" siguiendo esta guía:`,
    GUIDELINES,
    'Reportá cada hallazgo con la tool report_findings. Para "wcag_criterion" elegí el más cercano de esta lista (o omitilo si ninguno aplica):',
    criteriaListText()
  ].join('\n\n');
}

/**
 * Corre una revisión visual real vía un modelo con visión (no es axe-core: es la integración
 * real del skill antfu/rams, ver docs/superpowers/specs/2026-09-22-visual-ux-review-design.md).
 * `anthropicClient` se inyecta para poder mockearlo en tests (excepción documentada a la regla
 * de "sin mocks" del resto del repo, justificada por costo real + no-determinismo).
 */
export async function runVisualAudit({ url, screenshot }, { anthropicClient, model = 'claude-sonnet-5' }) {
  if (!url) throw new Error('runVisualAudit requiere "url"');
  if (!screenshot) throw new Error('runVisualAudit requiere "screenshot" (base64 PNG, ver scanUrl con captureScreenshot:true)');

  const response = await anthropicClient.messages.create({
    model,
    max_tokens: 2048,
    tools: [REPORT_FINDINGS_TOOL],
    tool_choice: { type: 'tool', name: 'report_findings' },
    messages: [{
      role: 'user',
      content: [
        { type: 'text', text: buildPrompt(url) },
        { type: 'image', source: { type: 'base64', media_type: 'image/png', data: screenshot } }
      ]
    }]
  });

  const toolUse = response.content.find((block) => block.type === 'tool_use');
  const rawFindings = toolUse?.input?.findings ?? [];
  return { visual_findings: normalizeReportedFindings(rawFindings, { url, source: 'visual_audit' }) };
}
