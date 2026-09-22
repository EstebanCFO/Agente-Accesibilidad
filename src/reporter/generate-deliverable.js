import { mkdir, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { buildScoreDeliverable } from './score-deliverable.js';
import { buildInventarioJson, buildInventarioWorkbook } from './inventario-deliverable.js';
import { buildRoadmapItems, buildRoadmapJson, buildRoadmapHtml, buildRoadmapWorkbook } from './roadmap-deliverable.js';
import { buildConformityMatrix, buildSeverityImpactGrid, buildMatrizJson, buildMatrizHtml, buildMatrizWorkbook } from './matriz-deliverable.js';
import { buildDashboardHtml } from './dashboard-deliverable.js';
import { buildConsolidatedDashboardHtml } from './consolidated-dashboard-deliverable.js';

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
    const jsonPath = await writeJsonFile(outputDir, 'inventario-hallazgos.json', jsonDoc);

    const workbook = await buildInventarioWorkbook(data.findings);
    await mkdir(outputDir, { recursive: true });
    const xlsxPath = path.join(outputDir, 'inventario-hallazgos.xlsx');
    await workbook.xlsx.writeFile(xlsxPath);

    return [jsonPath, xlsxPath];
  },
  roadmap: async (data, outputDir) => {
    const items = buildRoadmapItems(data.findings, {
      ontiCriteriaCompliant: data.ontiCriteriaCompliant,
      conformanceThreshold: data.conformanceThreshold
    });

    const jsonPath = await writeJsonFile(outputDir, 'roadmap-remediacion.json', buildRoadmapJson({ jobId: data.jobId, items }));
    const htmlPath = await writeTextFile(outputDir, 'roadmap-remediacion.html', buildRoadmapHtml({ jobId: data.jobId, channel: data.channel, items }));

    const workbook = await buildRoadmapWorkbook(items);
    await mkdir(outputDir, { recursive: true });
    const xlsxPath = path.join(outputDir, 'roadmap-remediacion.xlsx');
    await workbook.xlsx.writeFile(xlsxPath);

    return [jsonPath, htmlPath, xlsxPath];
  },
  matriz: async (data, outputDir) => {
    const includeExtended = data.includeExtended ?? false;
    const conformity = buildConformityMatrix({ findings: data.findings, urls: data.urls || [], includeExtended });
    const severityImpactGrid = buildSeverityImpactGrid(data.findings);

    const jsonPath = await writeJsonFile(outputDir, 'matriz-criticidad.json', buildMatrizJson({
      jobId: data.jobId, channel: data.channel, conformity, severityImpactGrid
    }));
    const htmlPath = await writeTextFile(outputDir, 'matriz-criticidad.html', buildMatrizHtml({
      jobId: data.jobId, channel: data.channel, conformity, severityImpactGrid
    }));

    const workbook = await buildMatrizWorkbook({ conformity, severityImpactGrid });
    await mkdir(outputDir, { recursive: true });
    const xlsxPath = path.join(outputDir, 'matriz-criticidad.xlsx');
    await workbook.xlsx.writeFile(xlsxPath);

    return [jsonPath, htmlPath, xlsxPath];
  },
  dashboard: async (data, outputDir) => {
    const html = buildDashboardHtml({ jobId: data.jobId, channel: data.channel, scores: data.scores, findings: data.findings });
    const filePath = await writeTextFile(outputDir, 'dashboard.html', html);
    return [filePath];
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
  return builder(data, outputDir);
}
