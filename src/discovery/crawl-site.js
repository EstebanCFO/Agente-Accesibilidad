import { PlaywrightCrawler, Configuration } from 'crawlee';

// Recursos que nunca tiene sentido navegar como "página" del canal (SPEC: solo interesan
// las páginas HTML/rutas de la SPA, no assets estáticos).
const DEFAULT_EXCLUDE_EXTENSIONS = '**/*.{pdf,jpg,jpeg,png,gif,svg,webp,ico,zip,mp3,mp4,css,js,woff,woff2,ttf}';

/**
 * Descubre las URLs de un canal a partir de una raíz (SPEC §6.1, fase DISCOVER cuando
 * target.mode=crawl). Usa crawlee en modo Playwright (decisión de stack de la SPEC),
 * con `persistStorage: false` para no dejar carpetas de estado en disco entre corridas.
 *
 * No hace falta devolver los links rotos encontrados durante el crawl: ese chequeo es
 * responsabilidad de validate_url_list, que corre después sobre el url_list resultante.
 */
export async function crawlSite(rootUrl, options = {}) {
  if (!rootUrl) throw new Error('crawlSite requiere "rootUrl"');

  const {
    maxUrls = 100,
    includePatterns = [],
    excludePatterns = [],
    timeoutPerUrl = 30000,
    strategy = 'same-hostname'
  } = options;

  const discovered = new Set();
  const config = new Configuration({ persistStorage: false });

  const crawler = new PlaywrightCrawler({
    maxRequestsPerCrawl: maxUrls,
    requestHandlerTimeoutSecs: Math.max(1, Math.ceil(timeoutPerUrl / 1000)),
    async requestHandler({ request, enqueueLinks }) {
      discovered.add(request.loadedUrl ?? request.url);
      await enqueueLinks({
        strategy,
        globs: includePatterns.length > 0 ? includePatterns : undefined,
        exclude: [...excludePatterns, DEFAULT_EXCLUDE_EXTENSIONS]
      });
    },
    failedRequestHandler() {
      // Una URL individual que no carga no debe tirar abajo el resto del crawl;
      // simplemente no queda en `discovered`. validate_url_list se encarga de reportar errores HTTP.
    }
  }, config);

  await crawler.run([rootUrl]);

  return [...discovered];
}
