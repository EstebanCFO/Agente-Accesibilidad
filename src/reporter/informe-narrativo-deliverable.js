import { ontiCriteria } from '../classification/wcag-map.js';
import { derivePrincipio, deriveSeveridad, worseSeveridad } from '../classification/criticidad.js';
import { criteriaWithoutAutomatedRules, pageLabels, analyzedTarget, manualReviewFor, manualReviewLabel } from './report-helpers.js';
import { DS_CSS, DS_COLORS, DS_FRAMED_SCRIPT, dsHeaderHtml, dsFooterHtml, complementaryFindingsHtml } from './design-system.js';

const HERRAMIENTA_LABEL = { 'axe-core': 'Agente', visual_audit: 'Revisión visual agéntica', ux_review: 'Revisión UX agéntica' };
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
  const sinReglas = new Set(criteriaWithoutAutomatedRules().missing);
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
    } else if (sinReglas.has(criterio.wcag_criterion)) {
      estado = 'No evaluado';
    } else {
      estado = 'Cumple';
    }

    const hallazgos = findingsDelCriterio.length > 0
      ? findingsDelCriterio.map((f) => findingToHallazgo(f, essentialFlows))
      : [{ descripcion: estado === 'No evaluado' ? 'Sin verificación automática disponible para este criterio.' : 'Sin hallazgos', herramientas: [], elementos_afectados: [], impacto_flujo: null }];

    const recomendacion = confirmados[0]?.remediation_hint
      || requierenRevision[0]?.remediation_hint
      || (estado === 'No evaluado'
        ? `${manualReviewLabel(criterio.wcag_criterion)} (Fase 2).`
        : 'Sin acción requerida - el criterio se cumple según la evaluación automática.');

    const paginas = [...new Set(findingsDelCriterio.flatMap((f) => f.affected_urls || []))];
    const elementos = findingsDelCriterio.reduce((sum, f) => sum + (f.occurrences ?? 0), 0);

    return {
      numero: index + 1,
      criterio: criterio.wcag_criterion,
      nombre: criterio.description,
      principio: derivePrincipio(criterio.wcag_criterion),
      nivel: criterio.level,
      estado,
      hallazgos,
      recomendacion,
      paginas,
      elementos,
      revision_manual: estado === 'No evaluado' ? manualReviewFor(criterio.wcag_criterion) : null
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

const HERRAMIENTAS_EXCLUIDAS_NOTA = `<p class="meta">Nota metodológica: se evaluó sumar Lighthouse, WAVE, Accessibility Insights y ARC Toolkit a la corrida automática. Lighthouse y Accessibility Insights usan internamente el mismo motor de detección que el agente (no aportan una detección nueva); WAVE solo ofrece una API paga que envía el contenido de la página a servidores de terceros; ARC Toolkit no tiene API en su versión gratuita. Por eso el agente sigue siendo la única fuente automática, complementada con la revisión visual y de UX agéntica.</p>`;

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
    <p><strong>Principio:</strong> ${escapeHtml(c.principio)} · <strong>Nivel:</strong> ${escapeHtml(c.nivel)} · <strong>Estado:</strong> ${escapeHtml(c.estado)}${c.revision_manual ? ` · <span class="review-tag ${c.revision_manual.assistive ? 'at' : 'manual'}">${c.revision_manual.assistive ? 'Requiere tecnología asistiva' : 'Requiere revisión manual'}</span>` : ''}</p>
    <p><strong>Hallazgos:</strong></p>
    <ul>${hallazgosHtml}</ul>
    <p><strong>Recomendación de remediación:</strong> ${escapeHtml(c.recomendacion)}</p>
  </section>`;
}

const conPunto = (t) => (/[.!?]$/.test(String(t).trim()) ? String(t).trim() : `${String(t).trim()}.`);
const ESTADO_ORDEN = { 'Crítico': 0, 'Alto': 1, 'Medio': 2, 'Bajo': 3, 'Requiere revisión': 4 };
const PROBLEMA_ESTADOS = new Set(Object.keys(ESTADO_ORDEN));

/**
 * Informe general: lectura corrida de toda la auditoría (alcance, resultado, principales
 * problemas, qué falta revisar y recomendación). El detalle criterio por criterio queda como anexo.
 */
function informeGeneralHtml({ criterios, resumen, urls, scores, complementaryFindings }) {
  const allUrls = urls?.length ? urls : [...new Set(criterios.flatMap((c) => c.paginas))];
  const labels = pageLabels(allUrls);
  const target = analyzedTarget(allUrls);
  const cuenta = (estado) => criterios.filter((c) => c.estado === estado).length;
  const problemas = criterios.filter((c) => PROBLEMA_ESTADOS.has(c.estado)).sort((x, y) => ESTADO_ORDEN[x.estado] - ESTADO_ORDEN[y.estado]);
  const noEvaluados = criterios.filter((c) => c.estado === 'No evaluado');
  const conAT = noEvaluados.filter((c) => c.revision_manual?.assistive);
  const sinAT = noEvaluados.filter((c) => !c.revision_manual?.assistive);
  const cumple = cuenta('Cumple');
  const noAplica = cuenta('No aplica');
  const verificados = cumple + problemas.length;
  // Misma fuente que la tarjeta "Compliance WCAG" del panel: conteo sin veredicto.
  const section = scores?.wcag_section;
  const na = section?.no_aplica ? ` · ${section.no_aplica} ${section.no_aplica === 1 ? 'no aplica' : 'no aplican'}` : '';
  const resultado = section
    ? `<p>Según la Circular BCRA, el resultado de la verificación automática es <strong>${section.ok} OK, ${section.nok} NOK y ${section.a_validar} a validar (de ${section.total})</strong>${na}. Los criterios a validar requieren tecnología asistiva, una revisión manual o no tuvieron elementos evaluables, y no cuentan como OK.</p>`
    : '';

  const problemasHtml = problemas.length === 0
    ? '<p>El agente no detectó incumplimientos en los criterios que puede verificar automáticamente.</p>'
    : `<ol class="problemas">${problemas.map((c) => `<li><strong>${escapeHtml(c.criterio)} ${escapeHtml(c.nombre)}</strong> (Nivel ${escapeHtml(c.nivel)}, ${c.estado === 'Requiere revisión' ? 'requiere confirmación humana' : `prioridad ${escapeHtml(c.estado)}`}): presente en ${c.paginas.length} de ${allUrls.length} página(s)${c.elementos ? `, ${c.elementos} elemento(s)` : ''}${c.paginas.length > 0 ? ` — ${c.paginas.map((u) => escapeHtml(labels.get(u) ?? u)).join(', ')}` : ''}. ${escapeHtml(conPunto(c.recomendacion))}</li>`).join('\n')}</ol>`;

  const codigos = (lista) => lista.map((c) => `${c.criterio} ${c.nombre}`).join(', ');
  const confirmados = problemas.filter((c) => c.estado !== 'Requiere revisión');
  const nivelA = confirmados.filter((c) => c.nivel === 'A');
  const nivelAA = confirmados.filter((c) => c.nivel !== 'A');
  const aConfirmar = problemas.filter((c) => c.estado === 'Requiere revisión');
  const pasos = [
    nivelA.length > 0 ? `Corregir primero los criterios de Nivel A, que bloquean el uso: ${codigos(nivelA)}.` : null,
    nivelAA.length > 0 ? `${nivelA.length > 0 ? 'Después' : 'Corregir'} los de Nivel AA, que dificultan el uso: ${codigos(nivelAA)}.` : null,
    aConfirmar.length > 0 ? `Confirmar con una revisión humana: ${codigos(aConfirmar)}.` : null,
    conAT.length > 0 ? `Probar con tecnología asistiva (lector de pantalla y navegación con teclado) los ${conAT.length} criterios que la requieren.` : null,
    sinAT.length > 0 ? `Completar la revisión manual de los otros ${sinAT.length} criterios sin verificación automática.` : null
  ].filter(Boolean);
  const recomendacion = pasos.length > 0
    ? `<ol>${pasos.map((p) => `<li>${escapeHtml(p)}</li>`).join('')}</ol>`
    : '<p>No hay acciones de remediación pendientes según la evaluación automática.</p>';

  const complementarios = complementaryFindings?.length ?? 0;

  return `
  <section class="general">
    <h2>Informe general</h2>
    <h3>Alcance</h3>
    <p>Se auditaron <strong>${allUrls.length} página(s)</strong>${target ? ` de <strong>${escapeHtml(target.text)}</strong>` : ''} contra los 38 criterios de accesibilidad que exige la Circular BCRA (WCAG 2.0, niveles A y AA). El resultado se basa en los hallazgos del agente.</p>
    <ul class="pages">${allUrls.map((u) => `<li title="${escapeHtml(u)}">${escapeHtml(labels.get(u) ?? u)}</li>`).join('')}</ul>

    <h3>Resultado</h3>
    ${resultado}
    <p>De los 38 criterios, el agente verificó automáticamente <strong>${verificados}</strong>: <strong>${cumple}</strong> se cumplen y <strong>${problemas.length}</strong> presentan problemas.${noEvaluados.length > 0 ? ` Otros <strong>${noEvaluados.length}</strong> no se pueden verificar de forma automática: <strong>${conAT.length} requieren tecnología asistiva</strong> (lector de pantalla o teclado) y ${sinAT.length} una revisión manual.` : ''}${noAplica > 0 ? ` ${noAplica} no aplican al sitio (no hay contenido de ese tipo).` : ''}</p>

    <h3>Principales problemas encontrados</h3>
    ${problemasHtml}

    ${noEvaluados.length > 0 ? `<h3>Qué queda por revisar manualmente</h3>
    <p>Estos criterios no tienen verificación automática. Que el agente no los marque no significa que se cumplan: hay que revisarlos en la Fase 2.</p>
    ${conAT.length > 0 ? `<h4>Requieren tecnología asistiva (${conAT.length})</h4>
    <ul class="review-list">${conAT.map((c) => `<li><strong>${escapeHtml(c.criterio)} ${escapeHtml(c.nombre)}</strong> — ${escapeHtml(c.revision_manual.method)}</li>`).join('')}</ul>` : ''}
    ${sinAT.length > 0 ? `<h4>Requieren revisión manual sin tecnología asistiva (${sinAT.length})</h4>
    <ul class="review-list">${sinAT.map((c) => `<li><strong>${escapeHtml(c.criterio)} ${escapeHtml(c.nombre)}</strong> — ${escapeHtml(c.revision_manual.method)}</li>`).join('')}</ul>` : ''}` : ''}

    <h3>Análisis complementario</h3>
    <p>${complementarios > 0 ? `La revisión visual y de UX agéntica aportó <strong>${complementarios} observación(es)</strong> adicionales (detalladas al final). Son orientativas y no modifican el resultado.` : 'La revisión visual y de UX agéntica no aportó observaciones en esta auditoría (o no estaba activa).'}</p>

    <h3>Recomendación</h3>
    ${recomendacion}
    ${resumen.flujos_esenciales_afectados && !resumen.flujos_esenciales_afectados.startsWith('No determinado') ? `<p>${escapeHtml(resumen.flujos_esenciales_afectados)}</p>` : ''}
  </section>`;
}

export function buildInformeNarrativoHtml({ jobId, channel, findings, complementaryFindings = [], naCriteria, essentialFlows, urls, scores }) {
  const { criterios, resumen } = buildInformeNarrativo({ findings, naCriteria, essentialFlows });
  return `<!doctype html>
<html lang="es">
<head>
<meta charset="utf-8">
<title>Informe Narrativo de Accesibilidad — ${escapeHtml(jobId)}</title>
<style>${DS_CSS}
  h2 { margin-top: 24px; }
  section.criterio { background: #fff; border: 1px solid var(--border); border-left-width: 5px; border-radius: 12px; padding: 14px 18px;
    margin-bottom: 12px; box-shadow: 0 1px 4px rgba(10,31,68,.05); }
  section.criterio h3 { color: var(--navy); font-size: 14px; }
  section.criterio.estado-critico { border-left-color: var(--red); }
  section.criterio.estado-alto { border-left-color: var(--orange); }
  section.criterio.estado-medio { border-left-color: #E0A100; }
  section.criterio.estado-bajo { border-left-color: var(--text2); }
  section.criterio.estado-cumple { border-left-color: var(--green); }
  section.criterio.estado-no-aplica { border-left-color: var(--gray3); }
  section.criterio.estado-requiere-revision { border-left-color: var(--blue); }
  section.criterio.estado-no-evaluado { border-left-color: var(--gray3); background: var(--gray1); }
  section.general { background: #fff; border: 1px solid var(--border); border-radius: 12px; padding: 18px 22px; margin-bottom: 20px; }
  section.general h2 { margin-top: 0; }
  section.general h3 { color: var(--navy); font-size: 15px; margin: 18px 0 6px; }
  section.general p, section.general li { font-size: 13px; line-height: 1.55; }
  ul.pages { columns: 2; font-size: 12px; color: var(--text2); margin: 4px 0; }
  ol.problemas li { margin-bottom: 6px; }
  section.general h4 { font-size: 13px; margin: 12px 0 4px; color: var(--text); }
  ul.review-list { columns: 2; column-gap: 24px; margin: 0; font-size: 12.5px; }
  ul.review-list li { break-inside: avoid; margin-bottom: 3px; }
  .review-tag { display: inline-block; font-size: 11px; font-weight: 600; border-radius: 10px; padding: 1px 8px; }
  .review-tag.at { background: #E8EFFB; color: var(--nav-active, #1B3F8A); border: 1px solid var(--nav-active, #1B3F8A); }
  .review-tag.manual { background: var(--gray1); color: var(--text2); border: 1px solid var(--border); }
  h2.anexo { border-top: 2px solid var(--border); padding-top: 18px; }
  table { width: auto; background: #fff; }
  code { font-size: 12px; background: var(--gray1); padding: 1px 4px; border-radius: 4px; }
</style>
</head>
<body>
  ${DS_FRAMED_SCRIPT}
  ${dsHeaderHtml('Informe Narrativo de Accesibilidad')}
  <main>
  <h1>Informe Narrativo de Accesibilidad — WCAG 2.0 A + AA</h1>
  <p class="meta">Job: ${escapeHtml(jobId)} · Generado: ${new Date().toISOString()}</p>
  ${informeGeneralHtml({ criterios, resumen, urls, scores, complementaryFindings })}
  <h2 class="anexo">Anexo — Detalle por criterio</h2>
  ${criterios.map(criterioBlockHtml).join('\n')}
  ${complementaryFindingsHtml(complementaryFindings, escapeHtml)}
  ${HERRAMIENTAS_EXCLUIDAS_NOTA}
  </main>
  ${dsFooterHtml()}
</body>
</html>`;
}
