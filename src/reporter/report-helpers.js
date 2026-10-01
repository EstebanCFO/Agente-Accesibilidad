// Movidos a clasificación (la Sección 1 los necesita para el motivo de cada criterio).
export { criteriaWithoutAutomatedRules, manualReviewFor, manualReviewLabel } from '../classification/manual-review.js';

function localPath(u) {
  return decodeURIComponent(u.pathname).replace(/^\/([A-Za-z]:)/, '$1');
}

/**
 * Nombre legible de cada página auditada: el path dentro del sitio ("/", "/cuentas.html") en vez
 * de la URL completa. Si hay páginas de más de un dominio se antepone el dominio. Para una carpeta
 * local se muestra el archivo relativo a la carpeta común.
 */
export function pageLabels(urls = []) {
  const list = [...new Set(urls.filter(Boolean))];
  const parsed = new Map(list.map((u) => { try { return [u, new URL(u)]; } catch { return [u, null]; } }));
  const labels = new Map();

  const fileUrls = list.filter((u) => parsed.get(u)?.protocol === 'file:');
  let commonDir = [];
  if (fileUrls.length > 0) {
    const dirs = fileUrls.map((u) => localPath(parsed.get(u)).split('/').slice(0, -1));
    for (let i = 0; i < dirs[0].length && dirs.every((d) => d[i] === dirs[0][i]); i++) commonDir.push(dirs[0][i]);
  }
  const hosts = new Set(list.map((u) => parsed.get(u)).filter((p) => p && p.protocol !== 'file:').map((p) => p.host));

  for (const url of list) {
    const u = parsed.get(url);
    if (!u) { labels.set(url, url); continue; }
    if (u.protocol === 'file:') {
      const rest = localPath(u).split('/').slice(commonDir.length).join('/');
      labels.set(url, rest || localPath(u));
      continue;
    }
    const path = `${u.pathname}${u.search}` || '/';
    const label = path === '/' ? '/ (inicio)' : path;
    labels.set(url, hosts.size > 1 ? `${u.host}${label === '/ (inicio)' ? '/' : label}` : label);
  }
  return labels;
}

export function pageLabel(url, labels) {
  return labels?.get(url) ?? url;
}

/**
 * Sitio/URL auditada para mostrar en el encabezado: la URL si es una sola página; el origen del
 * sitio (o la carpeta, para archivos locales) si se auditaron varias páginas del mismo lugar.
 */
export function analyzedTarget(urls = []) {
  const list = [...new Set(urls.filter(Boolean))];
  if (list.length === 0) return null;
  const parsed = list.map((u) => { try { return new URL(u); } catch { return null; } });
  const display = (u) => (u.protocol === 'file:' ? localPath(u) : u.href);
  if (list.length === 1) return parsed[0] ? { text: display(parsed[0]), href: parsed[0].protocol === 'file:' ? null : parsed[0].href } : { text: list[0], href: null };
  if (parsed.some((u) => !u)) return { text: list[0], href: null };
  if (parsed.every((u) => u.protocol === 'file:')) {
    const dirs = parsed.map((u) => localPath(u).split('/').slice(0, -1));
    const common = [];
    for (let i = 0; i < dirs[0].length && dirs.every((d) => d[i] === dirs[0][i]); i++) common.push(dirs[0][i]);
    return { text: `${common.join('/') || '/'}/`, href: null };
  }
  const origin = parsed[0].origin;
  return { text: origin, href: origin };
}
