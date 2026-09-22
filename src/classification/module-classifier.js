/**
 * Deriva un "módulo" de negocio a partir de una URL escaneada usando el primer segmento
 * del path (ej. '/home-banking/transferencias' -> 'home-banking'). Es la única señal
 * disponible hoy sin que alguien complete una config de mapeo por canal.
 *
 * Limitación aceptada: no distingue por host, solo por path. Dos hosts distintos que
 * compartan el primer segmento (ej. 'a.test/home-banking/x' y 'staging.test/home-banking/y')
 * caen en el mismo módulo. En la práctica un job escanea un solo canal/sitio a la vez
 * (SPEC D5: "1 canal = 1 job"), así que no debería darse dentro de un mismo job.
 */
export function classifyModule(url) {
  let parsed;
  try {
    parsed = new URL(url);
  } catch {
    return 'desconocido';
  }
  const segment = parsed.pathname.split('/').find((part) => part.length > 0);
  if (segment === undefined) return 'raiz';
  try {
    return decodeURIComponent(segment);
  } catch {
    return segment;
  }
}
