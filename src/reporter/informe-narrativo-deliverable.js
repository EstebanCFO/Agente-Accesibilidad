import { ontiCriteria } from '../classification/wcag-map.js';
import { derivePrincipio, deriveSeveridad, worseSeveridad } from '../classification/criticidad.js';

const HERRAMIENTA_LABEL = { 'axe-core': 'axe-core', visual_audit: 'IA (revisión visual)', ux_review: 'IA (revisión UX)' };
const NO_DETERMINADO_FLUJO = 'No determinado - requiere que el cliente indique qué páginas corresponden a flujos esenciales (login, transferencias, alta de producto).';
const SEVERIDAD_A_ESTADO = { critico: 'Crítico', alto: 'Alto', medio: 'Medio', bajo: 'Bajo' };

function ordenNumerico(a, b) {
  const partesA = a.wcag_criterion.split('.').map(Number);
  const partesB = b.wcag_criterion.split('.').map(Number);
  for (let i = 0; i < partesA.length; i += 1) {
    if (partesA[i] !== partesB[i]) return partesA[i] - partesB[i];
  }
  return 0;
}

function matchGlob(pattern, value) {
  const escaped = pattern.split('*').map((s) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')).join('.*');
  return new RegExp(`^${escaped}$`).test(value);
}

function resolveImpactoFlujo(url, essentialFlows) {
  if (!Array.isArray(essentialFlows) || essentialFlows.length === 0) return NO_DETERMINADO_FLUJO;
  const match = essentialFlows.find((flow) => matchGlob(flow.url_pattern, url));
  return match ? `Afecta el flujo esencial "${match.name}" (${url})` : NO_DETERMINADO_FLUJO;
}

function findingToHallazgo(finding, essentialFlows) {
  const impactos = (finding.affected_urls || []).map((url) => resolveImpactoFlujo(url, essentialFlows));
  return {
    descripcion: finding.failure_summary,
    herramientas: [HERRAMIENTA_LABEL[finding.source] ?? finding.source],
    elementos_afectados: [finding.element_sample],
    impacto_flujo: impactos.find((r) => r !== NO_DETERMINADO_FLUJO) ?? NO_DETERMINADO_FLUJO
  };
}

function buildFlujosEsencialesAfectados(criterios, essentialFlows) {
  if (!Array.isArray(essentialFlows) || essentialFlows.length === 0) {
    return NO_DETERMINADO_FLUJO;
  }
  const nombresAfectados = new Set();
  for (const c of criterios) {
    if (c.estado === 'Cumple' || c.estado === 'No aplica') continue;
    for (const h of c.hallazgos) {
      const match = h.impacto_flujo?.match(/^Afecta el flujo esencial "([^"]+)"/);
      if (match) nombresAfectados.add(match[1]);
    }
  }
  return nombresAfectados.size > 0
    ? `Flujos esenciales afectados: ${[...nombresAfectados].join(', ')}.`
    : 'Ningún flujo esencial configurado resultó afectado por los hallazgos de esta corrida.';
}

function buildResumen(criterios, essentialFlows) {
  const conteoPorEstado = {};
  for (const c of criterios) {
    conteoPorEstado[c.estado] = (conteoPorEstado[c.estado] ?? 0) + 1;
  }
  const prioritarios = criterios
    .filter((c) => c.estado === 'Crítico' || c.estado === 'Alto')
    .sort((a, b) => (a.estado === 'Crítico' ? 0 : 1) - (b.estado === 'Crítico' ? 0 : 1));

  return {
    conteo_por_estado: conteoPorEstado,
    hallazgos_prioritarios: prioritarios.map((c) => ({ criterio: c.criterio, nombre: c.nombre, estado: c.estado })),
    flujos_esenciales_afectados: buildFlujosEsencialesAfectados(criterios, essentialFlows),
    recomendacion_general: prioritarios.length > 0
      ? `Priorizar la remediación de los ${conteoPorEstado['Crítico'] ?? 0} criterio(s) Crítico(s) primero, luego los ${conteoPorEstado['Alto'] ?? 0} Alto(s).`
      : 'No hay criterios Crítico ni Alto pendientes de remediación.'
  };
}

/**
 * Arma los 38 bloques del informe narrativo (uno por criterio ONTI), en orden numérico (no el
 * orden interno de onti-38-criteria.json, que agrupa por nivel A/AA) para que salgan agrupados
 * por Principio tal como pide el formato. Ver docs/superpowers/specs/
 * 2026-09-23-informe-narrativo-design.md para la prioridad de estado/severidad.
 */
export function buildInformeNarrativo({ findings, naCriteria = [], essentialFlows = [] }) {
  const naSet = new Set(naCriteria);
  const criteriosOrdenados = [...ontiCriteria].sort(ordenNumerico);

  const criterios = criteriosOrdenados.map((criterio, index) => {
    const findingsDelCriterio = (findings || []).filter((f) => f.wcag_criterion === criterio.wcag_criterion && f.in_scope === 'onti');
    const confirmados = findingsDelCriterio.filter((f) => (f.review_status ?? 'confirmado') === 'confirmado');
    const requierenRevision = findingsDelCriterio.filter((f) => f.review_status === 'requiere_revision');

    let estado;
    if (naSet.has(criterio.wcag_criterion)) {
      estado = 'No aplica';
    } else if (confirmados.length > 0) {
      const peorSeveridad = confirmados.map(deriveSeveridad).reduce(worseSeveridad);
      estado = SEVERIDAD_A_ESTADO[peorSeveridad];
    } else if (requierenRevision.length > 0) {
      estado = 'Requiere revisión';
    } else {
      estado = 'Cumple';
    }

    const hallazgos = findingsDelCriterio.length > 0
      ? findingsDelCriterio.map((f) => findingToHallazgo(f, essentialFlows))
      : [{ descripcion: 'Sin hallazgos', herramientas: [], elementos_afectados: [], impacto_flujo: null }];

    const recomendacion = confirmados[0]?.remediation_hint
      || requierenRevision[0]?.remediation_hint
      || 'Sin acción requerida - el criterio se cumple según la evaluación automática.';

    return {
      numero: index + 1,
      criterio: criterio.wcag_criterion,
      nombre: criterio.description,
      principio: derivePrincipio(criterio.wcag_criterion),
      nivel: criterio.level,
      estado,
      hallazgos,
      recomendacion
    };
  });

  return { criterios, resumen: buildResumen(criterios, essentialFlows) };
}

export function buildInformeNarrativoJson({ jobId, channel, findings, naCriteria, essentialFlows }) {
  const { criterios, resumen } = buildInformeNarrativo({ findings, naCriteria, essentialFlows });
  return { job_id: jobId, channel: channel ?? null, generated_at: new Date().toISOString(), criterios, resumen };
}

function escapeHtml(value) {
  return String(value ?? '').replace(/[&<>"']/g, (char) => ({
    '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;'
  }[char]));
}

const HERRAMIENTAS_EXCLUIDAS_NOTA = `<p class="meta">Nota metodológica: se evaluó sumar Lighthouse, WAVE, Accessibility Insights y ARC Toolkit a la corrida automática. Lighthouse y Accessibility Insights dependen internamente de axe-core (no aportan un motor de detección nuevo); WAVE solo ofrece una API paga que envía el contenido de la página a servidores de terceros; ARC Toolkit no tiene API en su versión gratuita. Por eso axe-core sigue siendo la única fuente automática, complementada con la revisión de IA con visión (visual_audit/ux_compliance_review).</p>`;

function criterioBlockHtml(c) {
  const estadoClass = c.estado.toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/\s+/g, '-');
  const hallazgosHtml = c.hallazgos.map((h) => `
    <li>
      ${escapeHtml(h.descripcion)}
      ${h.herramientas.length > 0 ? `<br><small>Detectado por: ${h.herramientas.map(escapeHtml).join(', ')}</small>` : ''}
      ${h.elementos_afectados.filter(Boolean).length > 0 ? `<br><small>Elemento: <code>${escapeHtml(h.elementos_afectados[0])}</code></small>` : ''}
      ${h.impacto_flujo ? `<br><small>${escapeHtml(h.impacto_flujo)}</small>` : ''}
    </li>`).join('\n');

  return `
  <section class="criterio estado-${estadoClass}">
    <h3>${c.numero}. ${escapeHtml(c.criterio)} ${escapeHtml(c.nombre)}</h3>
    <p><strong>Principio:</strong> ${escapeHtml(c.principio)} · <strong>Nivel:</strong> ${escapeHtml(c.nivel)} · <strong>Estado:</strong> ${escapeHtml(c.estado)}</p>
    <p><strong>Hallazgos:</strong></p>
    <ul>${hallazgosHtml}</ul>
    <p><strong>Recomendación de remediación:</strong> ${escapeHtml(c.recomendacion)}</p>
  </section>`;
}

function resumenHtml(resumen) {
  const conteoRows = Object.entries(resumen.conteo_por_estado)
    .map(([estado, count]) => `<tr><td>${escapeHtml(estado)}</td><td>${count}</td></tr>`).join('\n');
  const prioritariosRows = resumen.hallazgos_prioritarios
    .map((h) => `<li>[${escapeHtml(h.estado)}] ${escapeHtml(h.criterio)} — ${escapeHtml(h.nombre)}</li>`).join('\n');

  return `
  <section class="resumen">
    <h2>Resumen final</h2>
    <table><thead><tr><th>Estado</th><th>Cantidad</th></tr></thead><tbody>${conteoRows}</tbody></table>
    <h3>Hallazgos prioritarios (Crítico + Alto)</h3>
    <ul>${prioritariosRows || '<li>Ninguno.</li>'}</ul>
    <h3>Flujos esenciales afectados</h3>
    <p>${escapeHtml(resumen.flujos_esenciales_afectados)}</p>
    <p><strong>Recomendación general de priorización:</strong> ${escapeHtml(resumen.recomendacion_general)}</p>
  </section>`;
}

export function buildInformeNarrativoHtml({ jobId, channel, findings, naCriteria, essentialFlows }) {
  const { criterios, resumen } = buildInformeNarrativo({ findings, naCriteria, essentialFlows });
  return `<!doctype html>
<html lang="es">
<head>
<meta charset="utf-8">
<title>Informe Narrativo de Accesibilidad — ${escapeHtml(jobId)}</title>
<style>
  body { font-family: Arial, Helvetica, sans-serif; margin: 2rem; color: #1a1a1a; }
  h1 { font-size: 1.4rem; } h2 { font-size: 1.15rem; margin-top: 2rem; } h3 { font-size: 1rem; }
  .meta { color: #555; font-size: 0.85rem; }
  section.criterio { border: 1px solid #ddd; border-radius: 6px; padding: 1rem; margin-bottom: 1rem; }
  section.criterio.estado-critico { border-left: 5px solid #d03b3b; }
  section.criterio.estado-alto { border-left: 5px solid #ec835a; }
  section.criterio.estado-medio { border-left: 5px solid #fab219; }
  section.criterio.estado-bajo { border-left: 5px solid #898781; }
  section.criterio.estado-cumple { border-left: 5px solid #0ca30c; }
  section.criterio.estado-no-aplica { border-left: 5px solid #cccccc; }
  section.criterio.estado-requiere-revision { border-left: 5px solid #2a78d6; }
  table { border-collapse: collapse; } th, td { border: 1px solid #ddd; padding: 4px 8px; }
</style>
</head>
<body>
  <h1>Informe Narrativo de Accesibilidad — WCAG 2.0 A + AA</h1>
  <p class="meta">Job: ${escapeHtml(jobId)} · Canal: ${escapeHtml(channel ?? 'N/D')} · Generado: ${new Date().toISOString()}</p>
  ${HERRAMIENTAS_EXCLUIDAS_NOTA}
  ${criterios.map(criterioBlockHtml).join('\n')}
  ${resumenHtml(resumen)}
</body>
</html>`;
}
