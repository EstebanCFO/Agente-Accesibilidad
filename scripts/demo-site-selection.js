/**
 * Sitios de referencia con problemas de accesibilidad reales y documentados, pensados
 * específicamente para practicar/demostrar auditorías WCAG - mejor elección que un sitio de
 * e-commerce genérico para el demo, y sin depender de que el sitio del cliente esté arriba.
 */
export const REFERENCE_SITES = [
  { label: 'W3C Before and After Demo (BAD)', url: 'https://www.w3.org/WAI/demos/bad/' },
  { label: 'Accessible University Demo Site', url: 'https://projects.accesscomputing.uw.edu/au/' },
  { label: 'The Accessibility Maze', url: 'https://de.torontomu.ca/wa/maze.html' }
];

/** Resuelve la URL del sitio de referencia elegido en el submenú de la opción 1. */
export function resolveReferenceSiteUrl(subChoice) {
  const index = Number(String(subChoice ?? '').trim());
  if (!Number.isInteger(index) || index < 1 || index > REFERENCE_SITES.length) {
    throw new Error(`Opción inválida: "${subChoice}". Elegí un número entre 1 y ${REFERENCE_SITES.length}.`);
  }
  return REFERENCE_SITES[index - 1].url;
}

/**
 * Resuelve la URL objetivo de la demo para las opciones 2/3 del menú de arranque (URL que el
 * presentador tipeó en el momento). La opción 1 (sitios de referencia) la resuelve
 * resolveReferenceSiteUrl, no esta función - necesita un submenú propio.
 */
export function resolveTargetUrl(choice, customUrl) {
  const trimmedChoice = String(choice ?? '').trim();

  if (trimmedChoice === '2' || trimmedChoice === '3') {
    const url = (customUrl ?? '').trim();
    if (!url) throw new Error('Elegiste una URL personalizada pero no se ingresó ninguna.');
    return url;
  }

  throw new Error(`Opción inválida: "${choice}". Elegí 1, 2 o 3.`);
}
