import path from 'node:path';
import { readFile, writeFile, mkdir } from 'node:fs/promises';
import { randomUUID } from 'node:crypto';
import { validateConfig } from '../config/validate-config.js';
import { scanUrl, scanBatch } from '../scanner.js';
import { classifyFindings } from '../classification/classify-findings.js';
import { calculateScore } from '../classification/calculate-score.js';
import { generateDeliverable } from '../reporter/generate-deliverable.js';
import { validateUrlList } from '../discovery/validate-url-list.js';
import { crawlSite } from '../discovery/crawl-site.js';
import { consolidateJobs } from '../reporter/consolidate-jobs.js';
import { runVisualAudit } from '../visual-review/visual-audit.js';
import { runUxComplianceReview } from '../visual-review/ux-compliance-review.js';

export class NotImplementedError extends Error {
  constructor(toolName) {
    super(`Tool "${toolName}" aún no está implementada (pendiente de un sub-plan posterior de construcción).`);
    this.name = 'NotImplementedError';
    this.toolName = toolName;
  }
}

async function loadCompletedJobScores(jobStore, jobIds) {
  const jobs = jobIds.map((jobId) => {
    const job = jobStore.getJob(jobId);
    if (!job) throw new Error(`Job no encontrado: ${jobId}`);
    return job;
  });

  const notCompleted = jobs.filter((job) => job.status !== 'completed');
  if (notCompleted.length > 0) {
    throw new Error(`Todos los jobs deben estar "completed" para consolidar. Pendientes: ${notCompleted.map((job) => job.job_id).join(', ')}`);
  }

  return Promise.all(jobs.map(async (job) => {
    const scorePath = path.join(job.config.output?.path ?? './reports', job.job_id, 'score-compliance.json');
    const score = JSON.parse(await readFile(scorePath, 'utf8'));
    return { jobId: job.job_id, channel: job.config.target.channel, score };
  }));
}

/**
 * Los captures (screenshot/html) de scan_url/scan_batch nunca deben viajar inline en los
 * mensajes del agent loop (blow up de contexto + el modelo no puede re-emitir un blob como
 * argumento de tool_use). Se persisten a disco bajo el output dir del job y se devuelve un
 * path en su lugar - visual_audit/ux_compliance_review lo leen server-side.
 */
async function persistCaptures(result, jobStore, jobId) {
  if (!result || (!result.screenshot && !result.html)) return result;

  const job = jobStore.getJob(jobId);
  const capturesDir = path.join(job.config.output?.path ?? './reports', jobId, 'captures');
  await mkdir(capturesDir, { recursive: true });

  const { screenshot, html, ...rest } = result;
  const output = { ...rest };

  if (screenshot) {
    const screenshotPath = path.join(capturesDir, `${randomUUID()}.png`);
    await writeFile(screenshotPath, Buffer.from(screenshot, 'base64'));
    output.screenshot_path = screenshotPath;
  }
  if (html) {
    const htmlPath = path.join(capturesDir, `${randomUUID()}.html`);
    await writeFile(htmlPath, html, 'utf8');
    output.html_path = htmlPath;
  }
  return output;
}

/**
 * screenshot_path/html_path llegan como argumento de tool_use del modelo - si el modelo fuera
 * manipulado (mismo threat model que la protección contra prompt injection en los prompts de
 * visual-audit.js/ux-compliance-review.js), un path arbitrario podría hacer leer cualquier
 * archivo del filesystem. Se valida que el path resuelto caiga dentro del directorio de
 * capturas del propio job antes de tocar el filesystem - no se confía en sanitizar el string.
 */
function resolveCapturePath(rawPath, jobStore, jobId) {
  if (!rawPath) return undefined;
  const job = jobStore.getJob(jobId);
  const capturesDir = path.resolve(job.config.output?.path ?? './reports', jobId, 'captures');
  const resolved = path.resolve(rawPath);
  if (resolved !== capturesDir && !resolved.startsWith(capturesDir + path.sep)) {
    throw new Error(`screenshot_path/html_path debe estar dentro del directorio de capturas del job (${capturesDir}), recibido: ${rawPath}`);
  }
  return resolved;
}

const TOOL_SCHEMAS = [
  { name: 'validate_config', description: 'Verifica que la config del job sea completa y coherente', input_schema: { type: 'object', properties: { config: { type: 'object', description: 'Config JSON completa a validar' } }, required: ['config'] } },
  { name: 'crawl_site', description: 'Descubre todas las URLs del canal desde una raíz', input_schema: { type: 'object', properties: { root_url: { type: 'string' }, options: { type: 'object' } }, required: ['root_url'] } },
  { name: 'validate_url_list', description: 'Verifica accesibilidad HTTP de cada URL antes de escanear', input_schema: { type: 'object', properties: { url_list: { type: 'array', items: { type: 'string' } }, timeout: { type: 'number' }, concurrency: { type: 'number' } }, required: ['url_list'] } },
  { name: 'scan_url', description: 'Escanea una URL con axe-core vía Playwright', input_schema: { type: 'object', properties: { url: { type: 'string' }, wcag_tags: { type: 'array', items: { type: 'string' } }, auth: { type: 'object' }, capture_screenshot: { type: 'boolean', description: 'Captura una screenshot full-page; se persiste a disco y el resultado trae screenshot_path (no el blob inline) para pasarle a visual_audit' }, capture_html: { type: 'boolean', description: 'Captura el HTML completo de la página; se persiste a disco y el resultado trae html_path (no el HTML inline) para pasarle a ux_compliance_review' } }, required: ['url'] } },
  { name: 'scan_batch', description: 'Escanea múltiples URLs en paralelo', input_schema: { type: 'object', properties: { url_list: { type: 'array', items: { type: 'string' } }, wcag_tags: { type: 'array', items: { type: 'string' } }, workers: { type: 'number' }, capture_screenshot: { type: 'boolean', description: 'Captura una screenshot full-page; se persiste a disco y el resultado trae screenshot_path (no el blob inline) para pasarle a visual_audit' }, capture_html: { type: 'boolean', description: 'Captura el HTML completo de la página; se persiste a disco y el resultado trae html_path (no el HTML inline) para pasarle a ux_compliance_review' } }, required: ['url_list'] } },
  { name: 'classify_findings', description: 'Deduplica, agrupa por criterio WCAG y asigna severidad', input_schema: { type: 'object', properties: { axe_results: { type: 'array' }, include_extended: { type: 'boolean', description: 'Incluir la capa extendida WCAG 2.1/2.2 (wcag.extended_22 de la config)' } }, required: ['axe_results'] } },
  { name: 'calculate_score', description: 'Calcula % de cumplimiento por canal y por criterio', input_schema: { type: 'object', properties: { classified_findings: { type: 'array' }, axe_results: { type: 'array', description: 'Opcional: para total_urls_evaluated y violations/incomplete por URL, incluye URLs 100% conformes' }, conformance_threshold: { type: 'number' }, include_extended: { type: 'boolean' } }, required: ['classified_findings'] } },
  { name: 'generate_deliverable', description: 'Genera uno de los 5 entregables de F1 en sus formatos', input_schema: { type: 'object', properties: { type: { type: 'string' }, data: { type: 'object' } }, required: ['type', 'data'] } },
  { name: 'consolidate_jobs', description: 'Agrega los resultados de varios jobs en un dashboard ejecutivo unificado', input_schema: { type: 'object', properties: { job_ids: { type: 'array', items: { type: 'string' } } }, required: ['job_ids'] } },
  { name: 'request_clarification', description: 'Pausa y solicita decisión al operador', input_schema: { type: 'object', properties: { question: { type: 'string' }, context: { type: 'object' } }, required: ['question'] } },
  { name: 'log_progress', description: 'Registra estado en el log del job', input_schema: { type: 'object', properties: { message: { type: 'string' }, level: { type: 'string' } }, required: ['message'] } },
  { name: 'visual_audit', description: 'Revisión visual real (contraste, spacing, touch targets) sobre una screenshot, vía modelo con visión guiado por la guía vendorizada de accesibilidad visual. Usar scan_url/scan_batch con capture_screenshot:true primero y pasar el screenshot_path devuelto (nunca el blob inline - se persiste a disco justamente para no viajar en el contexto del agente).', input_schema: { type: 'object', properties: { url: { type: 'string' }, screenshot_path: { type: 'string', description: 'Path devuelto por scan_url/scan_batch con capture_screenshot:true' }, screenshot: { type: 'string', description: 'Alternativa: screenshot base64 PNG inline (solo para uso directo fuera del agent loop)' }, include_extended: { type: 'boolean', description: 'Incluir la capa extendida WCAG 2.1/2.2 en los hallazgos (wcag.extended_22 de la config)' } }, required: ['url'] } },
  { name: 'ux_compliance_review', description: 'Revisión de coherencia de navegación y UX (formularios, mensajes de error) sobre el HTML de la página, vía modelo guiado por la guía vendorizada de UX. Usar scan_url/scan_batch con capture_html:true primero y pasar el html_path devuelto.', input_schema: { type: 'object', properties: { url: { type: 'string' }, html_path: { type: 'string', description: 'Path devuelto por scan_url/scan_batch con capture_html:true' }, html: { type: 'string', description: 'Alternativa: HTML completo inline (solo para uso directo fuera del agent loop)' }, screenshot_path: { type: 'string' }, screenshot: { type: 'string', description: 'Opcional: screenshot como contexto visual adicional' }, include_extended: { type: 'boolean' } }, required: ['url'] } }
];

const NOT_IMPLEMENTED_TOOLS = [];

export function createToolRegistry({ jobStore, anthropicClient }) {
  const handlers = {
    validate_config: (input) => validateConfig(input.config),
    log_progress: (input, jobId) => {
      jobStore.appendLog(jobId, { level: input.level || 'info', message: input.message });
      return { logged: true };
    },
    request_clarification: (input, jobId) => {
      jobStore.updateJob(jobId, { status: 'blocked', current_action: `Esperando respuesta: ${input.question}` });
      return { status: 'blocked', question: input.question };
    },
    crawl_site: (input) => crawlSite(input.root_url, {
      maxUrls: input.options?.max_urls,
      includePatterns: input.options?.include_patterns,
      excludePatterns: input.options?.exclude_patterns,
      timeoutPerUrl: input.options?.timeout_per_url
    }),
    validate_url_list: (input) => validateUrlList(input.url_list, { timeout: input.timeout, concurrency: input.concurrency }),
    scan_url: async (input, jobId) => {
      const result = await scanUrl({ url: input.url, wcagTags: input.wcag_tags, auth: input.auth, captureScreenshot: input.capture_screenshot, captureHtml: input.capture_html });
      return persistCaptures(result, jobStore, jobId);
    },
    scan_batch: async (input, jobId) => {
      const results = await scanBatch({ urlList: input.url_list, wcagTags: input.wcag_tags, workers: input.workers, captureScreenshot: input.capture_screenshot, captureHtml: input.capture_html });
      return Promise.all(results.map((result) => persistCaptures(result, jobStore, jobId)));
    },
    classify_findings: (input) => classifyFindings(input.axe_results, { includeExtended: input.include_extended ?? false }),
    calculate_score: (input) => calculateScore(input.classified_findings, {
      axeResults: input.axe_results,
      conformanceThreshold: input.conformance_threshold ?? 30,
      includeExtended: input.include_extended ?? false
    }),
    generate_deliverable: async (input, jobId) => {
      const job = jobStore.getJob(jobId);
      const outputDir = path.join(job.config.output?.path ?? './reports', jobId);
      const filePaths = await generateDeliverable(input.type, {
        ...input.data,
        jobId,
        channel: job.config.target.channel
      }, { outputDir });
      const filenames = filePaths.map((filePath) => path.basename(filePath));
      jobStore.updateJob(jobId, { reports: [...(job.reports || []), ...filenames] });
      return { file_path: filePaths };
    },
    consolidate_jobs: async (input) => {
      if (!Array.isArray(input.job_ids) || input.job_ids.length === 0) {
        throw new Error('consolidate_jobs requiere "job_ids" no vacío');
      }
      const channelReports = await loadCompletedJobScores(jobStore, input.job_ids);
      const consolidated = consolidateJobs(channelReports);

      const baseOutputPath = jobStore.getJob(input.job_ids[0]).config.output?.path ?? './reports';
      const outputDir = path.join(baseOutputPath, 'consolidated');
      await generateDeliverable('dashboard-consolidado', consolidated, { outputDir });

      return consolidated;
    },
    visual_audit: async (input, jobId) => {
      const screenshotPath = resolveCapturePath(input.screenshot_path, jobStore, jobId);
      const screenshot = input.screenshot ?? (screenshotPath ? (await readFile(screenshotPath)).toString('base64') : undefined);
      return runVisualAudit({ url: input.url, screenshot }, { anthropicClient, includeExtended: input.include_extended ?? false });
    },
    ux_compliance_review: async (input, jobId) => {
      const htmlPath = resolveCapturePath(input.html_path, jobStore, jobId);
      const screenshotPath = resolveCapturePath(input.screenshot_path, jobStore, jobId);
      const html = input.html ?? (htmlPath ? await readFile(htmlPath, 'utf8') : undefined);
      const screenshot = input.screenshot ?? (screenshotPath ? (await readFile(screenshotPath)).toString('base64') : undefined);
      return runUxComplianceReview({ url: input.url, html, screenshot }, { anthropicClient, includeExtended: input.include_extended ?? false });
    }
  };

  for (const toolName of NOT_IMPLEMENTED_TOOLS) {
    handlers[toolName] = () => {
      throw new NotImplementedError(toolName);
    };
  }

  return {
    schemas: TOOL_SCHEMAS,
    async execute(toolName, input, jobId) {
      const handler = handlers[toolName];
      if (!handler) {
        throw new Error(`Unknown tool: ${toolName}`);
      }
      return handler(input, jobId);
    }
  };
}
