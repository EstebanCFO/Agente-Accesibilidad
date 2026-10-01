/**
 * Recorrido con Tab de una página ya cargada (Playwright). Por cada parada registra qué elemento
 * recibió el foco, dónde está, dos recortes de la misma zona (con foco y sin foco) y si recibir el
 * foco cambió el contexto (URL, ventana nueva, diálogo). Solo junta evidencia: el estado de cada
 * criterio lo decide keyboard-criteria.js (y la IA para 2.4.3/2.4.7).
 */
export const MAX_TAB_STOPS = 60;
const SETTLE_MS = 120;
const CROP_PADDING = 8;
// Diferencia mínima por píxel (suma de |ΔR|+|ΔG|+|ΔB|) para contarlo como cambiado.
const PIXEL_THRESHOLD = 48;

// Se inyecta en la página: describe el elemento que recibió el foco.
const DESCRIBE_SOURCE = `(el) => {
  const r = el.getBoundingClientRect();
  const text = (el.getAttribute('aria-label') || el.innerText || el.value || el.getAttribute('title') || el.getAttribute('alt') || el.getAttribute('placeholder') || '');
  const selectorOf = (e) => {
    if (e.id) return '#' + CSS.escape(e.id);
    const parts = [];
    while (e && e.nodeType === 1 && e !== document.body && e !== document.documentElement) {
      let i = 1; let s = e;
      while ((s = s.previousElementSibling)) if (s.tagName === e.tagName) i++;
      parts.unshift(e.tagName.toLowerCase() + ':nth-of-type(' + i + ')');
      e = e.parentElement;
    }
    return 'body > ' + parts.join(' > ');
  };
  return {
    tag: el.tagName.toLowerCase(), role: el.getAttribute('role') || '',
    name: String(text).trim().replace(/\\s+/g, ' ').slice(0, 80), selector: selectorOf(el),
    bbox: { x: r.x, y: r.y, width: r.width, height: r.height },
    doc_x: r.left + window.scrollX, doc_y: r.top + window.scrollY
  };
}`;

const pageStates = new WeakMap();

/** Registra (una vez por página) un aviso desde el navegador cada vez que un elemento recibe el foco. */
async function installFocusProbe(page) {
  if (!pageStates.has(page)) {
    const state = { last: null };
    pageStates.set(page, state);
    await page.exposeBinding('__kbFocus', (_source, info) => { state.last = info; });
  }
  await page.evaluate(`(() => {
    if (window.__kbProbe) return;
    window.__kbProbe = true;
    const describe = ${DESCRIBE_SOURCE};
    document.addEventListener('focusin', (e) => {
      const el = e.target;
      if (!el || el === document.body || el === document.documentElement) return;
      window.__kbCurrent = el;
      window.__kbFocus(describe(el));
    }, true);
  })()`);
  return pageStates.get(page);
}

async function modalCount(page) {
  return page.evaluate(() => [...document.querySelectorAll('dialog[open], [role="dialog"], [role="alertdialog"], [aria-modal="true"]')]
    .filter((el) => el.getClientRects().length > 0).length).catch(() => 0);
}

function clipFor(bbox, viewport) {
  const x = Math.max(0, Math.floor(bbox.x - CROP_PADDING));
  const y = Math.max(0, Math.floor(bbox.y - CROP_PADDING));
  const right = Math.min(viewport.width, Math.ceil(bbox.x + bbox.width + CROP_PADDING));
  const bottom = Math.min(viewport.height, Math.ceil(bbox.y + bbox.height + CROP_PADDING));
  if (right - x < 2 || bottom - y < 2) return null;
  return { x, y, width: right - x, height: bottom - y };
}

/** % de píxeles distintos entre dos PNG, calculado en una página auxiliar sin CSP. */
async function changedPct(toolPage, a, b) {
  return toolPage.evaluate(async ([pngA, pngB, threshold]) => {
    const load = (data) => new Promise((resolve, reject) => {
      const img = new Image();
      img.onload = () => resolve(img);
      img.onerror = reject;
      img.src = `data:image/png;base64,${data}`;
    });
    const [ia, ib] = await Promise.all([load(pngA), load(pngB)]);
    const w = Math.min(ia.width, ib.width);
    const h = Math.min(ia.height, ib.height);
    if (!w || !h) return 0;
    const pixels = (img) => {
      const canvas = new OffscreenCanvas(w, h);
      const ctx = canvas.getContext('2d');
      ctx.drawImage(img, 0, 0);
      return ctx.getImageData(0, 0, w, h).data;
    };
    const da = pixels(ia);
    const db = pixels(ib);
    let changed = 0;
    for (let i = 0; i < da.length; i += 4) {
      if (Math.abs(da[i] - db[i]) + Math.abs(da[i + 1] - db[i + 1]) + Math.abs(da[i + 2] - db[i + 2]) > threshold) changed += 1;
    }
    return Math.round((changed / (w * h)) * 10000) / 100;
  }, [a, b, PIXEL_THRESHOLD]);
}

/** Shift+Tab desde el ciclo: si nunca sale de esos elementos, es una trampa de teclado. */
async function confirmTrap(page, state, cycleSelectors) {
  const inCycle = new Set(cycleSelectors);
  for (let i = 0; i <= cycleSelectors.length; i++) {
    state.last = null;
    await page.keyboard.press('Shift+Tab');
    await page.waitForTimeout(SETTLE_MS);
    if (!state.last || !inCycle.has(state.last.selector)) return false;
  }
  return true;
}

/**
 * Presiona Tab hasta maxStops veces. Termina cuando el foco vuelve al primer elemento o sale del
 * documento ('ciclo'), queda encerrado ('trampa'), un elemento repite sin trampa ('repeticion'),
 * cambia la URL ('cambio_de_contexto'), se llega al tope ('tope') o no hay enfocables.
 */
export async function walkKeyboard(page, { maxStops = MAX_TAB_STOPS, resetStart = false } = {}) {
  const state = await installFocusProbe(page);
  const viewport = page.viewportSize() ?? { width: 1280, height: 800 };
  const context = page.context();
  let popups = 0;
  let dialogs = 0;
  const onPopup = () => { popups += 1; };
  const onDialog = (dialog) => { dialogs += 1; dialog.dismiss().catch(() => {}); };
  context.on('page', onPopup);
  page.on('dialog', onDialog);
  const toolPage = await context.newPage();

  const stops = [];
  let ended = 'tope';
  let trap = null;
  try {
    // resetStart (tras cerrar un banner de cookies, cuyo botón enfocado ya no existe): se enfoca
    // un marcador al principio del body y se lo quita, así el primer Tab va al primer elemento de
    // la página y no al final del documento. No se usa siempre porque con un punto de partida el
    // navegador ya no visita primero los tabindex positivos.
    await page.evaluate((reset) => {
      document.activeElement?.blur?.();
      if (reset) {
        const start = document.createElement('span');
        start.tabIndex = -1;
        document.body.prepend(start);
        start.focus({ preventScroll: true });
        start.remove();
      }
      window.scrollTo(0, 0);
    }, resetStart);
    for (let i = 1; i <= maxStops; i++) {
      const before = { url: page.url(), popups, dialogs, modals: await modalCount(page) };
      state.last = null;
      await page.keyboard.press('Tab');
      await page.waitForTimeout(SETTLE_MS);

      if (page.url() !== before.url) {
        if (state.last) stops.push({ index: i, ...state.last, focus_change_pct: null, context_change: 'url' });
        ended = 'cambio_de_contexto';
        break;
      }
      const info = state.last;
      if (!info) { ended = stops.length === 0 ? 'sin_enfocables' : 'ciclo'; break; }
      if (stops.length > 0 && info.selector === stops[0].selector) { ended = 'ciclo'; break; }
      const firstSeen = stops.findIndex((s) => s.selector === info.selector);
      if (firstSeen >= 0) {
        const cycle = stops.slice(firstSeen);
        if (await confirmTrap(page, state, cycle.map((s) => s.selector))) {
          trap = { paradas: cycle.map((s) => s.index) };
          ended = 'trampa';
        } else {
          ended = 'repeticion';
        }
        break;
      }

      let contextChange = null;
      if (popups > before.popups) contextChange = 'popup';
      else if (dialogs > before.dialogs || (await modalCount(page)) > before.modals) contextChange = 'dialog';

      const stop = { index: i, ...info, focus_change_pct: null, context_change: contextChange };
      const clip = clipFor(info.bbox, viewport);
      if (clip) {
        const focused = (await page.screenshot({ clip })).toString('base64');
        await page.evaluate(() => window.__kbCurrent?.blur());
        await page.waitForTimeout(40);
        const unfocused = (await page.screenshot({ clip })).toString('base64');
        // Se devuelve el foco al elemento para que el próximo Tab (y sus handlers) partan de él.
        await page.evaluate(() => window.__kbCurrent?.focus({ preventScroll: true }));
        stop.focused_png = focused;
        stop.unfocused_png = unfocused;
        stop.focus_change_pct = await changedPct(toolPage, focused, unfocused);
      }
      stops.push(stop);
    }
  } finally {
    context.off('page', onPopup);
    page.off('dialog', onDialog);
    await toolPage.close().catch(() => {});
  }
  return { stops, ended, trap };
}
