async function checkUrl(url, timeoutMs) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    let response = await fetch(url, { method: 'HEAD', redirect: 'follow', signal: controller.signal });
    if (response.status === 405 || response.status === 501) {
      // Algunos servidores no soportan HEAD (WAFs, CDNs mal configurados) — reintenta con GET.
      response = await fetch(url, { method: 'GET', redirect: 'follow', signal: controller.signal });
    }
    return { url, status: response.status, ok: response.ok };
  } catch (error) {
    return { url, status: null, ok: false, error: error.name === 'AbortError' ? 'timeout' : error.message };
  } finally {
    clearTimeout(timer);
  }
}

/**
 * Verifica accesibilidad HTTP de cada URL antes de escanear (SPEC §6.1, fase DISCOVER).
 * No usa Playwright: es un chequeo liviano de status HTTP, no un render completo.
 */
export async function validateUrlList(urlList, { timeout = 10000, concurrency = 5 } = {}) {
  if (!Array.isArray(urlList) || urlList.length === 0) {
    throw new Error('validateUrlList requiere "urlList" no vacío');
  }

  const results = new Array(urlList.length);
  let nextIndex = 0;
  const workerCount = Math.max(1, Math.min(concurrency, urlList.length));

  async function runWorker() {
    while (nextIndex < urlList.length) {
      const index = nextIndex++;
      results[index] = await checkUrl(urlList[index], timeout);
    }
  }

  await Promise.all(Array.from({ length: workerCount }, runWorker));

  const validatedList = results.filter((r) => r.ok).map((r) => r.url);
  const errors = results
    .filter((r) => !r.ok)
    .map((r) => ({ url: r.url, status: r.status, error: r.error ?? `HTTP ${r.status}` }));

  return { validated_list: validatedList, errors };
}
