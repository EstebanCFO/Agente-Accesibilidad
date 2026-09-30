import { createRequire } from 'node:module';
import { ontiCriteria } from './wcag-map.js';

const require = createRequire(import.meta.url);

let cachedCoverage = null;

/**
 * Criterios de los 38 sin ninguna regla automática en el motor del agente (versión instalada).
 * Si no se encontró un incumplimiento en ellos, no se puede decir que "cumplen": figuran como
 * "No evaluado" y requieren revisión manual con tecnología asistiva (Fase 2).
 */
export function criteriaWithoutAutomatedRules() {
  if (cachedCoverage) return cachedCoverage;
  try {
    const axe = require('axe-core');
    const covered = new Set();
    for (const rule of axe.getRules()) {
      if (rule.tags.includes('deprecated') || rule.tags.includes('experimental')) continue;
      for (const tag of rule.tags) {
        const m = tag.match(/^wcag(\d)(\d)(\d+)$/);
        if (m) covered.add(`${m[1]}.${m[2]}.${m[3]}`);
      }
    }
    cachedCoverage = { axeVersion: axe.version, missing: ontiCriteria.map((c) => c.wcag_criterion).filter((c) => !covered.has(c)) };
  } catch {
    cachedCoverage = { axeVersion: null, missing: [] };
  }
  return cachedCoverage;
}

/**
 * Cómo se revisa cada criterio que el agente no puede verificar automáticamente. Algunos
 * requieren tecnología asistiva (lector de pantalla y/o navegación solo con teclado); el resto,
 * una revisión manual sin tecnología asistiva (inspección visual, del contenido o del código).
 */
const MANUAL_REVIEW = {
  '1.2.1': { assistive: false, method: 'Revisión del contenido de audio y video' },
  '1.2.3': { assistive: false, method: 'Revisión del contenido de audio y video' },
  '1.2.4': { assistive: false, method: 'Revisión del contenido de audio y video' },
  '1.2.5': { assistive: false, method: 'Revisión del contenido de audio y video' },
  '1.3.2': { assistive: true, method: 'Lector de pantalla' },
  '1.3.3': { assistive: false, method: 'Revisión de las instrucciones del contenido' },
  '1.4.5': { assistive: false, method: 'Inspección visual' },
  '2.1.2': { assistive: true, method: 'Navegación solo con teclado' },
  '2.3.1': { assistive: false, method: 'Análisis de destellos del contenido' },
  '2.4.3': { assistive: true, method: 'Navegación solo con teclado' },
  '2.4.5': { assistive: false, method: 'Revisión de la navegación del sitio' },
  '2.4.6': { assistive: true, method: 'Lector de pantalla' },
  '2.4.7': { assistive: true, method: 'Navegación solo con teclado' },
  '3.2.1': { assistive: true, method: 'Navegación solo con teclado' },
  '3.2.2': { assistive: true, method: 'Teclado y lector de pantalla' },
  '3.2.3': { assistive: false, method: 'Revisión de consistencia entre páginas' },
  '3.2.4': { assistive: false, method: 'Revisión de consistencia entre páginas' },
  '3.3.1': { assistive: true, method: 'Lector de pantalla' },
  '3.3.3': { assistive: true, method: 'Lector de pantalla' },
  '3.3.4': { assistive: false, method: 'Prueba del flujo de formularios' },
  '4.1.1': { assistive: false, method: 'Validación del código HTML' }
};

export function manualReviewFor(criterion) {
  return MANUAL_REVIEW[criterion] ?? { assistive: true, method: 'Tecnología asistiva' };
}

/** Texto corto para mostrar junto a un criterio "No evaluado". */
export function manualReviewLabel(criterion) {
  const r = manualReviewFor(criterion);
  return r.assistive ? `Requiere tecnología asistiva: ${r.method.toLowerCase()}` : `Requiere revisión manual: ${r.method.toLowerCase()}`;
}
