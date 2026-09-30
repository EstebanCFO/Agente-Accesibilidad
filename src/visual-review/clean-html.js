/**
 * Reduce el HTML de una página a lo que la revisión de UX necesita ver (estructura, textos,
 * formularios, etiquetas y atributos de accesibilidad) antes de mandarlo al modelo. Scripts,
 * estilos, SVG, comentarios y atributos de maquetación (class, data-*, handlers) no aportan a
 * la revisión y eran la mayor parte de los tokens de entrada de cada página.
 *
 * Basado en expresiones regulares a propósito (sin dependencias nuevas): el resultado lo lee un
 * modelo, no un parser, así que alcanza con que sea HTML "razonable", no perfecto.
 */

// Atributos que sí importan para accesibilidad/UX. style se conserva (recortado) porque
// "el error se marca solo en rojo" (criterio 1.4.1) solo se ve ahí.
const KEEP_ATTRIBUTES = new Set([
  'id', 'name', 'type', 'role', 'alt', 'title', 'href', 'for', 'label', 'placeholder', 'lang',
  'tabindex', 'required', 'disabled', 'readonly', 'checked', 'selected', 'value', 'autocomplete',
  'headers', 'scope', 'colspan', 'rowspan', 'action', 'method', 'target', 'dir', 'hidden',
  'aria-hidden', 'style', 'maxlength', 'pattern', 'accesskey', 'summary', 'caption', 'src'
]);
const MAX_ATTRIBUTE_LENGTH = 200;

// Elementos cuyo contenido completo se descarta.
const DROP_WITH_CONTENT = ['script', 'style', 'noscript', 'template', 'iframe', 'object', 'canvas'];

function keepAttribute(name) {
  const lower = name.toLowerCase();
  return KEEP_ATTRIBUTES.has(lower) || lower.startsWith('aria-');
}

function cleanAttributes(attrText) {
  const kept = [];
  const attrRegex = /([^\s=/>"']+)(?:\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s>"']+)))?/g;
  let match;
  while ((match = attrRegex.exec(attrText)) !== null) {
    const [, name, dq, sq, bare] = match;
    if (!keepAttribute(name)) continue;
    let value = dq ?? sq ?? bare;
    if (value === undefined) {
      kept.push(name);
      continue;
    }
    // Las imágenes embebidas (data:) pueden pesar cientos de KB y no aportan nada.
    if (value.startsWith('data:')) value = 'data:…';
    if (value.length > MAX_ATTRIBUTE_LENGTH) value = value.slice(0, MAX_ATTRIBUTE_LENGTH) + '…';
    kept.push(`${name}="${value.replace(/"/g, '&quot;')}"`);
  }
  return kept.length > 0 ? ' ' + kept.join(' ') : '';
}

/** Devuelve { html, originalLength, cleanedLength }. */
export function cleanHtmlForReview(rawHtml) {
  const original = String(rawHtml ?? '');
  let html = original;

  html = html.replace(/<!--[\s\S]*?-->/g, '');
  for (const tag of DROP_WITH_CONTENT) {
    html = html.replace(new RegExp(`<${tag}\\b[\\s\\S]*?</${tag}\\s*>`, 'gi'), '');
    html = html.replace(new RegExp(`<${tag}\\b[^>]*/?>`, 'gi'), '');
  }
  // SVG: se conserva solo lo que describe al ícono (title / aria-label), no los trazos.
  html = html.replace(/<svg\b([^>]*)>([\s\S]*?)<\/svg\s*>/gi, (_, attrs, inner) => {
    const title = inner.match(/<title[^>]*>([\s\S]*?)<\/title>/i);
    return `<svg${cleanAttributes(attrs)}>${title ? `<title>${title[1].trim()}</title>` : ''}</svg>`;
  });
  html = html.replace(/<(link|meta|base)\b[^>]*>/gi, '');
  html = html.replace(/<([a-zA-Z][\w:-]*)(\s[^>]*?)?(\/?)>/g, (_, tag, attrs, selfClose) =>
    `<${tag}${attrs ? cleanAttributes(attrs) : ''}${selfClose}>`);
  html = html.replace(/\s+/g, ' ').replace(/>\s+</g, '><').trim();

  return { html, originalLength: original.length, cleanedLength: html.length };
}
