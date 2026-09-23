import { test } from 'node:test';
import assert from 'node:assert/strict';
import { classifyFindings } from './classify-findings.js';

function axeResult(url, violations) {
  return { url, violations };
}

function violation(id, tags, impact, nodeCount, overrides = {}) {
  return {
    id,
    impact,
    tags,
    help: `help de ${id}`,
    help_url: `https://dequeuniversity.com/rules/axe/4.13/${id}`,
    node_count: nodeCount,
    nodes: Array.from({ length: nodeCount }, (_, i) => ({
      target: [`#el-${i}`],
      html: `<div id="el-${i}"></div>`,
      failure_summary: `Fix: ${id}`
    })),
    ...overrides
  };
}

test('classifyFindings agrupa un hallazgo por criterio ONTI y suma occurrences entre URLs', () => {
  const axeResults = [
    axeResult('https://a.test', [violation('image-alt', ['wcag2a', 'wcag111'], 'critical', 3)]),
    axeResult('https://b.test', [violation('image-alt', ['wcag2a', 'wcag111'], 'critical', 2)])
  ];

  const { total_findings, findings } = classifyFindings(axeResults);

  assert.equal(total_findings, 1);
  const finding = findings[0];
  assert.equal(finding.wcag_criterion, '1.1.1');
  assert.equal(finding.wcag_level, 'A');
  assert.equal(finding.onti_criterion, true);
  assert.equal(finding.in_scope, 'onti');
  assert.equal(finding.rule_id, 'image-alt');
  assert.equal(finding.severity, 'critical');
  assert.equal(finding.occurrences, 5);
  assert.deepEqual(finding.affected_urls.sort(), ['https://a.test', 'https://b.test']);
  assert.ok(finding.element_sample.includes('<div'));
  assert.ok(finding.id);
});

test('classifyFindings explota un rule_id que toca dos criterios ONTI en dos findings separados', () => {
  const axeResults = [axeResult('https://a.test', [violation('link-name', ['wcag2a', 'wcag244', 'wcag412'], 'serious', 4)])];

  const { total_findings, findings } = classifyFindings(axeResults);

  assert.equal(total_findings, 2);
  const criteria = findings.map((f) => f.wcag_criterion).sort();
  assert.deepEqual(criteria, ['2.4.4', '4.1.2']);
  for (const finding of findings) {
    assert.equal(finding.rule_id, 'link-name');
    assert.equal(finding.occurrences, 4);
  }
});

test('classifyFindings descarta hallazgos best-practice sin criterio WCAG (fuera de scope)', () => {
  const axeResults = [axeResult('https://a.test', [violation('region', ['cat.semantics', 'best-practice'], 'moderate', 1)])];
  const { total_findings, findings } = classifyFindings(axeResults);
  assert.equal(total_findings, 0);
  assert.deepEqual(findings, []);
});

test('classifyFindings descarta la capa extendida cuando includeExtended=false (decisión D7)', () => {
  const axeResults = [axeResult('https://a.test', [violation('target-size', ['wcag22aa', 'wcag258'], 'moderate', 1)])];

  assert.equal(classifyFindings(axeResults).total_findings, 0);

  const { total_findings, findings } = classifyFindings(axeResults, { includeExtended: true });
  assert.equal(total_findings, 1);
  assert.equal(findings[0].in_scope, 'extended_22');
  assert.equal(findings[0].onti_criterion, false);
});

test('classifyFindings se queda con la severidad más grave cuando difiere entre URLs', () => {
  const axeResults = [
    axeResult('https://a.test', [violation('color-contrast', ['wcag2aa', 'wcag143'], 'serious', 1)]),
    axeResult('https://b.test', [violation('color-contrast', ['wcag2aa', 'wcag143'], 'minor', 1)])
  ];
  const { findings } = classifyFindings(axeResults);
  assert.equal(findings[0].severity, 'serious');
});

test('classifyFindings ignora resultados de scan_batch que quedaron con error', () => {
  const axeResults = [
    { url: 'https://roto.test', error: { type: 'timeout', message: 'timeout' } },
    axeResult('https://a.test', [violation('html-has-lang', ['wcag2a', 'wcag311'], 'serious', 1)])
  ];
  const { total_findings, findings } = classifyFindings(axeResults);
  assert.equal(total_findings, 1);
  assert.equal(findings[0].wcag_criterion, '3.1.1');
});

test('classifyFindings con lista vacía devuelve cero hallazgos', () => {
  assert.deepEqual(classifyFindings([]), { total_findings: 0, findings: [] });
});

test('classifyFindings marca review_status:"confirmado" en findings de violations', () => {
  const axeResults = [axeResult('https://a.test', [violation('image-alt', ['wcag2a', 'wcag111'], 'critical', 1)])];
  const { findings } = classifyFindings(axeResults);
  assert.equal(findings[0].review_status, 'confirmado');
});

test('classifyFindings procesa incomplete[] y marca review_status:"requiere_revision"', () => {
  const axeResults = [{
    url: 'https://a.test',
    violations: [],
    incomplete: [violation('color-contrast', ['wcag2aa', 'wcag143'], 'serious', 1)]
  }];
  const { total_findings, findings } = classifyFindings(axeResults);
  assert.equal(total_findings, 1);
  assert.equal(findings[0].wcag_criterion, '1.4.3');
  assert.equal(findings[0].review_status, 'requiere_revision');
  assert.equal(findings[0].rule_id, 'color-contrast');
});

test('classifyFindings: si el mismo criterio+regla aparece confirmado en una URL e incompleto en otra, gana "confirmado"', () => {
  const axeResults = [
    { url: 'https://a.test', violations: [], incomplete: [violation('color-contrast', ['wcag2aa', 'wcag143'], 'serious', 1)] },
    { url: 'https://b.test', violations: [violation('color-contrast', ['wcag2aa', 'wcag143'], 'serious', 1)], incomplete: [] }
  ];
  const { findings } = classifyFindings(axeResults);
  assert.equal(findings.length, 1);
  assert.equal(findings[0].review_status, 'confirmado');
  assert.deepEqual(findings[0].affected_urls.sort(), ['https://a.test', 'https://b.test']);
});
