/**
 * Resuelve cuántas subpáginas adicionales (además de la principal) audita la demo, a partir
 * de lo que el presentador tipeó en el momento. Vacío = 0 (solo la principal). Si pide más de
 * las que existen, se recorta al máximo disponible en vez de cortar la demo con un error - un
 * typo en vivo no debería interrumpir la presentación.
 */
export function resolveAdditionalPageCount(rawAnswer, availableCount) {
  const trimmed = String(rawAnswer ?? '').trim();
  if (trimmed === '') return 0;

  const parsed = Number(trimmed);
  if (!Number.isInteger(parsed) || parsed < 0) {
    throw new Error(`Cantidad inválida: "${rawAnswer}". Ingresá un número entero entre 0 y ${availableCount}.`);
  }

  return Math.min(parsed, availableCount);
}
