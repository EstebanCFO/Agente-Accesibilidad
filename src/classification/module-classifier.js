/**
 * Deriva un "módulo" de negocio a partir de una URL escaneada usando el primer segmento
 * del path (ej. '/home-banking/transferencias' -> 'home-banking'). Es la única señal
 * disponible hoy sin que alguien complete una config de mapeo por canal.
 */
export function classifyModule(url) {
  let parsed;
  try {
    parsed = new URL(url);
  } catch {
    return url;
  }
  const segment = parsed.pathname.split('/').find((part) => part.length > 0);
  return segment ?? 'raiz';
}
