# Plan A — Secciones WCAG y Buenas prácticas: implementación

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** calcular la Sección 1 (Compliance WCAG: OK / NOK / A validar / No aplica, sin veredicto) y la Sección 2 (Buenas prácticas con puntaje ponderado por impacto), y mostrarlas en dos tarjetas separadas del panel.

**Architecture:** dos módulos puros nuevos en `src/classification/` (`wcag-section.js`, `best-practices.js`) que se agregan de forma **aditiva** a la salida de `calculateScore` (`wcag_section`, `best_practices`). Los campos viejos (`onti_conformance`, umbral, porcentajes) **no se tocan en este plan**: los informes siguen funcionando y se migran en el Plan C. El scanner guarda el impacto de las reglas `best-practice` (que axe no devuelve en `passes`/`inapplicable`). El panel reemplaza la tarjeta "Cumplimiento ONTI" por "Compliance WCAG" y suma "Buenas prácticas".

**Tech Stack:** Node ≥20 ESM, `node:test` + `node:assert/strict`, Playwright + `@axe-core/playwright` 4.13.

**Spec:** `docs/superpowers/specs/2026-09-30-tres-secciones-teclado-design.md` (secciones "Sección 1" y "Sección 2"; el resto va en los Planes B y C).

**Planes hermanos:** B — pruebas de teclado (reemplaza visual/UX); C — informes, agente/config sin umbral, SPEC v0.4, retiro de campos viejos.

## Global Constraints

- "A validar" **nunca** cuenta como OK. La Sección 1 no emite veredicto ni porcentaje de cumplimiento.
- Normativa BCRA = WCAG 2.0 A/AA (38 criterios ONTI); con `includeExtended` se suman los 18 de `wcag-extended-22.json`.
- Las reglas `best-practice` nunca entran a la Sección 1 ni a la tarjeta "Problemas WCAG".
- Peso por impacto (Sección 2): `critical` 4 · `serious` 3 · `moderate` 2 · `minor` 1; impacto desconocido → 2.
- Sin dependencias nuevas. Textos de UI y nombres de tests en español.
- Cambio aditivo: ningún test existente de `calculate-score`, `generate-deliverable` o reporters debe romperse.
- Comandos de test: `node --test <archivo>`; suite completa `npm test`.

## Review Focus

1. **Criterio con violación en una página y `incomplete` en otra** → debe quedar **NOK** (la violación gana). Test en Task 1.
2. **Criterio N/A (`1.2.1`/`1.2.2` solo `inapplicable`) pero con un finding de axe** → no puede quedar "No aplica". Test en Task 1.
3. **Regla best-practice que falla en una página y pasa en otra** → "Mejora sugerida", no "Cumple". Test en Task 2.
4. **Sin ninguna regla best-practice aplicable** (todas `inapplicable` o ninguna escaneada) → puntaje `null`, y la tarjeta muestra "—", no `0%` ni `NaN%`. Tests en Tasks 2 y 5.
5. **Escaneo con `best-practice` agregado a los tags** → el log por página y el resaltado sobre la página deben seguir contando solo WCAG, no inflarse con buenas prácticas. Test en Task 5.

---

## File Structure

| Archivo | Responsabilidad |
|---|---|
| `src/classification/wcag-section.js` (nuevo) | Estado por criterio y conteo de la Sección 1 |
| `src/classification/best-practices.js` (nuevo) | Estado por regla best-practice y puntaje ponderado |
| `src/classification/calculate-score.js` | Suma `wcag_section` y `best_practices` a su salida (aditivo) |
| `src/scanner.js` | Guarda `rule_impacts` de las reglas best-practice |
| `scripts/demo-config.js` | Suma el tag `best-practice` al escaneo |
| `scripts/demo-results.js` | `isWcagViolation`, `buildWcagCard`, `buildBestPracticesCard` |
| `scripts/demo.js` | Usa las tarjetas nuevas; log y resaltado solo WCAG |

---

### Task 1: Sección 1 — estados por criterio WCAG

**Files:**
- Create: `src/classification/wcag-section.js`
- Test: `src/classification/wcag-section.test.js`

**Interfaces:**
- Consumes: `ontiCriteria`, `extendedCriteria`, `extractWcagCriteria` de `./wcag-map.js`; `computeNaCriteria` de `./na-criteria.js`; findings de `classifyFindings` (`{ wcag_criterion, in_scope, review_status: 'confirmado'|'requiere_revision', source }`).
- Produces: `computeWcagSection(findings, { axeResults, includeExtended }) → { total, ok, nok, a_validar, no_aplica, by_criterion: Array<{ wcag_criterion, level, description, in_scope: 'onti'|'extended_22', status: 'ok'|'nok'|'a_validar'|'no_aplica' }> }`. `total` = criterios en alcance menos `no_aplica`.

- [ ] **Step 1: Escribir los tests que fallan**

```js
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { computeWcagSection } from './wcag-section.js';

const pass = (id, tags) => ({ id, tags });
const page = (url, { passes = [], inapplicable = [] } = {}) => ({ url, violations: [], incomplete: [], passes, inapplicable });
const finding = (criterion, reviewStatus, inScope = 'onti') => ({ source: 'axe-core', wcag_criterion: criterion, in_scope: inScope, review_status: reviewStatus });
const statusOf = (section, criterion) => section.by_criterion.find((c) => c.wcag_criterion === criterion)?.status;

test('computeWcagSection: criterio con regla que pasó y sin hallazgos queda OK', () => {
  const section = computeWcagSection([], { axeResults: [page('https://a.test', { passes: [pass('image-alt', ['wcag2a', 'wcag111'])] })] });
  assert.equal(statusOf(section, '1.1.1'), 'ok');
});

test('computeWcagSection: una violación confirmada deja el criterio NOK', () => {
  const section = computeWcagSection([finding('1.4.3', 'confirmado')], { axeResults: [page('https://a.test')] });
  assert.equal(statusOf(section, '1.4.3'), 'nok');
});

test('computeWcagSection: violación en una página e incomplete en otra queda NOK', () => {
  const section = computeWcagSection(
    [finding('1.4.3', 'requiere_revision'), finding('1.4.3', 'confirmado')],
    { axeResults: [page('https://a.test'), page('https://b.test')] }
  );
  assert.equal(statusOf(section, '1.4.3'), 'nok');
});

test('computeWcagSection: solo incomplete (aunque otra regla del criterio pase) queda A validar', () => {
  const section = computeWcagSection([finding('1.4.3', 'requiere_revision')], {
    axeResults: [page('https://a.test', { passes: [pass('color-contrast', ['wcag2aa', 'wcag143'])] })]
  });
  assert.equal(statusOf(section, '1.4.3'), 'a_validar');
});

test('computeWcagSection: criterio sin ninguna regla evaluada queda A validar y no cuenta como OK', () => {
  const section = computeWcagSection([], { axeResults: [page('https://a.test')] });
  assert.equal(statusOf(section, '2.4.7'), 'a_validar');
  assert.equal(section.ok, 0);
  assert.equal(section.a_validar, 38);
});

test('computeWcagSection: 1.2.1 solo inapplicable queda No aplica y sale del total', () => {
  const section = computeWcagSection([], {
    axeResults: [page('https://a.test', { inapplicable: [pass('audio-caption', ['wcag2a', 'wcag121'])] })]
  });
  assert.equal(statusOf(section, '1.2.1'), 'no_aplica');
  assert.equal(section.no_aplica, 1);
  assert.equal(section.total, 37);
});

test('computeWcagSection: un finding real impide No aplica aunque axe lo marque inapplicable', () => {
  const section = computeWcagSection([finding('1.2.1', 'confirmado')], {
    axeResults: [page('https://a.test', { inapplicable: [pass('audio-caption', ['wcag2a', 'wcag121'])] })]
  });
  assert.equal(statusOf(section, '1.2.1'), 'nok');
});

test('computeWcagSection: los hallazgos complementarios no cambian ningún estado', () => {
  const section = computeWcagSection([{ ...finding('2.4.7', 'confirmado'), source: 'keyboard_review' }], { axeResults: [page('https://a.test')] });
  assert.equal(statusOf(section, '2.4.7'), 'a_validar');
});

test('computeWcagSection: sin includeExtended evalúa 38; con includeExtended suma los 18 de 2.1/2.2', () => {
  assert.equal(computeWcagSection([], { axeResults: [page('https://a.test')] }).by_criterion.length, 38);
  const extended = computeWcagSection([finding('2.5.8', 'confirmado', 'extended_22')], { axeResults: [page('https://a.test')], includeExtended: true });
  assert.equal(extended.by_criterion.length, 56);
  assert.equal(statusOf(extended, '2.5.8'), 'nok');
});

test('computeWcagSection: los conteos suman el total más los No aplica', () => {
  const section = computeWcagSection([finding('1.4.3', 'confirmado')], {
    axeResults: [page('https://a.test', { passes: [pass('image-alt', ['wcag2a', 'wcag111'])] })]
  });
  assert.equal(section.ok + section.nok + section.a_validar, section.total);
  assert.equal(section.total + section.no_aplica, 38);
});
```

- [ ] **Step 2: Correr y verificar que fallan**

Run: `node --test src/classification/wcag-section.test.js`
Expected: FAIL — `Cannot find module './wcag-section.js'`.

- [ ] **Step 3: Implementar**

```js
import { ontiCriteria, extendedCriteria, extractWcagCriteria } from './wcag-map.js';
import { computeNaCriteria } from './na-criteria.js';
import { splitFindings } from './finding-sources.js';

/**
 * Sección 1 del informe (Compliance WCAG). Estado por criterio, consolidado entre páginas:
 *   nok       - al menos una violación confirmada de axe-core;
 *   a_validar - algún incomplete sin violación, o ninguna regla automática evaluada (requiere
 *               tecnología asistiva o revisión manual). Nunca cuenta como OK;
 *   no_aplica - regla de na-criteria.js (solo inapplicable), sale del total;
 *   ok        - al menos una regla del criterio pasó y no hubo violación ni incomplete.
 * Sin veredicto ni porcentaje: el cumplimiento se decide después de la validación humana.
 * Solo axe-core participa: los hallazgos complementarios no cambian estados.
 */
export function computeWcagSection(findings, { axeResults = [], includeExtended = false } = {}) {
  const primary = splitFindings(findings || []).primary;
  const confirmed = new Set(primary.filter((f) => f.review_status === 'confirmado').map((f) => f.wcag_criterion));
  const toReview = new Set(primary.filter((f) => f.review_status === 'requiere_revision').map((f) => f.wcag_criterion));

  const passed = new Set();
  for (const result of axeResults || []) {
    if (!result || result.error) continue;
    for (const entry of result.passes || []) {
      for (const criterion of extractWcagCriteria(entry.tags)) passed.add(criterion);
    }
  }
  const naSet = new Set(computeNaCriteria(axeResults, { includeExtended }));

  const inScope = [
    ...ontiCriteria.map((c) => ({ ...c, in_scope: 'onti' })),
    ...(includeExtended ? extendedCriteria.map((c) => ({ ...c, in_scope: 'extended_22' })) : [])
  ];

  const byCriterion = inScope.map((c) => {
    const id = c.wcag_criterion;
    let status;
    if (confirmed.has(id)) status = 'nok';
    else if (toReview.has(id)) status = 'a_validar';
    else if (naSet.has(id)) status = 'no_aplica';
    else if (passed.has(id)) status = 'ok';
    else status = 'a_validar';
    return { wcag_criterion: id, level: c.level, description: c.description, in_scope: c.in_scope, status };
  });

  const count = (status) => byCriterion.filter((c) => c.status === status).length;
  const noAplica = count('no_aplica');
  return {
    total: byCriterion.length - noAplica,
    ok: count('ok'),
    nok: count('nok'),
    a_validar: count('a_validar'),
    no_aplica: noAplica,
    by_criterion: byCriterion
  };
}
```

- [ ] **Step 4: Correr y verificar que pasan**

Run: `node --test src/classification/wcag-section.test.js`
Expected: PASS (10 tests).

- [ ] **Step 5: Commit**

```bash
git add src/classification/wcag-section.js src/classification/wcag-section.test.js
git commit -m "feat: Sección 1 Compliance WCAG con estados OK/NOK/A validar/No aplica"
```

---

### Task 2: Sección 2 — buenas prácticas con puntaje ponderado

**Files:**
- Create: `src/classification/best-practices.js`
- Test: `src/classification/best-practices.test.js`

**Interfaces:**
- Consumes: `extractWcagCriteria` de `./wcag-map.js`; `axeResults[]` con `violations`/`incomplete` (`{ id, impact, tags, help, node_count }`), `passes`/`inapplicable` (`{ id, tags }`) y el nuevo `rule_impacts` (`{ [ruleId]: 'critical'|'serious'|'moderate'|'minor'|null }`, Task 4).
- Produces: `IMPACT_WEIGHT` y `computeBestPractices(axeResults) → { score: number|null, cumple, mejora, no_aplica, rules: Array<{ rule_id, help, impact, weight, status: 'cumple'|'mejora'|'no_aplica', affected_urls: string[] }> }`. `score` = porcentaje con 2 decimales, `null` si no hay reglas aplicables.

- [ ] **Step 1: Escribir los tests que fallan**

```js
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { computeBestPractices, IMPACT_WEIGHT } from './best-practices.js';

const BP = ['cat.keyboard', 'best-practice'];
const violation = (id, impact) => ({ id, impact, tags: BP, help: `ayuda ${id}`, node_count: 1 });
const rule = (id) => ({ id, tags: BP });
const page = (url, parts = {}) => ({ url, violations: [], incomplete: [], passes: [], inapplicable: [], rule_impacts: {}, ...parts });
const ruleOf = (bp, id) => bp.rules.find((r) => r.rule_id === id);

test('IMPACT_WEIGHT pondera crítico 4, serio 3, moderado 2, menor 1', () => {
  assert.deepEqual(IMPACT_WEIGHT, { critical: 4, serious: 3, moderate: 2, minor: 1 });
});

test('computeBestPractices: regla que pasa en todas las páginas cumple', () => {
  const bp = computeBestPractices([page('https://a.test', { passes: [rule('region')], rule_impacts: { region: 'moderate' } })]);
  assert.equal(ruleOf(bp, 'region').status, 'cumple');
  assert.equal(bp.score, 100);
});

test('computeBestPractices: falla en una página y pasa en otra es mejora sugerida', () => {
  const bp = computeBestPractices([
    page('https://a.test', { violations: [violation('region', 'moderate')] }),
    page('https://b.test', { passes: [rule('region')] })
  ]);
  assert.equal(ruleOf(bp, 'region').status, 'mejora');
  assert.deepEqual(ruleOf(bp, 'region').affected_urls, ['https://a.test']);
});

test('computeBestPractices: incomplete cuenta como mejora sugerida', () => {
  const bp = computeBestPractices([page('https://a.test', { incomplete: [violation('heading-order', 'moderate')] })]);
  assert.equal(ruleOf(bp, 'heading-order').status, 'mejora');
});

test('computeBestPractices: solo inapplicable no aplica y queda fuera del puntaje', () => {
  const bp = computeBestPractices([page('https://a.test', {
    inapplicable: [rule('skip-link')], passes: [rule('region')], rule_impacts: { region: 'moderate', 'skip-link': 'moderate' }
  })]);
  assert.equal(ruleOf(bp, 'skip-link').status, 'no_aplica');
  assert.equal(bp.no_aplica, 1);
  assert.equal(bp.score, 100);
});

test('computeBestPractices: el puntaje pondera por impacto', () => {
  // cumple: region (moderate=2); mejora: landmark-one-main (serious=3) → 2 / 5 = 40%
  const bp = computeBestPractices([page('https://a.test', {
    passes: [rule('region')], violations: [violation('landmark-one-main', 'serious')], rule_impacts: { region: 'moderate' }
  })]);
  assert.equal(bp.score, 40);
  assert.equal(bp.cumple, 1);
  assert.equal(bp.mejora, 1);
});

test('computeBestPractices: impacto desconocido pesa como moderado', () => {
  const bp = computeBestPractices([page('https://a.test', { passes: [rule('region')] })]);
  assert.equal(ruleOf(bp, 'region').weight, 2);
});

test('computeBestPractices: ignora reglas con criterio WCAG aunque tengan tag best-practice', () => {
  const bp = computeBestPractices([page('https://a.test', { violations: [{ ...violation('color-contrast', 'serious'), tags: ['wcag2aa', 'wcag143', 'best-practice'] }] })]);
  assert.equal(bp.rules.length, 0);
});

test('computeBestPractices: sin reglas aplicables el puntaje es null', () => {
  assert.equal(computeBestPractices([page('https://a.test', { inapplicable: [rule('skip-link')] })]).score, null);
  assert.equal(computeBestPractices([]).score, null);
});

test('computeBestPractices: ignora resultados con error', () => {
  assert.equal(computeBestPractices([{ url: 'https://x.test', error: { type: 'timeout' } }]).rules.length, 0);
});
```

- [ ] **Step 2: Correr y verificar que fallan**

Run: `node --test src/classification/best-practices.test.js`
Expected: FAIL — `Cannot find module './best-practices.js'`.

- [ ] **Step 3: Implementar**

```js
import { extractWcagCriteria } from './wcag-map.js';

export const IMPACT_WEIGHT = { critical: 4, serious: 3, moderate: 2, minor: 1 };
const DEFAULT_WEIGHT = IMPACT_WEIGHT.moderate;

/** Regla de buenas prácticas de axe-core: tag 'best-practice' y ningún criterio WCAG numerado. */
function isBestPracticeRule(tags) {
  return Array.isArray(tags) && tags.includes('best-practice') && extractWcagCriteria(tags).length === 0;
}

/**
 * Sección 2 del informe (Buenas prácticas). Complementaria: no afecta el compliance WCAG.
 * Estado por regla, consolidado entre páginas: 'mejora' si falló o quedó incomplete en alguna
 * página; si no, 'cumple' si pasó en alguna; si no, 'no_aplica'. Puntaje = peso de las que
 * cumplen / peso de las que aplican, ponderado por el impacto de la regla en axe-core
 * (passes/inapplicable no traen impact: se toma de rule_impacts que guarda el scanner).
 */
export function computeBestPractices(axeResults = []) {
  const rules = new Map();
  const get = (entry) => {
    if (!rules.has(entry.id)) {
      rules.set(entry.id, { rule_id: entry.id, help: entry.help ?? '', impact: null, failed: false, passed: false, affected_urls: [] });
    }
    return rules.get(entry.id);
  };

  for (const result of axeResults || []) {
    if (!result || result.error) continue;
    const impacts = result.rule_impacts || {};
    for (const entry of [...(result.violations || []), ...(result.incomplete || [])]) {
      if (!isBestPracticeRule(entry.tags)) continue;
      const r = get(entry);
      r.failed = true;
      r.impact = r.impact ?? entry.impact ?? impacts[entry.id] ?? null;
      if (entry.help) r.help = entry.help;
      if (!r.affected_urls.includes(result.url)) r.affected_urls.push(result.url);
    }
    for (const entry of result.passes || []) {
      if (!isBestPracticeRule(entry.tags)) continue;
      const r = get(entry);
      r.passed = true;
      r.impact = r.impact ?? impacts[entry.id] ?? null;
    }
    for (const entry of result.inapplicable || []) {
      if (!isBestPracticeRule(entry.tags)) continue;
      const r = get(entry);
      r.impact = r.impact ?? impacts[entry.id] ?? null;
    }
  }

  const list = [...rules.values()].map(({ failed, passed, ...r }) => ({
    ...r,
    weight: IMPACT_WEIGHT[r.impact] ?? DEFAULT_WEIGHT,
    status: failed ? 'mejora' : passed ? 'cumple' : 'no_aplica'
  }));

  const sumWeight = (status) => list.filter((r) => r.status === status).reduce((sum, r) => sum + r.weight, 0);
  const applicable = sumWeight('cumple') + sumWeight('mejora');
  const count = (status) => list.filter((r) => r.status === status).length;
  return {
    score: applicable === 0 ? null : Math.round((sumWeight('cumple') / applicable) * 10000) / 100,
    cumple: count('cumple'),
    mejora: count('mejora'),
    no_aplica: count('no_aplica'),
    rules: list
  };
}
```

- [ ] **Step 4: Correr y verificar que pasan**

Run: `node --test src/classification/best-practices.test.js`
Expected: PASS (10 tests).

- [ ] **Step 5: Commit**

```bash
git add src/classification/best-practices.js src/classification/best-practices.test.js
git commit -m "feat: Sección 2 Buenas prácticas con puntaje ponderado por impacto"
```

---

### Task 3: `calculateScore` expone las dos secciones (aditivo)

**Files:**
- Modify: `src/classification/calculate-score.js` (imports y `return` final, líneas 1-4 y 117-135)
- Test: `src/classification/calculate-score.test.js` (agregar al final)

**Interfaces:**
- Consumes: `computeWcagSection` (Task 1), `computeBestPractices` (Task 2).
- Produces: `calculateScore(...)` devuelve además `wcag_section` (forma de Task 1) y `best_practices` (forma de Task 2). Todo lo existente queda igual. La tool `calculate_score` del agente lo expone sin cambios de schema.

- [ ] **Step 1: Escribir los tests que fallan** (agregar a `calculate-score.test.js`)

```js
test('calculateScore: expone wcag_section sin cambiar el summary existente', () => {
  const axeResults = [{ url: 'https://a.test', violation_count: 0, incomplete_count: 0, violations: [], incomplete: [], passes: [], inapplicable: [] }];
  const result = calculateScore([], { axeResults });
  assert.equal(result.summary.onti_criteria_compliant, 38);
  assert.equal(result.wcag_section.a_validar, 38);
  assert.equal(result.wcag_section.ok, 0);
});

test('calculateScore: expone best_practices', () => {
  const axeResults = [{ url: 'https://a.test', violation_count: 0, incomplete_count: 0, violations: [], incomplete: [],
    passes: [{ id: 'region', tags: ['best-practice'] }], inapplicable: [], rule_impacts: { region: 'moderate' } }];
  assert.equal(calculateScore([], { axeResults }).best_practices.score, 100);
});

test('calculateScore: wcag_section respeta includeExtended', () => {
  const result = calculateScore([], { axeResults: [], includeExtended: true });
  assert.equal(result.wcag_section.by_criterion.length, 56);
});
```

- [ ] **Step 2: Correr y verificar que fallan**

Run: `node --test src/classification/calculate-score.test.js`
Expected: FAIL — `Cannot read properties of undefined (reading 'a_validar')`.

- [ ] **Step 3: Implementar**

Agregar a los imports de `calculate-score.js`:

```js
import { computeWcagSection } from './wcag-section.js';
import { computeBestPractices } from './best-practices.js';
```

En el `return` final, después de `by_module: byModule`:

```js
    by_module: byModule,
    // Secciones del informe (spec 2026-09-30). Aditivo: los campos de arriba se retiran en el Plan C.
    wcag_section: computeWcagSection(classifiedFindings, { axeResults, includeExtended }),
    best_practices: computeBestPractices(axeResults)
```

- [ ] **Step 4: Correr la suite de clasificación y reporters**

Run: `node --test src/classification/ src/reporter/ src/tools/`
Expected: PASS, incluidos todos los tests preexistentes.

- [ ] **Step 5: Commit**

```bash
git add src/classification/calculate-score.js src/classification/calculate-score.test.js
git commit -m "feat: calculateScore expone wcag_section y best_practices"
```

---

### Task 4: el scanner guarda el impacto de las reglas best-practice

axe-core no devuelve `impact` en `passes`/`inapplicable`, pero cada regla lo declara en su metadata (verificado en axe-core 4.13: `region` → `impact: 'moderate'`). Se lee de `axe._audit.rules` en la página después de `analyze()`.

**Files:**
- Modify: `src/scanner.js` (`scanOne`, después de `const results = await axeBuilder.analyze();`; `toAxeResult`)
- Test: `src/scanner.test.js` (agregar al final)

**Interfaces:**
- Produces: cada `axeResult` gana `rule_impacts: { [ruleId]: string|null }` con las reglas `best-practice` que corrieron (clave ausente → Task 2 usa peso 2). Si la lectura falla, `rule_impacts: {}` y el escaneo sigue.

- [ ] **Step 1: Escribir el test que falla**

```js
test('scanUrl guarda rule_impacts de las reglas best-practice (axe no los trae en passes/inapplicable)', async () => {
  const result = await scanUrl({ url: 'https://example.com' });
  assert.equal(result.rule_impacts.region, 'moderate');
  for (const id of Object.keys(result.rule_impacts)) {
    const all = [...result.violations, ...result.incomplete, ...result.passes, ...result.inapplicable];
    const tags = all.find((r) => r.id === id)?.tags ?? [];
    assert.ok(tags.includes('best-practice'), `"${id}" no es best-practice`);
  }
});
```

- [ ] **Step 2: Correr y verificar que falla**

Run: `node --test --test-name-pattern="rule_impacts" src/scanner.test.js`
Expected: FAIL — `Cannot read properties of undefined (reading 'region')`.

- [ ] **Step 3: Implementar**

En `scanOne`, justo después de `const results = await axeBuilder.analyze();`:

```js
    // axe-core no trae impact en passes/inapplicable; la Sección 2 lo necesita para ponderar.
    // Se lee de la metadata de las reglas best-practice ya inyectadas en la página.
    const ruleImpacts = await page.evaluate(() => Object.fromEntries(
      (window.axe?._audit?.rules || [])
        .filter((r) => (r.tags || []).includes('best-practice'))
        .map((r) => [r.id, r.impact ?? null])
    )).catch(() => ({}));
```

y pasarlo: `return toAxeResult(url, results, { ...extras, ruleImpacts });`. En `toAxeResult`, dentro de `base` después de `inapplicable: ...`, agregar:

```js
    rule_impacts: extras.ruleImpacts || {},
```

- [ ] **Step 4: Correr los tests del scanner**

Run: `node --test src/scanner.test.js`
Expected: PASS. Si `window.axe` no existiera tras `analyze()` (AxeBuilder lo inyecta en el frame principal), el test falla en `region`: en ese caso inyectar `AXE_SOURCE_ES` con `page.evaluate(AXE_SOURCE_ES)` antes de leer y volver a correr.

- [ ] **Step 5: Commit**

```bash
git add src/scanner.js src/scanner.test.js
git commit -m "feat: scanner guarda rule_impacts de reglas best-practice"
```

---

### Task 5: panel — tarjetas "Compliance WCAG" y "Buenas prácticas"

**Files:**
- Modify: `scripts/demo-config.js:25` (tags base), `scripts/demo-results.js`, `scripts/demo.js` (import línea 23, escaneo ~350-356, clasificación ~379-380, informes ~434)
- Test: `scripts/demo-results.test.js`, `scripts/demo-config.test.js`

**Interfaces:**
- Consumes: `scores.wcag_section`, `scores.best_practices` (Task 3).
- Produces (en `demo-results.js`): `isWcagViolation(violation, { includeExtended }) → boolean`; `buildWcagCard(section, { includeExtended }) → card`; `buildBestPracticesCard(bp) → card`. `buildScoreCard` queda sin uso en el demo (se borra en el Plan C junto con los informes).

- [ ] **Step 1: Escribir los tests que fallan**

En `scripts/demo-results.test.js` (sumar los imports `isWcagViolation, buildWcagCard, buildBestPracticesCard`):

```js
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
```

En `scripts/demo-config.test.js`, actualizar las dos aserciones existentes de `wcagTags` (líneas 11 y 18):

```js
  assert.deepEqual(config.wcagTags, ['wcag2a', 'wcag2aa', 'best-practice']);
```

```js
  assert.deepEqual(config.wcagTags, ['wcag2a', 'wcag2aa', 'best-practice', 'wcag21a', 'wcag21aa', 'wcag22aa']);
```

(La aserción de la línea 144, `.slice(0, 2)`, no cambia.)

- [ ] **Step 2: Correr y verificar que fallan**

Run: `node --test scripts/demo-results.test.js scripts/demo-config.test.js`
Expected: FAIL — `isWcagViolation is not a function` y las dos aserciones de `wcagTags` en `demo-config.test.js`.

- [ ] **Step 3: Implementar**

`scripts/demo-config.js:25`:

```js
// best-practice siempre corre: alimenta la Sección 2 (no suma al compliance, ver best-practices.js).
const BASE_WCAG_TAGS = ['wcag2a', 'wcag2aa', 'best-practice'];
```

`scripts/demo-results.js` — reemplazar el filtro interno de `countViolationsByImpact` por la función exportada y sumar las tarjetas:

```js
/** Violación que cuenta para la Sección 1: WCAG 2.0 (BCRA), + 2.1/2.2 con includeExtended. */
export function isWcagViolation(violation, { includeExtended = false } = {}) {
  const tags = includeExtended ? [...BCRA_TAGS, ...EXTENDED_TAGS] : BCRA_TAGS;
  return (violation.tags || []).some((tag) => tags.includes(tag));
}
```

y en `countViolationsByImpact` cambiar las dos líneas del filtro por:

```js
      if (!isWcagViolation(violation, { includeExtended })) continue;
```

(borrar la constante local `tags` que queda sin uso). Luego:

```js
const PCT = new Intl.NumberFormat('es-AR', { maximumFractionDigits: 2 });

/**
 * Tarjeta de la Sección 1: conteo sin veredicto. El anillo muestra cuánto se pudo validar
 * automáticamente ((OK+NOK)/total), no un porcentaje de cumplimiento.
 */
export function buildWcagCard(section, { includeExtended = false } = {}) {
  const validated = section.total ? Math.round(((section.ok + section.nok) / section.total) * 10000) / 100 : 0;
  const na = section.no_aplica ? ` · ${section.no_aplica} no aplican` : '';
  return {
    key: 'wcag',
    label: includeExtended ? 'Compliance WCAG 2.0 (BCRA) + 2.2' : 'Compliance WCAG 2.0 (BCRA)',
    value: `${section.ok} OK · ${section.nok} NOK`,
    detail: `${section.a_validar} a validar (de ${section.total})${na}`,
    title: 'Los criterios "a validar" requieren tecnología asistiva o revisión manual y no cuentan como OK.',
    ring: { pct: validated, tone: 'warn' }
  };
}

/** Tarjeta de la Sección 2: puntaje ponderado por impacto; no afecta el compliance. */
export function buildBestPracticesCard(bp) {
  return {
    key: 'best-practices',
    label: 'Buenas prácticas (complementario)',
    value: bp.score === null ? '—' : `${PCT.format(bp.score)}%`,
    detail: `${bp.cumple} cumplen · ${bp.mejora} a mejorar · ${bp.no_aplica} no aplican`,
    title: 'Reglas de buenas prácticas de axe-core, ponderadas por impacto. No forman parte de la normativa BCRA.'
  };
}
```

`scripts/demo.js`:
- Import (línea 23): reemplazar `buildScoreCard` por `buildWcagCard, buildBestPracticesCard, isWcagViolation`.
- Escaneo (~línea 350): el log por página cuenta solo WCAG y el resaltado marca solo WCAG:

```js
      const wcagScope = { includeExtended: config.includeExtended };
      const wcagViolations = axeResult.violations.filter((v) => isWcagViolation(v, wcagScope));
      ui.pushLog(`${shortUrl(url)}: ${wcagViolations.length} problema(s) WCAG, ${axeResult.pass_count} chequeo(s) aprobado(s).`, wcagViolations.length ? 'warn' : 'ok');
      ui.pushResult(buildSeverityCard(countViolationsByImpact(axeResults, wcagScope), wcagScope));
```

y en la captura: `highlightOnPage(p, wcagViolations)`. (La línea `const wcagScope = ...` que ya existe se reemplaza por esta; no duplicarla.)
- Clasificación (~línea 379-380):

```js
  ui.pushResult(buildWcagCard(scores.wcag_section, { includeExtended: config.includeExtended }));
  ui.pushResult(buildBestPracticesCard(scores.best_practices));
  const s = scores.wcag_section;
  ui.pushLog(`Compliance WCAG: ${s.ok} OK, ${s.nok} NOK, ${s.a_validar} a validar (de ${s.total}).`, s.nok ? 'warn' : 'ok');
```

- Informes (~línea 434): `ui.pushResult(buildScoreCard(finalScores.summary));` → las mismas dos líneas `buildWcagCard(finalScores.wcag_section, ...)` / `buildBestPracticesCard(finalScores.best_practices)`.

Verificar que no quede ningún `buildScoreCard` en `scripts/demo.js`: `grep -n buildScoreCard scripts/demo.js` → sin resultados.

- [ ] **Step 4: Correr los tests de scripts y la suite completa**

Run: `node --test scripts/*.test.js` y luego `npm test`
Expected: PASS. Los tests de `buildScoreCard` siguen pasando (la función sigue exportada hasta el Plan C).

- [ ] **Step 5: Verificación en vivo**

Run: `npm run demo`, auditar el sitio de referencia con 2 páginas.
Expected: aparecen las tarjetas "Compliance WCAG 2.0 (BCRA)" (`X OK · Y NOK`, `Z a validar (de N)`) y "Buenas prácticas (complementario)" con porcentaje; el log por página dice "problema(s) WCAG"; no aparece "Conforme / No conforme" en las tarjetas. Anotar los valores reales en el mensaje del commit.

- [ ] **Step 6: Commit**

```bash
git add scripts/demo-config.js scripts/demo-config.test.js scripts/demo-results.js scripts/demo-results.test.js scripts/demo.js
git commit -m "feat: tarjetas Compliance WCAG y Buenas prácticas en el panel"
```
