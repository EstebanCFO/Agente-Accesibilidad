import { test } from 'node:test';
import assert from 'node:assert/strict';
import { countViolationsByImpact, isWcagViolation, buildWcagCard, buildBestPracticesCard, formatPageChecks, buildScoreCard, buildSeverityCard, buildKeyboardCard, buildUsageCard } from './demo-results.js';

test('countViolationsByImpact suma por severidad entre páginas e ignora impactos desconocidos', () => {
  const counts = countViolationsByImpact([
    { violations: [{ impact: 'critical', tags: ['wcag2a'] }, { impact: 'minor', tags: ['wcag2aa'] }] },
    { violations: [{ impact: 'critical', tags: ['wcag2a'] }, { impact: null, tags: ['wcag2a'] }] },
    {}
  ]);
  assert.deepEqual(counts, { critical: 2, serious: 0, moderate: 0, minor: 1 });
});

test('buildScoreCard muestra X/Y, porcentaje y conformidad con el umbral efectivo', () => {
  const card = buildScoreCard({
    onti_criteria_compliant: 27, onti_criteria_evaluated: 38, onti_compliance_percentage: 71.05,
    onti_conformance: false, conformance_threshold: 30, effective_conformance_threshold: 30
  });
  assert.equal(card.value, '27/38');
  assert.match(card.detail, /71\.05% · No conforme \(mín\. 30\)/);
  assert.equal(card.tone, 'bad');
  assert.deepEqual(card.ring, { pct: 71.05, tone: 'bad' });
});

test('buildScoreCard marca ok cuando es conforme', () => {
  const card = buildScoreCard({
    onti_criteria_compliant: 33, onti_criteria_evaluated: 35, onti_compliance_percentage: 94.29,
    onti_conformance: true, conformance_threshold: 30, effective_conformance_threshold: 28
  });
  assert.equal(card.tone, 'ok');
  assert.match(card.detail, /mín\. 28/);
});

test('buildScoreCard sin summary devuelve null', () => {
  assert.equal(buildScoreCard(undefined), null);
});

test('countViolationsByImpact cuenta solo WCAG 2.0 (BCRA) por default: ignora 2.1/2.2 y best-practice', () => {
  const counts = countViolationsByImpact([
    { violations: [
      { impact: 'critical', tags: ['wcag2a', 'wcag111'] },
      { impact: 'serious', tags: ['wcag2aa', 'wcag143'] },
      { impact: 'serious', tags: ['wcag22aa', 'wcag258'] },
      { impact: 'moderate', tags: ['best-practice'] }
    ] }
  ]);
  assert.deepEqual(counts, { critical: 1, serious: 1, moderate: 0, minor: 0 });
});

test('countViolationsByImpact con includeExtended suma WCAG 2.1/2.2 pero no best-practice', () => {
  const counts = countViolationsByImpact([
    { violations: [
      { impact: 'critical', tags: ['wcag2a'] },
      { impact: 'serious', tags: ['wcag21aa'] },
      { impact: 'serious', tags: ['wcag22aa'] },
      { impact: 'moderate', tags: ['best-practice'] }
    ] }
  ], { includeExtended: true });
  assert.deepEqual(counts, { critical: 1, serious: 2, moderate: 0, minor: 0 });
});

test('buildSeverityCard rotula WCAG 2.0 (BCRA) o WCAG 2.0 + 2.2 según la selección', () => {
  assert.equal(buildSeverityCard({ critical: 1 }).label, 'Problemas WCAG 2.0 (BCRA)');
  assert.equal(buildSeverityCard({ critical: 1 }, { includeExtended: true }).label, 'Problemas WCAG 2.0 (BCRA) + 2.2');
});

test('buildSeverityCard totaliza y desglosa', () => {
  const card = buildSeverityCard({ critical: 1, serious: 2, moderate: 3, minor: 0 });
  assert.equal(card.value, '6');
  assert.deepEqual(card.breakdown.map((b) => b.value), [1, 2, 3, 0]);
});

test('buildUsageCard muestra tokens totales, costo en US$ y cantidad de llamadas', () => {
  const card = buildUsageCard({ calls: 4, inputTokens: 10000, outputTokens: 2000, cacheWriteTokens: 1500, cacheReadTokens: 500 }, 0.0452);
  assert.equal(card.key, 'usage');
  assert.equal(card.value, '14.000 tokens');
  assert.equal(card.detail, '≈ US$ 0,0452 · 4 llamada(s)');
  assert.match(card.title, /Entrada 10\.000 · salida 2\.000 · caché 2\.000/);
});

test('buildUsageCard sin precio conocido lo indica en vez de mostrar 0', () => {
  assert.match(buildUsageCard({ calls: 1, inputTokens: 1, outputTokens: 1, cacheWriteTokens: 0, cacheReadTokens: 0 }, null).detail, /costo s\/d/);
});

test('isWcagViolation: WCAG 2.0 siempre, 2.1/2.2 solo con includeExtended, best-practice nunca', () => {
  assert.equal(isWcagViolation({ tags: ['wcag2a'] }), true);
  assert.equal(isWcagViolation({ tags: ['wcag22aa'] }), false);
  assert.equal(isWcagViolation({ tags: ['wcag22aa'] }, { includeExtended: true }), true);
  assert.equal(isWcagViolation({ tags: ['best-practice'] }, { includeExtended: true }), false);
});

test('buildWcagCard muestra OK/NOK/A validar sobre el total, sin veredicto', () => {
  const card = buildWcagCard({ total: 38, ok: 22, nok: 5, a_validar: 11, no_aplica: 0 });
  assert.equal(card.key, 'wcag');
  assert.equal(card.label, 'Compliance WCAG 2.0 (BCRA)');
  assert.equal(card.value, '22 OK · 5 NOK');
  assert.equal(card.detail, '11 a validar (de 38)');
  assert.doesNotMatch(JSON.stringify(card), /Conforme|No conforme/);
  assert.deepEqual(card.ring, { pct: 71.05, tone: 'warn' });
});

test('buildWcagCard rotula + 2.2 y aclara los No aplica', () => {
  const card = buildWcagCard({ total: 54, ok: 30, nok: 4, a_validar: 20, no_aplica: 2 }, { includeExtended: true });
  assert.equal(card.label, 'Compliance WCAG 2.0 (BCRA) + 2.2');
  assert.equal(card.detail, '20 a validar (de 54) · 2 no aplican');
});

test('buildBestPracticesCard muestra puntaje ponderado y conteos', () => {
  const card = buildBestPracticesCard({ score: 82.5, cumple: 18, mejora: 6, no_aplica: 11 });
  assert.equal(card.key, 'best-practices');
  assert.equal(card.label, 'Buenas prácticas (complementario)');
  assert.equal(card.value, '82,5%');
  assert.equal(card.detail, '18 cumplen · 6 a mejorar · 11 no aplican');
});

test('buildBestPracticesCard sin reglas aplicables muestra guion, no 0% ni NaN', () => {
  const card = buildBestPracticesCard({ score: null, cumple: 0, mejora: 0, no_aplica: 3 });
  assert.equal(card.value, '—');
});

test('formatPageChecks distingue reglas WCAG, criterios y buenas prácticas', () => {
  const text = formatPageChecks({
    wcag: { fail: 3, review: 1, pass: 30, inapplicable: 30, criteria_with_pass: 12 },
    best_practice: { fail: 1, review: 0, pass: 16, inapplicable: 10 }
  });
  assert.equal(text, 'WCAG — 3 reglas con problemas, 1 a revisar, 30 aprobadas (12 criterios con verificación) · Buenas prácticas — 1 a mejorar, 16 cumplen');
});

test('formatPageChecks usa singular con una sola regla o criterio', () => {
  const text = formatPageChecks({
    wcag: { fail: 1, review: 0, pass: 1, inapplicable: 0, criteria_with_pass: 1 },
    best_practice: { fail: 0, review: 0, pass: 1, inapplicable: 0 }
  });
  assert.equal(text, 'WCAG — 1 regla con problemas, 0 a revisar, 1 aprobada (1 criterio con verificación) · Buenas prácticas — 0 a mejorar, 1 cumple');
});

test('las tarjetas usan singular cuando corresponde', () => {
  assert.equal(buildWcagCard({ total: 37, ok: 8, nok: 5, a_validar: 24, no_aplica: 1 }).detail, '24 a validar (de 37) · 1 no aplica');
  assert.equal(buildBestPracticesCard({ score: 50, cumple: 1, mejora: 1, no_aplica: 1 }).detail, '1 cumple · 1 a mejorar · 1 no aplica');
});

test('buildKeyboardCard muestra el puntaje y los conteos con/sin indicios', () => {
  const card = buildKeyboardCard({ score: 75, sin_indicios: 12, con_indicios: 4, no_evaluable: 0 });
  assert.equal(card.key, 'keyboard');
  assert.equal(card.label, 'Pruebas de teclado del Agente (complementario)');
  assert.equal(card.value, '75%');
  assert.equal(card.detail, '4 con indicios · 12 sin indicios');
});

test('buildKeyboardCard aclara las no evaluables y muestra guion sin pares evaluables', () => {
  assert.equal(buildKeyboardCard({ score: 50, sin_indicios: 1, con_indicios: 1, no_evaluable: 4 }).detail, '1 con indicios · 1 sin indicios · 4 no evaluables');
  assert.equal(buildKeyboardCard({ score: null, sin_indicios: 0, con_indicios: 0, no_evaluable: 4 }).value, '—');
});

test('buildKeyboardCard indica En curso mientras falta alguna página', () => {
  const card = buildKeyboardCard({ score: 100, sin_indicios: 4, con_indicios: 0, no_evaluable: 0 }, { pending: 2 });
  assert.match(card.detail, /2 página\(s\) en curso/);
});
