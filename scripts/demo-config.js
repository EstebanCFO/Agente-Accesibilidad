/**
 * Lógica pura de la pantalla de configuración del panel de demo: define los campos del
 * formulario, valida/normaliza lo que el presentador cargó y arma el resumen previo a ejecutar.
 * Sin I/O - la orquestación (demo.js) y el panel (demo-panel.html) solo consumen estas funciones.
 */
import { REFERENCE_SITES } from './demo-site-selection.js';

export const CHANNELS = [
  { value: 'home_banking', label: 'Home Banking (web)' },
  { value: 'app_ios', label: 'App iOS (vista móvil)' },
  { value: 'app_android', label: 'App Android (vista móvil)' }
];

export const SOURCES = [
  { value: 'reference', label: 'Sitio de referencia' },
  { value: 'url', label: 'URL del cliente u otra' },
  { value: 'local', label: 'Carpeta local' }
];

export const DEFAULT_MAX_PAGES = 6;
// Tope del recorrido que cuenta las páginas de una URL: con 10 páginas el crawl real ya tardaba
// ~29s en vivo, más de 20 haría esperar demasiado a la audiencia.
export const MAX_PAGES_LIMIT = 20;

// best-practice siempre corre: alimenta la Sección 2 (no suma al compliance, ver best-practices.js).
const BASE_WCAG_TAGS = ['wcag2a', 'wcag2aa', 'best-practice'];
const EXTENDED_WCAG_TAGS = ['wcag21a', 'wcag21aa', 'wcag22aa'];
const DESKTOP_VIEWPORT = { width: 1280, height: 800 };
const MOBILE_VIEWPORT = { width: 390, height: 844 };

/**
 * Campos del formulario de configuración, en el formato genérico que renderiza el panel.
 * Qué se ve depende de "Qué auditar":
 *   - Sitio de referencia: el combo del sitio y páginas a analizar, igual que una URL.
 *   - URL del cliente u otra: URL (con tilde verde/rojo según si se puede escanear) y páginas a
 *     analizar (arranca en 1 = la home; el botón "Analizar sitio" permite sumar otras páginas).
 *   - Carpeta local: path; se auditan todos los .html de la carpeta.
 */
export function buildConfigFields(values = {}) {
  const v = { ...defaultConfigValues(), ...values };
  const onlyUrl = { name: 'source', equals: 'url' };
  const withPages = { name: 'source', in: ['url', 'reference'] };
  return [
    { name: 'source', type: 'select', label: 'Qué auditar', value: v.source, options: SOURCES },
    {
      name: 'referenceSite', type: 'select', label: 'Sitio de referencia', value: v.referenceSite,
      options: REFERENCE_SITES.map((site, i) => ({ value: String(i + 1), label: site.label, url: site.url })),
      showIf: { name: 'source', equals: 'reference' }
    },
    { name: 'targetUrl', type: 'url', label: 'URL', value: v.targetUrl, placeholder: 'https://…', discover: true, check: true, showIf: onlyUrl },
    { name: 'targetPath', type: 'text', label: 'Path', value: v.targetPath, placeholder: 'C:\\carpeta\\del\\sitio', showIf: { name: 'source', equals: 'local' } },
    // "Analizar sitio" usa la URL del campo visible: la escrita (URL) o la del sitio elegido (referencia).
    { name: 'selectedPages', type: 'pages', label: 'Páginas a analizar', discoverFrom: ['targetUrl', 'referenceSite'], showIf: withPages },
    // Siempre activo: es la base normativa del puntaje (38 criterios WCAG 2.0 A+AA). Se muestra
    // para que quede explícito qué se evalúa; no se puede desmarcar.
    { name: 'wcagBase', type: 'checkbox', label: 'Evaluar estándares internacionales WCAG 2.0 (niveles A, AA)', value: true, locked: true },
    { name: 'keyboardReview', type: 'checkbox', label: 'Pruebas de teclado del Agente (trampas de teclado, orden y visibilidad del foco, cambios al recibir el foco)', value: v.keyboardReview },
    { name: 'includeExtended', type: 'checkbox', label: 'Sumar WCAG 2.2 (score aparte)', value: v.includeExtended }
  ];
}

export function defaultConfigValues() {
  return {
    source: 'reference', referenceSite: '1', targetUrl: '', targetPath: '', channel: 'home_banking',
    maxPages: DEFAULT_MAX_PAGES, selectedPages: [], keyboardReview: true, includeExtended: false
  };
}

function asBool(value) {
  return value === true || value === 'true' || value === 'on';
}

/**
 * Valida y normaliza lo que mandó el formulario. Nunca tira: devuelve { config, errors } para
 * que el panel pueda volver a mostrar el formulario con los errores marcados por campo.
 */
export function validateDemoConfig(raw = {}) {
  const errors = {};
  const values = { ...defaultConfigValues(), ...raw };

  const source = SOURCES.some((s) => s.value === values.source) ? values.source : null;
  if (!source) errors.source = 'Elegí qué querés auditar.';

  let target = null;
  if (source === 'reference') {
    const index = Number(values.referenceSite);
    if (!Number.isInteger(index) || index < 1 || index > REFERENCE_SITES.length) {
      errors.referenceSite = 'Elegí un sitio de referencia.';
    } else {
      target = REFERENCE_SITES[index - 1].url;
    }
  } else if (source === 'url') {
    target = String(values.targetUrl ?? values.target ?? '').trim();
    if (!target) errors.targetUrl = 'Ingresá la URL a auditar.';
    else if (!/^https?:\/\/\S+$/i.test(target)) errors.targetUrl = 'La URL tiene que empezar con http:// o https://';
  } else if (source === 'local') {
    target = String(values.targetPath ?? values.target ?? '').trim();
    if (!target) errors.targetPath = 'Ingresá la ruta de la carpeta.';
  }

  // El canal ya no se elige en el formulario: siempre Home Banking (vista desktop).
  // Páginas: carpeta local todos los .html; URL y sitio de referencia la principal + las que se
  // eligieron en el desplegable (la demo después verifica que salgan del análisis del sitio).
  const channel = 'home_banking';
  let maxPages = source === 'local' ? null : DEFAULT_MAX_PAGES;
  let selectedPages = [];
  if ((source === 'url' || source === 'reference') && target) {
    const raw = Array.isArray(values.selectedPages) ? values.selectedPages : [];
    selectedPages = [...new Set(raw.map((u) => String(u).trim()).filter((u) => /^https?:\/\/\S+$/i.test(u) && u !== target))]
      .slice(0, MAX_PAGES_LIMIT - 1);
    maxPages = 1 + selectedPages.length;
  }

  if (Object.keys(errors).length > 0) return { config: null, errors };

  const includeExtended = asBool(values.includeExtended);
  return {
    errors: {},
    config: {
      source,
      target,
      channel,
      maxPages,
      selectedPages,
      includeExtended,
      keyboardReview: asBool(values.keyboardReview),
      wcagTags: includeExtended ? [...BASE_WCAG_TAGS, ...EXTENDED_WCAG_TAGS] : [...BASE_WCAG_TAGS],
      viewport: channel === 'home_banking' ? DESKTOP_VIEWPORT : MOBILE_VIEWPORT,
      // El panel ya no ofrece usuario de prueba: la demo audita solo páginas públicas.
      auth: null
    }
  };
}

/** Filas del resumen "antes de ejecutar". */
function pagesSummary(config) {
  if (config.source === 'local') return 'todos los archivos .html';
  if (config.source === 'url' || config.source === 'reference') {
    const extra = config.selectedPages.length;
    return extra ? `${1 + extra} (principal + ${extra} elegida(s))` : '1 (solo la principal)';
  }
  return `hasta ${config.maxPages}`;
}

export function buildConfigSummary(config) {
  const sourceLabel = SOURCES.find((s) => s.value === config.source)?.label ?? config.source;
  // Solo se resume lo que el presentador eligió (el canal ya no se elige).
  return [
    { label: 'Qué auditar', value: `${sourceLabel}: ${config.target}` },
    { label: 'Páginas', value: pagesSummary(config) },
    { label: 'Normativa', value: config.includeExtended ? 'ONTI 38 criterios + WCAG 2.2 (aparte)' : 'ONTI 38 criterios (WCAG 2.0 A+AA)' },
    { label: 'Pruebas de teclado del Agente', value: config.keyboardReview ? 'sí' : 'no' }
  ];
}

/**
 * Qué mostrar en la vista previa del formulario según lo cargado hasta ahora (sin exigir que el
 * resto del formulario sea válido). null = todavía no hay nada que mostrar.
 */
export function previewTarget(values = {}) {
  if (values.source === 'reference') {
    const site = REFERENCE_SITES[Number(values.referenceSite) - 1];
    return site ? { kind: 'url', target: site.url } : null;
  }
  if (values.source === 'url') {
    const url = String(values.targetUrl ?? '').trim();
    return /^https?:\/\/\S+$/i.test(url) ? { kind: 'url', target: url } : null;
  }
  if (values.source === 'local') {
    const dir = String(values.targetPath ?? '').trim();
    return dir ? { kind: 'local', target: dir } : null;
  }
  return null;
}
