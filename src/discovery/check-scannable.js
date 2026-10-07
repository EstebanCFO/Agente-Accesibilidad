/**
 * Chequeo previo de una URL (o sub-URL de un portal) antes de escanearla: un único GET normal,
 * sin forzar nada, para saber si el agente la va a poder auditar y si el sitio lo admite.
 *   - responde 2xx (después de redirecciones) y devuelve HTML
 *   - no muestra un sistema anti-bots / desafío (Cloudflare, Akamai, Imperva, DataDome, ...)
 *   - su robots.txt no prohíbe esa ruta
 * Si detecta protección, NO intenta esquivarla: avisa para que el cliente habilite la auditoría.
 */

export const AUDIT_USER_AGENT = 'CFOTech-A11y-Audit/0.1 (+auditoria de accesibilidad autorizada)';

// Firmas públicas y conocidas de gestión de bots / WAF con desafío. La sola presencia de un CDN
// (ej. el header cf-ray de Cloudflare) no cuenta: solo lo que indica bloqueo o desafío a bots.
const COOKIE_SIGNATURES = [
  { re: /^__cf_bm=/i, name: 'Cloudflare Bot Management' },
  { re: /^cf_clearance=/i, name: 'Cloudflare (desafío)' },
  { re: /^(_abck|bm_sz|ak_bmsc)=/i, name: 'Akamai Bot Manager' },
  { re: /^datadome=/i, name: 'DataDome' },
  { re: /^_px(hd|vid|3|2)?=/i, name: 'HUMAN / PerimeterX' },
  { re: /^(incap_ses_|visid_incap_|reese84=)/i, name: 'Imperva' },
  { re: /^TS01[0-9a-f]{6}=/i, name: 'F5 BIG-IP ASM' }
];
const HEADER_SIGNATURES = [
  { header: 'cf-mitigated', name: 'Cloudflare (desafío)' },
  { header: 'x-datadome', name: 'DataDome' },
  { header: 'x-iinfo', name: 'Imperva' },
  { header: 'x-px-block', name: 'HUMAN / PerimeterX' }
];
const BODY_SIGNATURES = [
  { re: /\/cdn-cgi\/challenge-platform\/|<title>\s*Just a moment/i, name: 'Cloudflare (desafío)' },
  { re: /_Incapsula_Resource|Incapsula incident ID/i, name: 'Imperva' },
  { re: /captcha-delivery\.com|geo\.captcha-delivery/i, name: 'DataDome' },
  { re: /px-captcha|perimeterx/i, name: 'HUMAN / PerimeterX' },
  { re: /The requested URL was rejected\. Please consult with your administrator/i, name: 'F5 BIG-IP ASM' }
];

function setCookieNames(headers) {
  const list = typeof headers.getSetCookie === 'function' ? headers.getSetCookie() : [headers.get('set-cookie')].filter(Boolean);
  return list.map((c) => c.trim());
}

/** Nombre del sistema anti-bots detectado, o null. Lógica pura sobre headers y cuerpo. */
export function detectBotProtection(headers, body = '') {
  for (const cookie of setCookieNames(headers)) {
    const hit = COOKIE_SIGNATURES.find((s) => s.re.test(cookie));
    if (hit) return hit.name;
  }
  const hit = HEADER_SIGNATURES.find((s) => headers.get(s.header) !== null);
  if (hit) return hit.name;
  return BODY_SIGNATURES.find((s) => s.re.test(body))?.name ?? null;
}

/**
 * ¿robots.txt permite la ruta para cualquier agente ("User-agent: *")? Regla de la coincidencia
 * más larga entre Allow/Disallow (RFC 9309), con soporte de * y $.
 */
export function robotsAllows(robotsTxt, pathWithQuery) {
  const rules = [];
  let inStar = false;
  let lastWasAgent = false;
  for (const raw of String(robotsTxt).split(/\r?\n/)) {
    const line = raw.replace(/#.*/, '').trim();
    const m = line.match(/^([a-z-]+)\s*:\s*(.*)$/i);
    if (!m) continue;
    const key = m[1].toLowerCase();
    const value = m[2].trim();
    if (key === 'user-agent') {
      if (!lastWasAgent) inStar = false;
      if (value === '*') inStar = true;
      lastWasAgent = true;
      continue;
    }
    lastWasAgent = false;
    if (inStar && (key === 'allow' || key === 'disallow') && value) rules.push({ allow: key === 'allow', pattern: value });
  }
  let best = null;
  for (const rule of rules) {
    const source = '^' + rule.pattern.replace(/[.+?^{}()|[\]\\]/g, '\\$&').replace(/\*/g, '.*');
    if (!new RegExp(source).test(pathWithQuery)) continue;
    if (!best || rule.pattern.length > best.pattern.length || (rule.pattern.length === best.pattern.length && rule.allow)) best = rule;
  }
  return best ? best.allow : true;
}

async function fetchWithTimeout(fetchImpl, url, timeoutMs) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    return await fetchImpl(url, { redirect: 'follow', signal: controller.signal, headers: { 'User-Agent': AUDIT_USER_AGENT, Accept: 'text/html,*/*' } });
  } finally {
    clearTimeout(timer);
  }
}

/**
 * Devuelve { ok, reason, status, protection }. Nunca tira: cualquier falla es un ok=false con
 * el motivo en castellano, listo para mostrar al lado del campo URL.
 */
export async function checkScannable(url, { fetchImpl = fetch, timeout = 10000 } = {}) {
  let parsed;
  try {
    parsed = new URL(url);
    if (!/^https?:$/.test(parsed.protocol)) throw new Error();
  } catch {
    return { ok: false, reason: 'URL inválida', status: null, protection: null };
  }

  let response;
  let body = '';
  try {
    response = await fetchWithTimeout(fetchImpl, parsed.href, timeout);
    body = (await response.text()).slice(0, 200000);
  } catch (error) {
    const reason = error.name === 'AbortError' ? 'El sitio no respondió a tiempo' : `No se pudo conectar (${error.cause?.code ?? error.message})`;
    return { ok: false, reason, status: null, protection: null };
  }

  const protection = detectBotProtection(response.headers, body);
  if (protection) {
    return { ok: false, reason: `Protección anti-bots detectada (${protection}): pedí al cliente que habilite la auditoría`, status: response.status, protection };
  }
  if (!response.ok) {
    return { ok: false, reason: `El sitio respondió HTTP ${response.status}`, status: response.status, protection: null };
  }
  const contentType = response.headers.get('content-type') ?? '';
  if (contentType && !/html/i.test(contentType)) {
    return { ok: false, reason: `No es una página HTML (${contentType.split(';')[0]})`, status: response.status, protection: null };
  }

  // robots.txt: si no existe o no se puede leer, no restringe.
  const finalUrl = new URL(response.url || parsed.href);
  try {
    const robots = await fetchWithTimeout(fetchImpl, `${finalUrl.origin}/robots.txt`, timeout);
    if (robots.ok && !robotsAllows(await robots.text(), finalUrl.pathname + finalUrl.search)) {
      return { ok: false, reason: 'El robots.txt del sitio no permite rastrear esta ruta', status: response.status, protection: null };
    }
  } catch {
    // sin robots.txt accesible = sin restricción declarada
  }

  return { ok: true, reason: 'Se puede escanear', status: response.status, protection: null };
}
