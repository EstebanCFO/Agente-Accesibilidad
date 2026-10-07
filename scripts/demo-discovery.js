/**
 * Recorre una URL una sola vez y guarda el resultado: el formulario lo usa para el botón
 * "Analizar sitio" y el paso 1 lo reutiliza sin volver a recorrer.
 * Siempre devuelve la principal primero, sin duplicados.
 *
 * onPage(url) avisa cada página (distinta de la principal) apenas se descubre, para mostrar el
 * avance. Si la URL ya se recorrió, repite las páginas al instante; si se está recorriendo en
 * otro pedido, repite las ya encontradas y sigue avisando las nuevas.
 */
export function createSiteDiscovery(crawl, { maxPages }) {
  const cache = new Map();

  function start(url) {
    const entry = { found: [], listeners: new Set(), promise: null };
    const seen = new Set([url]);
    const notify = (page) => {
      if (seen.has(page)) return;
      seen.add(page);
      entry.found.push(page);
      for (const listener of entry.listeners) listener(page);
    };
    entry.promise = crawl(url, { maxUrls: maxPages, onPage: notify })
      .then((urls) => {
        for (const page of urls) notify(page);
        return [url, ...entry.found];
      })
      .catch((error) => {
        cache.delete(url);
        throw error;
      });
    cache.set(url, entry);
    return entry;
  }

  async function discover(url, onPage = () => {}) {
    const entry = cache.get(url) ?? start(url);
    for (const page of entry.found) onPage(page);
    entry.listeners.add(onPage);
    try {
      return await entry.promise;
    } finally {
      entry.listeners.delete(onPage);
    }
  }
  // ¿Ya se analizó (o se está analizando) esta URL?
  discover.has = (url) => cache.has(url);
  return discover;
}
