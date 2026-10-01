import { randomUUID } from 'node:crypto';

const VALID_CHANNELS = ['home_banking', 'app_ios', 'app_android'];
const VALID_MODES = ['url_list', 'crawl'];
const VPAT_FIELDS = ['product_name', 'product_version', 'description', 'contact'];

function buildDefaults() {
  return {
    auth: { type: 'none', config: {} },
    wcag: {
      baseline: 'onti_2019',
      levels: ['A', 'AA'],
      base_tags: ['wcag2a', 'wcag2aa'],
      extended_22: false,
      extended_22_tags: ['wcag21a', 'wcag21aa', 'wcag22aa']
    },
    scope: {
      max_urls: 100,
      timeout_per_url: 30000,
      parallel_workers: 3,
      wait_for: 'networkidle',
      viewport: {
        desktop: { width: 1280, height: 800 },
        mobile: { width: 390, height: 844, is_mobile: true }
      },
      include_patterns: [],
      exclude_patterns: []
    },
    skills: { keyboard_review: true, generate_remediation_plan: true },
    output: { formats: ['html', 'json', 'xlsx'], path: './reports', include_screenshots: true, language: 'es' },
    agent: { max_iterations: 30, log_level: 'info', model: 'claude-sonnet-5' }
  };
}

function deepMerge(defaults, overrides) {
  if (overrides === undefined || overrides === null) return defaults;
  if (typeof defaults !== 'object' || Array.isArray(defaults)) return overrides;
  const merged = { ...defaults };
  for (const key of Object.keys(overrides)) {
    merged[key] = deepMerge(defaults[key], overrides[key]);
  }
  return merged;
}

export function validateConfig(rawConfig) {
  const errors = [];
  const raw = rawConfig && typeof rawConfig === 'object' ? rawConfig : {};

  if (!raw.target || typeof raw.target !== 'object') {
    errors.push('target es requerido');
    return { valid: false, errors, config: null };
  }

  const { channel, mode, root_url: rootUrl, urls } = raw.target;

  if (!channel || !VALID_CHANNELS.includes(channel)) {
    errors.push(`target.channel es requerido y debe ser uno de: ${VALID_CHANNELS.join(', ')}`);
  }
  if (!mode || !VALID_MODES.includes(mode)) {
    errors.push(`target.mode es requerido y debe ser uno de: ${VALID_MODES.join(', ')}`);
  }
  if (mode === 'crawl' && (!rootUrl || typeof rootUrl !== 'string' || rootUrl.trim() === '')) {
    errors.push('target.root_url es requerido cuando target.mode=crawl');
  }
  if (mode === 'url_list' && (!Array.isArray(urls) || urls.length === 0)) {
    errors.push('target.urls debe ser un array no vacío cuando target.mode=url_list');
  }

  if (errors.length > 0) {
    return { valid: false, errors, config: null };
  }

  // Campos retirados (spec 2026-09-30): el resultado ya no tiene umbral de conformidad y la
  // revisión visual/UX se reemplazó por keyboard_review. Una config vieja sigue siendo válida:
  // esos campos se ignoran con un aviso.
  const warnings = [];
  const rawWcag = { ...(raw.wcag || {}) };
  if ('conformance_threshold' in rawWcag) {
    delete rawWcag.conformance_threshold;
    warnings.push('wcag.conformance_threshold se ignora: el resultado es un conteo OK/NOK/a validar, sin umbral de conformidad');
  }
  const rawSkills = { ...(raw.skills || {}) };
  for (const retired of ['visual_audit', 'ux_compliance_review']) {
    if (retired in rawSkills) {
      delete rawSkills[retired];
      warnings.push(`skills.${retired} se ignora: se reemplazó por keyboard_review`);
    }
  }

  // Datos del producto para el VPAT (spec 2026-10-01): opcionales; lo que falte se completa con
  // valores por defecto al generar el informe. Lo mal formado se ignora con aviso, nunca frena.
  const vpat = {};
  if (raw.vpat !== undefined) {
    if (raw.vpat && typeof raw.vpat === 'object' && !Array.isArray(raw.vpat)) {
      for (const key of VPAT_FIELDS) {
        if (!(key in raw.vpat)) continue;
        if (typeof raw.vpat[key] === 'string') vpat[key] = raw.vpat[key];
        else warnings.push(`vpat.${key} se ignora: tiene que ser texto`);
      }
    } else {
      warnings.push('vpat se ignora: tiene que ser un objeto con product_name, product_version, description y contact');
    }
  }

  const defaults = buildDefaults();
  const config = {
    job_id: raw.job_id || randomUUID(),
    description: raw.description || '',
    target: { channel, mode, root_url: rootUrl ?? null, urls: urls ?? [] },
    auth: deepMerge(defaults.auth, raw.auth),
    wcag: deepMerge(defaults.wcag, rawWcag),
    scope: deepMerge(defaults.scope, raw.scope),
    skills: deepMerge(defaults.skills, rawSkills),
    output: deepMerge(defaults.output, raw.output),
    agent: deepMerge(defaults.agent, raw.agent),
    vpat
  };

  return { valid: true, errors: [], warnings, config };
}

const REDACTED = '[REDACTED]';

function redactAuthConfig(authConfig) {
  if (!authConfig || typeof authConfig !== 'object') return authConfig;
  const redacted = { ...authConfig };
  if (redacted.username !== undefined) redacted.username = REDACTED;
  if (redacted.password !== undefined) redacted.password = REDACTED;
  if (redacted.bearer_token !== undefined) redacted.bearer_token = REDACTED;
  if (Array.isArray(redacted.cookies)) {
    redacted.cookies = redacted.cookies.map((cookie) => ({ ...cookie, value: REDACTED }));
  }
  return redacted;
}

export function redactConfig(config) {
  return {
    ...config,
    auth: { ...config.auth, config: redactAuthConfig(config.auth?.config) }
  };
}
