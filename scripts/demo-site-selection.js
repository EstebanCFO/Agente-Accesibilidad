/**
 * Sitio de demo fijo: problemas de accesibilidad reales y visibles, sin depender de que el
 * sitio del cliente esté arriba ni exponer datos reales durante una presentación en vivo.
 */
export const DEMO_SITE_URL = 'https://dequeuniversity.com/demo/mars/';

/**
 * Resuelve la URL objetivo de la demo a partir de la opción elegida en el menú de arranque
 * (1 = sitio de demo fijo, 2/3 = URL que el presentador tipeó en el momento).
 */
export function resolveTargetUrl(choice, customUrl) {
  const trimmedChoice = String(choice ?? '').trim();

  if (trimmedChoice === '1') return DEMO_SITE_URL;

  if (trimmedChoice === '2' || trimmedChoice === '3') {
    const url = (customUrl ?? '').trim();
    if (!url) throw new Error('Elegiste una URL personalizada pero no se ingresó ninguna.');
    return url;
  }

  throw new Error(`Opción inválida: "${choice}". Elegí 1, 2 o 3.`);
}
