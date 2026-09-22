const STATUS_GOOD = '#0ca30c';
const STATUS_CRITICAL = '#d03b3b';

const CHANNEL_LABEL = { home_banking: 'Home Banking', app_ios: 'App iOS', app_android: 'App Android' };

function escapeHtml(value) {
  return String(value ?? '').replace(/[&<>"']/g, (char) => ({
    '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;'
  }[char]));
}

function meterHtml({ value, max, color, label }) {
  const widthPct = Math.round((value / max) * 1000) / 10;
  return `<div class="meter" role="img" aria-label="${escapeHtml(label)}">
    <div class="meter-track"><div class="meter-fill" style="width:${widthPct}%; background:${color}"></div></div>
  </div>`;
}

function channelBarChart(channels) {
  return `<div class="hbar-chart">
    ${channels.map((c) => {
      const color = c.onti_conformance ? STATUS_GOOD : STATUS_CRITICAL;
      const label = CHANNEL_LABEL[c.channel] ?? c.channel;
      return `<div class="hbar-row">
        <div class="hbar-label">${escapeHtml(label)}</div>
        <div class="hbar-track"><div class="hbar-fill" style="width:${c.onti_compliance_percentage}%; background:${color}" title="${escapeHtml(label)}: ${c.onti_compliance_percentage}%"></div></div>
        <div class="hbar-value">${c.onti_compliance_percentage}%</div>
      </div>`;
    }).join('\n')}
  </div>`;
}

export function buildConsolidatedDashboardHtml({ channels, global }) {
  return `<!doctype html>
<html lang="es">
<head>
<meta charset="utf-8">
<title>Dashboard Ejecutivo Consolidado</title>
<style>
  :root { --surface: #fcfcfb; --page: #f9f9f7; --ink: #0b0b0b; --ink-secondary: #52514e; --muted: #898781; --gridline: #e1e0d9; --border: rgba(11,11,11,0.10); }
  @media (prefers-color-scheme: dark) { :root { --surface: #1a1a19; --page: #0d0d0d; --ink: #ffffff; --ink-secondary: #c3c2b7; --gridline: #2c2c2a; --border: rgba(255,255,255,0.10); } }
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
  .hero { font-size: 3rem; font-weight: 700; line-height: 1; }
  .meter-track { height: 20px; background: var(--gridline); border-radius: 4px; overflow: hidden; }
  .meter-fill { height: 100%; border-radius: 0 4px 4px 0; }
  table { border-collapse: collapse; width: 100%; font-size: 0.85rem; }
  th, td { border: 1px solid var(--gridline); padding: 6px 10px; text-align: left; }
  th { background: var(--page); color: var(--ink-secondary); font-weight: 600; }
  .hbar-chart { display: flex; flex-direction: column; gap: 6px; }
  .hbar-row { display: grid; grid-template-columns: 160px 1fr 48px; align-items: center; gap: 8px; }
  .hbar-label { font-size: 0.8rem; color: var(--ink-secondary); }
  .hbar-track { background: var(--gridline); height: 18px; border-radius: 4px; overflow: hidden; }
  .hbar-fill { height: 100%; border-radius: 0 4px 4px 0; }
  .hbar-value { font-size: 0.8rem; color: var(--ink-secondary); text-align: right; }
  .badge { font-weight: 700; }
  footer { color: var(--muted); font-size: 0.75rem; padding: 0 2rem 2rem; max-width: 1100px; margin: 0 auto; }
</style>
</head>
<body>
  <header>
    <span class="brand">CFOTech<span class="accent">.</span></span>
    <span class="title">Dashboard Ejecutivo Consolidado</span>
  </header>
  <main>
    <p class="meta">${channels.length} canales · Generado: ${new Date().toISOString()}</p>

    <section class="card">
      <h2>Score ONTI global ponderado</h2>
      <div class="hero">${global.weighted_onti_compliance_percentage}%</div>
      ${meterHtml({
        value: global.weighted_onti_compliance_percentage, max: 100,
        color: global.channels_conformant === global.channels_total ? STATUS_GOOD : STATUS_CRITICAL,
        label: `${global.weighted_onti_compliance_percentage}% de compliance ONTI ponderado`
      })}
      <p class="muted">
        <span class="badge" style="color:${global.channels_conformant === global.channels_total ? STATUS_GOOD : STATUS_CRITICAL}">
          ${global.channels_conformant}/${global.channels_total} canales conformes
        </span>
        — ponderado por URLs evaluadas por canal (${global.total_urls_evaluated} URLs en total).
      </p>
    </section>

    <section class="card">
      <h2>Resumen por canal</h2>
      <table>
        <thead><tr><th>Canal</th><th>Job</th><th>Criterios conformes</th><th>% compliance</th><th>Estado</th><th>URLs evaluadas</th></tr></thead>
        <tbody>
          ${channels.map((c) => `<tr>
            <td>${escapeHtml(CHANNEL_LABEL[c.channel] ?? c.channel)}</td>
            <td>${escapeHtml(c.job_id)}</td>
            <td>${c.onti_criteria_compliant}/${c.onti_criteria_evaluated}</td>
            <td>${c.onti_compliance_percentage}%</td>
            <td style="color:${c.onti_conformance ? STATUS_GOOD : STATUS_CRITICAL}">${c.onti_conformance ? '✔ Conforme' : '✕ No conforme'}</td>
            <td>${c.total_urls_evaluated}</td>
          </tr>`).join('\n')}
        </tbody>
      </table>
    </section>

    <section class="card">
      <h2>Compliance ONTI por canal</h2>
      ${channelBarChart(channels)}
    </section>
  </main>
  <footer>
    Generado automáticamente por el Agente F1 de Compliance de Accesibilidad — CFOTech.
  </footer>
</body>
</html>`;
}
