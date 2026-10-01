/**
 * Página "Informes de la auditoría": una fila de botones (uno por informe) y el informe elegido
 * embebido debajo, sin abrir pestañas nuevas. Se guarda como informes.html en la carpeta de la
 * auditoría, así que también funciona abierta desde el disco después de la demo.
 * El informe visible se elige con el hash (#dashboard, #matriz…): lo cambian tanto los botones
 * de la página como los del panel de control.
 */
const ESCAPES = { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' };
const escapeHtml = (text) => String(text).replace(/[&<>"']/g, (c) => ESCAPES[c]);

/** reports: [{ key, label, file }]. El primero es el que se muestra por defecto. */
export function buildReportViewerHtml({ reports, title = 'Informes de la auditoría' }) {
  if (!Array.isArray(reports) || reports.length === 0) throw new Error('buildReportViewerHtml requiere al menos un informe');
  const tabs = reports.map((r, i) => `
      <button type="button" role="tab" id="tab-${escapeHtml(r.key)}" aria-controls="visor" aria-selected="${i === 0}" tabindex="${i === 0 ? 0 : -1}"
        data-key="${escapeHtml(r.key)}" data-file="${escapeHtml(r.file)}">${escapeHtml(r.label)}</button>`).join('');

  return `<!doctype html>
<html lang="es">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>${escapeHtml(title)}</title>
<style>
  /* CFOTech IT Tools — Design System (Portal de Acceso): header 48px + nav pills + AppFrame. */
  :root { --navy-dark: #0B1526; --nav-active: #1B3F8A; --green-a: #4FD1B2; --logo-green: #00A878; --blue: #4472C4; --gray1: #F4F6F9; }
  * { box-sizing: border-box; }
  html, body { height: 100%; margin: 0; overflow: hidden; }
  body { font-family: 'Segoe UI', system-ui, sans-serif; display: flex; flex-direction: column; background: var(--navy-dark); color: #0D1B2A; }
  header { background: var(--navy-dark); height: 48px; flex-shrink: 0; display: flex; align-items: center; gap: 14px;
    padding: 0 24px; border-bottom: 3px solid #1C2E48; }
  .logo { width: 32px; height: 32px; background: var(--logo-green); border-radius: 8px; display: flex; align-items: center; justify-content: center; flex-shrink: 0; }
  .logo span { color: #fff; font-size: 11px; font-weight: 700; letter-spacing: -.3px; }
  h1 { margin: 0; display: flex; flex-direction: column; line-height: 1.2; flex-shrink: 0; }
  .brand-main { font-size: 13px; font-weight: 700; color: #fff; }
  .brand-sub { font-size: 11px; font-weight: 700; color: var(--green-a); }
  [role=tablist] { display: flex; gap: 4px; flex: 1; min-width: 0; overflow-x: auto; scrollbar-width: none; }
  [role=tab] { height: 32px; padding: 0 14px; border-radius: 20px; border: none; font: inherit; font-size: 13px; font-weight: 500;
    cursor: pointer; white-space: nowrap; color: rgba(255,255,255,.62); background: rgba(255,255,255,.07); transition: background .15s, color .15s; }
  [role=tab]:hover:not([aria-selected=true]) { background: rgba(255,255,255,.12); color: rgba(255,255,255,.82); }
  [role=tab][aria-selected=true] { background: var(--nav-active); color: #fff; font-weight: 600; box-shadow: 0 0 0 1px rgba(255,255,255,.15) inset; }
  :focus-visible { outline: 3px solid var(--green-a); outline-offset: 2px; }
  main { flex: 1; min-height: 0; position: relative; overflow: hidden; background: var(--gray1); }
  iframe { position: absolute; inset: 0; width: 100%; height: 100%; border: 0; background: #fff; }
  /* Embebido en el panel de la demo (?embed=1): el panel ya muestra logo y marca. */
  body.embed .logo, body.embed h1 { display: none; }
  body.embed header { height: 44px; padding: 0 12px; }
</style>
</head>
<body>
  <header>
    <svg class="logo" width="32" height="32" viewBox="0 0 32 32" role="img" aria-label="Logo CFOTech"><rect width="32" height="32" rx="8" fill="#00A878"/><text x="16" y="20" text-anchor="middle" fill="#fff" font-family="Segoe UI, system-ui, sans-serif" font-size="11" font-weight="700" letter-spacing="-.3">CFO</text></svg>
    <h1><span class="brand-main">CFOTech</span><span class="brand-sub">${escapeHtml(title)}</span></h1>
    <div role="tablist" aria-label="Informes">${tabs}
    </div>
  </header>
  <main>
    <iframe id="visor" role="tabpanel" aria-labelledby="tab-${escapeHtml(reports[0].key)}" title="${escapeHtml(reports[0].label)}" src="${escapeHtml(reports[0].file)}"></iframe>
  </main>
<script>
  if (new URLSearchParams(location.search).has('embed')) document.body.classList.add('embed');
  const tabs = [...document.querySelectorAll('[role=tab]')];
  const visor = document.getElementById('visor');
  function show(key, focus) {
    const tab = tabs.find((t) => t.dataset.key === key) || tabs[0];
    tabs.forEach((t) => { const on = t === tab; t.setAttribute('aria-selected', on); t.tabIndex = on ? 0 : -1; });
    if (visor.getAttribute('src') !== tab.dataset.file) visor.setAttribute('src', tab.dataset.file);
    visor.title = tab.textContent;
    visor.setAttribute('aria-labelledby', tab.id);
    if (focus) tab.focus();
  }
  tabs.forEach((t, i) => {
    t.addEventListener('click', () => { location.hash = t.dataset.key; });
    t.addEventListener('keydown', (e) => {
      const d = e.key === 'ArrowRight' ? 1 : e.key === 'ArrowLeft' ? -1 : 0;
      if (d) { const n = tabs[(i + d + tabs.length) % tabs.length]; location.hash = n.dataset.key; n.focus(); }
    });
  });
  window.addEventListener('hashchange', () => show(location.hash.slice(1)));
  show(location.hash.slice(1));
</script>
</body>
</html>
`;
}
