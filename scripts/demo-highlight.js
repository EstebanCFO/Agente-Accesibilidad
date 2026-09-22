// Mismos colores de status fijos que ya usa dashboard-deliverable.js — consistencia visual
// entre lo que se resalta en vivo durante la demo y lo que después se ve en el dashboard.
const SEVERITY_COLOR = { critical: '#d03b3b', serious: '#ec835a', moderate: '#fab219', minor: '#898781' };

/**
 * Convierte las violations[] de un axe_result (scanUrl) en los targets a resaltar visualmente
 * sobre la página durante la demo. Función pura - no toca el DOM, solo prepara los datos que
 * después se le pasan a page.evaluate() para dibujar los bordes.
 */
export function buildHighlightTargets(violations) {
  const targets = [];
  for (const violation of violations || []) {
    const color = SEVERITY_COLOR[violation.impact] ?? SEVERITY_COLOR.minor;
    for (const node of violation.nodes || []) {
      const selector = Array.isArray(node.target) ? node.target[0] : node.target;
      targets.push({ selector, color, label: violation.help });
    }
  }
  return targets;
}

/** Texto del badge flotante que se muestra sobre la página escaneada durante la demo. */
export function buildBadgeText(violations) {
  const count = (violations || []).reduce((sum, v) => sum + (v.nodes?.length ?? 0), 0);
  if (count === 0) return 'Sin problemas detectados por el escaneo automático en esta página.';
  return `${count} problema${count === 1 ? '' : 's'} de accesibilidad detectado${count === 1 ? '' : 's'} en esta página`;
}
