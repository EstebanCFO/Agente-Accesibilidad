import { BASELINE_LABEL, COVERAGE_NOTE } from './score-deliverable.js';
import { ontiCriteria } from '../classification/wcag-map.js';

const SEVERITY_ORDER = ['critical', 'serious', 'moderate', 'minor'];
const SEVERITY_LABEL_ES = { critical: 'Crítica', serious: 'Seria', moderate: 'Moderada', minor: 'Menor' };
// Colores de status de la paleta validada (dataviz skill, references/palette.md) — fijos, nunca
// reciclados como categóricos. axe-core no tiene un 5to nivel de severidad "minor" en esa paleta:
// se deja en tinta muted en vez de inventar un color de status nuevo.
const SEVERITY_COLOR = { critical: '#d03b3b', serious: '#ec835a', moderate: '#fab219', minor: '#898781' };
const STATUS_GOOD = '#0ca30c';
const STATUS_CRITICAL = '#d03b3b';
const SEQUENTIAL_BLUE = '#2a78d6';
const STATUS_NEUTRAL = '#c9c8c2';

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

/**
 * Clasifica cada uno de los 38 criterios ONTI como conforme/no_conforme/no_aplica. Un criterio
 * con al menos un finding real (cualquier review_status) nunca es no_aplica, aunque esté en
 * naCriteria - mismo criterio que ya usa calculate-score.js.
 */
function deriveOntiCriteriaStatus(findings, naCriteria = []) {
  const naSet = new Set(naCriteria);
  const violatedCriteria = new Set(
    (findings || []).filter((f) => f.in_scope === 'onti').map((f) => f.wcag_criterion)
  );
  return ontiCriteria.map((c) => {
    const pauta = c.wcag_criterion.split('.').slice(0, 2).join('.');
    let status;
    if (violatedCriteria.has(c.wcag_criterion)) {
      status = 'no_conforme';
    } else if (naSet.has(c.wcag_criterion)) {
      status = 'no_aplica';
    } else {
      status = 'conforme';
    }
    return { wcag_criterion: c.wcag_criterion, level: c.level, pauta, status };
  });
}

function ontiComplianceSummary(criteriaStatus) {
  const counts = { conforme: 0, no_conforme: 0, no_aplica: 0 };
  for (const c of criteriaStatus) counts[c.status] += 1;
  const evaluated = counts.conforme + counts.no_conforme;
  const conformePct = evaluated > 0 ? round1((counts.conforme / evaluated) * 100) : 0;
  const noConformePct = evaluated > 0 ? round1((counts.no_conforme / evaluated) * 100) : 0;
  return { ...counts, evaluated, conformePct, noConformePct };
}

function ontiComplianceSummaryHtml(summary) {
  return `<table>
    <thead><tr><th>Estado</th><th>Cantidad</th><th>%</th></tr></thead>
    <tbody>
      <tr><td><span class="severity-swatch" style="background:${STATUS_GOOD}"></span>Conformes</td><td>${summary.conforme}</td><td>${summary.conformePct}%</td></tr>
      <tr><td><span class="severity-swatch" style="background:${STATUS_CRITICAL}"></span>No conformes</td><td>${summary.no_conforme}</td><td>${summary.noConformePct}%</td></tr>
      ${summary.no_aplica > 0 ? `<tr><td><span class="severity-swatch" style="background:${STATUS_NEUTRAL}"></span>No aplica</td><td>${summary.no_aplica}</td><td>—</td></tr>` : ''}
    </tbody>
  </table>`;
}

function pautaCompliance(criteriaStatus, pautaCode) {
  const criteriaInPauta = criteriaStatus.filter((c) => c.pauta === pautaCode);
  const evaluated = criteriaInPauta.filter((c) => c.status !== 'no_aplica');
  const compliant = evaluated.filter((c) => c.status === 'conforme').length;
  return { pauta: pautaCode, label: PAUTA_LABELS[pautaCode], compliant, evaluated: evaluated.length };
}

function pautaRowHtml(stat) {
  const hasData = stat.evaluated > 0;
  const pct = hasData ? round1((stat.compliant / stat.evaluated) * 100) : 0;
  const color = !hasData ? STATUS_NEUTRAL : pct >= 100 ? STATUS_GOOD : pct === 0 ? STATUS_CRITICAL : SEQUENTIAL_BLUE;
  const valueLabel = hasData ? `${stat.compliant}/${stat.evaluated} (${pct}%)` : 'Sin criterios evaluados';
  return `<div class="pauta-row">
    <div class="pauta-label">${escapeHtml(stat.pauta)} ${escapeHtml(stat.label)}</div>
    <div class="pauta-track"><div class="pauta-fill" style="width:${pct}%; background:${color}"></div></div>
    <div class="pauta-value">${escapeHtml(valueLabel)}</div>
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

function horizontalBarChart(rows, { valueKey, labelFn, color }) {
  if (rows.length === 0) return '<p class="empty">Sin datos.</p>';
  const max = Math.max(1, ...rows.map((r) => r[valueKey]));
  return `<div class="hbar-chart">
    ${rows.map((row) => {
      const value = row[valueKey];
      const widthPct = round1((value / max) * 100);
      const label = labelFn(row);
      return `<div class="hbar-row">
        <div class="hbar-label">${escapeHtml(label)}</div>
        <div class="hbar-track"><div class="hbar-fill" style="width:${widthPct}%; background:${color}" title="${escapeHtml(label)}: ${value}"></div></div>
        <div class="hbar-value">${value}</div>
      </div>`;
    }).join('\n')}
  </div>`;
}

function meterHtml({ value, max, color, label }) {
  const widthPct = round1((value / max) * 100);
  return `<div class="meter" role="img" aria-label="${escapeHtml(label)}">
    <div class="meter-track"><div class="meter-fill" style="width:${widthPct}%; background:${color}"></div></div>
  </div>`;
}

function statTile({ label, value, sublabel = '' }) {
  return `<div class="stat-tile">
    <div class="stat-label">${escapeHtml(label)}</div>
    <div class="stat-value">${escapeHtml(value)}</div>
    ${sublabel ? `<div class="stat-sublabel">${escapeHtml(sublabel)}</div>` : ''}
  </div>`;
}

function conformanceBadgeHtml(conformant) {
  const color = conformant ? STATUS_GOOD : STATUS_CRITICAL;
  const icon = conformant ? '✔' : '✕';
  const label = conformant ? 'CONFORME' : 'NO CONFORME';
  return `<span class="badge" style="color:${color}"><span aria-hidden="true">${icon}</span> ${label}</span>`;
}

function visualUxSectionHtml(findings) {
  const visualCount = findings.filter((f) => f.source === 'visual_audit').length;
  const uxCount = findings.filter((f) => f.source === 'ux_review').length;
  if (visualCount === 0 && uxCount === 0) {
    return '<p class="empty">No disponible — los skills externos (visual_audit / ux_compliance_review) no se activaron en este job.</p>';
  }
  return `<table>
    <thead><tr><th>Fuente</th><th>Hallazgos</th></tr></thead>
    <tbody>
      <tr><td>Visual (rams)</td><td>${visualCount}</td></tr>
      <tr><td>UX / navegación</td><td>${uxCount}</td></tr>
    </tbody>
  </table>`;
}

function extendedBlockHtml(extended22) {
  if (!extended22) return '';
  return `<section class="card">
    <h2>Capa extendida WCAG 2.2 <span class="pill">No exigida por BCRA/ONTI</span></h2>
    <p class="muted">Score separado — no incide en el compliance ONTI de arriba.</p>
    <div class="stat-row">
      ${statTile({ label: 'Criterios conformes', value: `${extended22.criteria_compliant}/${extended22.criteria_evaluated}` })}
      ${statTile({ label: 'Compliance', value: `${extended22.compliance_percentage}%` })}
    </div>
  </section>`;
}

export function buildDashboardHtml({ jobId, channel, scores, findings, naCriteria = [] }) {
  const { summary, extended_22: extended22, by_url: byUrl, by_module: byModule = [] } = scores;
  const sevCounts = severityCounts(findings);
  const criteriaStatus = deriveOntiCriteriaStatus(findings, naCriteria);
  const complianceSummary = ontiComplianceSummary(criteriaStatus);

  return `<!doctype html>
<html lang="es">
<head>
<meta charset="utf-8">
<title>Dashboard Ejecutivo — ${escapeHtml(jobId)}</title>
<style>
  :root {
    --surface: #fcfcfb; --page: #f9f9f7; --ink: #0b0b0b; --ink-secondary: #52514e;
    --muted: #898781; --gridline: #e1e0d9; --border: rgba(11,11,11,0.10);
  }
  @media (prefers-color-scheme: dark) {
    :root { --surface: #1a1a19; --page: #0d0d0d; --ink: #ffffff; --ink-secondary: #c3c2b7; --gridline: #2c2c2a; --border: rgba(255,255,255,0.10); }
  }
  * { box-sizing: border-box; }
  body { font-family: system-ui, -apple-system, "Segoe UI", sans-serif; margin: 0; background: var(--page); color: var(--ink); }
  header { background: #14213d; color: #fff; padding: 1.5rem 2rem; display: flex; align-items: baseline; gap: 1rem; }
  header .brand { font-weight: 700; letter-spacing: 0.02em; }
  header .brand .accent { color: #4caf6a; }
  header .title { font-size: 1.1rem; font-weight: 600; }
  main { max-width: 1100px; margin: 0 auto; padding: 1.5rem 2rem 3rem; }
  .meta { color: var(--ink-secondary); margin-bottom: 1.5rem; font-size: 0.9rem; }
  .card { background: var(--surface); border: 1px solid var(--border); border-radius: 8px; padding: 1.25rem 1.5rem; margin-bottom: 1.5rem; }
  h2 { font-size: 1rem; margin: 0 0 0.75rem; color: var(--ink); }
  .muted { color: var(--muted); font-size: 0.85rem; }
  .stat-row { display: flex; gap: 1.5rem; flex-wrap: wrap; }
  .stat-tile { min-width: 140px; }
  .stat-label { font-size: 0.8rem; color: var(--ink-secondary); }
  .stat-value { font-size: 2rem; font-weight: 600; }
  .stat-sublabel { font-size: 0.8rem; color: var(--muted); }
  .hero { font-size: 3rem; font-weight: 700; line-height: 1; }
  .badge { font-weight: 700; }
  .pill { font-size: 0.7rem; font-weight: 600; background: var(--gridline); color: var(--ink-secondary); border-radius: 999px; padding: 2px 10px; margin-left: 0.5rem; vertical-align: middle; }
  .meter-track { height: 20px; background: var(--gridline); border-radius: 4px; overflow: hidden; }
  .meter-fill { height: 100%; border-radius: 0 4px 4px 0; }
  table { border-collapse: collapse; width: 100%; font-size: 0.85rem; }
  th, td { border: 1px solid var(--gridline); padding: 6px 10px; text-align: left; }
  th { background: var(--page); color: var(--ink-secondary); font-weight: 600; }
  .hbar-chart { display: flex; flex-direction: column; gap: 6px; }
  .hbar-row { display: grid; grid-template-columns: 260px 1fr 48px; align-items: center; gap: 8px; }
  .hbar-label { font-size: 0.8rem; color: var(--ink-secondary); overflow-wrap: break-word; line-height: 1.25; }
  .hbar-track { background: var(--gridline); height: 18px; border-radius: 4px; overflow: hidden; }
  .hbar-fill { height: 100%; border-radius: 0 4px 4px 0; }
  .hbar-value { font-size: 0.8rem; color: var(--ink-secondary); text-align: right; }
  .empty { color: var(--muted); font-size: 0.85rem; }
  .severity-swatch { display: inline-block; width: 10px; height: 10px; border-radius: 2px; margin-right: 6px; }
  .pauta-group { margin-bottom: 1rem; }
  .pauta-group:last-child { margin-bottom: 0; }
  .pauta-group h3 { font-size: 0.85rem; font-weight: 700; margin: 0 0 0.5rem; color: var(--ink-secondary); }
  .pauta-row { display: grid; grid-template-columns: 300px 1fr 140px; align-items: center; gap: 8px; margin-bottom: 4px; }
  .pauta-label { font-size: 0.8rem; color: var(--ink-secondary); }
  .pauta-track { background: var(--gridline); height: 14px; border-radius: 4px; overflow: hidden; }
  .pauta-fill { height: 100%; border-radius: 0 4px 4px 0; }
  .pauta-value { font-size: 0.78rem; color: var(--ink-secondary); text-align: right; }
  footer { color: var(--muted); font-size: 0.75rem; padding: 0 2rem 2rem; max-width: 1100px; margin: 0 auto; }
</style>
</head>
<body>
  <header>
    <span class="brand">CFOTech<span class="accent">.</span></span>
    <span class="title">Dashboard Ejecutivo de Accesibilidad</span>
  </header>
  <main>
    <p class="meta">Job: ${escapeHtml(jobId)} · Canal: ${escapeHtml(channel ?? 'N/D')} · Generado: ${new Date().toISOString()}</p>

    <section class="card">
      <h2>Score de cumplimiento ONTI</h2>
      <div class="hero">${summary.onti_criteria_compliant}/${summary.onti_criteria_evaluated} <small style="font-size:1.2rem; color:var(--ink-secondary)">(${summary.onti_compliance_percentage}%)</small></div>
      ${meterHtml({
        value: summary.onti_criteria_compliant, max: summary.onti_criteria_evaluated,
        color: summary.onti_conformance ? STATUS_GOOD : STATUS_CRITICAL,
        label: `${summary.onti_compliance_percentage}% de criterios ONTI conformes`
      })}
      <p class="muted">${conformanceBadgeHtml(summary.onti_conformance)} — umbral regulatorio: ≥ ${summary.conformance_threshold}/38 por norma${summary.onti_criteria_na > 0 ? ` (ajustado a ≥ ${summary.effective_conformance_threshold}/${summary.onti_criteria_evaluated} esta corrida — ${summary.onti_criteria_na} criterio(s) no aplican)` : ''}</p>
      <div class="stat-row">
        ${statTile({ label: `Nivel A (${summary.score_level_a_evaluated} criterios)`, value: `${summary.score_level_a}%` })}
        ${statTile({ label: `Nivel AA (${summary.score_level_aa_evaluated} criterios)`, value: `${summary.score_level_aa}%` })}
        ${statTile({ label: 'URLs evaluadas', value: String(summary.total_urls_evaluated) })}
      </div>
      <p class="muted">${COVERAGE_NOTE} Base: ${BASELINE_LABEL}.</p>
    </section>

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
      <h2>Cumplimiento de los 38 criterios ONTI (BCRA)</h2>
      ${ontiComplianceSummaryHtml(complianceSummary)}
    </section>

    <section class="card">
      <h2>Cumplimiento por Principio y Pauta WCAG</h2>
      ${principiosPautasSectionHtml(criteriaStatus)}
    </section>

    <section class="card">
      <h2>Distribución por módulo</h2>
      <p class="muted">Módulo derivado del primer segmento del path de cada URL escaneada.</p>
      ${horizontalBarChart(byModule, {
        valueKey: 'violations',
        labelFn: (r) => r.module,
        color: SEQUENTIAL_BLUE
      })}
    </section>

    <section class="card">
      <h2>Distribución por URL</h2>
      <p class="muted">Detalle por URL individual dentro de cada módulo.</p>
      ${horizontalBarChart(byUrl, {
        valueKey: 'violations',
        labelFn: (r) => r.url,
        color: SEQUENTIAL_BLUE
      })}
    </section>

    <section class="card">
      <h2>Hallazgos visuales / UX</h2>
      ${visualUxSectionHtml(findings)}
    </section>

    ${extendedBlockHtml(extended22)}
  </main>
  <footer>
    Generado automáticamente por el Agente F1 de Compliance de Accesibilidad — CFOTech.
  </footer>
</body>
</html>`;
}
