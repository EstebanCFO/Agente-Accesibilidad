import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import { REPORT_FINDINGS_TOOL, criteriaListText, normalizeReportedFindings } from './report-findings-schema.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const GUIDELINES = readFileSync(path.join(__dirname, 'references', 'ux-interaction-guidelines.md'), 'utf8');

function buildPrompt(url, html) {
  return [
    `Sos un revisor de coherencia de navegación y UX. Revisá el HTML de "${url}" siguiendo esta guía:`,
    GUIDELINES,
    'HTML de la página:',
    html,
    'Reportá cada hallazgo con la tool report_findings. Para "wcag_criterion" elegí el más cercano de esta lista (o omitilo si ninguno aplica):',
    criteriaListText()
  ].join('\n\n');
}

/**
 * Corre una revisión de UX/coherencia de navegación real vía modelo, usando el HTML ya
 * capturado por scanUrl/scanBatch (captureHtml:true) como stand-in simplificado de
 * "interaction_flows" (SPEC §19.2) - ver limitación documentada en el spec de diseño.
 * `anthropicClient` inyectado, mismo motivo que visual-audit.js.
 */
export async function runUxComplianceReview({ url, html, screenshot }, { anthropicClient, model = 'claude-sonnet-5' }) {
  if (!url) throw new Error('runUxComplianceReview requiere "url"');
  if (!html) throw new Error('runUxComplianceReview requiere "html" (ver scanUrl con captureHtml:true)');

  const content = [{ type: 'text', text: buildPrompt(url, html) }];
  if (screenshot) {
    content.push({ type: 'image', source: { type: 'base64', media_type: 'image/png', data: screenshot } });
  }

  const response = await anthropicClient.messages.create({
    model,
    max_tokens: 2048,
    tools: [REPORT_FINDINGS_TOOL],
    tool_choice: { type: 'tool', name: 'report_findings' },
    messages: [{ role: 'user', content }]
  });

  const toolUse = response.content.find((block) => block.type === 'tool_use');
  const rawFindings = toolUse?.input?.findings ?? [];
  return { ux_findings: normalizeReportedFindings(rawFindings, { url, source: 'ux_review' }) };
}
