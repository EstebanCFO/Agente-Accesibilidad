/**
 * Cierra un banner de consentimiento de cookies antes del recorrido con Tab. Muchos de esos
 * banners son modales y encierran el foco: sin cerrarlos, el recorrido nunca llega a la página.
 * El escaneo de axe-core ya corrió con el banner presente (el banner igual se audita); esto solo
 * afecta a las pruebas de teclado. Preferencia: Rechazar (lo que menos consiente en nombre del
 * cliente) > Cerrar > Aceptar (solo si es la única salida). Queda registrado en la evidencia.
 */
const SETTLE_MS = 250;
const MAX_WAIT_MS = 2000;

// Se ejecuta en la página: marca el banner y el botón elegido, y devuelve la acción.
function markBanner() {
  const visible = (el) => {
    if (!el || el.getClientRects().length === 0) return false;
    const style = getComputedStyle(el);
    return style.visibility !== 'hidden' && style.display !== 'none' && Number(style.opacity) > 0;
  };
  const CONTAINERS = '[id*="cookie" i], [class*="cookie" i], [id*="consent" i], [class*="consent" i], [id*="gdpr" i], [class*="gdpr" i], #onetrust-banner-sdk, #CybotCookiebotDialog, [aria-label*="cookie" i]';
  const TEXT = /cookie|consentimiento|consent|privacidad|privacy/i;
  const candidates = [
    ...document.querySelectorAll(CONTAINERS),
    ...[...document.querySelectorAll('[role="dialog"], [role="alertdialog"], dialog[open], [aria-modal="true"]')].filter((el) => TEXT.test(el.textContent))
  ].filter(visible);
  // El contenedor más externo de cada banner (no cada elemento interno con "cookie" en la clase).
  const banners = candidates.filter((el) => !candidates.some((other) => other !== el && other.contains(el)));

  const CATEGORIES = [
    { action: 'Rechazar', test: /rechaz|reject|declin|deneg|solo (las )?(cookies )?necesarias|only necessary|necessary only|no acepto/i },
    { action: 'Cerrar', test: /^(×|✕|x|cerrar|close|entendido|ok|de acuerdo|continuar)$/i },
    { action: 'Aceptar', test: /acept|accept|agree|allow|permitir|consiento/i }
  ];
  for (const banner of banners) {
    const buttons = [...banner.querySelectorAll('button, [role="button"], a, input[type="button"], input[type="submit"]')].filter(visible);
    const label = (b) => (b.getAttribute('aria-label') || b.innerText || b.value || '').trim();
    for (const { action, test } of CATEGORIES) {
      const button = buttons.find((b) => test.test(label(b)));
      if (button) {
        banner.setAttribute('data-kb-banner', '1');
        button.setAttribute('data-kb-dismiss', '1');
        return { found: true, action };
      }
    }
  }
  return { found: banners.length > 0, action: null };
}

export async function dismissConsentBanner(page) {
  let marked;
  try {
    marked = await page.evaluate(markBanner);
  } catch {
    return { detected: false, dismissed: false, action: null };
  }
  if (!marked.found) return { detected: false, dismissed: false, action: null };
  if (!marked.action) return { detected: true, dismissed: false, action: null };
  try {
    await page.click('[data-kb-dismiss]', { timeout: 2000 });
    // Algunos banners se van con una animación o quedan como contenedor vacío de 0 px: se espera
    // hasta MAX_WAIT_MS a que no quede nada visible (área real, no solo "tiene un rect").
    let stillVisible = true;
    for (let waited = 0; stillVisible && waited <= MAX_WAIT_MS; waited += SETTLE_MS) {
      await page.waitForTimeout(SETTLE_MS);
      stillVisible = await page.evaluate(() => {
        const el = document.querySelector('[data-kb-banner]');
        if (!el) return false;
        const rect = el.getBoundingClientRect();
        const style = getComputedStyle(el);
        return rect.width * rect.height > 0 && style.visibility !== 'hidden' && style.display !== 'none' && Number(style.opacity) > 0;
      }).catch(() => false);
    }
    return { detected: true, dismissed: !stillVisible, action: marked.action };
  } catch {
    return { detected: true, dismissed: false, action: marked.action };
  }
}
