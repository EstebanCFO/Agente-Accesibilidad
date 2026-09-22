import { BASELINE_LABEL, COVERAGE_NOTE } from './score-deliverable.js';

const SEVERITY_ORDER = ['critical', 'serious', 'moderate', 'minor'];
const SEVERITY_LABEL_ES = { critical: 'Crítica', serious: 'Seria', moderate: 'Moderada', minor: 'Menor' };
// Colores de status de la paleta validada (dataviz skill, references/palette.md) — fijos, nunca
// reciclados como categóricos. axe-core no tiene un 5to nivel de severidad "minor" en esa paleta:
// se deja en tinta muted en vez de inventar un color de status nuevo.
const SEVERITY_COLOR = { critical: '#d03b3b', serious: '#ec835a', moderate: '#fab219', minor: '#898781' };
const STATUS_GOOD = '#0ca30c';
const STATUS_CRITICAL = '#d03b3b';
const SEQUENTIAL_BLUE = '#2a78d6';

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

/** SPEC §8.2 pide "Top 10 criterios ONTI más vulnerados" — solo ONTI, no la capa extendida. */
function topOntiCriteria(findings, limit = 10) {
  const byCriterion = new Map();
  for (const finding of findings) {
    if (finding.in_scope !== 'onti') continue;
    if (!byCriterion.has(finding.wcag_criterion)) {
      byCriterion.set(finding.wcag_criterion, {
        wcag_criterion: finding.wcag_criterion,
        description: finding.wcag_description,
        occurrences: 0
      });
    }
    byCriterion.get(finding.wcag_criterion).occurrences += finding.occurrences;
  }
  return [...byCriterion.values()].sort((a, b) => b.occurrences - a.occurrences).slice(0, limit);
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

export function buildDashboardHtml({ jobId, channel, scores, findings }) {
  const { summary, extended_22: extended22, by_url: byUrl, by_module: byModule = [] } = scores;
  const sevCounts = severityCounts(findings);
  const topCriteria = topOntiCriteria(findings);

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
      <p class="muted">${conformanceBadgeHtml(summary.onti_conformance)} — umbral regulatorio: ≥ ${summary.conformance_threshold}/${summary.onti_criteria_evaluated}</p>
      <div class="stat-row">
        ${statTile({ label: 'Nivel A (25 criterios)', value: `${summary.score_level_a}%` })}
        ${statTile({ label: 'Nivel AA (13 criterios)', value: `${summary.score_level_aa}%` })}
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
      <h2>Top 10 criterios ONTI más vulnerados</h2>
      ${horizontalBarChart(topCriteria, {
        valueKey: 'occurrences',
        labelFn: (r) => `${r.wcag_criterion} — ${r.description}`,
        color: SEQUENTIAL_BLUE
      })}
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
      <p class="empty">No disponible — los skills externos (visual_audit / ux_compliance_review) todavía no están integrados en el agente.</p>
    </section>

    ${extendedBlockHtml(extended22)}
  </main>
  <footer>
    Generado automáticamente por el Agente F1 de Compliance de Accesibilidad — CFOTech.
  </footer>
</body>
</html>`;
}
