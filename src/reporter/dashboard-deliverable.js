import { ontiCriteria } from '../classification/wcag-map.js';
import { DS_CSS, DS_COLORS, DS_FRAMED_SCRIPT, dsHeaderHtml, dsFooterHtml } from './design-system.js';
import { splitFindings } from '../classification/finding-sources.js';
import { pageLabels, analyzedTarget } from './report-helpers.js';
import { computeWcagSection } from '../classification/wcag-section.js';
import { summarizeRuleChecks } from '../classification/rule-checks.js';
import { computeKeyboardScore, KEYBOARD_CRITERIA } from '../keyboard/keyboard-criteria.js';

// El Dashboard Ejecutivo es para el cliente/directorio - no menciona "ONTI" (la norma técnica de
// origen), hace referencia a la Circular BCRA en su lugar. score-compliance.json (score-
// deliverable.js) es un contrato de datos técnico aparte y sigue citando ONTI 6/2019 sin cambios -
// este pedido fue explícitamente solo sobre el dashboard.
const DASHBOARD_BASELINE_LABEL = 'Circular BCRA — WCAG 2.0 A+AA (38 criterios)';
const DASHBOARD_COVERAGE_NOTE = 'OK y NOK son criterios que el agente verificó automáticamente. Los criterios "a validar" '
  + 'requieren tecnología asistiva (lector de pantalla, teclado), una revisión manual, o no tuvieron elementos evaluables: '
  + 'no cuentan como OK y se validan en la Fase 2.';

const SEVERITY_ORDER = ['critical', 'serious', 'moderate', 'minor'];
const SEVERITY_LABEL_ES = { critical: 'Crítica', serious: 'Seria', moderate: 'Moderada', minor: 'Menor' };
// Colores de status de la paleta validada (dataviz skill, references/palette.md) — fijos, nunca
// reciclados como categóricos. axe-core no tiene un 5to nivel de severidad "minor" en esa paleta:
// se deja en tinta muted en vez de inventar un color de status nuevo.
// Paleta semántica del Design System CFOTech (ver design-system.js).
const SEVERITY_COLOR = { critical: DS_COLORS.critical, serious: DS_COLORS.warn, moderate: '#E0A100', minor: DS_COLORS.minor };
const STATUS_GOOD = DS_COLORS.good;
const STATUS_CRITICAL = DS_COLORS.critical;
const SEQUENTIAL_BLUE = DS_COLORS.info;
const STATUS_NEUTRAL = DS_COLORS.neutral;

// Taxonomía fija de WCAG 2.0 (Principios/Pautas) - no depende de datos del job, es la estructura
// oficial de la norma. Nombres tal como los pidió el usuario (no necesariamente idénticos a la
// traducción oficial de W3C, ej. "Perceptibilidad" en vez de "Perceptible").
const PAUTA_LABELS = {
  '1.1': 'Alternativas textuales',
  '1.2': 'Contenido multimedia dependiente del tiempo',
  '1.3': 'Adaptabilidad',
  '1.4': 'Distinguible',
  '2.1': 'Accesible a través del teclado',
  '2.2': 'Tiempo suficiente',
  '2.3': 'Ataques',
  '2.4': 'Navegable',
  '3.1': 'Legible',
  '3.2': 'Predecible',
  '3.3': 'Ayuda a la entrada de datos',
  '4.1': 'Compatible'
};

const PRINCIPIOS_ORDENADOS = [
  { numero: 1, nombre: 'Perceptibilidad', pautas: ['1.1', '1.2', '1.3', '1.4'] },
  { numero: 2, nombre: 'Operabilidad', pautas: ['2.1', '2.2', '2.3', '2.4'] },
  { numero: 3, nombre: 'Comprensibilidad', pautas: ['3.1', '3.2', '3.3'] },
  { numero: 4, nombre: 'Robustez', pautas: ['4.1'] }
];

function escapeHtml(value) {
  return String(value ?? '').replace(/[&<>"']/g, (char) => ({
    '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;'
  }[char]));
}

function round1(n) {
  return Math.round(n * 10) / 10;
}

function severityCounts(findings) {
  return SEVERITY_ORDER.map((severity) => ({
    severity,
    label: SEVERITY_LABEL_ES[severity],
    color: SEVERITY_COLOR[severity],
    count: findings.filter((f) => f.severity === severity).length
  }));
}

// Motivos de "a validar", en el orden en que se muestran.
const A_VALIDAR_REASONS = [
  { code: 'requiere_asistiva', label: 'A validar — requiere tecnología asistiva' },
  { code: 'requiere_manual', label: 'A validar — requiere revisión manual' },
  { code: 'sin_elementos', label: 'A validar — sin elementos evaluables' },
  { code: 'sin_multimedia', label: 'A validar — sin audio ni video detectado' },
  { code: 'indeterminado', label: 'A validar — no determinado automáticamente' }
];
const STATUS_LABEL = { ok: 'OK', nok: 'NOK', a_validar: 'A validar', no_aplica: 'No aplica' };

/** Los 38 criterios de la Circular BCRA con su estado y motivo, tomados de la Sección 1. */
function ontiCriteriaStatus(section) {
  return section.by_criterion
    .filter((c) => c.in_scope === 'onti')
    .map((c) => ({ ...c, pauta: c.wcag_criterion.split('.').slice(0, 2).join('.') }));
}

function ontiComplianceSummary(criteriaStatus) {
  const counts = { ok: 0, nok: 0, a_validar: 0, no_aplica: 0 };
  const byReason = {};
  for (const c of criteriaStatus) {
    counts[c.status] += 1;
    if (c.status === 'a_validar') byReason[c.reason.code] = (byReason[c.reason.code] ?? 0) + 1;
  }
  const evaluated = counts.ok + counts.nok;
  const okPct = evaluated > 0 ? round1((counts.ok / evaluated) * 100) : 0;
  const nokPct = evaluated > 0 ? round1((counts.nok / evaluated) * 100) : 0;
  return { ...counts, byReason, evaluated, okPct, nokPct };
}

function ontiComplianceSummaryHtml(summary) {
  const swatch = (color) => `<span class="severity-swatch" style="background:${color}"></span>`;
  return `<table>
    <thead><tr><th>Estado</th><th>Criterios</th><th>% de los verificados</th></tr></thead>
    <tbody>
      <tr><td>${swatch(STATUS_GOOD)}OK</td><td>${summary.ok}</td><td>${summary.okPct}%</td></tr>
      <tr><td>${swatch(STATUS_CRITICAL)}NOK</td><td>${summary.nok}</td><td>${summary.nokPct}%</td></tr>
      ${A_VALIDAR_REASONS.filter((r) => summary.byReason[r.code]).map((r) => `<tr><td>${swatch(STATUS_NEUTRAL)}${r.label}</td><td>${summary.byReason[r.code]}</td><td>—</td></tr>`).join('\n      ')}
      ${summary.no_aplica > 0 ? `<tr><td>${swatch(STATUS_NEUTRAL)}No aplica</td><td>${summary.no_aplica}</td><td>—</td></tr>` : ''}
    </tbody>
  </table>`;
}

/** Tabla con cada criterio "a validar" o "no aplica" y el motivo, para que el lector sepa por qué. */
function pendingCriteriaHtml(criteriaStatus, keyboardResults = []) {
  const rows = criteriaStatus.filter((c) => c.status === 'a_validar' || c.status === 'no_aplica');
  if (rows.length === 0) return '<p class="empty">Todos los criterios se verificaron automáticamente.</p>';
  return `<table>
    <thead><tr><th>Criterio</th><th>Nivel</th><th>Estado</th><th>Motivo</th></tr></thead>
    <tbody>
      ${rows.map((c) => `<tr><td>${escapeHtml(c.wcag_criterion)} ${escapeHtml(c.description)}</td><td>${escapeHtml(c.level)}</td><td>${STATUS_LABEL[c.status]}</td><td>${escapeHtml([c.reason.text, keyboardEvidence(c.wcag_criterion, keyboardResults)].filter(Boolean).join(' · '))}</td></tr>`).join('\n      ')}
    </tbody>
  </table>`;
}

/** Anexo: qué pasó con las reglas de axe-core en cada página (reglas ≠ criterios). */
function ruleChecksAnnexHtml(axeResults, includeExtended) {
  const scanned = (axeResults || []).filter((r) => r && !r.error);
  if (scanned.length === 0) return '';
  const labels = pageLabels(scanned.map((r) => r.url));
  return `<section class="card">
    <h2>Reglas evaluadas por página</h2>
    <p class="muted">Cada chequeo es una regla del agente. Una misma regla puede fallar en unos elementos y aprobarse en otros; varias reglas pueden cubrir el mismo criterio. "Con verificación" cuenta los criterios WCAG distintos con al menos una regla aprobada.</p>
    <table>
      <thead><tr><th>Página</th><th>WCAG con problemas</th><th>A revisar</th><th>Aprobadas</th><th>Sin elementos</th><th>Criterios con verificación</th><th>Buenas prácticas a mejorar</th><th>Buenas prácticas que cumplen</th></tr></thead>
      <tbody>
        ${scanned.map((r) => {
          const { wcag, best_practice: bp } = summarizeRuleChecks(r, { includeExtended });
          return `<tr><td title="${escapeHtml(r.url)}">${escapeHtml(labels.get(r.url))}</td><td>${wcag.fail}</td><td>${wcag.review}</td><td>${wcag.pass}</td><td>${wcag.inapplicable}</td><td>${wcag.criteria_with_pass}</td><td>${bp.fail + bp.review}</td><td>${bp.pass}</td></tr>`;
        }).join('\n        ')}
      </tbody>
    </table>
  </section>`;
}

function pautaCompliance(criteriaStatus, pautaCode) {
  const criteriaInPauta = criteriaStatus.filter((c) => c.pauta === pautaCode);
  const evaluated = criteriaInPauta.filter((c) => c.status === 'ok' || c.status === 'nok');
  const compliant = evaluated.filter((c) => c.status === 'ok').length;
  const noEvaluado = criteriaInPauta.filter((c) => c.status === 'a_validar').length;
  return { pauta: pautaCode, label: PAUTA_LABELS[pautaCode], compliant, evaluated: evaluated.length, noEvaluado };
}

function pautaRowHtml(stat) {
  const hasData = stat.evaluated > 0;
  const pct = hasData ? round1((stat.compliant / stat.evaluated) * 100) : 0;
  const color = !hasData ? STATUS_NEUTRAL : pct >= 100 ? STATUS_GOOD : pct === 0 ? STATUS_CRITICAL : SEQUENTIAL_BLUE;
  // Ancho mínimo visible para 0% - con width:0% la barra roja no se ve (0px), queda indistinguible
  // de "sin datos". No afecta el texto, que sigue mostrando el % real.
  const displayWidth = hasData ? Math.max(pct, 3) : 0;
  const pendientes = stat.noEvaluado > 0 ? `${stat.noEvaluado} a validar` : '';
  const main = hasData ? `${stat.compliant}/${stat.evaluated} (${pct}%)` : (stat.noEvaluado > 0 ? 'A validar' : 'Sin criterios aplicables');
  const sub = hasData ? pendientes : (stat.noEvaluado > 0 ? `${stat.noEvaluado} criterio${stat.noEvaluado > 1 ? 's' : ''}` : '');
  return `<div class="pauta-row">
    <div class="pauta-label">${escapeHtml(stat.pauta)} ${escapeHtml(stat.label)}</div>
    <div class="pauta-track"><div class="pauta-fill" style="width:${displayWidth}%; background:${color}"></div></div>
    <div class="pauta-value">${escapeHtml(main)}${sub ? `<small>${escapeHtml(sub)}</small>` : ''}</div>
  </div>`;
}

function principiosPautasSectionHtml(criteriaStatus) {
  return PRINCIPIOS_ORDENADOS.map((principio) => {
    const rows = principio.pautas.map((pautaCode) => pautaCompliance(criteriaStatus, pautaCode));
    return `<div class="pauta-group">
      <h3>Principio ${principio.numero}: ${escapeHtml(principio.nombre)}</h3>
      ${rows.map(pautaRowHtml).join('\n')}
    </div>`;
  }).join('\n');
}

function meterHtml({ value, max, color, label }) {
  const widthPct = round1((value / max) * 100);
  return `<div class="meter" role="img" aria-label="${escapeHtml(label)}">
    <div class="meter-track"><div class="meter-fill" style="width:${widthPct}%; background:${color}"></div></div>
  </div>`;
}

function statTile({ label, value, sublabel = '' }) {
  return `<div class="stat-tile">
    <div class="ds-kpi-label">${escapeHtml(label)}</div>
    <div class="ds-kpi-value">${escapeHtml(value)}</div>
    ${sublabel ? `<div class="ds-kpi-label">${escapeHtml(sublabel)}</div>` : ''}
  </div>`;
}

const ESTADO_TECLADO = { sin_indicios: 'Sin indicios', con_indicios: 'Con indicios', no_evaluable: 'No evaluable' };

/** Evidencia de las pruebas de teclado para un criterio (null si no se probó en ninguna página). */
function keyboardEvidence(criterionId, keyboardResults) {
  const evaluables = keyboardResults.map((r) => r.criteria?.[criterionId]?.estado).filter((e) => e === 'sin_indicios' || e === 'con_indicios');
  if (evaluables.length === 0) return null;
  const con = evaluables.filter((e) => e === 'con_indicios').length;
  const paginas = evaluables.length === 1 ? 'página' : 'páginas';
  return con > 0
    ? `Prueba de teclado del Agente: con indicios en ${con} de ${evaluables.length} ${paginas}`
    : `Prueba de teclado del Agente: sin indicios en ${evaluables.length} ${paginas}`;
}

/** Banners de cookies cerrados (o que no se pudieron cerrar) antes del recorrido con Tab. */
function bannerNotesHtml(keyboardResults, labels) {
  const pages = (filter) => keyboardResults.filter(filter).map((r) => escapeHtml(labels.get(r.url) ?? r.url)).join(', ');
  const byAction = new Map();
  for (const r of keyboardResults.filter((x) => x.consent_banner?.dismissed)) {
    const action = r.consent_banner.action;
    byAction.set(action, [...(byAction.get(action) ?? []), r]);
  }
  const notes = [...byAction.entries()].map(([action, list]) => `Se cerró un banner de cookies (${escapeHtml(action)}) antes del recorrido en: ${list.map((r) => escapeHtml(labels.get(r.url) ?? r.url)).join(', ')}.`);
  const stuck = pages((r) => r.consent_banner?.detected && !r.consent_banner.dismissed);
  if (stuck) notes.push(`No se pudo cerrar el banner de cookies en: ${stuck}. El recorrido puede haber quedado dentro del banner.`);
  return notes.length ? `<p class="muted">${notes.join(' ')}</p>` : '';
}

/** Sección 3 del informe: resultado del recorrido con Tab por página, con puntaje propio. */
function keyboardSectionHtml(keyboardResults) {
  if (keyboardResults.length === 0) return '<p class="empty">No se ejecutaron las pruebas de teclado del Agente en esta auditoría.</p>';
  const k = computeKeyboardScore(keyboardResults);
  const labels = pageLabels(keyboardResults.map((r) => r.url));
  const motivos = keyboardResults.flatMap((r) => KEYBOARD_CRITERIA
    .filter((c) => r.criteria[c.id].estado === 'con_indicios')
    .map((c) => `<li><strong>${escapeHtml(labels.get(r.url))}</strong> · ${c.id} ${escapeHtml(c.label)}: ${escapeHtml(r.criteria[c.id].motivo)}</li>`));
  const rows = keyboardResults.map((r) => `<tr><td title="${escapeHtml(r.url)}">${escapeHtml(labels.get(r.url))}</td>${
    KEYBOARD_CRITERIA.map((c) => `<td>${ESTADO_TECLADO[r.criteria[c.id].estado] ?? '—'}</td>`).join('')}</tr>`);
  return `<p><strong>${k.score === null ? '—' : `${k.score}%`}</strong> de los pares página×criterio sin indicios · ${k.con_indicios} con indicios · ${k.sin_indicios} sin indicios${k.no_evaluable ? ` · ${k.no_evaluable} no evaluables` : ''}</p>
  <table>
    <thead><tr><th>Página</th>${KEYBOARD_CRITERIA.map((c) => `<th>${c.id} ${escapeHtml(c.label)}</th>`).join('')}</tr></thead>
    <tbody>${rows.join('')}</tbody>
  </table>
  ${motivos.length ? `<ul>${motivos.join('')}</ul>` : ''}
  ${bannerNotesHtml(keyboardResults, labels)}
  <p class="muted">Recorrido con Tab de cada página, interpretado por el Agente. "Con indicios" requiere validación humana: estos criterios siguen "a validar" en el compliance WCAG.</p>`;
}

/**
 * Resultado por página: cuántos criterios de la Circular BCRA tienen al menos un problema en esa
 * página (sin porcentaje de cumplimiento: ver la Sección 1).
 */
function pagesSectionHtml(urls, findings) {
  if (urls.length === 0) return '<p class="empty">Sin datos.</p>';
  const labels = pageLabels(urls);
  const rows = urls.map((url) => {
    const violated = new Set(findings.filter((f) => f.in_scope === 'onti' && (f.affected_urls || []).includes(url)).map((f) => f.wcag_criterion));
    return { url, label: labels.get(url), criterios: violated.size };
  });
  const max = Math.max(1, ...rows.map((r) => r.criterios));
  return `<table class="pages-table">
    <thead><tr><th>Página</th><th>Criterios con problemas</th></tr></thead>
    <tbody>
      ${rows.map((r) => `<tr>
        <td title="${escapeHtml(r.url)}">${escapeHtml(r.label)}</td>
        <td><div class="hbar-inline"><div class="hbar-track"><div class="hbar-fill" style="width:${r.criterios === 0 ? 0 : Math.max(round1((r.criterios / max) * 100), 4)}%; background:${SEQUENTIAL_BLUE}"></div></div><span>${r.criterios}</span></div></td>
      </tr>`).join('\n')}
    </tbody>
  </table>`;
}

function extendedBlockHtml(extended22) {
  if (!extended22) return '';
  return `<section class="card">
    <h2>Capa extendida WCAG 2.2 <span class="pill">No exigida por la Circular BCRA</span></h2>
    <p class="muted">Conteo separado — no incide en el compliance de la Circular BCRA de arriba.</p>
    <div class="stat-row">
      ${statTile({ label: 'Criterios WCAG 2.1/2.2', value: `${extended22.ok} OK · ${extended22.nok} NOK`, sublabel: `${extended22.a_validar} a validar (de ${extended22.total})` })}
    </div>
  </section>`;
}

export { analyzedTarget };

function analyzedTargetHtml(urls) {
  const target = analyzedTarget(urls);
  if (!target) return '';
  const value = target.href
    ? `<a href="${escapeHtml(target.href)}">${escapeHtml(target.text)}</a>`
    : escapeHtml(target.text);
  const pages = urls.length > 1 ? ` · ${urls.length} páginas` : '';
  return `<p class="meta target-url"><strong>URL analizada:</strong> ${value}${pages}</p>`;
}

/** Barra apilada OK / NOK / a validar sobre el total (sin porcentaje de cumplimiento). */
function stackedMeterHtml(section) {
  const part = (n) => (section.total > 0 ? round1((n / section.total) * 100) : 0);
  return `<div class="meter" role="img" aria-label="${section.ok} OK, ${section.nok} NOK y ${section.a_validar} a validar de ${section.total} criterios">
    <div class="meter-track meter-stack">
      <div class="meter-fill" style="width:${part(section.ok)}%; background:${STATUS_GOOD}"></div>
      <div class="meter-fill" style="width:${part(section.nok)}%; background:${STATUS_CRITICAL}"></div>
      <div class="meter-fill" style="width:${part(section.a_validar)}%; background:${STATUS_NEUTRAL}"></div>
    </div>
  </div>`;
}

function levelCounts(criteriaStatus, level) {
  const list = criteriaStatus.filter((c) => c.level === level && c.status !== 'no_aplica');
  const n = (status) => list.filter((c) => c.status === status).length;
  return { total: list.length, value: `${n('ok')} OK · ${n('nok')} NOK`, sublabel: `${n('a_validar')} a validar` };
}

// naCriteria se mantiene en la firma por compatibilidad: "No aplica" sale de la Sección 1.
export function buildDashboardHtml({ jobId, channel, scores, findings: allFindings, complementaryFindings = [], naCriteria = [], urls, axeResults = [], includeExtended = false, keyboardResults = [] }) {
  const { summary, extended_22: extended22, by_url: byUrl } = scores;
  // Todo lo que se cuenta sale de axe-core; lo del Agente solo se muestra como complementario.
  const { primary: findings } = splitFindings(allFindings);
  const sevCounts = severityCounts(findings);
  // Misma fuente que la tarjeta "Compliance WCAG" del panel.
  const section = scores.wcag_section ?? computeWcagSection(allFindings, { axeResults, includeExtended });
  const criteriaStatus = ontiCriteriaStatus(section);
  const complianceSummary = ontiComplianceSummary(criteriaStatus);
  const analyzedUrls = urls?.length ? urls : (byUrl ?? []).map((u) => u.url);
  const withExtended = section.by_criterion.some((c) => c.in_scope === 'extended_22');
  const na = section.no_aplica ? ` · ${section.no_aplica} ${section.no_aplica === 1 ? 'no aplica' : 'no aplican'}` : '';
  const levelA = levelCounts(criteriaStatus, 'A');
  const levelAA = levelCounts(criteriaStatus, 'AA');

  return `<!doctype html>
<html lang="es">
<head>
<meta charset="utf-8">
<title>Score de cumplimiento inicial — ${escapeHtml(jobId)}</title>
<style>${DS_CSS}
  .stat-tile { min-width: 140px; }
  .hbar-chart { display: flex; flex-direction: column; gap: 6px; }
  .hbar-row { display: grid; grid-template-columns: minmax(120px, 38%) 1fr 40px; align-items: center; gap: 8px; }
  .hbar-label { font-size: 12px; color: var(--text2); overflow-wrap: anywhere; line-height: 1.25; }
  .hbar-track { background: var(--gray2); height: 8px; border-radius: 4px; overflow: hidden; }
  .hbar-fill { height: 100%; border-radius: 4px; }
  .hbar-value { font-size: 12px; color: var(--text2); text-align: right; }
  .hbar-inline { display: grid; grid-template-columns: 1fr 28px; align-items: center; gap: 8px; min-width: 120px; }
  .hbar-inline span { text-align: right; font-weight: 600; }
  .pages-table td:first-child { overflow-wrap: anywhere; }
  .meter-track { height: 8px; background: rgba(255,255,255,.18); border-radius: 4px; overflow: hidden; margin: 10px 0; max-width: 520px; }
  .meter-fill { height: 100%; border-radius: 4px; }
  .severity-swatch { display: inline-block; width: 10px; height: 10px; border-radius: 3px; margin-right: 6px; }
  .pauta-group { margin-bottom: 14px; }
  .pauta-group:last-child { margin-bottom: 0; }
  .pauta-row { display: grid; grid-template-columns: minmax(150px, 42%) 1fr 104px; align-items: center; gap: 8px; margin-bottom: 5px; }
  .pauta-label { font-size: 12px; color: var(--text); }
  .pauta-track { background: var(--gray2); height: 8px; border-radius: 4px; overflow: hidden; }
  .pauta-fill { height: 100%; border-radius: 4px; }
  .pauta-value { font-size: 12px; color: var(--text); font-weight: 600; text-align: right; line-height: 1.25; }
  .pauta-value small { display: block; font-weight: 400; color: var(--text2); font-size: 11px; }
  .hero-score { font-size: 40px; font-weight: 700; line-height: 1; }
  .hero-score small { font-size: 18px; color: rgba(255,255,255,.75); font-weight: 600; }
  .hero-sub { font-size: 16px; margin: 6px 0 0; color: rgba(255,255,255,.85); }
  .meter-stack { display: flex; }
  .meter-stack .meter-fill { border-radius: 0; }
  .hero-main { flex: 1; min-width: 280px; }
  .hero-side { display: flex; align-items: center; gap: 24px; flex-wrap: wrap; }
  .stat-row { display: flex; gap: 24px; flex-wrap: wrap; }
  .card .ds-kpi-label { color: var(--text2); }
  .card .ds-kpi-value { color: var(--navy); }
  .target-url { font-size: 14px; color: var(--text); margin: 0 0 4px; word-break: break-all; }
</style>
</head>
<body>
  ${DS_FRAMED_SCRIPT}
  ${dsHeaderHtml('Score de cumplimiento inicial')}
  <main>
    <h1>Score de cumplimiento inicial</h1>
    ${analyzedTargetHtml(analyzedUrls)}
    <p class="meta">Job: ${escapeHtml(jobId)} · Generado: ${new Date().toISOString()}</p>

    <section class="ds-hero" aria-labelledby="score-title">
      <div class="hero-main">
        <h2 id="score-title">Score de cumplimiento — Circular BCRA${withExtended ? ' + WCAG 2.2' : ''}</h2>
        <div class="hero-score">${section.ok} OK · ${section.nok} NOK</div>
        <p class="hero-sub">${section.a_validar} a validar (de ${section.total})${na}</p>
        ${stackedMeterHtml(section)}
      </div>
      <div class="hero-side">
        <div class="ds-kpis">
          ${statTile({ label: `Nivel A (${levelA.total} criterios)`, value: levelA.value, sublabel: levelA.sublabel })}
          ${statTile({ label: `Nivel AA (${levelAA.total} criterios)`, value: levelAA.value, sublabel: levelAA.sublabel })}
          ${statTile({ label: 'Páginas evaluadas', value: String(summary.total_urls_evaluated) })}
        </div>
      </div>
      <p class="muted" style="flex-basis:100%;margin:0">${DASHBOARD_COVERAGE_NOTE} Base: ${DASHBOARD_BASELINE_LABEL}.</p>
    </section>

    <div class="ds-grid">
      <div>
        <section class="card">
          <h2>Cumplimiento por Principio y Pauta WCAG</h2>
          <p class="muted">Consolidado de todas las páginas auditadas (no es un promedio): un criterio es NOK si falla en al menos una página. Las barras muestran la proporción OK sobre los criterios verificados (OK + NOK); los "a validar" se indican aparte y no cuentan como OK.</p>
          ${principiosPautasSectionHtml(criteriaStatus)}
        </section>

        <section class="card">
          <h2>Resultado por página</h2>
          <p class="muted">Cada página auditada, con la cantidad de criterios de la Circular BCRA que presentan al menos un problema en ella.</p>
          ${pagesSectionHtml(analyzedUrls, findings)}
        </section>
      </div>
      <div>
        <section class="card">
          <h2>Hallazgos por severidad</h2>
          <table>
            <thead><tr><th>Severidad</th><th>Cantidad</th></tr></thead>
            <tbody>
              ${sevCounts.map((s) => `<tr><td><span class="severity-swatch" style="background:${s.color}"></span>${s.label}</td><td>${s.count}</td></tr>`).join('\n')}
            </tbody>
          </table>
        </section>

        <section class="card">
          <h2>Cumplimiento de los 38 criterios WCAG — Circular BCRA</h2>
          ${ontiComplianceSummaryHtml(complianceSummary)}
        </section>

        <section class="card">
          <h2>Criterios a validar y no aplicables</h2>
          <p class="muted">Por qué cada uno de estos criterios no se pudo dar como OK o NOK en esta auditoría.</p>
          ${pendingCriteriaHtml(criteriaStatus, keyboardResults)}
        </section>

        <section class="card">
          <h2>Pruebas de teclado del Agente <span class="pill">No afecta el compliance</span></h2>
          ${keyboardSectionHtml(keyboardResults)}
        </section>

        ${extendedBlockHtml(extended22)}
      </div>
    </div>
    ${ruleChecksAnnexHtml(axeResults, includeExtended)}
  </main>
  ${dsFooterHtml()}
</body>
</html>`;
}
