import { validateConfig } from '../config/validate-config.js';

export class NotImplementedError extends Error {
  constructor(toolName) {
    super(`Tool "${toolName}" aún no está implementada (pendiente de un sub-plan posterior de construcción).`);
    this.name = 'NotImplementedError';
    this.toolName = toolName;
  }
}

const TOOL_SCHEMAS = [
  { name: 'validate_config', description: 'Verifica que la config del job sea completa y coherente', input_schema: { type: 'object', properties: { config: { type: 'object', description: 'Config JSON completa a validar' } }, required: ['config'] } },
  { name: 'crawl_site', description: 'Descubre todas las URLs del canal desde una raíz', input_schema: { type: 'object', properties: { root_url: { type: 'string' }, options: { type: 'object' } }, required: ['root_url'] } },
  { name: 'validate_url_list', description: 'Verifica accesibilidad HTTP de cada URL antes de escanear', input_schema: { type: 'object', properties: { url_list: { type: 'array', items: { type: 'string' } } }, required: ['url_list'] } },
  { name: 'scan_url', description: 'Escanea una URL con axe-core vía Playwright', input_schema: { type: 'object', properties: { url: { type: 'string' }, wcag_tags: { type: 'array', items: { type: 'string' } }, auth: { type: 'object' } }, required: ['url'] } },
  { name: 'scan_batch', description: 'Escanea múltiples URLs en paralelo', input_schema: { type: 'object', properties: { url_list: { type: 'array', items: { type: 'string' } }, wcag_tags: { type: 'array', items: { type: 'string' } }, workers: { type: 'number' } }, required: ['url_list'] } },
  { name: 'classify_findings', description: 'Deduplica, agrupa por criterio WCAG y asigna severidad', input_schema: { type: 'object', properties: { axe_results: { type: 'array' } }, required: ['axe_results'] } },
  { name: 'calculate_score', description: 'Calcula % de cumplimiento por canal y por criterio', input_schema: { type: 'object', properties: { classified_findings: { type: 'array' } }, required: ['classified_findings'] } },
  { name: 'generate_deliverable', description: 'Genera uno de los 5 entregables de F1 en sus formatos', input_schema: { type: 'object', properties: { type: { type: 'string' }, data: { type: 'object' } }, required: ['type', 'data'] } },
  { name: 'consolidate_jobs', description: 'Agrega los resultados de varios jobs en un dashboard ejecutivo unificado', input_schema: { type: 'object', properties: { job_ids: { type: 'array', items: { type: 'string' } } }, required: ['job_ids'] } },
  { name: 'request_clarification', description: 'Pausa y solicita decisión al operador', input_schema: { type: 'object', properties: { question: { type: 'string' }, context: { type: 'object' } }, required: ['question'] } },
  { name: 'log_progress', description: 'Registra estado en el log del job', input_schema: { type: 'object', properties: { message: { type: 'string' }, level: { type: 'string' } }, required: ['message'] } }
];

const NOT_IMPLEMENTED_TOOLS = [
  'crawl_site', 'validate_url_list', 'scan_url', 'scan_batch',
  'classify_findings', 'calculate_score', 'generate_deliverable', 'consolidate_jobs'
];

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
