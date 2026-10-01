/**
 * CFOTech IT Tools — Design System (Portal de Acceso), aplicado a los informes HTML del agente.
 * Un solo lugar para tokens, header, cards y tablas: todos los informes comparten el mismo look.
 *
 * Colores de TEXTO semánticos un paso más oscuros que el DS (#00875A→#006B47, #C96A00→#9A5100,
 * #C0392B→#A93226) para llegar a 4.5:1 (WCAG AA) sobre sus fondos claros. Barras, anillos y
 * bordes usan los colores originales del DS.
 */

// Colores para gráficos (barras, anillos, semáforos) — paleta semántica del DS.
export const DS_COLORS = {
  good: '#00875A',
  critical: '#C0392B',
  warn: '#C96A00',
  info: '#4472C4',
  neutral: '#C5CDD8',
  navy: '#0A1F44',
  minor: '#4A5568'
};

const LOGO_SVG = '<svg class="ds-logo" width="32" height="32" viewBox="0 0 32 32" role="img" aria-label="Logo CFOTech">'
  + '<rect width="32" height="32" rx="8" fill="#00A878"/>'
  + '<text x="16" y="20" text-anchor="middle" fill="#fff" font-family="Segoe UI, system-ui, sans-serif" font-size="11" font-weight="700" letter-spacing="-.3">CFO</text></svg>';

export const DS_CSS = `
  :root {
    --navy-dark: #0B1526; --navy: #0A1F44; --navy2: #0D2B5E; --nav-active: #1B3F8A; --blue: #4472C4;
    --green: #00875A; --green-l: #E3F5EE; --green-a: #4FD1B2;
    --red: #C0392B; --orange: #C96A00;
    --gray1: #F4F6F9; --gray2: #E8ECF2; --gray3: #C5CDD8;
    --text: #0D1B2A; --text2: #4A5568; --border: #D1D9E6;
    --green-text: #006B47; --red-text: #A93226; --orange-text: #9A5100;
    --red-l: #FDEDEC; --orange-l: #FFF6E8;
  }
  * { box-sizing: border-box; }
  body { font-family: 'Segoe UI', system-ui, sans-serif; margin: 0; background: var(--gray1); color: var(--text); font-size: 14px; }
  :focus-visible { outline: 3px solid var(--blue); outline-offset: 2px; }
  .ds-header { background: var(--navy-dark); height: 48px; display: flex; align-items: center; gap: 12px; padding: 0 24px;
    border-bottom: 3px solid #1C2E48; }
  .ds-logo { flex-shrink: 0; }
  .ds-brand { margin: 0; display: flex; flex-direction: column; line-height: 1.2; }
  .ds-brand-main { font-size: 13px; font-weight: 700; color: #fff; }
  .ds-brand-sub { font-size: 11px; font-weight: 700; color: var(--green-a); }
  /* Dentro del visor de informes (iframe) el header ya lo muestra el visor. */
  body.ds-framed .ds-header { display: none; }
  main { max-width: 1120px; margin: 0 auto; padding: 24px 20px 40px; }
  h1 { font-size: 20px; color: var(--navy); margin: 0 0 4px; }
  h2 { font-size: 15px; color: var(--navy); margin: 0 0 12px; }
  h3 { font-size: 13px; color: var(--text2); margin: 0 0 8px; }
  .meta { color: var(--text2); font-size: 12px; margin: 0 0 20px; }
  .muted { color: var(--text2); font-size: 12px; }
  .empty { color: var(--text2); font-size: 13px; }
  .card { background: #fff; border: 1px solid var(--border); border-radius: 12px; padding: 16px 20px; margin-bottom: 16px;
    box-shadow: 0 1px 4px rgba(10,31,68,.05); }
  .pill { font-size: 11px; font-weight: 600; background: var(--gray2); color: var(--text2); border-radius: 20px; padding: 2px 10px;
    margin-left: 8px; vertical-align: middle; }
  table { border-collapse: collapse; width: 100%; font-size: 13px; }
  th, td { border-bottom: 1px solid var(--gray2); padding: 7px 10px; text-align: left; vertical-align: top; }
  th { background: var(--gray1); color: var(--text2); font-weight: 600; font-size: 12px; border-bottom: 1px solid var(--border); }
  .ds-grid { display: grid; grid-template-columns: 1.35fr 1fr; gap: 16px; align-items: start; }
  @media (max-width: 860px) { .ds-grid { grid-template-columns: 1fr; } }
  .ds-hero { background: var(--navy); color: #fff; border-radius: 12px; padding: 20px 24px; margin-bottom: 16px;
    display: flex; align-items: center; justify-content: space-between; gap: 24px; flex-wrap: wrap; }
  .ds-hero h2 { color: rgba(255,255,255,.75); font-size: 13px; font-weight: 600; margin: 0 0 6px; }
  .ds-hero .muted { color: rgba(255,255,255,.75); }
  .ds-kpis { display: flex; gap: 24px; flex-wrap: wrap; }
  .ds-kpi-label { font-size: 12px; color: rgba(255,255,255,.75); }
  .ds-kpi-value { font-size: 22px; font-weight: 700; color: #fff; }
  .ds-ring { --p: 0; --c: var(--green); width: 84px; height: 84px; border-radius: 50%; flex-shrink: 0; position: relative;
    background: conic-gradient(var(--c) calc(var(--p) * 1%), rgba(255,255,255,.18) 0); }
  .ds-ring::after { content: ''; position: absolute; inset: 11px; border-radius: 50%; background: var(--navy); }
  .ds-ring span { position: absolute; inset: 0; display: flex; align-items: center; justify-content: center; z-index: 1; font-weight: 700; font-size: 17px; }
  .ds-chip { display: inline-flex; align-items: center; gap: 6px; font-size: 12px; font-weight: 700; border-radius: 20px; padding: 3px 12px; }
  .ds-chip.ok { background: var(--green-l); color: var(--green-text); }
  .ds-chip.bad { background: var(--red-l); color: var(--red-text); }
  .ds-chip.warn { background: var(--orange-l); color: var(--orange-text); }
  .ds-chip.info { background: var(--gray2); color: var(--navy); }
  footer.ds-footer { color: var(--text2); font-size: 12px; text-align: center; padding: 0 20px 28px; }
`;

export function dsHeaderHtml(subtitle) {
  return `<header class="ds-header">
    ${LOGO_SVG}
    <p class="ds-brand"><span class="ds-brand-main">CFOTech</span><span class="ds-brand-sub">${subtitle}</span></p>
  </header>`;
}

export function dsFooterHtml() {
  return '<footer class="ds-footer">Generado automáticamente por el Agente F1 de Compliance de Accesibilidad — CFOTech.</footer>';
}

/** Script inline (sin src): marca el body cuando el informe se ve dentro del visor de informes. */
export const DS_FRAMED_SCRIPT = '<script>try { if (window.top !== window) document.body.classList.add(\'ds-framed\'); } catch (e) {}</script>';

/**
 * Análisis complementario del Agente (IA visual / UX): se lista aparte, con aviso explícito de que
 * no modifica estados, puntaje ni prioridades — esos salen solo de axe-core.
 */
export function complementaryFindingsHtml(findings = [], escape) {
  if (!findings || findings.length === 0) return '';
  const label = { visual_audit: 'Revisión visual', ux_review: 'Revisión de UX' };
  const sevLabel = { critical: 'Crítica', serious: 'Seria', moderate: 'Moderada', minor: 'Menor' };
  const rows = findings.map((f) => `<tr>
      <td>${escape(label[f.source] ?? f.source)}</td>
      <td>${escape(f.wcag_criterion ?? '—')}</td>
      <td>${escape(sevLabel[f.severity] ?? f.severity ?? '—')}</td>
      <td>${escape(f.failure_summary ?? f.wcag_description ?? '')}</td>
      <td>${escape(f.remediation_hint ?? '')}</td>
    </tr>`).join('\n');
  return `<section class="card complementario">
    <h2>Análisis complementario del Agente <span class="pill">No afecta el puntaje ni los informes</span></h2>
    <p class="muted">Hallazgos de la revisión visual y de UX agéntica. Son orientativos: el cumplimiento, los criterios y las prioridades se calculan solo con los resultados del agente.</p>
    <table><thead><tr><th>Revisión</th><th>Criterio</th><th>Severidad</th><th>Hallazgo</th><th>Sugerencia</th></tr></thead><tbody>${rows}</tbody></table>
  </section>`;
}
