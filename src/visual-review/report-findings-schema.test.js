import { test } from 'node:test';
import assert from 'node:assert/strict';
import { REPORT_FINDINGS_TOOL, criteriaListText, normalizeReportedFindings } from './report-findings-schema.js';

test('REPORT_FINDINGS_TOOL tiene el nombre y schema esperados por tool_choice', () => {
  assert.equal(REPORT_FINDINGS_TOOL.name, 'report_findings');
  assert.equal(REPORT_FINDINGS_TOOL.input_schema.type, 'object');
  assert.ok(REPORT_FINDINGS_TOOL.input_schema.properties.findings);
});

test('REPORT_FINDINGS_TOOL trae cache_control para que Anthropic cachee su definición entre llamadas', () => {
  assert.deepEqual(REPORT_FINDINGS_TOOL.cache_control, { type: 'ephemeral' });
});

test('criteriaListText incluye solo criterios ONTI por default (sin includeExtended)', () => {
  const text = criteriaListText();
  assert.match(text, /1\.1\.1/);
  assert.match(text, /Contenido no textual/);
  assert.doesNotMatch(text, /extended_22/);
});

test('criteriaListText incluye también los extendidos cuando includeExtended:true', () => {
  const text = criteriaListText(true);
  assert.match(text, /1\.1\.1/);
  assert.match(text, /extended_22/);
});

test('normalizeReportedFindings arma un finding completo a partir de un item válido', () => {
  const raw = [{ wcag_criterion: '1.4.3', severity: 'serious', failure_summary: 'Contraste insuficiente en botón primario', remediation_hint: 'Subir contraste a 4.5:1', element_sample: '<button>Enviar</button>' }];
  const findings = normalizeReportedFindings(raw, { url: 'https://a.test', source: 'visual_audit' });

  assert.equal(findings.length, 1);
  const finding = findings[0];
  assert.equal(finding.source, 'visual_audit');
  assert.equal(finding.wcag_criterion, '1.4.3');
  assert.equal(finding.wcag_level, 'AA');
  assert.equal(finding.onti_criterion, true);
  assert.equal(finding.in_scope, 'onti');
  assert.equal(finding.severity, 'serious');
  assert.equal(finding.review_status, 'confirmado');
  assert.deepEqual(finding.affected_urls, ['https://a.test']);
  assert.equal(finding.occurrences, 1);
  assert.equal(finding.rule_id, 'visual_audit:contraste-insuficiente-en-boton-primario');
  assert.ok(finding.id);
});

test('normalizeReportedFindings descarta items sin wcag_criterion reconocido (D7)', () => {
  const raw = [{ severity: 'moderate', failure_summary: 'Algo raro', remediation_hint: 'x' }];
  const findings = normalizeReportedFindings(raw, { url: 'https://a.test', source: 'ux_review' });
  assert.deepEqual(findings, []);
});

test('normalizeReportedFindings cae a severity "moderate" si el modelo devuelve un valor fuera de la enum', () => {
  const raw = [{ wcag_criterion: '1.1.1', severity: 'catastrófico', failure_summary: 'x', remediation_hint: 'y' }];
  const findings = normalizeReportedFindings(raw, { url: 'https://a.test', source: 'visual_audit' });
  assert.equal(findings[0].severity, 'moderate');
});

test('normalizeReportedFindings descarta un criterio extended_22 si includeExtended no está en true (gate de la config, D7)', () => {
  const raw = [{ wcag_criterion: '2.5.8', severity: 'moderate', failure_summary: 'Target chico', remediation_hint: 'Agrandar target' }];
  const findings = normalizeReportedFindings(raw, { url: 'https://a.test', source: 'visual_audit' });
  assert.deepEqual(findings, []);
});

test('normalizeReportedFindings acepta un criterio extended_22 con includeExtended:true', () => {
  const raw = [{ wcag_criterion: '2.5.8', severity: 'moderate', failure_summary: 'Target chico', remediation_hint: 'Agrandar target' }];
  const findings = normalizeReportedFindings(raw, { url: 'https://a.test', source: 'visual_audit', includeExtended: true });
  assert.equal(findings.length, 1);
  assert.equal(findings[0].in_scope, 'extended_22');
});
