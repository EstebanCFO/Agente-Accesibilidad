import { test } from 'node:test';
import assert from 'node:assert/strict';
import { buildReportViewerHtml } from './demo-report-viewer.js';

const REPORTS = [
  { key: 'dashboard', label: 'Dashboard ejecutivo', file: 'dashboard.html' },
  { key: 'matriz', label: 'Matriz de criticidad', file: 'matriz-criticidad.html' }
];

test('buildReportViewerHtml arma un botón por informe y embebe el primero por defecto', () => {
  const html = buildReportViewerHtml({ reports: REPORTS });
  assert.match(html, /role="tab"[^>]*data-key="dashboard"[^>]*>Dashboard ejecutivo</);
  assert.match(html, /data-key="matriz"[^>]*>Matriz de criticidad</);
  assert.match(html, /<iframe id="visor"[^>]*title="Dashboard ejecutivo"[^>]*src="dashboard.html"/);
  assert.match(html, /aria-selected="true"[^>]*data-key="dashboard"/);
});

test('buildReportViewerHtml no muestra la URL auditada junto a las pestañas', () => {
  const html = buildReportViewerHtml({ reports: REPORTS, subtitle: 'sitio.test/cuentas' });
  assert.doesNotMatch(html, /sitio\.test/);
  assert.doesNotMatch(html, /class="site"/);
});

test('buildReportViewerHtml escapa textos y exige al menos un informe', () => {
  const html = buildReportViewerHtml({ reports: [{ key: 'x', label: '<b>Informe</b>', file: 'a.html' }] });
  assert.ok(html.includes('&lt;b&gt;Informe&lt;/b&gt;'));
  assert.throws(() => buildReportViewerHtml({ reports: [] }), /al menos un informe/);
});
