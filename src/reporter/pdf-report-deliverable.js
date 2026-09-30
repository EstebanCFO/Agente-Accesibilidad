import { criteriaWithoutAutomatedRules, manualReviewFor } from './report-helpers.js';
import { computeWcagSection } from '../classification/wcag-section.js';
import { computeNaCriteria } from '../classification/na-criteria.js';
import { splitFindings } from '../classification/finding-sources.js';
import { DS_CSS } from './design-system.js';
import { buildDashboardHtml } from './dashboard-deliverable.js';
import { buildConformityMatrix, buildSeverityImpactGrid, buildMatrizHtml } from './matriz-deliverable.js';
import { buildInventarioHtml } from './inventario-deliverable.js';

/**
 * Informe consolidado en PDF: portada + metodología + los tres informes HTML (score de
 * cumplimiento, inventario de hallazgos y matriz de criticidad) en un solo documento imprimible.
 * Reutiliza los mismos builders que los HTML, así que el PDF siempre dice exactamente lo mismo que ellos.
 * Igual que el resto: el contenido se basa solo en axe-core; la revisión del Agente va como
 * análisis complementario (dentro del score y del inventario).
 */

function escapeHtml(value) {
  return String(value ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
}

export { criteriaWithoutAutomatedRules };

function extractPart(html, tag) {
  const match = html.match(new RegExp(`<${tag}>([\\s\\S]*)</${tag}>`));
  return match ? match[1] : '';
}

/** Prefija cada selector del CSS propio de un informe para que no choque con los demás. */
export function scopeCss(css, scope) {
  return css.split('}').map((chunk) => {
    const [selectors, body] = chunk.split('{');
    if (!body) return '';
    const scoped = selectors.split(',').map((sel) => {
      const s = sel.trim();
      if (!s || s.startsWith('@') || s.startsWith(':root') || s.startsWith('*')) return s;
      return `${scope} ${s.replace(/^body\s*/, '')}`.trim();
    }).join(', ');
    return `${scoped} {${body}}`;
  }).join('\n');
}

function sectionFrom(html, key) {
  const style = extractPart(html, 'style').replace(DS_CSS, '');
  return { css: scopeCss(style, `.sec-${key}`), body: extractPart(html, 'main') };
}

const PRINT_CSS = `
  @page { size: A4; margin: 16mm 12mm 18mm; }
  * { -webkit-print-color-adjust: exact; print-color-adjust: exact; }
  body { background: #fff; font-size: 12px; }
  main { max-width: none; padding: 0; }
  .card, section.criterio { box-shadow: none; }
  section.criterio, .ds-hero, .pauta-group { break-inside: avoid; }
  h1, h2, h3, .pdf-section-title { break-after: avoid; }
  thead { display: table-header-group; }
  tr { break-inside: avoid; }
  .pdf-section { break-before: page; }
  .pdf-section-title { font-size: 11px; font-weight: 700; color: var(--text2); text-transform: uppercase; letter-spacing: .08em;
    border-bottom: 2px solid var(--navy); padding-bottom: 4px; margin: 0 0 14px; }
  .sec-matriz table, .sec-inventario table { font-size: 9px; }
  .sec-matriz th, .sec-matriz td, .sec-inventario th, .sec-inventario td { padding: 4px 5px; }
  .ds-grid { grid-template-columns: 1fr; }
  .sec-matriz table, .sec-inventario table { table-layout: fixed; width: 100%; }
  .sec-matriz th, .sec-matriz td, .sec-inventario th, .sec-inventario td { overflow-wrap: anywhere; word-break: break-word; }
  .table-wrap { overflow: visible; }
  .sec-inventario th:nth-child(1) { width: 3%; } .sec-inventario th:nth-child(2) { width: 8%; } .sec-inventario th:nth-child(3) { width: 15%; }
  .sec-inventario th:nth-child(4) { width: 22%; } .sec-inventario th:nth-child(5) { width: 13%; }
  .sec-inventario th:nth-child(6) { width: 6%; } .sec-inventario th:nth-child(7) { width: 9%; }
  .sec-inventario th:nth-child(8) { width: 24%; } .sec-inventario ul.pages, .sec-inventario code { font-size: 8.5px; }
  .sec-matriz table:not(.si-grid) th:nth-child(1) { width: 9%; } .sec-matriz table:not(.si-grid) th:nth-child(2) { width: 7%; }
  .sec-matriz table:not(.si-grid) th:nth-child(3) { width: 21%; }
  .sec-matriz th, .sec-inventario th { word-break: normal; overflow-wrap: normal; hyphens: none; }
  .sec-matriz table.si-grid { table-layout: auto; width: auto; }
  .cover { height: 250mm; display: flex; flex-direction: column; justify-content: space-between; }
  .cover-band { background: var(--navy-dark); color: #fff; border-radius: 12px; padding: 28px 30px; }
  .cover-brand { display: flex; align-items: center; gap: 12px; margin-bottom: 36px; }
  .cover-brand b { font-size: 14px; } .cover-brand span { color: var(--green-a); font-size: 12px; font-weight: 700; display: block; }
  .cover h1 { color: #fff; font-size: 28px; margin: 0 0 8px; }
  .cover-sub { color: rgba(255,255,255,.75); font-size: 14px; margin: 0; }
  .cover-score { display: flex; align-items: center; gap: 28px; margin: 28px 0 0; }
  .cover-score .big { font-size: 46px; font-weight: 700; line-height: 1; }
  .cover-meta { width: 100%; border-collapse: collapse; font-size: 12px; margin-top: 24px; }
  .cover-meta td { border-bottom: 1px solid var(--gray2); padding: 7px 4px; }
  .cover-meta td:first-child { color: var(--text2); width: 30%; font-weight: 600; }
  .toc { list-style: none; padding: 0; margin: 0; }
  .toc li { display: flex; justify-content: space-between; border-bottom: 1px dotted var(--gray3); padding: 6px 0; font-size: 13px; }
  .note { background: var(--gray1); border-left: 4px solid var(--blue); border-radius: 8px; padding: 10px 14px; margin: 10px 0; font-size: 12px; }
`;

const LOGO = '<svg width="36" height="36" viewBox="0 0 32 32" role="img" aria-label="Logo CFOTech"><rect width="32" height="32" rx="8" fill="#00A878"/><text x="16" y="20" text-anchor="middle" fill="#fff" font-family="Segoe UI, system-ui, sans-serif" font-size="11" font-weight="700">CFO</text></svg>';

export function buildConsolidatedReportHtml(data) {
  const { primary, complementary } = splitFindings(data.findings);
  const findings = primary;
  const complementaryFindings = [...complementary, ...(data.complementaryFindings ?? [])];
  const axeResults = data.axe_results ?? data.axeResults ?? [];
  const urls = data.urls ?? axeResults.map((r) => r.url);
  const generatedAt = new Date();

  const naCriteria = computeNaCriteria(axeResults, { includeExtended: false });
  const includeExtended = data.includeExtended ?? false;

  const sections = [
    { key: 'dashboard', title: 'Score de cumplimiento inicial', html: buildDashboardHtml({ jobId: data.jobId, channel: data.channel, scores: data.scores, findings, complementaryFindings, naCriteria, urls: data.urls, axeResults, includeExtended, keyboardResults: data.keyboardResults ?? [] }) },
    { key: 'inventario', title: 'Inventario de hallazgos', html: buildInventarioHtml({ jobId: data.jobId, findings, complementaryFindings, urls }) },
    { key: 'matriz', title: 'Matriz de criticidad WCAG 2.0 AA', html: buildMatrizHtml({
      jobId: data.jobId, channel: data.channel,
      conformity: buildConformityMatrix({ findings, urls, includeExtended, axeResults }),
      severityImpactGrid: buildSeverityImpactGrid(findings)
    }) }
  ].map((s) => ({ ...s, ...sectionFrom(s.html, s.key) }));

  // Misma fuente que la tarjeta "Compliance WCAG" del panel y el Score de cumplimiento inicial.
  const section = data.scores.wcag_section ?? computeWcagSection(data.findings, { axeResults, includeExtended });
  const na = section.no_aplica ? ` · ${section.no_aplica} ${section.no_aplica === 1 ? 'no aplica' : 'no aplican'}` : '';
  const coverage = criteriaWithoutAutomatedRules();

  return `<!doctype html>
<html lang="es">
<head>
<meta charset="utf-8">
<title>Informe de Auditoría de Accesibilidad — ${escapeHtml(data.jobId)}</title>
<style>${DS_CSS}
${sections.map((s) => s.css).join('\n')}
${PRINT_CSS}
</style>
</head>
<body>
<main>
  <section class="cover">
    <div class="cover-band">
      <div class="cover-brand">${LOGO}<div><b>CFOTech</b><span>Agente F1 · Compliance de Accesibilidad</span></div></div>
      <h1>Informe de Auditoría de Accesibilidad Digital</h1>
      <p class="cover-sub">Circular BCRA — WCAG 2.0 A+AA (38 criterios)</p>
      <div class="cover-score">
        <div>
          <div class="big">${section.ok} OK · ${section.nok} NOK</div>
          <p class="cover-sub">${section.a_validar} a validar (de ${section.total})${na} · los criterios a validar no cuentan como OK</p>
        </div>
      </div>
    </div>
    <div>
      <table class="cover-meta">
        <tr><td>Job</td><td>${escapeHtml(data.jobId)}</td></tr>
        <tr><td>Páginas evaluadas</td><td>${urls.length}</td></tr>
        <tr><td>Generado</td><td>${generatedAt.toLocaleString('es-AR')}</td></tr>
      </table>
      <h2 style="margin-top:24px">Contenido</h2>
      <ol class="toc">
        <li><span>1. Alcance y metodología</span></li>
        ${sections.map((s, i) => `<li><span>${i + 2}. ${escapeHtml(s.title)}</span></li>`).join('\n')}
      </ol>
    </div>
  </section>

  <section class="pdf-section">
    <p class="pdf-section-title">1. Alcance y metodología</p>
    <h1>Alcance y metodología</h1>
    <p>La auditoría evalúa cada página contra los <strong>38 criterios de conformidad</strong> exigidos por la Circular BCRA (WCAG 2.0 niveles A y AA). El puntaje y todas las secciones de este informe se basan <strong>exclusivamente en los resultados del agente</strong>.</p>
    <div class="note"><strong>Cobertura de la detección automática.</strong> El agente detecta en promedio alrededor del 57% de los problemas de accesibilidad por volumen. ${coverage.missing.length > 0 ? `Además, ${coverage.missing.length} de los 38 criterios no tienen ninguna regla automática (${coverage.missing.map(escapeHtml).join(', ')}): en las vistas por criterio figuran como <strong>No evaluado</strong>: no se detectó incumplimiento, pero no se pueden verificar automáticamente. De ellos, <strong>${coverage.missing.filter((c) => manualReviewFor(c).assistive).length} requieren tecnología asistiva</strong> (lector de pantalla o navegación con teclado) y ${coverage.missing.filter((c) => !manualReviewFor(c).assistive).length} una revisión manual (Fase 2). No se cuentan como OK: figuran como <strong>a validar</strong>.` : ''}</div>
    <div class="note"><strong>Análisis complementario del Agente.</strong> ${complementaryFindings.length > 0 ? `La revisión visual y de UX agéntica aportó ${complementaryFindings.length} hallazgo(s) adicionales.` : 'La revisión visual y de UX agéntica no aportó hallazgos en esta corrida (o no estaba activa).'} Estos hallazgos son orientativos: se muestran en secciones rotuladas "Análisis complementario" y no modifican el puntaje, el estado de los criterios ni las prioridades.</div>
  </section>

  ${sections.map((s, i) => `<section class="pdf-section sec-${s.key}">
    <p class="pdf-section-title">${i + 2}. ${escapeHtml(s.title)}</p>
    ${s.body}
  </section>`).join('\n')}
</main>
</body>
</html>`;
}

/** Renderiza el HTML a PDF A4 con Chromium (Playwright, ya dependencia del proyecto). */
export async function renderPdf(html, pdfPath, { jobId } = {}) {
  const { chromium } = await import('playwright');
  const browser = await chromium.launch();
  try {
    const page = await browser.newPage();
    await page.setContent(html, { waitUntil: 'load' });
    await page.pdf({
      path: pdfPath,
      format: 'A4',
      printBackground: true,
      displayHeaderFooter: true,
      headerTemplate: '<div></div>',
      footerTemplate: `<div style="font-family:Segoe UI,sans-serif;font-size:8px;color:#4A5568;width:100%;padding:0 12mm;display:flex;justify-content:space-between">
        <span>CFOTech · Informe de Auditoría de Accesibilidad${jobId ? ` · ${escapeHtml(jobId)}` : ''}</span>
        <span>Página <span class="pageNumber"></span> de <span class="totalPages"></span></span></div>`,
      margin: { top: '14mm', bottom: '16mm', left: '12mm', right: '12mm' }
    });
  } finally {
    await browser.close();
  }
  return pdfPath;
}
