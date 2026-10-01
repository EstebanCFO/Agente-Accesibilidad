import { mkdir, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { buildScoreDeliverable } from './score-deliverable.js';
import { buildInventarioJson, buildInventarioHtml, buildInventarioWorkbook } from './inventario-deliverable.js';
import { buildRoadmapItems, buildRoadmapJson, buildRoadmapHtml, buildRoadmapWorkbook } from './roadmap-deliverable.js';
import { buildConformityMatrix, buildSeverityImpactGrid, buildMatrizJson, buildMatrizHtml, buildMatrizWorkbook } from './matriz-deliverable.js';
import { splitFindings } from '../classification/finding-sources.js';
import { buildDashboardHtml } from './dashboard-deliverable.js';
import { buildConsolidatedDashboardHtml } from './consolidated-dashboard-deliverable.js';
import { buildInformeNarrativoJson, buildInformeNarrativoHtml } from './informe-narrativo-deliverable.js';
import { buildConsolidatedReportHtml, renderPdf } from './pdf-report-deliverable.js';
import { buildVpatReportHtml } from './vpat-deliverable.js';

async function writeJsonFile(outputDir, filename, doc) {
  await mkdir(outputDir, { recursive: true });
  const filePath = path.join(outputDir, filename);
  await writeFile(filePath, JSON.stringify(doc, null, 2), 'utf8');
  return filePath;
}

async function writeTextFile(outputDir, filename, content) {
  await mkdir(outputDir, { recursive: true });
  const filePath = path.join(outputDir, filename);
  await writeFile(filePath, content, 'utf8');
  return filePath;
}

const BUILDERS = {
  score: async (data, outputDir) => {
    const doc = buildScoreDeliverable(data);
    const filePath = await writeJsonFile(outputDir, 'score-compliance.json', doc);
    return [filePath];
  },
  inventario: async (data, outputDir) => {
    const jsonDoc = buildInventarioJson(data);
    if (data.complementaryFindings?.length) jsonDoc.complementary_findings = data.complementaryFindings;
    const jsonPath = await writeJsonFile(outputDir, 'inventario-hallazgos.json', jsonDoc);
    const htmlPath = await writeTextFile(outputDir, 'inventario-hallazgos.html', buildInventarioHtml({
      jobId: data.jobId, findings: data.findings, complementaryFindings: data.complementaryFindings, urls: data.urls
    }));

    const workbook = await buildInventarioWorkbook(data.findings);
    await mkdir(outputDir, { recursive: true });
    const xlsxPath = path.join(outputDir, 'inventario-hallazgos.xlsx');
    await workbook.xlsx.writeFile(xlsxPath);

    return [jsonPath, htmlPath, xlsxPath];
  },
  roadmap: async (data, outputDir) => {
    const items = buildRoadmapItems(data.findings);

    const jsonPath = await writeJsonFile(outputDir, 'roadmap-remediacion.json', buildRoadmapJson({ jobId: data.jobId, items }));
    const htmlPath = await writeTextFile(outputDir, 'roadmap-remediacion.html', buildRoadmapHtml({ jobId: data.jobId, channel: data.channel, items, urls: data.urls, bestPractices: data.scores?.best_practices ?? null }));

    const workbook = await buildRoadmapWorkbook(items);
    await mkdir(outputDir, { recursive: true });
    const xlsxPath = path.join(outputDir, 'roadmap-remediacion.xlsx');
    await workbook.xlsx.writeFile(xlsxPath);

    return [jsonPath, htmlPath, xlsxPath];
  },
  matriz: async (data, outputDir) => {
    const includeExtended = data.includeExtended ?? false;
    const urls = data.urls || [];
    const conformity = buildConformityMatrix({ findings: data.findings, urls, includeExtended, axeResults: data.axe_results ?? data.axeResults ?? [] });
    const moduleConformity = null;
    const severityImpactGrid = buildSeverityImpactGrid(data.findings);

    const jsonPath = await writeJsonFile(outputDir, 'matriz-criticidad.json', buildMatrizJson({
      jobId: data.jobId, channel: data.channel, conformity, moduleConformity, severityImpactGrid
    }));
    const htmlPath = await writeTextFile(outputDir, 'matriz-criticidad.html', buildMatrizHtml({
      jobId: data.jobId, channel: data.channel, conformity, moduleConformity, severityImpactGrid
    }));

    const workbook = await buildMatrizWorkbook({ conformity, moduleConformity, severityImpactGrid, bestPractices: data.scores?.best_practices ?? null });
    await mkdir(outputDir, { recursive: true });
    const xlsxPath = path.join(outputDir, 'matriz-criticidad.xlsx');
    await workbook.xlsx.writeFile(xlsxPath);

    return [jsonPath, htmlPath, xlsxPath];
  },
  dashboard: async (data, outputDir) => {

    const html = buildDashboardHtml({ jobId: data.jobId, channel: data.channel, scores: data.scores, findings: data.findings, complementaryFindings: data.complementaryFindings, urls: data.urls, axeResults: data.axe_results ?? data.axeResults ?? [], includeExtended: data.includeExtended ?? false, keyboardResults: data.keyboardResults ?? [] });
    const filePath = await writeTextFile(outputDir, 'dashboard.html', html);
    return [filePath];
  },
  'informe-narrativo': async (data, outputDir) => {

    const jsonPath = await writeJsonFile(outputDir, 'informe-narrativo.json', buildInformeNarrativoJson({
      jobId: data.jobId, channel: data.channel, findings: data.findings, essentialFlows: data.essentialFlows,
      axeResults: data.axe_results ?? data.axeResults ?? [], scores: data.scores
    }));
    const htmlPath = await writeTextFile(outputDir, 'informe-narrativo.html', buildInformeNarrativoHtml({
      jobId: data.jobId, channel: data.channel, findings: data.findings, complementaryFindings: data.complementaryFindings, essentialFlows: data.essentialFlows, urls: data.urls, scores: data.scores, axeResults: data.axe_results ?? data.axeResults ?? []
    }));
    return [jsonPath, htmlPath];
  },
  // Informe consolidado en PDF (portada + metodología + score, inventario y matriz).
  'informe-pdf': async (data, outputDir) => {
    const html = buildConsolidatedReportHtml(data);
    await mkdir(outputDir, { recursive: true });
    const pdfPath = path.join(outputDir, 'informe-consolidado.pdf');
    await renderPdf(html, pdfPath, { jobId: data.jobId });
    return [pdfPath];
  },
  // Informe de Conformidad de Accesibilidad basado en VPAT 2.5, edición WCAG (spec 2026-10-01).
  vpat: async (data, outputDir) => {
    const html = buildVpatReportHtml(data);
    await mkdir(outputDir, { recursive: true });
    const pdfPath = path.join(outputDir, 'vpat-wcag.pdf');
    await renderPdf(html, pdfPath, { jobId: data.jobId, footerLabel: 'Informe de Conformidad de Accesibilidad (VPAT®)' });
    return [pdfPath];
  },
  'dashboard-consolidado': async (data, outputDir) => {
    const jsonPath = await writeJsonFile(outputDir, 'score-consolidado.json', {
      generated_at: data.generated_at,
      channels: data.channels,
      global: data.global
    });
    const htmlPath = await writeTextFile(outputDir, 'dashboard-consolidado.html', buildConsolidatedDashboardHtml({
      channels: data.channels, global: data.global
    }));
    return [jsonPath, htmlPath];
  }
};

/**
 * Genera uno de los 5 entregables de F1 (SPEC §8) — o el consolidado multi-canal de
 * consolidate_jobs — y lo escribe a disco.
 */
export async function generateDeliverable(type, data, { outputDir }) {
  const builder = BUILDERS[type];
  if (!builder) {
    throw new Error(`Tipo de entregable desconocido o no implementado todavía: "${type}"`);
  }
  if (!outputDir) {
    throw new Error('generateDeliverable requiere "outputDir"');
  }
  // Regla del proyecto: los informes se basan solo en axe-core. Los hallazgos de la revisión del
  // Agente (visual/UX) viajan aparte como análisis complementario y no cambian ningún cálculo.
  const { primary, complementary } = splitFindings(data?.findings);
  const complementaryFindings = [...complementary, ...(data?.complementaryFindings ?? [])];
  return builder({ ...data, findings: primary, complementaryFindings }, outputDir);
}
