import path from 'node:path';
import { readFile } from 'node:fs/promises';
import { validateConfig } from '../config/validate-config.js';
import { scanUrl, scanBatch } from '../scanner.js';
import { classifyFindings } from '../classification/classify-findings.js';
import { calculateScore } from '../classification/calculate-score.js';
import { generateDeliverable } from '../reporter/generate-deliverable.js';
import { validateUrlList } from '../discovery/validate-url-list.js';
import { crawlSite } from '../discovery/crawl-site.js';
import { consolidateJobs } from '../reporter/consolidate-jobs.js';

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

const TOOL_SCHEMAS = [
  { name: 'validate_config', description: 'Verifica que la config del job sea completa y coherente', input_schema: { type: 'object', properties: { config: { type: 'object', description: 'Config JSON completa a validar' } }, required: ['config'] } },
  { name: 'crawl_site', description: 'Descubre todas las URLs del canal desde una raíz', input_schema: { type: 'object', properties: { root_url: { type: 'string' }, options: { type: 'object' } }, required: ['root_url'] } },
  { name: 'validate_url_list', description: 'Verifica accesibilidad HTTP de cada URL antes de escanear', input_schema: { type: 'object', properties: { url_list: { type: 'array', items: { type: 'string' } }, timeout: { type: 'number' }, concurrency: { type: 'number' } }, required: ['url_list'] } },
  { name: 'scan_url', description: 'Escanea una URL con axe-core vía Playwright', input_schema: { type: 'object', properties: { url: { type: 'string' }, wcag_tags: { type: 'array', items: { type: 'string' } }, auth: { type: 'object' } }, required: ['url'] } },
  { name: 'scan_batch', description: 'Escanea múltiples URLs en paralelo', input_schema: { type: 'object', properties: { url_list: { type: 'array', items: { type: 'string' } }, wcag_tags: { type: 'array', items: { type: 'string' } }, workers: { type: 'number' } }, required: ['url_list'] } },
  { name: 'classify_findings', description: 'Deduplica, agrupa por criterio WCAG y asigna severidad', input_schema: { type: 'object', properties: { axe_results: { type: 'array' }, include_extended: { type: 'boolean', description: 'Incluir la capa extendida WCAG 2.1/2.2 (wcag.extended_22 de la config)' } }, required: ['axe_results'] } },
  { name: 'calculate_score', description: 'Calcula % de cumplimiento por canal y por criterio', input_schema: { type: 'object', properties: { classified_findings: { type: 'array' }, axe_results: { type: 'array', description: 'Opcional: para total_urls_evaluated y violations/incomplete por URL, incluye URLs 100% conformes' }, conformance_threshold: { type: 'number' }, include_extended: { type: 'boolean' } }, required: ['classified_findings'] } },
  { name: 'generate_deliverable', description: 'Genera uno de los 5 entregables de F1 en sus formatos', input_schema: { type: 'object', properties: { type: { type: 'string' }, data: { type: 'object' } }, required: ['type', 'data'] } },
  { name: 'consolidate_jobs', description: 'Agrega los resultados de varios jobs en un dashboard ejecutivo unificado', input_schema: { type: 'object', properties: { job_ids: { type: 'array', items: { type: 'string' } } }, required: ['job_ids'] } },
  { name: 'request_clarification', description: 'Pausa y solicita decisión al operador', input_schema: { type: 'object', properties: { question: { type: 'string' }, context: { type: 'object' } }, required: ['question'] } },
  { name: 'log_progress', description: 'Registra estado en el log del job', input_schema: { type: 'object', properties: { message: { type: 'string' }, level: { type: 'string' } }, required: ['message'] } }
];

const NOT_IMPLEMENTED_TOOLS = [];

export function createToolRegistry({ jobStore }) {
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
    scan_url: (input) => scanUrl({ url: input.url, wcagTags: input.wcag_tags, auth: input.auth }),
    scan_batch: (input) => scanBatch({ urlList: input.url_list, wcagTags: input.wcag_tags, workers: input.workers }),
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
