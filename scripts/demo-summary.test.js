import { test } from 'node:test';
import assert from 'node:assert/strict';
import { buildRunSummary, buildStations, shortUrl } from './demo-summary.js';

const node = { target: ['img'], html: '<img>', failureSummary: 'x' };
function axe(url, { fail = false } = {}) {
  return {
    url,
    violations: fail ? [{ id: 'image-alt', impact: 'critical', tags: ['wcag2a', 'wcag111'], help: 'alt', nodes: [node] }] : [],
    passes: [
      { id: 'document-title', tags: ['wcag2a', 'wcag242'], nodes: [node] },
      { id: 'region', tags: ['best-practice'], impact: 'moderate', nodes: [node] }
    ],
    incomplete: [],
    inapplicable: []
  };
}
const crit = (estados) => ({ criteria: Object.fromEntries(['2.1.2', '2.4.3', '2.4.7', '3.2.1'].map((id, i) => [id, { estado: estados[i] }])), status: 'done' });

test('buildRunSummary consolida URLs, WCAG validados (OK/NOK) y QA manual del sitio', () => {
  const pages = [
    { url: 'https://b.test/', status: 'done', axeResult: axe('https://b.test/') },
    { url: 'https://b.test/p', status: 'done', axeResult: axe('https://b.test/p', { fail: true }) },
    { url: 'https://b.test/x', status: 'failed', error: 'el sitio no respondió' },
    { url: 'https://b.test/y', status: 'pending' }
  ];
  const s = buildRunSummary({ pages, keyboardEnabled: false });
  assert.deepEqual(s.urls, { total: 4, scanned: 2, failed: 1 });
  assert.equal(s.wcag.total, 38);
  assert.equal(s.wcag.ok, 1);
  assert.equal(s.wcag.nok, 1);
  assert.equal(s.wcag.validated, 2);
  assert.equal(s.wcag.manual, 36);
  assert.equal(s.bestPractices.score, 100);
  assert.deepEqual(s.keyboard, { enabled: false });
  assert.equal(s.rows[0].wcag.ok, 1);
  assert.equal(s.rows[1].wcag.nok, 1);
  assert.equal(s.rows[1].keyboard, null);
  assert.equal(s.rows[2].error, 'el sitio no respondió');
  assert.equal(s.rows[3].wcag, undefined);
});

test('buildRunSummary cuenta teclado por página y deja pendientes las que la IA no terminó', () => {
  const pages = [
    { url: 'https://b.test/', status: 'done', axeResult: axe('https://b.test/') },
    { url: 'https://b.test/p', status: 'done', axeResult: axe('https://b.test/p') }
  ];
  const kb = new Map([['https://b.test/', crit(['sin_indicios', 'con_indicios', 'sin_indicios', 'no_evaluable'])]]);
  const s = buildRunSummary({ pages, keyboardResults: kb });
  assert.equal(s.keyboard.con_indicios, 1);
  assert.equal(s.keyboard.sin_indicios, 2);
  assert.equal(s.keyboard.pending, 1);
  assert.equal(s.keyboard.score, 66.67);
  assert.deepEqual(s.rows[0].keyboard, { con_indicios: 1, sin_indicios: 2, no_evaluable: 1, ai_failed: false });
  assert.equal(s.rows[1].keyboard, 'pending');
});

test('buildRunSummary sin páginas escaneadas no inventa números', () => {
  const s = buildRunSummary({ pages: [{ url: 'https://b.test/', status: 'scanning' }] });
  assert.equal(s.wcag, null);
  assert.equal(s.bestPractices, null);
  assert.equal(s.keyboard.score, null);
});

test('buildStations avanza solo según el estado y marca teclado omitido', () => {
  const pages = [{ url: 'https://b.test/', status: 'done', axeResult: axe('https://b.test/') }, { url: 'https://b.test/p', status: 'scanning' }];
  const live = buildStations(buildRunSummary({ pages }), { scanning: true });
  assert.deepEqual(live.map((s) => s.state), ['active', 'active', 'active', 'pending']);
  assert.equal(live[0].detail, '1/2');

  const off = buildStations(buildRunSummary({ pages: [pages[0]], keyboardEnabled: false }), { scanning: false, reports: 'done' });
  assert.deepEqual(off.map((s) => s.state), ['done', 'done', 'skipped', 'done']);
});

test('shortUrl muestra dominio + ruta o el nombre de archivo', () => {
  assert.equal(shortUrl('https://www.banco.test/personas/'), 'www.banco.test/personas');
  assert.equal(shortUrl('file:///C:/sitio/index.html'), 'index.html');
});
