# Capturar incomplete/inapplicable de axe-core → parcialmente_conforme/no_aplica Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Dejar de descartar `incomplete[]`/`passes[]`/`inapplicable[]` de axe-core (hoy solo se cuenta `violation_count`/`pass_count`/`incomplete_count`, se pierde el detalle) para que la Matriz de Criticidad pueda emitir sus 4 estados reales: `conforme` / `no_conforme` / `parcialmente_conforme` / `no_aplica`.

**Architecture:** `scanner.js` captura las 4 categorías completas de axe-core. `classify-findings.js` procesa tanto `violations` (review_status:'confirmado') como `incomplete` (review_status:'requiere_revision') con la misma lógica de agrupación que ya usa. Un módulo nuevo (`na-criteria.js`) determina qué criterios ONTI/extendidos nunca tuvieron contenido aplicable en ninguna URL escaneada, cruzando las 4 categorías. `calculate-score.js` usa ese módulo para ajustar el denominador del umbral regulatorio quando hay criterios N/A. `matriz-deliverable.js` usa `review_status` + la lista de N/A para las 4 celdas.

**Tech Stack:** Node.js ESM, `node:test` + `node:assert/strict`, axe-core 4.13.0 (ya dependencia, verificado su formato real de `incomplete`/`inapplicable` antes de escribir este plan).

**Spec:** `docs/superpowers/specs/2026-09-22-incomplete-inapplicable-design.md` — leé ese archivo completo antes de empezar, tiene el contexto de por qué el N/A automático solo funciona para criterios donde axe-core realmente tiene reglas (no para los 5 criterios de audio/video en general, solo 1.2.1 y 1.2.2).

## Global Constraints

- **Un criterio con solo `incomplete` (sin violación real) cuenta como NO conforme** para el umbral ≥30/38 — decisión ya confirmada con el usuario, mismo criterio "el agente nunca asume éxito" del resto del proyecto.
- **Un criterio N/A se resta del denominador** del umbral (proporcional, ej. 3 N/A → umbral escala de 30/38 a ~28/35) — decisión ya confirmada, criterio estándar de auditorías WCAG.
- Un criterio es N/A **solo si TODAS sus reglas de axe-core conocidas fueron `inapplicable` en TODAS las URLs donde aparecieron** — nunca una violación, nunca un pase, nunca un incomplete en ningún lado. Si axe-core nunca tiene ninguna regla para ese criterio (nunca aparece en ninguna categoría, en ninguna URL), **no** se marca N/A.
- Reusar `extractWcagCriteria`/`classifyByWcagTags`/`lookupOntiCriterion`/`lookupExtendedCriterion` ya exportados desde `src/classification/wcag-map.js` — no reimplementar el mapeo tag→criterio.
- La capa extendida (`extended_22`) **no** recibe este ajuste de denominador N/A en `calculate-score.js` — no tiene umbral regulatorio propio, fuera de alcance de este plan.
- `randomUUID` viene de `node:crypto` (patrón ya establecido en `classify-findings.js`/`report-findings-schema.js`).

---

## Task 1: `scanner.js` captura incomplete/passes/inapplicable completos

**Files:**
- Modify: `src/scanner.js`
- Modify: `src/scanner.test.js`

**Interfaces:**
- Produces: `toAxeResult(url, results, extras)` ahora agrega `incomplete[]` (misma forma que `violations[]`), `passes[]` (`{id, tags}`), `inapplicable[]` (`{id, tags}`) al objeto devuelto por `scanUrl`/`scanBatch`. `violation_count`/`pass_count`/`incomplete_count` no cambian.

- [ ] **Step 1: Escribir el test que falla**

Agregar al final de `src/scanner.test.js`:

```javascript
test('scanUrl captura incomplete[], passes[] e inapplicable[] con su forma completa', async () => {
  const result = await scanUrl({ url: 'https://example.com' });

  assert.ok(Array.isArray(result.incomplete));
  assert.ok(Array.isArray(result.passes));
  assert.ok(Array.isArray(result.inapplicable));
  assert.ok(result.passes.length > 0, 'example.com tiene reglas que pasan');
  assert.ok(result.inapplicable.length > 0, 'example.com tiene reglas que no aplican (ej. sin <video>)');

  const somePass = result.passes[0];
  assert.ok(typeof somePass.id === 'string');
  assert.ok(Array.isArray(somePass.tags));

  const someInapplicable = result.inapplicable[0];
  assert.ok(typeof someInapplicable.id === 'string');
  assert.ok(Array.isArray(someInapplicable.tags));
});
```

- [ ] **Step 2: Correr el test y confirmar que falla**

Run: `node --test src/scanner.test.js`
Expected: FAIL — `result.incomplete`/`result.passes`/`result.inapplicable` son `undefined`.

- [ ] **Step 3: Implementar la captura en `scanner.js`**

Reemplazar la función `toAxeResult` completa por:

```javascript
function toAxeResult(url, results, extras = {}) {
  const base = {
    url,
    scanned_at: new Date().toISOString(),
    violation_count: results.violations.length,
    pass_count: results.passes.length,
    incomplete_count: results.incomplete.length,
    violations: results.violations.map((violation) => ({
      id: violation.id,
      impact: violation.impact,
      tags: violation.tags,
      help: violation.help,
      help_url: violation.helpUrl,
      node_count: violation.nodes.length,
      nodes: violation.nodes.map((node) => ({
        target: node.target,
        html: node.html,
        failure_summary: node.failureSummary
      }))
    })),
    incomplete: results.incomplete.map((item) => ({
      id: item.id,
      impact: item.impact,
      tags: item.tags,
      help: item.help,
      help_url: item.helpUrl,
      node_count: item.nodes.length,
      nodes: item.nodes.map((node) => ({
        target: node.target,
        html: node.html,
        failure_summary: node.failureSummary
      }))
    })),
    passes: results.passes.map((item) => ({ id: item.id, tags: item.tags })),
    inapplicable: results.inapplicable.map((item) => ({ id: item.id, tags: item.tags }))
  };
  if (extras.screenshot) base.screenshot = extras.screenshot;
  if (extras.html) base.html = extras.html;
  return base;
}
```

- [ ] **Step 4: Correr el test y confirmar que pasa**

Run: `node --test src/scanner.test.js`
Expected: todos los tests de `scanner.test.js` (viejos y nuevos) PASAN.

- [ ] **Step 5: Commit**

```bash
git add src/scanner.js src/scanner.test.js
git commit -m "feat: capture axe-core incomplete/passes/inapplicable in full"
```

---

## Task 2: `na-criteria.js` — determinar qué criterios son N/A

**Files:**
- Create: `src/classification/na-criteria.js`
- Create: `src/classification/na-criteria.test.js`

**Interfaces:**
- Consumes: `ontiCriteria`, `extendedCriteria`, `extractWcagCriteria` desde `./wcag-map.js` (ya existen).
- Produces: `computeNaCriteria(axeResults, {includeExtended})` → array de strings `wcag_criterion`. Usado por Task 5 (`calculate-score.js`) y Task 6 (`generate-deliverable.js`).

- [ ] **Step 1: Escribir el test que falla**

Crear `src/classification/na-criteria.test.js`:

```javascript
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { computeNaCriteria } from './na-criteria.js';

test('computeNaCriteria marca un criterio N/A cuando su única regla es inapplicable en todas las URLs', () => {
  const axeResults = [
    { url: 'https://a.test', violations: [], incomplete: [], passes: [], inapplicable: [{ id: 'video-caption', tags: ['wcag2a', 'wcag122'] }] },
    { url: 'https://b.test', violations: [], incomplete: [], passes: [], inapplicable: [{ id: 'video-caption', tags: ['wcag2a', 'wcag122'] }] }
  ];
  const naCriteria = computeNaCriteria(axeResults);
  assert.ok(naCriteria.includes('1.2.2'));
});

test('computeNaCriteria no marca N/A si la regla fue aplicable (pasó) en alguna URL', () => {
  const axeResults = [
    { url: 'https://a.test', violations: [], incomplete: [], passes: [{ id: 'video-caption', tags: ['wcag2a', 'wcag122'] }], inapplicable: [] },
    { url: 'https://b.test', violations: [], incomplete: [], passes: [], inapplicable: [{ id: 'video-caption', tags: ['wcag2a', 'wcag122'] }] }
  ];
  const naCriteria = computeNaCriteria(axeResults);
  assert.ok(!naCriteria.includes('1.2.2'));
});

test('computeNaCriteria no marca N/A si hubo una violación real en algún lado', () => {
  const axeResults = [
    { url: 'https://a.test', violations: [{ id: 'video-caption', tags: ['wcag2a', 'wcag122'] }], incomplete: [], passes: [], inapplicable: [] }
  ];
  const naCriteria = computeNaCriteria(axeResults);
  assert.ok(!naCriteria.includes('1.2.2'));
});

test('computeNaCriteria no marca N/A si hubo un "incomplete" en algún lado (la regla sí encontró contenido)', () => {
  const axeResults = [
    { url: 'https://a.test', violations: [], incomplete: [{ id: 'video-caption', tags: ['wcag2a', 'wcag122'] }], passes: [], inapplicable: [] }
  ];
  const naCriteria = computeNaCriteria(axeResults);
  assert.ok(!naCriteria.includes('1.2.2'));
});

test('computeNaCriteria no marca N/A un criterio que axe-core nunca evalúa (sin reglas propias, ej. 1.2.3)', () => {
  const axeResults = [
    { url: 'https://a.test', violations: [], incomplete: [], passes: [], inapplicable: [] }
  ];
  const naCriteria = computeNaCriteria(axeResults);
  assert.ok(!naCriteria.includes('1.2.3'));
});

test('computeNaCriteria incluye criterios de la capa extendida solo cuando includeExtended:true', () => {
  const axeResults = [
    { url: 'https://a.test', violations: [], incomplete: [], passes: [], inapplicable: [{ id: 'target-size', tags: ['wcag22aa', 'wcag258'] }] }
  ];
  const sinExtendida = computeNaCriteria(axeResults, { includeExtended: false });
  assert.ok(!sinExtendida.includes('2.5.8'));

  const conExtendida = computeNaCriteria(axeResults, { includeExtended: true });
  assert.ok(conExtendida.includes('2.5.8'));
});

test('computeNaCriteria con lista vacía o resultados con error no rompe y devuelve []', () => {
  assert.deepEqual(computeNaCriteria([]), []);
  assert.deepEqual(computeNaCriteria([{ url: 'https://roto.test', error: { type: 'timeout' } }]), []);
  assert.deepEqual(computeNaCriteria(undefined), []);
});
```

- [ ] **Step 2: Correr el test y confirmar que falla**

Run: `node --test src/classification/na-criteria.test.js`
Expected: FAIL con `Cannot find module './na-criteria.js'`.

- [ ] **Step 3: Implementar `na-criteria.js`**

```javascript
import { ontiCriteria, extendedCriteria, extractWcagCriteria } from './wcag-map.js';

/**
 * Determina qué criterios ONTI (+ extendidos si includeExtended) son N/A para el canal
 * completo: un criterio es N/A solo si TODAS las reglas de axe-core que lo tocan resultaron
 * "inapplicable" en TODAS las URLs donde aparecieron - nunca generaron ni una violación, ni
 * un pase, ni un incomplete en ningún lado. Si axe-core no tiene ninguna regla conocida para
 * ese criterio (nunca aparece en ninguna de las 4 categorías, en ninguna URL), NO se marca
 * N/A - se deja como limitación de cobertura ya documentada (ver docs/superpowers/specs/
 * 2026-09-22-incomplete-inapplicable-design.md), no se inventa una respuesta.
 */
export function computeNaCriteria(axeResults, { includeExtended = false } = {}) {
  const ruleTagsById = new Map();
  const ruleIdsEverApplicable = new Set();

  for (const result of axeResults || []) {
    if (!result || result.error) continue;

    for (const entry of result.violations || []) {
      ruleTagsById.set(entry.id, entry.tags);
      ruleIdsEverApplicable.add(entry.id);
    }
    for (const entry of result.incomplete || []) {
      ruleTagsById.set(entry.id, entry.tags);
      ruleIdsEverApplicable.add(entry.id);
    }
    for (const entry of result.passes || []) {
      ruleTagsById.set(entry.id, entry.tags);
      ruleIdsEverApplicable.add(entry.id);
    }
    for (const entry of result.inapplicable || []) {
      if (!ruleTagsById.has(entry.id)) ruleTagsById.set(entry.id, entry.tags);
    }
  }

  const criteria = includeExtended ? [...ontiCriteria, ...extendedCriteria] : ontiCriteria;
  const naCriteria = [];

  for (const criterion of criteria) {
    const rulesForCriterion = [...ruleTagsById.entries()]
      .filter(([, tags]) => extractWcagCriteria(tags).includes(criterion.wcag_criterion))
      .map(([ruleId]) => ruleId);

    if (rulesForCriterion.length > 0 && rulesForCriterion.every((ruleId) => !ruleIdsEverApplicable.has(ruleId))) {
      naCriteria.push(criterion.wcag_criterion);
    }
  }

  return naCriteria;
}
```

- [ ] **Step 4: Correr el test y confirmar que pasa**

Run: `node --test src/classification/na-criteria.test.js`
Expected: todos los tests PASAN.

- [ ] **Step 5: Commit**

```bash
git add src/classification/na-criteria.js src/classification/na-criteria.test.js
git commit -m "feat: add computeNaCriteria to derive N/A WCAG criteria from axe-core results"
```

---

## Task 3: `classify-findings.js` — `review_status` + procesar `incomplete`

**Files:**
- Modify: `src/classification/classify-findings.js`
- Modify: `src/classification/classify-findings.test.js`

**Interfaces:**
- Produces: cada finding de `classifyFindings` gana `review_status: 'confirmado' | 'requiere_revision'`. `'confirmado'` para findings derivados de `violations`, `'requiere_revision'` para los derivados de `incomplete`. Si el mismo `(criterio, rule_id)` aparece en ambas categorías (en cualquier URL), gana `'confirmado'` (peor caso).

- [ ] **Step 1: Escribir los tests que fallan**

Agregar al final de `src/classification/classify-findings.test.js`:

```javascript
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
```

- [ ] **Step 2: Correr los tests y confirmar que fallan**

Run: `node --test src/classification/classify-findings.test.js`
Expected: los 3 tests nuevos FALLAN — `review_status` es `undefined`, y el segundo test da `total_findings: 0` (no se procesa `incomplete` todavía).

- [ ] **Step 3: Implementar en `classify-findings.js`**

Reemplazar el archivo completo por:

```javascript
import { randomUUID } from 'node:crypto';
import { classifyByWcagTags } from './wcag-map.js';

const SEVERITY_RANK = { critical: 4, serious: 3, moderate: 2, minor: 1 };
const REVIEW_STATUS_RANK = { confirmado: 2, requiere_revision: 1 };

function worseSeverity(a, b) {
  return (SEVERITY_RANK[b] ?? 0) > (SEVERITY_RANK[a] ?? 0) ? b : a;
}

function worseReviewStatus(a, b) {
  return (REVIEW_STATUS_RANK[b] ?? 0) > (REVIEW_STATUS_RANK[a] ?? 0) ? b : a;
}

function matchedCriteria(classification) {
  return [
    ...classification.onti_criteria.map((criterion) => ({ criterion, in_scope: 'onti' })),
    ...classification.extended_criteria.map((criterion) => ({ criterion, in_scope: 'extended_22' }))
  ];
}

function findingKey(wcagCriterion, ruleId) {
  return `${wcagCriterion}::${ruleId}`;
}

function createFinding(entry, criterion, inScope, reviewStatus) {
  const firstNode = entry.nodes[0];
  return {
    id: randomUUID(),
    source: 'axe-core',
    wcag_criterion: criterion.wcag_criterion,
    wcag_level: criterion.level,
    wcag_description: criterion.description,
    onti_criterion: inScope === 'onti',
    in_scope: inScope,
    severity: entry.impact || 'minor',
    review_status: reviewStatus,
    rule_id: entry.id,
    affected_urls: [],
    occurrences: 0,
    element_sample: firstNode?.html ?? null,
    failure_summary: firstNode?.failure_summary ?? entry.help,
    remediation_hint: entry.help
  };
}

function processEntries(entries, axeResult, reviewStatus, includeExtended, findingsByKey) {
  for (const entry of entries || []) {
    const classification = classifyByWcagTags(entry.tags, { includeExtended });

    for (const { criterion, in_scope: inScope } of matchedCriteria(classification)) {
      const key = findingKey(criterion.wcag_criterion, entry.id);
      if (!findingsByKey.has(key)) {
        findingsByKey.set(key, createFinding(entry, criterion, inScope, reviewStatus));
      }

      const finding = findingsByKey.get(key);
      if (!finding.affected_urls.includes(axeResult.url)) {
        finding.affected_urls.push(axeResult.url);
      }
      finding.occurrences += entry.node_count;
      finding.severity = worseSeverity(finding.severity, entry.impact || 'minor');
      finding.review_status = worseReviewStatus(finding.review_status, reviewStatus);
    }
  }
}

/**
 * Deduplica y agrupa los axe_results[] de scan_url/scan_batch por (criterio WCAG, rule_id),
 * asignando severidad, y descarta lo que quede out_of_scope (decisión D7).
 *
 * Un mismo rule_id puede tocar más de un criterio a la vez (ej. link-name → 2.4.4 y 4.1.2):
 * cada criterio matcheado genera su propia fila, agregada por separado.
 *
 * Procesa tanto violations[] (review_status:'confirmado' - axe-core está seguro de que falla)
 * como incomplete[] (review_status:'requiere_revision' - axe-core no pudo determinar solo).
 * Si el mismo (criterio, rule_id) aparece confirmado en una URL e incompleto en otra, gana el
 * peor caso ('confirmado'), mismo patrón que ya usa worseSeverity.
 */
export function classifyFindings(axeResults, { includeExtended = false } = {}) {
  const findingsByKey = new Map();

  for (const axeResult of axeResults || []) {
    if (!axeResult || axeResult.error) continue;
    processEntries(axeResult.violations, axeResult, 'confirmado', includeExtended, findingsByKey);
    processEntries(axeResult.incomplete, axeResult, 'requiere_revision', includeExtended, findingsByKey);
  }

  const findings = [...findingsByKey.values()];
  return { total_findings: findings.length, findings };
}
```

- [ ] **Step 4: Correr los tests y confirmar que pasan**

Run: `node --test src/classification/classify-findings.test.js`
Expected: todos los tests (viejos y nuevos) PASAN. Los tests viejos siguen verdes porque sus fixtures no traen `incomplete` (queda `undefined`, `processEntries` lo trata como `[]`).

- [ ] **Step 5: Commit**

```bash
git add src/classification/classify-findings.js src/classification/classify-findings.test.js
git commit -m "feat: process axe-core incomplete[] into requiere_revision findings"
```

---

## Task 4: `report-findings-schema.js` — findings de IA siempre "confirmado"

**Files:**
- Modify: `src/visual-review/report-findings-schema.js`
- Modify: `src/visual-review/report-findings-schema.test.js`

**Interfaces:**
- Produces: cada finding de `normalizeReportedFindings` gana `review_status: 'confirmado'` (fijo — un hallazgo reportado por visual_audit/ux_compliance_review es una afirmación concreta del modelo, no un "no pude determinar").

- [ ] **Step 1: Escribir el test que falla**

En `src/visual-review/report-findings-schema.test.js`, en el test `'normalizeReportedFindings arma un finding completo a partir de un item válido'`, agregar esta línea junto a las demás aserciones (después de `assert.equal(finding.severity, 'serious');`):

```javascript
  assert.equal(finding.review_status, 'confirmado');
```

- [ ] **Step 2: Correr el test y confirmar que falla**

Run: `node --test src/visual-review/report-findings-schema.test.js`
Expected: FAIL — `finding.review_status` es `undefined`.

- [ ] **Step 3: Implementar en `report-findings-schema.js`**

En la función `normalizeReportedFindings`, en el objeto que se hace `push` a `findings`, agregar el campo `review_status: 'confirmado',` justo después de `severity,`:

```javascript
    findings.push({
      id: randomUUID(),
      source,
      wcag_criterion: criterion.wcag_criterion,
      wcag_level: criterion.level,
      wcag_description: criterion.description,
      onti_criterion: criterion.in_scope === 'onti',
      in_scope: criterion.in_scope,
      severity,
      review_status: 'confirmado',
      rule_id: `${source}:${slugify(failureSummary)}`,
      affected_urls: [url],
      occurrences: 1,
      element_sample: raw.element_sample ?? '',
      failure_summary: failureSummary,
      remediation_hint: raw.remediation_hint || ''
    });
```

- [ ] **Step 4: Correr el test y confirmar que pasa**

Run: `node --test src/visual-review/report-findings-schema.test.js`
Expected: todos los tests PASAN.

- [ ] **Step 5: Commit**

```bash
git add src/visual-review/report-findings-schema.js src/visual-review/report-findings-schema.test.js
git commit -m "feat: tag visual_audit/ux_compliance_review findings as review_status:confirmado"
```

---

## Task 5: `calculate-score.js` — denominador y umbral proporcional con N/A

**Files:**
- Modify: `src/classification/calculate-score.js`
- Modify: `src/classification/calculate-score.test.js`

**Interfaces:**
- Consumes: `computeNaCriteria` (Task 2).
- Produces: `calculateScore(...)` summary gana `onti_criteria_na` (cantidad de criterios N/A) y `effective_conformance_threshold` (umbral escalado). `onti_criteria_evaluated`, `onti_criteria_compliant`, `onti_compliance_percentage`, `score_level_a`, `score_level_aa`, y los `onti_compliance_percentage` de `by_url`/`by_module` pasan a calcularse sobre el denominador ajustado (38 menos los N/A). `conformance_threshold` (el valor de la norma, ej. 30) no cambia; `onti_conformance` ahora compara contra `effective_conformance_threshold`.

- [ ] **Step 1: Escribir los tests que fallan**

Agregar al final de `src/classification/calculate-score.test.js`:

```javascript
test('calculateScore: un criterio N/A se resta del denominador y el umbral escala proporcionalmente', () => {
  const axeResults = [
    { url: 'https://a.test', violation_count: 0, incomplete_count: 0, violations: [], incomplete: [], passes: [], inapplicable: [{ id: 'video-caption', tags: ['wcag2a', 'wcag122'] }] }
  ];
  const { summary } = calculateScore([], { axeResults });

  assert.equal(summary.onti_criteria_evaluated, 37);
  assert.equal(summary.onti_criteria_na, 1);
  assert.equal(summary.onti_criteria_compliant, 37);
  assert.equal(summary.onti_compliance_percentage, 100);
  assert.equal(summary.effective_conformance_threshold, Math.round((30 / 38) * 37));
  assert.equal(summary.onti_conformance, true);
});

test('calculateScore: sin criterios N/A, effective_conformance_threshold es igual a conformance_threshold', () => {
  const { summary } = calculateScore([]);
  assert.equal(summary.onti_criteria_na, 0);
  assert.equal(summary.effective_conformance_threshold, summary.conformance_threshold);
});

test('calculateScore: un finding con review_status:"requiere_revision" cuenta como no conforme igual que uno "confirmado"', () => {
  const findings = [{
    id: 'f1', wcag_criterion: '1.4.3', wcag_level: 'AA', onti_criterion: true, in_scope: 'onti',
    severity: 'serious', review_status: 'requiere_revision', rule_id: 'color-contrast',
    affected_urls: ['https://a.test'], occurrences: 1
  }];
  const { summary } = calculateScore(findings, { axeResults: [{ url: 'https://a.test', violation_count: 0, incomplete_count: 1 }] });
  assert.equal(summary.onti_criteria_compliant, 37);
});
```

- [ ] **Step 2: Correr los tests y confirmar que fallan**

Run: `node --test src/classification/calculate-score.test.js`
Expected: los 2 primeros tests nuevos FALLAN (`onti_criteria_na`/`effective_conformance_threshold` son `undefined`, `onti_criteria_evaluated` sigue en 38). El tercer test ya PASA hoy (no requiere cambios de código, es una regresión que confirma que `calculate-score.js` nunca necesitó mirar `review_status` — documentalo así en el reporte).

- [ ] **Step 3: Implementar en `calculate-score.js`**

Reemplazar el archivo completo por:

```javascript
import { ontiCriteria, extendedCriteria } from './wcag-map.js';
import { classifyModule } from './module-classifier.js';
import { computeNaCriteria } from './na-criteria.js';

function round2(n) {
  return Math.round(n * 100) / 100;
}

function percentage(compliant, total) {
  if (total === 0) return 0;
  return round2((compliant / total) * 100);
}

/**
 * Calcula compliance_scores (SPEC §8.1) a partir de classified_findings. axeResults es opcional
 * y se usa para: (1) saber qué URLs se escanearon de verdad (incluidas las 100% conformes, que
 * no generan ningún finding), (2) las cifras crudas de violations/incomplete por URL, y (3)
 * determinar qué criterios ONTI son N/A (computeNaCriteria) - sin él, no hay forma de saber que
 * un criterio nunca tuvo contenido aplicable en ningún lado.
 */
export function calculateScore(classifiedFindings, {
  axeResults = [],
  conformanceThreshold = 30,
  includeExtended = false
} = {}) {
  const findings = classifiedFindings || [];
  const ontiFindings = findings.filter((f) => f.in_scope === 'onti');
  const extendedFindings = findings.filter((f) => f.in_scope === 'extended_22');

  // Los criterios N/A del cuerpo ONTI se calculan siempre con includeExtended:false - la capa
  // extendida no tiene umbral regulatorio propio, no recibe este ajuste de denominador.
  const naOntiCriteria = computeNaCriteria(axeResults, { includeExtended: false });
  const naSet = new Set(naOntiCriteria);
  const evaluatedOntiCriteria = ontiCriteria.filter((c) => !naSet.has(c.wcag_criterion));

  const violatedOntiCriteria = new Set(ontiFindings.map((f) => f.wcag_criterion));
  const ontiCriteriaCompliant = evaluatedOntiCriteria.length - violatedOntiCriteria.size;

  const scoreForLevel = (level) => {
    const criteria = evaluatedOntiCriteria.filter((c) => c.level === level);
    const compliant = criteria.filter((c) => !violatedOntiCriteria.has(c.wcag_criterion)).length;
    return percentage(compliant, criteria.length);
  };

  const effectiveConformanceThreshold = evaluatedOntiCriteria.length === ontiCriteria.length
    ? conformanceThreshold
    : Math.round((conformanceThreshold / ontiCriteria.length) * evaluatedOntiCriteria.length);

  const scannedUrls = axeResults.length > 0
    ? [...new Set(axeResults.filter((r) => r && !r.error).map((r) => r.url))]
    : [...new Set(findings.flatMap((f) => f.affected_urls || []))];

  const axeResultByUrl = new Map(axeResults.filter((r) => r && !r.error).map((r) => [r.url, r]));

  const byUrl = scannedUrls.map((url) => {
    const axeResult = axeResultByUrl.get(url);
    const violatedForUrl = new Set(
      ontiFindings.filter((f) => (f.affected_urls || []).includes(url)).map((f) => f.wcag_criterion)
    );
    const compliantForUrl = evaluatedOntiCriteria.length - violatedForUrl.size;
    return {
      url,
      module: classifyModule(url),
      onti_compliance_percentage: percentage(compliantForUrl, evaluatedOntiCriteria.length),
      violations: axeResult?.violation_count ?? 0,
      incomplete: axeResult?.incomplete_count ?? 0
    };
  });

  const urlsByModule = new Map();
  for (const entry of byUrl) {
    if (!urlsByModule.has(entry.module)) urlsByModule.set(entry.module, []);
    urlsByModule.get(entry.module).push(entry);
  }

  const byModule = [...urlsByModule.entries()].map(([module, entries]) => {
    const moduleUrls = new Set(entries.map((e) => e.url));
    const violatedForModule = new Set(
      ontiFindings
        .filter((f) => (f.affected_urls || []).some((url) => moduleUrls.has(url)))
        .map((f) => f.wcag_criterion)
    );
    const compliantForModule = evaluatedOntiCriteria.length - violatedForModule.size;
    return {
      module,
      url_count: entries.length,
      onti_compliance_percentage: percentage(compliantForModule, evaluatedOntiCriteria.length),
      violations: entries.reduce((sum, e) => sum + e.violations, 0),
      incomplete: entries.reduce((sum, e) => sum + e.incomplete, 0)
    };
  });

  let extended22 = null;
  if (includeExtended) {
    const violatedExtended = new Set(extendedFindings.map((f) => f.wcag_criterion));
    const compliant = extendedCriteria.length - violatedExtended.size;
    extended22 = {
      criteria_evaluated: extendedCriteria.length,
      criteria_compliant: compliant,
      compliance_percentage: percentage(compliant, extendedCriteria.length),
      by_criterion: extendedCriteria.map((c) => ({
        wcag_criterion: c.wcag_criterion,
        level: c.level,
        source: c.source,
        description: c.description,
        compliant: !violatedExtended.has(c.wcag_criterion)
      }))
    };
  }

  return {
    summary: {
      total_urls_evaluated: scannedUrls.length,
      onti_criteria_evaluated: evaluatedOntiCriteria.length,
      onti_criteria_na: naSet.size,
      onti_criteria_compliant: ontiCriteriaCompliant,
      onti_compliance_percentage: percentage(ontiCriteriaCompliant, evaluatedOntiCriteria.length),
      onti_conformance: ontiCriteriaCompliant >= effectiveConformanceThreshold,
      conformance_threshold: conformanceThreshold,
      effective_conformance_threshold: effectiveConformanceThreshold,
      score_level_a: scoreForLevel('A'),
      score_level_aa: scoreForLevel('AA')
    },
    extended_22: extended22,
    by_url: byUrl,
    by_module: byModule
  };
}
```

Nota: `criteriaOfLevel` (la función vieja que filtraba `ontiCriteria` por nivel) se elimina — `scoreForLevel` ahora filtra directamente `evaluatedOntiCriteria` por nivel, que ya excluye los N/A.

- [ ] **Step 4: Correr los tests y confirmar que pasan**

Run: `node --test src/classification/calculate-score.test.js`
Expected: todos los tests (viejos y nuevos) PASAN. Los tests viejos siguen dando exactamente los mismos números porque sus fixtures de `axeResults` no traen `inapplicable`/`incomplete`/`passes` (computeNaCriteria devuelve `[]`, `evaluatedOntiCriteria.length === 38`, `effectiveConformanceThreshold === conformanceThreshold`).

- [ ] **Step 5: Correr la suite completa del repo**

Run: `npm test`
Expected: todos los tests PASAN, sin regresiones en otros archivos que consumen `calculateScore` (matriz/dashboard/generate-deliverable).

- [ ] **Step 6: Commit**

```bash
git add src/classification/calculate-score.js src/classification/calculate-score.test.js
git commit -m "feat: scale ONTI compliance denominator/threshold for N/A criteria"
```

---

## Task 6: `matriz-deliverable.js` — 4 estados de celda + wiring en `generate-deliverable.js`

**Files:**
- Modify: `src/reporter/matriz-deliverable.js`
- Modify: `src/reporter/matriz-deliverable.test.js`
- Modify: `src/reporter/generate-deliverable.js`
- Modify: `src/reporter/generate-deliverable.test.js`

**Interfaces:**
- Consumes: `computeNaCriteria` (Task 2), `review_status` en los findings (Task 3/4).
- Produces: `buildConformityMatrix`/`buildModuleConformityMatrix` ganan un parámetro opcional `naCriteria` (array de `wcag_criterion`, default `[]`) y las celdas pueden ser `conforme`/`no_conforme`/`parcialmente_conforme`/`no_aplica`. El builder `matriz` de `generate-deliverable.js` calcula `naCriteria` a partir de un nuevo campo opcional `data.axe_results`.

- [ ] **Step 1: Escribir los tests que fallan**

En `src/reporter/matriz-deliverable.test.js`, agregar al final:

```javascript
test('buildConformityMatrix marca parcialmente_conforme cuando el único finding tiene review_status:"requiere_revision"', () => {
  const findings = [finding({ review_status: 'requiere_revision', affected_urls: ['https://a.test'] })];
  const { rows } = buildConformityMatrix({ findings, urls: ['https://a.test', 'https://b.test'] });
  const criterio111 = rows.find((r) => r.wcag_criterion === '1.1.1');
  assert.equal(criterio111.cells['https://a.test'], 'parcialmente_conforme');
  assert.equal(criterio111.cells['https://b.test'], 'conforme');
});

test('buildConformityMatrix prioriza no_conforme sobre parcialmente_conforme para la misma celda', () => {
  const findings = [
    finding({ review_status: 'requiere_revision', rule_id: 'r1', affected_urls: ['https://a.test'] }),
    finding({ review_status: 'confirmado', rule_id: 'r2', affected_urls: ['https://a.test'] })
  ];
  const { rows } = buildConformityMatrix({ findings, urls: ['https://a.test'] });
  const criterio111 = rows.find((r) => r.wcag_criterion === '1.1.1');
  assert.equal(criterio111.cells['https://a.test'], 'no_conforme');
});

test('buildConformityMatrix marca no_aplica en toda la fila de un criterio listado en naCriteria', () => {
  const findings = [finding({ affected_urls: ['https://a.test'] })];
  const { rows } = buildConformityMatrix({ findings, urls: ['https://a.test', 'https://b.test'], naCriteria: ['1.1.1'] });
  const criterio111 = rows.find((r) => r.wcag_criterion === '1.1.1');
  assert.equal(criterio111.cells['https://a.test'], 'no_aplica');
  assert.equal(criterio111.cells['https://b.test'], 'no_aplica');
});

test('buildModuleConformityMatrix hereda parcialmente_conforme si ninguna URL del módulo tiene un finding confirmado', () => {
  const findings = [finding({ review_status: 'requiere_revision', affected_urls: ['https://a.test/home-banking/pago'] })];
  const urls = ['https://a.test/home-banking/pago', 'https://a.test/home-banking/transferencias'];
  const { rows } = buildModuleConformityMatrix({ findings, urls });
  const criterio111 = rows.find((r) => r.wcag_criterion === '1.1.1');
  assert.equal(criterio111.cells['home-banking'], 'parcialmente_conforme');
});

test('buildModuleConformityMatrix respeta naCriteria a nivel de módulo también', () => {
  const { rows } = buildModuleConformityMatrix({ findings: [], urls: ['https://a.test/home-banking/pago'], naCriteria: ['1.1.1'] });
  const criterio111 = rows.find((r) => r.wcag_criterion === '1.1.1');
  assert.equal(criterio111.cells['home-banking'], 'no_aplica');
});

test('buildMatrizHtml renderiza las etiquetas "Parcial" y "N/A" además de Conforme/No conforme', () => {
  const findings = [finding({ rule_id: 'r1', review_status: 'requiere_revision', wcag_criterion: '2.4.4', wcag_level: 'A', wcag_description: 'Propósito del enlace', affected_urls: ['https://a.test'] })];
  const conformity = buildConformityMatrix({ findings, urls: ['https://a.test'], naCriteria: ['1.2.2'] });
  const grid = buildSeverityImpactGrid([]);
  const html = buildMatrizHtml({ jobId: 'job-1', channel: 'home_banking', conformity, severityImpactGrid: grid });
  assert.match(html, /Parcial/);
  assert.match(html, /N\/A/);
});
```

En `src/reporter/generate-deliverable.test.js`, agregar al final (junto a los demás tests de `'matriz'`):

```javascript
test('generateDeliverable("matriz") marca no_aplica cuando se pasan axe_results con un criterio N/A', async () => {
  const outputDir = await mkdtemp(path.join(tmpdir(), 'f1-deliverable-'));
  const axeResults = [
    { url: 'https://a.test', violations: [], incomplete: [], passes: [], inapplicable: [{ id: 'video-caption', tags: ['wcag2a', 'wcag122'] }] }
  ];

  const filePaths = await generateDeliverable('matriz', {
    jobId: 'job-na', channel: 'home_banking', findings: [], urls: ['https://a.test'], axeResults
  }, { outputDir });

  const jsonPath = filePaths.find((p) => p.endsWith('.json'));
  const jsonDoc = JSON.parse(await readFile(jsonPath, 'utf8'));
  const criterio122 = jsonDoc.conformity_matrix.rows.find((r) => r.wcag_criterion === '1.2.2');
  assert.equal(criterio122.cells['https://a.test'], 'no_aplica');
});
```

- [ ] **Step 2: Correr los tests y confirmar que fallan**

Run: `node --test src/reporter/matriz-deliverable.test.js src/reporter/generate-deliverable.test.js`
Expected: los tests nuevos de `matriz-deliverable.test.js` FALLAN (siguen dando `conforme`/`no_conforme` solamente, `naCriteria` no existe como parámetro). El test nuevo de `generate-deliverable.test.js` falla porque `axeResults` no se usa todavía.

- [ ] **Step 3: Implementar en `matriz-deliverable.js`**

Agregar esta constante cerca de las otras constantes del archivo (después de `IMPACT_LABEL_ES`):

```javascript
const STATUS_LABEL_ES = { conforme: 'Conforme', no_conforme: 'No conforme', parcialmente_conforme: 'Parcial', no_aplica: 'N/A' };
```

Reemplazar `buildConformityMatrix` completa por:

```javascript
/**
 * Vista detallada de conformidad criterio × URL individual (complementa la vista por módulo
 * de `buildModuleConformityMatrix`). 4 estados por celda: 'no_aplica' si el criterio de esa
 * fila está en `naCriteria` (propiedad del criterio para todo el canal, no de una URL puntual);
 * si no, 'no_conforme' si hay un finding review_status:'confirmado' afectando esa URL;
 * si no, 'parcialmente_conforme' si hay uno review_status:'requiere_revision'; si no, 'conforme'.
 */
export function buildConformityMatrix({ findings, urls, includeExtended = false, naCriteria = [] }) {
  const naSet = new Set(naCriteria);
  const confirmed = new Set();
  const review = new Set();

  for (const finding of findings) {
    if (finding.in_scope !== 'onti' && !(includeExtended && finding.in_scope === 'extended_22')) continue;
    const target = (finding.review_status ?? 'confirmado') === 'confirmado' ? confirmed : review;
    for (const url of finding.affected_urls || []) {
      target.add(`${url}::${finding.wcag_criterion}`);
    }
  }

  const rows = taggedCriteria(includeExtended).map((criterion) => ({
    wcag_criterion: criterion.wcag_criterion,
    level: criterion.level,
    in_scope: criterion.in_scope,
    description: criterion.description,
    cells: Object.fromEntries(urls.map((url) => {
      if (naSet.has(criterion.wcag_criterion)) return [url, 'no_aplica'];
      const key = `${url}::${criterion.wcag_criterion}`;
      if (confirmed.has(key)) return [url, 'no_conforme'];
      if (review.has(key)) return [url, 'parcialmente_conforme'];
      return [url, 'conforme'];
    }))
  }));

  return { urls, rows };
}
```

Reemplazar `buildModuleConformityMatrix` completa por:

```javascript
/**
 * Vista adicional: mismo criterio de conformidad que `buildConformityMatrix`, pero agrupando
 * columnas por módulo (primer segmento de path, ver module-classifier.js) en vez de por URL
 * individual. Un módulo hereda el peor estado de cualquiera de sus URLs
 * (no_conforme > parcialmente_conforme > conforme), mismo criterio que ya usa calculate-score.js
 * para by_module. 'no_aplica' es una propiedad del criterio para todo el canal, no depende de
 * qué URLs caen en cada módulo.
 */
export function buildModuleConformityMatrix({ findings, urls, includeExtended = false, naCriteria = [] }) {
  const urlToModule = new Map(urls.map((url) => [url, classifyModule(url)]));
  const modules = [...new Set(urls.map((url) => urlToModule.get(url)))];
  const naSet = new Set(naCriteria);

  const confirmed = new Set();
  const review = new Set();

  for (const finding of findings) {
    if (finding.in_scope !== 'onti' && !(includeExtended && finding.in_scope === 'extended_22')) continue;
    const target = (finding.review_status ?? 'confirmado') === 'confirmado' ? confirmed : review;
    for (const url of finding.affected_urls || []) {
      const module = urlToModule.get(url) ?? classifyModule(url);
      target.add(`${module}::${finding.wcag_criterion}`);
    }
  }

  const rows = taggedCriteria(includeExtended).map((criterion) => ({
    wcag_criterion: criterion.wcag_criterion,
    level: criterion.level,
    in_scope: criterion.in_scope,
    description: criterion.description,
    cells: Object.fromEntries(modules.map((module) => {
      if (naSet.has(criterion.wcag_criterion)) return [module, 'no_aplica'];
      const key = `${module}::${criterion.wcag_criterion}`;
      if (confirmed.has(key)) return [module, 'no_conforme'];
      if (review.has(key)) return [module, 'parcialmente_conforme'];
      return [module, 'conforme'];
    }))
  }));

  return { modules, rows };
}
```

En `conformityTableHtml`, reemplazar la línea:
```javascript
      return `<td class="status-${status}">${status === 'conforme' ? 'Conforme' : 'No conforme'}</td>`;
```
por:
```javascript
      return `<td class="status-${status}">${STATUS_LABEL_ES[status] ?? status}</td>`;
```

En el bloque `<style>` de `buildMatrizHtml`, agregar estas dos líneas junto a las reglas `td.status-conforme`/`td.status-no_conforme` ya existentes:
```css
  td.status-parcialmente_conforme { background: #fff4e0; color: #8a5a00; }
  td.status-no_aplica { background: #eeeeee; color: #666; }
```

En `addConformitySheet` (para el XLSX), reemplazar la línea:
```javascript
      rowData[`col_${index}`] = row.cells[column] === 'conforme' ? 'Conforme' : 'No conforme';
```
por:
```javascript
      rowData[`col_${index}`] = STATUS_LABEL_ES[row.cells[column]] ?? row.cells[column];
```

- [ ] **Step 4: Implementar el wiring en `generate-deliverable.js`**

Agregar el import al inicio del archivo:
```javascript
import { computeNaCriteria } from '../classification/na-criteria.js';
```

En el builder `matriz`, reemplazar:
```javascript
    const includeExtended = data.includeExtended ?? false;
    const urls = data.urls || [];
    const conformity = buildConformityMatrix({ findings: data.findings, urls, includeExtended });
    const moduleConformity = buildModuleConformityMatrix({ findings: data.findings, urls, includeExtended });
```
por:
```javascript
    const includeExtended = data.includeExtended ?? false;
    const urls = data.urls || [];
    const naCriteria = computeNaCriteria(data.axeResults || [], { includeExtended: false });
    const conformity = buildConformityMatrix({ findings: data.findings, urls, includeExtended, naCriteria });
    const moduleConformity = buildModuleConformityMatrix({ findings: data.findings, urls, includeExtended, naCriteria });
```

- [ ] **Step 5: Correr los tests y confirmar que pasan**

Run: `node --test src/reporter/matriz-deliverable.test.js src/reporter/generate-deliverable.test.js`
Expected: todos los tests (viejos y nuevos) PASAN.

- [ ] **Step 6: Correr la suite completa del repo**

Run: `npm test`
Expected: todos los tests PASAN, sin regresiones (los tests viejos de `matriz-deliverable.test.js` no pasan `naCriteria`, así que sigue vacío por default y el comportamiento no cambia para ellos).

- [ ] **Step 7: Commit**

```bash
git add src/reporter/matriz-deliverable.js src/reporter/matriz-deliverable.test.js src/reporter/generate-deliverable.js src/reporter/generate-deliverable.test.js
git commit -m "feat: emit parcialmente_conforme/no_aplica in the conformity matrix"
```

---

## Nota final para quien ejecute este plan

Después de la Task 6, actualizar la memoria del proyecto marcando como resuelta la limitación "`matriz` nunca emite `parcialmente_conforme` ni `no_aplica`" — pero dejar documentado que el N/A automático solo cubre criterios donde axe-core tiene reglas propias (confirmado: solo 1.2.1 y 1.2.2 de los 5 criterios de audio/video), no una solución general a la cobertura de detección automática.
