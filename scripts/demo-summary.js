/**
 * Resumen de la auditoría en vivo: lo que se ve llenándose abajo de la pantalla mientras el agente
 * trabaja y lo que queda como resumen ejecutivo al final (la misma función, para que siempre
 * coincidan). Lógica pura, sin I/O.
 */
import path from 'node:path';
import { classifyFindings } from '../src/classification/classify-findings.js';
import { computeWcagSection } from '../src/classification/wcag-section.js';
import { computeBestPractices } from '../src/classification/best-practices.js';
import { computeKeyboardScore, KEYBOARD_CRITERIA } from '../src/keyboard/keyboard-criteria.js';

/** URL corta y legible: dominio + ruta (o el nombre del archivo para una carpeta local). */
export function shortUrl(url) {
  try {
    const u = new URL(url);
    return u.protocol === 'file:' ? path.basename(decodeURIComponent(u.pathname)) : (u.hostname + u.pathname).replace(/\/$/, '');
  } catch {
    return url;
  }
}

/** Compliance WCAG de un conjunto de páginas: validados por el agente (OK/NOK) y QA manual. */
function wcagCounts(axeResults, includeExtended) {
  if (axeResults.length === 0) return null;
  const scope = { includeExtended };
  const s = computeWcagSection(classifyFindings(axeResults, scope).findings, { axeResults, ...scope });
  return { total: s.total, validated: s.ok + s.nok, ok: s.ok, nok: s.nok, manual: s.a_validar, no_aplica: s.no_aplica };
}

function keyboardCounts(result) {
  if (!result) return null;
  const count = (estado) => KEYBOARD_CRITERIA.filter((c) => result.criteria?.[c.id]?.estado === estado).length;
  return { con_indicios: count('con_indicios'), sin_indicios: count('sin_indicios'), no_evaluable: count('no_evaluable'), ai_failed: result.status === 'failed' };
}

/**
 * pages: [{ url, status: 'pending'|'scanning'|'done'|'failed', axeResult?, error? }] en orden.
 * keyboardResults: Map url → { criteria, status } de las revisiones de teclado ya terminadas.
 * keyboardEnabled: false = la prueba de teclado se omitió en la configuración.
 */
export function buildRunSummary({ pages = [], keyboardResults = new Map(), keyboardEnabled = true, includeExtended = false, final = false, usage = null }) {
  const scanned = pages.filter((p) => p.status === 'done' && p.axeResult);
  const axeResults = scanned.map((p) => p.axeResult);
  const kbDone = scanned.map((p) => keyboardResults.get(p.url)).filter(Boolean);
  const kbScore = computeKeyboardScore(kbDone);
  const bp = axeResults.length ? computeBestPractices(axeResults) : null;

  return {
    final,
    scope: includeExtended ? 'WCAG 2.0 (BCRA) + 2.2' : 'WCAG 2.0 (BCRA)',
    urls: { total: pages.length, scanned: scanned.length, failed: pages.filter((p) => p.status === 'failed').length },
    wcag: wcagCounts(axeResults, includeExtended),
    keyboard: keyboardEnabled
      ? { enabled: true, score: kbScore.score, con_indicios: kbScore.con_indicios, sin_indicios: kbScore.sin_indicios, no_evaluable: kbScore.no_evaluable, pending: scanned.length - kbDone.length }
      : { enabled: false },
    bestPractices: bp ? { score: bp.score, cumple: bp.cumple, mejora: bp.mejora } : null,
    usage,
    rows: pages.map((p) => {
      const row = { url: p.url, label: shortUrl(p.url), status: p.status };
      if (p.status === 'failed') return { ...row, error: p.error ?? 'No se pudo escanear' };
      if (p.status !== 'done' || !p.axeResult) return row;
      return {
        ...row,
        wcag: wcagCounts([p.axeResult], includeExtended),
        keyboard: keyboardEnabled ? (keyboardCounts(keyboardResults.get(p.url)) ?? 'pending') : null,
        bestPractices: computeBestPractices([p.axeResult]).score
      };
    })
  };
}

/**
 * Estaciones de arriba de la pantalla en vivo. state: 'pending'|'active'|'done'|'skipped'.
 * reports: estado de la generación de informes.
 */
export function buildStations(summary, { scanning, reports = 'pending' }) {
  const { urls, keyboard } = summary;
  const scanState = scanning ? 'active' : urls.scanned + urls.failed > 0 ? 'done' : 'pending';
  const bcraState = urls.scanned === 0 ? 'pending' : scanning ? 'active' : 'done';
  let kbState = 'skipped';
  let kbDetail = 'omitido';
  if (keyboard.enabled) {
    const done = urls.scanned - keyboard.pending;
    kbState = urls.scanned === 0 ? 'pending' : keyboard.pending > 0 || scanning ? 'active' : 'done';
    kbDetail = `${done}/${scanning ? urls.total - urls.failed : urls.scanned}`;
  }
  return [
    { key: 'scan', label: 'Escaneo', state: scanState, detail: `${urls.scanned + urls.failed}/${urls.total}` },
    { key: 'bcra', label: 'Normativa BCRA', state: bcraState, detail: summary.wcag ? `${summary.wcag.total} criterios` : '' },
    { key: 'keyboard', label: 'Teclado', state: kbState, detail: kbDetail },
    { key: 'reports', label: 'Informes', state: reports, detail: '' }
  ];
}
