/**
 * Hoja de contactos del recorrido con Tab: una sola imagen por página con cada parada numerada y
 * sus recortes sin foco / con foco. Es lo que ve la IA (una consulta por página) y lo que ve la
 * persona que valida. Se arma renderizando un HTML en Playwright: sin dependencias de imágenes.
 */
const SHEET_WIDTH = 1200;
const MAX_SHEET_HEIGHT = 7900; // la API rechaza imágenes de más de 8.000px por lado
const JPEG_QUALITY = 75;

function escapeHtml(value) {
  return String(value ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
}

function cellHtml(stop) {
  const pct = typeof stop.focus_change_pct === 'number' ? `${stop.focus_change_pct}% de cambio` : 'sin medición';
  const shots = stop.focused_png && stop.unfocused_png
    ? `<figure><img src="data:image/png;base64,${stop.unfocused_png}" alt=""><figcaption>Sin foco</figcaption></figure>
       <figure><img src="data:image/png;base64,${stop.focused_png}" alt=""><figcaption>Con foco</figcaption></figure>`
    : '<p class="none">sin captura (fuera de la pantalla)</p>';
  return `<div class="cell">
    <div class="head"><span class="num">${stop.index}</span><span class="name">${escapeHtml(stop.name || `<${stop.tag}>`)}</span><span class="pct">${pct}</span></div>
    <div class="shots">${shots}</div>
  </div>`;
}

export function buildContactSheetHtml(stops = []) {
  return `<!doctype html><html lang="es"><head><meta charset="utf-8"><style>
  body { margin: 0; padding: 12px; font: 13px system-ui, sans-serif; background: #fff; color: #111; width: ${SHEET_WIDTH - 24}px; }
  .grid { display: grid; grid-template-columns: repeat(3, 1fr); gap: 10px; }
  .cell { border: 1px solid #bbb; border-radius: 6px; padding: 6px; overflow: hidden; }
  .head { display: flex; gap: 6px; align-items: center; margin-bottom: 4px; }
  .num { background: #0A1F44; color: #fff; font-weight: 700; border-radius: 10px; padding: 1px 8px; }
  .name { flex: 1; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; font-weight: 600; }
  .pct { color: #555; font-size: 11px; }
  .shots { display: flex; gap: 6px; }
  figure { margin: 0; flex: 1; min-width: 0; }
  figure img { max-width: 100%; max-height: 90px; display: block; border: 1px dashed #ddd; }
  figcaption { font-size: 10px; color: #555; }
  .none { color: #777; font-style: italic; margin: 0; }
</style></head><body><div class="grid">${stops.map(cellHtml).join('')}</div></body></html>`;
}

/** Renderiza la hoja y devuelve un JPEG en base64 (null si no hay paradas). */
export async function renderContactSheet(context, stops = []) {
  if (stops.length === 0) return null;
  const page = await context.newPage();
  try {
    await page.setViewportSize({ width: SHEET_WIDTH, height: 800 });
    await page.setContent(buildContactSheetHtml(stops), { waitUntil: 'load' });
    const height = await page.evaluate(() => document.documentElement.scrollHeight);
    const buffer = await page.screenshot({
      fullPage: true, type: 'jpeg', quality: JPEG_QUALITY,
      ...(height > MAX_SHEET_HEIGHT ? { clip: { x: 0, y: 0, width: SHEET_WIDTH, height: MAX_SHEET_HEIGHT } } : {})
    });
    return buffer.toString('base64');
  } finally {
    await page.close();
  }
}
