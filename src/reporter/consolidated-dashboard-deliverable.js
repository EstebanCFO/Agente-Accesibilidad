import { DS_CSS, DS_COLORS, DS_FRAMED_SCRIPT, dsHeaderHtml, dsFooterHtml } from './design-system.js';

const CHANNEL_LABEL = { home_banking: 'Home Banking', app_ios: 'App iOS', app_android: 'App Android' };

function escapeHtml(value) {
  return String(value ?? '').replace(/[&<>"']/g, (char) => ({
    '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;'
  }[char]));
}

/** Barra apilada OK / NOK / a validar (sin porcentaje de cumplimiento). */
function stackedBar(c, trackColor) {
  const part = (n) => (c.total > 0 ? Math.round((n / c.total) * 1000) / 10 : 0);
  return `<div class="stack" style="background:${trackColor}" role="img" aria-label="${c.ok} OK, ${c.nok} NOK y ${c.a_validar} a validar de ${c.total} criterios">
    <span style="width:${part(c.ok)}%; background:${DS_COLORS.good}"></span><span style="width:${part(c.nok)}%; background:${DS_COLORS.critical}"></span><span style="width:${part(c.a_validar)}%; background:${DS_COLORS.neutral}"></span>
  </div>`;
}

const counts = (c) => `${c.ok} OK · ${c.nok} NOK`;
const pending = (c) => `${c.a_validar} a validar (de ${c.total})${c.no_aplica ? ` · ${c.no_aplica} no aplica${c.no_aplica === 1 ? '' : 'n'}` : ''}`;

export function buildConsolidatedDashboardHtml({ channels, global }) {
  return `<!doctype html>
<html lang="es">
<head>
<meta charset="utf-8">
<title>Dashboard Ejecutivo Consolidado</title>
<style>${DS_CSS}
  .hero-score { font-size: 40px; font-weight: 700; line-height: 1; }
  .hero-sub { font-size: 16px; margin: 6px 0 0; color: rgba(255,255,255,.85); }
  .stack { display: flex; height: 8px; border-radius: 4px; overflow: hidden; margin: 10px 0; max-width: 520px; }
  .stack span { height: 100%; }
</style>
</head>
<body>
  ${DS_FRAMED_SCRIPT}
  ${dsHeaderHtml('Dashboard Ejecutivo Consolidado')}
  <main>
    <h1>Dashboard Ejecutivo Consolidado</h1>
    <p class="meta">${channels.length} canales · Generado: ${new Date().toISOString()}</p>

    <section class="ds-hero">
      <div>
      <h2>Compliance WCAG — Circular BCRA, todos los canales</h2>
      <div class="hero-score">${counts(global)}</div>
      <p class="hero-sub">${pending(global)}</p>
      ${stackedBar(global, 'rgba(255,255,255,.18)')}
      <p class="muted">Criterio por criterio, peor caso entre canales: NOK si falla en alguno, a validar si está pendiente en alguno. ${global.channels_con_nok} de ${global.channels_total} canales con criterios NOK · ${global.total_urls_evaluated} URLs evaluadas.</p>
      </div>
    </section>

    <section class="card">
      <h2>Resumen por canal</h2>
      <table>
        <thead><tr><th>Canal</th><th>Job</th><th>Resultado</th><th>Pendiente</th><th></th><th>URLs evaluadas</th></tr></thead>
        <tbody>
          ${channels.map((c) => `<tr>
            <td>${escapeHtml(CHANNEL_LABEL[c.channel] ?? c.channel)}</td>
            <td>${escapeHtml(c.job_id)}</td>
            <td>${counts(c)}</td>
            <td>${pending(c)}</td>
            <td style="min-width:140px">${stackedBar(c, 'var(--gray2)')}</td>
            <td>${c.total_urls_evaluated}</td>
          </tr>`).join('\n')}
        </tbody>
      </table>
      <p class="muted">Los criterios a validar requieren tecnología asistiva o revisión manual y no cuentan como OK. Sin veredicto de conformidad hasta completar la validación.</p>
    </section>
  </main>
  ${dsFooterHtml()}
</body>
</html>`;
}
