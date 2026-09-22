import { randomUUID } from 'node:crypto';
import { ontiCriteria, extendedCriteria, lookupOntiCriterion, lookupExtendedCriterion } from '../classification/wcag-map.js';

const VALID_SEVERITIES = ['critical', 'serious', 'moderate', 'minor'];

export const REPORT_FINDINGS_TOOL = {
  name: 'report_findings',
  description: 'Reporta los hallazgos de accesibilidad/UX detectados en la revisión, uno por objeto.',
  input_schema: {
    type: 'object',
    properties: {
      findings: {
        type: 'array',
        items: {
          type: 'object',
          properties: {
            wcag_criterion: {
              type: 'string',
              description: 'Criterio WCAG más cercano de la lista provista (ej. "1.4.3"). Omitir el campo si ningún criterio de la lista aplica a este hallazgo.'
            },
            severity: { type: 'string', enum: VALID_SEVERITIES },
            failure_summary: { type: 'string', description: 'Descripción breve y concreta del problema encontrado' },
            remediation_hint: { type: 'string', description: 'Cómo corregirlo' },
            element_sample: { type: 'string', description: 'Fragmento de HTML o descripción del elemento afectado, si aplica' }
          },
          required: ['severity', 'failure_summary', 'remediation_hint']
        }
      }
    },
    required: ['findings']
  }
};

/**
 * Texto con los 38 criterios ONTI + 18 extendidos para que el modelo elija el más cercano
 * (o ninguno) al reportar un hallazgo — mismo marco normativo que ya usa el resto del pipeline.
 */
export function criteriaListText(includeExtended = false) {
  const onti = ontiCriteria.map((c) => `${c.wcag_criterion} (${c.level}, onti): ${c.description}`);
  if (!includeExtended) return onti.join('\n');
  const extended = extendedCriteria.map((c) => `${c.wcag_criterion} (${c.level}, extended_22): ${c.description}`);
  return [...onti, ...extended].join('\n');
}

function resolveCriterion(wcagCriterion, { includeExtended }) {
  if (!wcagCriterion) return null;
  const onti = lookupOntiCriterion(wcagCriterion);
  if (onti) return { ...onti, in_scope: 'onti' };
  if (includeExtended) {
    const extended = lookupExtendedCriterion(wcagCriterion);
    if (extended) return { ...extended, in_scope: 'extended_22' };
  }
  return null;
}

function slugify(text) {
  return (text || '')
    .toLowerCase()
    .normalize('NFD').replace(/[̀-ͯ]/g, '')
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/(^-|-$)/g, '')
    .slice(0, 50) || 'hallazgo';
}

/**
 * Normaliza los items crudos del tool_use de report_findings a la forma exacta de finding de
 * SPEC §8.3. Descarta (sin romper el resto) los items sin criterio WCAG reconocido - mismo
 * criterio D7 que ya usa classify-findings.js para axe-core - y defiende contra un `severity`
 * fuera de la enum en vez de dejarlo pasar tal cual (el modelo puede alucinar un valor).
 */
export function normalizeReportedFindings(rawFindings, { url, source, includeExtended = false }) {
  const findings = [];
  for (const raw of rawFindings || []) {
    const criterion = resolveCriterion(raw.wcag_criterion, { includeExtended });
    if (!criterion) continue;

    const severity = VALID_SEVERITIES.includes(raw.severity) ? raw.severity : 'moderate';
    const failureSummary = raw.failure_summary || 'Hallazgo sin descripción provista por el modelo';

    findings.push({
      id: randomUUID(),
      source,
      wcag_criterion: criterion.wcag_criterion,
      wcag_level: criterion.level,
      wcag_description: criterion.description,
      onti_criterion: criterion.in_scope === 'onti',
      in_scope: criterion.in_scope,
      severity,
      rule_id: `${source}:${slugify(failureSummary)}`,
      affected_urls: [url],
      occurrences: 1,
      element_sample: raw.element_sample ?? '',
      failure_summary: failureSummary,
      remediation_hint: raw.remediation_hint || ''
    });
  }
  return findings;
}
