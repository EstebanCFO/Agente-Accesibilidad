/**
 * Sección 3 (Pruebas de teclado del Agente): de lo que registró el recorrido con Tab (y, si hubo,
 * el juicio de la IA) se deriva, por página, el estado de 4 criterios que requieren tecnología
 * asistiva. Es complementario: nunca cambia la Sección 1, donde estos criterios siguen "a validar".
 *   2.1.2 sin trampas de teclado y 3.2.1 al recibir el foco -> solo reglas (son hechos);
 *   2.4.3 orden del foco y 2.4.7 foco visible -> juicio de la IA, o reglas si la IA no respondió.
 */
export const KEYBOARD_CRITERIA = [
  { id: '2.1.2', label: 'Sin trampas de teclado' },
  { id: '2.4.3', label: 'Orden del foco' },
  { id: '2.4.7', label: 'Foco visible' },
  { id: '3.2.1', label: 'Al recibir el foco' }
];

/** Menos de este % de píxeles distintos entre la parada con foco y sin foco = foco poco visible. */
export const MIN_FOCUS_CHANGE_PCT = 1;

const CONTEXT_LABEL = { url: 'cambió la URL', popup: 'abrió otra ventana', dialog: 'abrió un diálogo' };

/**
 * Paradas donde el foco retrocede hacia arriba en la pantalla: el elemento nuevo queda entero por
 * encima del anterior (los de la misma fila no cuentan). Coordenadas del documento, no del viewport.
 */
export function detectOrderJumps(stops = []) {
  const jumps = [];
  for (let i = 1; i < stops.length; i++) {
    const a = stops[i - 1];
    const b = stops[i];
    if (b.doc_y + (b.bbox?.height ?? 0) <= a.doc_y) jumps.push({ from: a.index, to: b.index });
  }
  return jumps;
}

/** Paradas con cambio visual medido y menor al mínimo (null = no se pudo medir, no cuenta). */
export function lowVisibilityStops(stops = []) {
  return stops.filter((s) => typeof s.focus_change_pct === 'number' && s.focus_change_pct < MIN_FOCUS_CHANGE_PCT).map((s) => s.index);
}

const lista = (paradas) => paradas.join(', ');

function fromAi(aiCriterion, fallback) {
  if (!aiCriterion || !['sin_indicios', 'con_indicios'].includes(aiCriterion.estado)) return fallback;
  return { estado: aiCriterion.estado, paradas: aiCriterion.paradas ?? [], motivo: aiCriterion.motivo || fallback.motivo, fuente: 'Agente' };
}

/**
 * Estado de los 4 criterios para una página. walk = resultado de walkKeyboard (sin imágenes);
 * ai = salida normalizada de runKeyboardReview; aiFailed = la IA se intentó y falló.
 */
export function buildKeyboardCriteria(walk, { ai = null, aiFailed = false, error = null } = {}) {
  const noEvaluable = (motivo) => Object.fromEntries(KEYBOARD_CRITERIA.map((c) => [c.id, { estado: 'no_evaluable', paradas: [], motivo, fuente: 'reglas' }]));
  if (error || !walk) return noEvaluable(`No se pudo recorrer la página con el teclado: ${error ?? 'sin datos'}`);
  if (walk.stops.length === 0) return noEvaluable('La página no tiene elementos que reciban el foco con Tab');

  const ruleSource = aiFailed ? 'reglas (sin interpretación del Agente)' : 'reglas';
  const trap = walk.trap?.paradas ?? [];
  const contextStops = walk.stops.filter((s) => s.context_change);
  const jumps = detectOrderJumps(walk.stops);
  const invisible = lowVisibilityStops(walk.stops);

  const trampa = trap.length > 0
    ? { estado: 'con_indicios', paradas: trap, motivo: `El foco quedó encerrado entre las paradas ${lista(trap)} y Shift+Tab no lo sacó`, fuente: 'reglas' }
    : { estado: 'sin_indicios', paradas: [], motivo: `El foco recorrió ${walk.stops.length} elemento(s) sin quedar encerrado`, fuente: 'reglas' };
  const alFoco = contextStops.length > 0
    ? { estado: 'con_indicios', paradas: contextStops.map((s) => s.index), motivo: contextStops.map((s) => `La parada ${s.index} ${CONTEXT_LABEL[s.context_change] ?? 'cambió el contexto'} solo por recibir el foco`).join('; '), fuente: 'reglas' }
    : { estado: 'sin_indicios', paradas: [], motivo: 'Recibir el foco no cambió la página, la URL ni abrió ventanas', fuente: 'reglas' };
  const orden = jumps.length > 0
    ? { estado: 'con_indicios', paradas: jumps.map((j) => j.to), motivo: `El foco vuelve hacia arriba en la pantalla en las paradas ${lista(jumps.map((j) => j.to))}`, fuente: ruleSource }
    : { estado: 'sin_indicios', paradas: [], motivo: 'El foco avanza en el orden de lectura de la pantalla', fuente: ruleSource };
  const visible = invisible.length > 0
    ? { estado: 'con_indicios', paradas: invisible, motivo: `El aspecto casi no cambia al recibir el foco en las paradas ${lista(invisible)}`, fuente: ruleSource }
    : { estado: 'sin_indicios', paradas: [], motivo: 'Cada elemento cambia de aspecto al recibir el foco', fuente: ruleSource };

  return {
    '2.1.2': trampa,
    '2.4.3': fromAi(ai?.orden_del_foco, orden),
    '2.4.7': fromAi(ai?.foco_visible, visible),
    '3.2.1': alFoco
  };
}

/** Puntaje de la Sección 3: % de pares página×criterio sin indicios, sobre los evaluables. */
export function computeKeyboardScore(pageResults = []) {
  const counts = { sin_indicios: 0, con_indicios: 0, no_evaluable: 0 };
  for (const page of pageResults) {
    for (const c of KEYBOARD_CRITERIA) {
      const estado = page.criteria?.[c.id]?.estado;
      if (estado in counts) counts[estado] += 1;
    }
  }
  const evaluables = counts.sin_indicios + counts.con_indicios;
  return { score: evaluables === 0 ? null : Math.round((counts.sin_indicios / evaluables) * 10000) / 100, ...counts };
}
