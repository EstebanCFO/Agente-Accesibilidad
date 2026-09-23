# Informe Narrativo (Crítico/Alto/Medio/Bajo) — 6to entregable Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Agregar un 6to entregable — un informe narrativo con un bloque por cada uno de los 38 criterios ONTI (Número, Nombre, Principio, Nivel, Estado, Hallazgos, Recomendación) más un resumen final — usando exclusivamente datos que el pipeline ya produce hoy (findings, `review_status`, N/A).

**Architecture:** Un módulo nuevo de lógica pura (`criticidad.js`) deriva el Principio WCAG y la escala Crítico/Alto/Medio/Bajo a partir de campos que cada finding ya trae (`wcag_level`, `severity`, `affected_urls`). Un módulo de reporte nuevo (`informe-narrativo-deliverable.js`) arma los 38 bloques (ordenados numéricamente, no en el orden interno de `onti-38-criteria.json` que agrupa por nivel) + el resumen, y los renderiza a JSON/HTML. Se wirea como un nuevo `type` de `generate_deliverable`, reusando `computeNaCriteria` ya existente.

**Tech Stack:** Node.js ESM, `node:test` + `node:assert/strict`.

**Spec:** `docs/superpowers/specs/2026-09-23-informe-narrativo-design.md` — leé ese archivo completo antes de empezar, tiene el spike de por qué no se integra Lighthouse/WAVE/Accessibility Insights/ARC Toolkit y la justificación completa de cada regla de prioridad.

## Global Constraints

- **No se integra ninguna herramienta nueva** (Lighthouse/WAVE/Accessibility Insights/ARC Toolkit) — decisión ya tomada y documentada en la spec. El informe solo documenta esa decisión, no intenta correr esas herramientas.
- Orden de prioridad de severidad (primer match gana): (1) Nivel A + `severity:'critical'` → Crítico; (2) `severity:'minor'` → Bajo (gana incluso sobre Nivel AA); (3) Nivel A + `serious`/`moderate`, o afecta más de 1 URL → Alto; (4) cualquier otro caso Nivel AA → Medio; (5) fallback Bajo.
- Orden de prioridad de estado por criterio: `No aplica` (si está en `naCriteria`) > severidad del peor finding `confirmado` > `Requiere revisión` (solo si hay `requiere_revision` y ningún `confirmado`) > `Cumple`.
- Los 38 criterios se ordenan numéricamente (por `wcag_criterion`, no por el orden interno del archivo JSON) para agruparse por Principio como pide el formato.
- `essential_flows` (config opcional, `[{name, url_pattern}]`) es la única fuente de "impacto en flujos esenciales" — sin ella, el campo siempre dice explícitamente que no está determinado. Nunca se adivina a partir del nombre del módulo/URL.
- Reusar `ontiCriteria` (ya exportado desde `src/classification/wcag-map.js`) y `computeNaCriteria` (ya exportado desde `src/classification/na-criteria.js`) — no reimplementar.
- Este entregable es JSON + HTML solamente (sin XLSX) — mismo patrón que `score`/`dashboard`, que tampoco llevan XLSX.

---

## Task 1: `criticidad.js` — Principio + escala Crítico/Alto/Medio/Bajo

**Files:**
- Create: `src/classification/criticidad.js`
- Create: `src/classification/criticidad.test.js`

**Interfaces:**
- Produces: `derivePrincipio(wcagCriterion)` → `'Perceptible'|'Operable'|'Comprensible'|'Robusto'`. `deriveSeveridad(finding)` → `'critico'|'alto'|'medio'|'bajo'` (toma `{wcag_level, severity, affected_urls}`). `worseSeveridad(a, b)` → el peor de los dos. Usados por Task 2.

- [ ] **Step 1: Escribir el test que falla**

Crear `src/classification/criticidad.test.js`:

```javascript
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { derivePrincipio, deriveSeveridad, worseSeveridad } from './criticidad.js';

test('derivePrincipio mapea el primer dígito al principio WCAG correcto', () => {
  assert.equal(derivePrincipio('1.1.1'), 'Perceptible');
  assert.equal(derivePrincipio('2.4.7'), 'Operable');
  assert.equal(derivePrincipio('3.3.4'), 'Comprensible');
  assert.equal(derivePrincipio('4.1.2'), 'Robusto');
});

test('deriveSeveridad: Nivel A + critical da "critico"', () => {
  assert.equal(deriveSeveridad({ wcag_level: 'A', severity: 'critical', affected_urls: ['https://a.test'] }), 'critico');
});

test('deriveSeveridad: severity "minor" da "bajo" aunque el criterio sea AA', () => {
  assert.equal(deriveSeveridad({ wcag_level: 'AA', severity: 'minor', affected_urls: ['https://a.test'] }), 'bajo');
});

test('deriveSeveridad: Nivel A con serious/moderate da "alto"', () => {
  assert.equal(deriveSeveridad({ wcag_level: 'A', severity: 'serious', affected_urls: ['https://a.test'] }), 'alto');
  assert.equal(deriveSeveridad({ wcag_level: 'A', severity: 'moderate', affected_urls: ['https://a.test'] }), 'alto');
});

test('deriveSeveridad: afecta varias páginas da "alto" aunque sea AA (proxy de componente reutilizado)', () => {
  assert.equal(deriveSeveridad({ wcag_level: 'AA', severity: 'moderate', affected_urls: ['https://a.test', 'https://b.test'] }), 'alto');
});

test('deriveSeveridad: Nivel AA en una sola página da "medio"', () => {
  assert.equal(deriveSeveridad({ wcag_level: 'AA', severity: 'serious', affected_urls: ['https://a.test'] }), 'medio');
});

test('worseSeveridad devuelve el peor de dos niveles', () => {
  assert.equal(worseSeveridad('bajo', 'critico'), 'critico');
  assert.equal(worseSeveridad('alto', 'medio'), 'alto');
  assert.equal(worseSeveridad('medio', 'medio'), 'medio');
  assert.equal(worseSeveridad('critico', 'bajo'), 'critico');
});
```

- [ ] **Step 2: Correr el test y confirmar que falla**

Run: `node --test src/classification/criticidad.test.js`
Expected: FAIL con `Cannot find module './criticidad.js'`.

- [ ] **Step 3: Implementar `criticidad.js`**

```javascript
/**
 * Deriva el Principio WCAG (Perceptible/Operable/Comprensible/Robusto) del primer dígito del
 * criterio - no es un dato nuevo, es una propiedad fija de la numeración WCAG 2.0.
 */
const PRINCIPIO_POR_DIGITO = { '1': 'Perceptible', '2': 'Operable', '3': 'Comprensible', '4': 'Robusto' };

export function derivePrincipio(wcagCriterion) {
  const primerDigito = String(wcagCriterion).split('.')[0];
  return PRINCIPIO_POR_DIGITO[primerDigito] ?? 'Desconocido';
}

const SEVERIDAD_RANK = { critico: 4, alto: 3, medio: 2, bajo: 1 };

export function worseSeveridad(a, b) {
  return (SEVERIDAD_RANK[b] ?? 0) > (SEVERIDAD_RANK[a] ?? 0) ? b : a;
}

/**
 * Mapeo determinístico Crítico/Alto/Medio/Bajo a partir de datos que el finding ya trae
 * (wcag_level, severity de axe-core, affected_urls.length como proxy de "componente
 * reutilizado en muchas pantallas") - sin pedir tags de negocio nuevos. Ver
 * docs/superpowers/specs/2026-09-23-informe-narrativo-design.md para la justificación de cada
 * regla y del orden de prioridad (en particular: "minor" siempre da "bajo", incluso en AA).
 */
export function deriveSeveridad(finding) {
  const afectaVariasPaginas = (finding.affected_urls?.length ?? 0) > 1;

  if (finding.wcag_level === 'A' && finding.severity === 'critical') return 'critico';
  if (finding.severity === 'minor') return 'bajo';
  if (finding.wcag_level === 'A' && ['serious', 'moderate'].includes(finding.severity)) return 'alto';
  if (afectaVariasPaginas) return 'alto';
  if (finding.wcag_level === 'AA') return 'medio';
  return 'bajo';
}
```

- [ ] **Step 4: Correr el test y confirmar que pasa**

Run: `node --test src/classification/criticidad.test.js`
Expected: todos los tests PASAN.

- [ ] **Step 5: Commit**

```bash
git add src/classification/criticidad.js src/classification/criticidad.test.js
git commit -m "feat: add derivePrincipio/deriveSeveridad/worseSeveridad for the narrative report"
```

---

## Task 2: `informe-narrativo-deliverable.js` — los 38 bloques + resumen

**Files:**
- Create: `src/reporter/informe-narrativo-deliverable.js`
- Create: `src/reporter/informe-narrativo-deliverable.test.js`

**Interfaces:**
- Consumes: `ontiCriteria` (`../classification/wcag-map.js`), `derivePrincipio`/`deriveSeveridad`/`worseSeveridad` (Task 1).
- Produces: `buildInformeNarrativo({findings, naCriteria, essentialFlows})` → `{criterios[], resumen}`. `buildInformeNarrativoJson({jobId, channel, findings, naCriteria, essentialFlows})` → documento JSON completo. `buildInformeNarrativoHtml({jobId, channel, findings, naCriteria, essentialFlows})` → string HTML. Usados por Task 3.

- [ ] **Step 1: Escribir el test que falla**

Crear `src/reporter/informe-narrativo-deliverable.test.js`:

```javascript
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { buildInformeNarrativo, buildInformeNarrativoJson, buildInformeNarrativoHtml } from './informe-narrativo-deliverable.js';

function finding(overrides) {
  return {
    id: 'f1', wcag_criterion: '1.1.1', wcag_level: 'A', in_scope: 'onti',
    severity: 'critical', review_status: 'confirmado', source: 'axe-core',
    affected_urls: ['https://a.test'], occurrences: 1,
    element_sample: '<img>', failure_summary: 'Falta alt', remediation_hint: 'Agregar alt',
    ...overrides
  };
}

test('buildInformeNarrativo devuelve los 38 criterios ordenados numéricamente por Principio', () => {
  const { criterios } = buildInformeNarrativo({ findings: [] });
  assert.equal(criterios.length, 38);
  assert.equal(criterios[0].criterio, '1.1.1');
  assert.equal(criterios[0].principio, 'Perceptible');
  assert.equal(criterios[37].criterio, '4.1.2');
  assert.equal(criterios[37].principio, 'Robusto');
  for (let i = 1; i < criterios.length; i += 1) {
    const a = criterios[i - 1].criterio.split('.').map(Number);
    const b = criterios[i].criterio.split('.').map(Number);
    const menor = a[0] < b[0] || (a[0] === b[0] && (a[1] < b[1] || (a[1] === b[1] && a[2] < b[2])));
    assert.ok(menor, `${criterios[i - 1].criterio} debería ir antes que ${criterios[i].criterio}`);
  }
});

test('buildInformeNarrativo: sin findings, todos los criterios quedan "Cumple" con "Sin hallazgos"', () => {
  const { criterios } = buildInformeNarrativo({ findings: [] });
  assert.ok(criterios.every((c) => c.estado === 'Cumple'));
  assert.deepEqual(criterios[0].hallazgos, [{ descripcion: 'Sin hallazgos', herramientas: [], elementos_afectados: [], impacto_flujo: null }]);
});

test('buildInformeNarrativo: un criterio en naCriteria queda "No aplica" aunque tenga findings', () => {
  const { criterios } = buildInformeNarrativo({ findings: [finding()], naCriteria: ['1.1.1'] });
  assert.equal(criterios.find((c) => c.criterio === '1.1.1').estado, 'No aplica');
});

test('buildInformeNarrativo: un finding confirmado da la severidad correspondiente como estado', () => {
  const { criterios } = buildInformeNarrativo({ findings: [finding({ wcag_level: 'A', severity: 'critical' })] });
  assert.equal(criterios.find((c) => c.criterio === '1.1.1').estado, 'Crítico');
});

test('buildInformeNarrativo: solo un finding "requiere_revision" (sin confirmado) da "Requiere revisión"', () => {
  const { criterios } = buildInformeNarrativo({ findings: [finding({ review_status: 'requiere_revision' })] });
  assert.equal(criterios.find((c) => c.criterio === '1.1.1').estado, 'Requiere revisión');
});

test('buildInformeNarrativo: un finding confirmado gana sobre uno requiere_revision del mismo criterio', () => {
  const findings = [
    finding({ review_status: 'requiere_revision' }),
    finding({ review_status: 'confirmado', severity: 'moderate' })
  ];
  const { criterios } = buildInformeNarrativo({ findings });
  assert.notEqual(criterios.find((c) => c.criterio === '1.1.1').estado, 'Requiere revisión');
});

test('buildInformeNarrativo: hallazgos mapea descripcion/herramientas/elementos desde el finding', () => {
  const { criterios } = buildInformeNarrativo({ findings: [finding({ source: 'visual_audit' })] });
  const hallazgo = criterios.find((c) => c.criterio === '1.1.1').hallazgos[0];
  assert.equal(hallazgo.descripcion, 'Falta alt');
  assert.deepEqual(hallazgo.herramientas, ['IA (revisión visual)']);
  assert.deepEqual(hallazgo.elementos_afectados, ['<img>']);
  assert.match(hallazgo.impacto_flujo, /No determinado/);
});

test('buildInformeNarrativo: resumen cuenta por estado y prioriza Crítico+Alto', () => {
  const findings = [
    finding({ wcag_criterion: '1.1.1', wcag_level: 'A', severity: 'critical' }),
    finding({ wcag_criterion: '2.4.4', wcag_level: 'A', severity: 'serious' })
  ];
  const { resumen } = buildInformeNarrativo({ findings });
  assert.equal(resumen.conteo_por_estado['Crítico'], 1);
  assert.equal(resumen.conteo_por_estado['Alto'], 1);
  assert.equal(resumen.conteo_por_estado['Cumple'], 36);
  assert.equal(resumen.hallazgos_prioritarios.length, 2);
  assert.match(resumen.recomendacion_general, /1 criterio/);
});

test('buildInformeNarrativo: resumen.flujos_esenciales_afectados dice "No determinado" sin config de essential_flows', () => {
  const { resumen } = buildInformeNarrativo({ findings: [finding()] });
  assert.match(resumen.flujos_esenciales_afectados, /No determinado/);
});

test('buildInformeNarrativo: resumen.flujos_esenciales_afectados lista los flujos realmente afectados por un hallazgo', () => {
  const essentialFlows = [{ name: 'Login', url_pattern: 'https://a.test/*' }];
  const findings = [finding({ affected_urls: ['https://a.test/login'] })];
  const { resumen } = buildInformeNarrativo({ findings, essentialFlows });
  assert.match(resumen.flujos_esenciales_afectados, /Login/);
});

test('buildInformeNarrativo: resumen.flujos_esenciales_afectados dice que ninguno fue afectado si hay config pero ningún hallazgo cae en flujos', () => {
  const essentialFlows = [{ name: 'Login', url_pattern: 'https://otra.test/*' }];
  const { resumen } = buildInformeNarrativo({ findings: [], essentialFlows });
  assert.match(resumen.flujos_esenciales_afectados, /Ningún flujo esencial configurado/);
});

test('buildInformeNarrativoJson envuelve con job_id/channel/generated_at', () => {
  const doc = buildInformeNarrativoJson({ jobId: 'job-1', channel: 'home_banking', findings: [] });
  assert.equal(doc.job_id, 'job-1');
  assert.equal(doc.channel, 'home_banking');
  assert.ok(doc.generated_at);
  assert.equal(doc.criterios.length, 38);
});

test('buildInformeNarrativoHtml escapa HTML y documenta la exclusión de Lighthouse/WAVE/Accessibility Insights/ARC Toolkit', () => {
  const findings = [finding({ failure_summary: '<script>alert(1)</script>' })];
  const html = buildInformeNarrativoHtml({ jobId: 'job-1', channel: 'home_banking', findings });
  assert.ok(!html.includes('<script>alert(1)</script>'));
  assert.match(html, /Lighthouse/);
  assert.match(html, /WAVE/);
  assert.match(html, /Accessibility Insights/);
  assert.match(html, /ARC Toolkit/);
  assert.match(html, /Resumen final/);
});
```

- [ ] **Step 2: Correr el test y confirmar que falla**

Run: `node --test src/reporter/informe-narrativo-deliverable.test.js`
Expected: FAIL con `Cannot find module './informe-narrativo-deliverable.js'`.

- [ ] **Step 3: Implementar `informe-narrativo-deliverable.js`**

```javascript
import { ontiCriteria } from '../classification/wcag-map.js';
import { derivePrincipio, deriveSeveridad, worseSeveridad } from '../classification/criticidad.js';

const HERRAMIENTA_LABEL = { 'axe-core': 'axe-core', visual_audit: 'IA (revisión visual)', ux_review: 'IA (revisión UX)' };
const NO_DETERMINADO_FLUJO = 'No determinado - requiere que el cliente indique qué páginas corresponden a flujos esenciales (login, transferencias, alta de producto).';
const SEVERIDAD_A_ESTADO = { critico: 'Crítico', alto: 'Alto', medio: 'Medio', bajo: 'Bajo' };

function ordenNumerico(a, b) {
  const partesA = a.wcag_criterion.split('.').map(Number);
  const partesB = b.wcag_criterion.split('.').map(Number);
  for (let i = 0; i < partesA.length; i += 1) {
    if (partesA[i] !== partesB[i]) return partesA[i] - partesB[i];
  }
  return 0;
}

function matchGlob(pattern, value) {
  const escaped = pattern.split('*').map((s) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')).join('.*');
  return new RegExp(`^${escaped}$`).test(value);
}

function resolveImpactoFlujo(url, essentialFlows) {
  if (!Array.isArray(essentialFlows) || essentialFlows.length === 0) return NO_DETERMINADO_FLUJO;
  const match = essentialFlows.find((flow) => matchGlob(flow.url_pattern, url));
  return match ? `Afecta el flujo esencial "${match.name}" (${url})` : NO_DETERMINADO_FLUJO;
}

function findingToHallazgo(finding, essentialFlows) {
  const impactos = (finding.affected_urls || []).map((url) => resolveImpactoFlujo(url, essentialFlows));
  return {
    descripcion: finding.failure_summary,
    herramientas: [HERRAMIENTA_LABEL[finding.source] ?? finding.source],
    elementos_afectados: [finding.element_sample],
    impacto_flujo: impactos.find((r) => r !== NO_DETERMINADO_FLUJO) ?? NO_DETERMINADO_FLUJO
  };
}

function buildFlujosEsencialesAfectados(criterios, essentialFlows) {
  if (!Array.isArray(essentialFlows) || essentialFlows.length === 0) {
    return NO_DETERMINADO_FLUJO;
  }
  const nombresAfectados = new Set();
  for (const c of criterios) {
    if (c.estado === 'Cumple' || c.estado === 'No aplica') continue;
    for (const h of c.hallazgos) {
      const match = h.impacto_flujo?.match(/^Afecta el flujo esencial "([^"]+)"/);
      if (match) nombresAfectados.add(match[1]);
    }
  }
  return nombresAfectados.size > 0
    ? `Flujos esenciales afectados: ${[...nombresAfectados].join(', ')}.`
    : 'Ningún flujo esencial configurado resultó afectado por los hallazgos de esta corrida.';
}

function buildResumen(criterios, essentialFlows) {
  const conteoPorEstado = {};
  for (const c of criterios) {
    conteoPorEstado[c.estado] = (conteoPorEstado[c.estado] ?? 0) + 1;
  }
  const prioritarios = criterios
    .filter((c) => c.estado === 'Crítico' || c.estado === 'Alto')
    .sort((a, b) => (a.estado === 'Crítico' ? 0 : 1) - (b.estado === 'Crítico' ? 0 : 1));

  return {
    conteo_por_estado: conteoPorEstado,
    hallazgos_prioritarios: prioritarios.map((c) => ({ criterio: c.criterio, nombre: c.nombre, estado: c.estado })),
    flujos_esenciales_afectados: buildFlujosEsencialesAfectados(criterios, essentialFlows),
    recomendacion_general: prioritarios.length > 0
      ? `Priorizar la remediación de los ${conteoPorEstado['Crítico'] ?? 0} criterio(s) Crítico(s) primero, luego los ${conteoPorEstado['Alto'] ?? 0} Alto(s).`
      : 'No hay criterios Crítico ni Alto pendientes de remediación.'
  };
}

/**
 * Arma los 38 bloques del informe narrativo (uno por criterio ONTI), en orden numérico (no el
 * orden interno de onti-38-criteria.json, que agrupa por nivel A/AA) para que salgan agrupados
 * por Principio tal como pide el formato. Ver docs/superpowers/specs/
 * 2026-09-23-informe-narrativo-design.md para la prioridad de estado/severidad.
 */
export function buildInformeNarrativo({ findings, naCriteria = [], essentialFlows = [] }) {
  const naSet = new Set(naCriteria);
  const criteriosOrdenados = [...ontiCriteria].sort(ordenNumerico);

  const criterios = criteriosOrdenados.map((criterio, index) => {
    const findingsDelCriterio = (findings || []).filter((f) => f.wcag_criterion === criterio.wcag_criterion && f.in_scope === 'onti');
    const confirmados = findingsDelCriterio.filter((f) => (f.review_status ?? 'confirmado') === 'confirmado');
    const requierenRevision = findingsDelCriterio.filter((f) => f.review_status === 'requiere_revision');

    let estado;
    if (naSet.has(criterio.wcag_criterion)) {
      estado = 'No aplica';
    } else if (confirmados.length > 0) {
      const peorSeveridad = confirmados.map(deriveSeveridad).reduce(worseSeveridad);
      estado = SEVERIDAD_A_ESTADO[peorSeveridad];
    } else if (requierenRevision.length > 0) {
      estado = 'Requiere revisión';
    } else {
      estado = 'Cumple';
    }

    const hallazgos = findingsDelCriterio.length > 0
      ? findingsDelCriterio.map((f) => findingToHallazgo(f, essentialFlows))
      : [{ descripcion: 'Sin hallazgos', herramientas: [], elementos_afectados: [], impacto_flujo: null }];

    const recomendacion = confirmados[0]?.remediation_hint
      || requierenRevision[0]?.remediation_hint
      || 'Sin acción requerida - el criterio se cumple según la evaluación automática.';

    return {
      numero: index + 1,
      criterio: criterio.wcag_criterion,
      nombre: criterio.description,
      principio: derivePrincipio(criterio.wcag_criterion),
      nivel: criterio.level,
      estado,
      hallazgos,
      recomendacion
    };
  });

  return { criterios, resumen: buildResumen(criterios, essentialFlows) };
}

export function buildInformeNarrativoJson({ jobId, channel, findings, naCriteria, essentialFlows }) {
  const { criterios, resumen } = buildInformeNarrativo({ findings, naCriteria, essentialFlows });
  return { job_id: jobId, channel: channel ?? null, generated_at: new Date().toISOString(), criterios, resumen };
}

function escapeHtml(value) {
  return String(value ?? '').replace(/[&<>"']/g, (char) => ({
    '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;'
  }[char]));
}

const HERRAMIENTAS_EXCLUIDAS_NOTA = `<p class="meta">Nota metodológica: se evaluó sumar Lighthouse, WAVE, Accessibility Insights y ARC Toolkit a la corrida automática. Lighthouse y Accessibility Insights dependen internamente de axe-core (no aportan un motor de detección nuevo); WAVE solo ofrece una API paga que envía el contenido de la página a servidores de terceros; ARC Toolkit no tiene API en su versión gratuita. Por eso axe-core sigue siendo la única fuente automática, complementada con la revisión de IA con visión (visual_audit/ux_compliance_review).</p>`;

function criterioBlockHtml(c) {
  const estadoClass = c.estado.toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/\s+/g, '-');
  const hallazgosHtml = c.hallazgos.map((h) => `
    <li>
      ${escapeHtml(h.descripcion)}
      ${h.herramientas.length > 0 ? `<br><small>Detectado por: ${h.herramientas.map(escapeHtml).join(', ')}</small>` : ''}
      ${h.elementos_afectados.filter(Boolean).length > 0 ? `<br><small>Elemento: <code>${escapeHtml(h.elementos_afectados[0])}</code></small>` : ''}
      ${h.impacto_flujo ? `<br><small>${escapeHtml(h.impacto_flujo)}</small>` : ''}
    </li>`).join('\n');

  return `
  <section class="criterio estado-${estadoClass}">
    <h3>${c.numero}. ${escapeHtml(c.criterio)} ${escapeHtml(c.nombre)}</h3>
    <p><strong>Principio:</strong> ${escapeHtml(c.principio)} · <strong>Nivel:</strong> ${escapeHtml(c.nivel)} · <strong>Estado:</strong> ${escapeHtml(c.estado)}</p>
    <p><strong>Hallazgos:</strong></p>
    <ul>${hallazgosHtml}</ul>
    <p><strong>Recomendación de remediación:</strong> ${escapeHtml(c.recomendacion)}</p>
  </section>`;
}

function resumenHtml(resumen) {
  const conteoRows = Object.entries(resumen.conteo_por_estado)
    .map(([estado, count]) => `<tr><td>${escapeHtml(estado)}</td><td>${count}</td></tr>`).join('\n');
  const prioritariosRows = resumen.hallazgos_prioritarios
    .map((h) => `<li>[${escapeHtml(h.estado)}] ${escapeHtml(h.criterio)} — ${escapeHtml(h.nombre)}</li>`).join('\n');

  return `
  <section class="resumen">
    <h2>Resumen final</h2>
    <table><thead><tr><th>Estado</th><th>Cantidad</th></tr></thead><tbody>${conteoRows}</tbody></table>
    <h3>Hallazgos prioritarios (Crítico + Alto)</h3>
    <ul>${prioritariosRows || '<li>Ninguno.</li>'}</ul>
    <h3>Flujos esenciales afectados</h3>
    <p>${escapeHtml(resumen.flujos_esenciales_afectados)}</p>
    <p><strong>Recomendación general de priorización:</strong> ${escapeHtml(resumen.recomendacion_general)}</p>
  </section>`;
}

export function buildInformeNarrativoHtml({ jobId, channel, findings, naCriteria, essentialFlows }) {
  const { criterios, resumen } = buildInformeNarrativo({ findings, naCriteria, essentialFlows });
  return `<!doctype html>
<html lang="es">
<head>
<meta charset="utf-8">
<title>Informe Narrativo de Accesibilidad — ${escapeHtml(jobId)}</title>
<style>
  body { font-family: Arial, Helvetica, sans-serif; margin: 2rem; color: #1a1a1a; }
  h1 { font-size: 1.4rem; } h2 { font-size: 1.15rem; margin-top: 2rem; } h3 { font-size: 1rem; }
  .meta { color: #555; font-size: 0.85rem; }
  section.criterio { border: 1px solid #ddd; border-radius: 6px; padding: 1rem; margin-bottom: 1rem; }
  section.criterio.estado-critico { border-left: 5px solid #d03b3b; }
  section.criterio.estado-alto { border-left: 5px solid #ec835a; }
  section.criterio.estado-medio { border-left: 5px solid #fab219; }
  section.criterio.estado-bajo { border-left: 5px solid #898781; }
  section.criterio.estado-cumple { border-left: 5px solid #0ca30c; }
  section.criterio.estado-no-aplica { border-left: 5px solid #cccccc; }
  section.criterio.estado-requiere-revision { border-left: 5px solid #2a78d6; }
  table { border-collapse: collapse; } th, td { border: 1px solid #ddd; padding: 4px 8px; }
</style>
</head>
<body>
  <h1>Informe Narrativo de Accesibilidad — WCAG 2.0 A + AA</h1>
  <p class="meta">Job: ${escapeHtml(jobId)} · Canal: ${escapeHtml(channel ?? 'N/D')} · Generado: ${new Date().toISOString()}</p>
  ${HERRAMIENTAS_EXCLUIDAS_NOTA}
  ${criterios.map(criterioBlockHtml).join('\n')}
  ${resumenHtml(resumen)}
</body>
</html>`;
}
```

- [ ] **Step 4: Correr el test y confirmar que pasa**

Run: `node --test src/reporter/informe-narrativo-deliverable.test.js`
Expected: todos los tests PASAN.

- [ ] **Step 5: Commit**

```bash
git add src/reporter/informe-narrativo-deliverable.js src/reporter/informe-narrativo-deliverable.test.js
git commit -m "feat: build the 38-criteria narrative accessibility report"
```

---

## Task 3: Wiring en `generate-deliverable.js`

**Files:**
- Modify: `src/reporter/generate-deliverable.js`
- Modify: `src/reporter/generate-deliverable.test.js`

**Interfaces:**
- Consumes: `buildInformeNarrativoJson`/`buildInformeNarrativoHtml` (Task 2), `computeNaCriteria` (ya importado en este archivo desde un plan anterior).
- Produces: `generateDeliverable('informe-narrativo', {jobId, channel, findings, axe_results?, essentialFlows?}, {outputDir})` → `[jsonPath, htmlPath]`.

- [ ] **Step 1: Escribir el test que falla**

Leé primero el `generate-deliverable.js` y `generate-deliverable.test.js` actuales para confirmar el import existente de `computeNaCriteria` (ya está, de un plan anterior) y el patrón de los demás builders.

Agregar a `src/reporter/generate-deliverable.test.js` (junto a los demás tests de `generateDeliverable`):

```javascript
test('generateDeliverable("informe-narrativo") escribe json + html con los 38 criterios y el resumen', async () => {
  const outputDir = await mkdtemp(path.join(tmpdir(), 'f1-deliverable-'));
  const findings = [
    {
      id: 'f1', wcag_criterion: '1.1.1', wcag_level: 'A', in_scope: 'onti', severity: 'critical',
      review_status: 'confirmado', source: 'axe-core', affected_urls: ['https://a.test'], occurrences: 1,
      element_sample: '<img>', failure_summary: 'Falta alt', remediation_hint: 'Agregar alt'
    }
  ];

  const filePaths = await generateDeliverable('informe-narrativo', {
    jobId: 'job-narrativo', channel: 'home_banking', findings
  }, { outputDir });

  assert.equal(filePaths.length, 2);
  const jsonPath = filePaths.find((p) => p.endsWith('.json'));
  const htmlPath = filePaths.find((p) => p.endsWith('.html'));

  const jsonDoc = JSON.parse(await readFile(jsonPath, 'utf8'));
  assert.equal(jsonDoc.criterios.length, 38);
  assert.equal(jsonDoc.criterios.find((c) => c.criterio === '1.1.1').estado, 'Crítico');
  assert.equal(jsonDoc.resumen.conteo_por_estado['Crítico'], 1);

  const html = await readFile(htmlPath, 'utf8');
  assert.match(html, /Informe Narrativo de Accesibilidad/);
  assert.match(html, /Resumen final/);
});

test('generateDeliverable("informe-narrativo") marca no_aplica en el JSON cuando se pasan axe_results con un criterio N/A', async () => {
  const outputDir = await mkdtemp(path.join(tmpdir(), 'f1-deliverable-'));
  const axeResults = [
    { url: 'https://a.test', violations: [], incomplete: [], passes: [], inapplicable: [{ id: 'video-caption', tags: ['wcag2a', 'wcag122'] }] }
  ];

  const filePaths = await generateDeliverable('informe-narrativo', {
    jobId: 'job-na', channel: 'home_banking', findings: [], axe_results: axeResults
  }, { outputDir });

  const jsonPath = filePaths.find((p) => p.endsWith('.json'));
  const jsonDoc = JSON.parse(await readFile(jsonPath, 'utf8'));
  assert.equal(jsonDoc.criterios.find((c) => c.criterio === '1.2.2').estado, 'No aplica');
});
```

- [ ] **Step 2: Correr el test y confirmar que falla**

Run: `node --test src/reporter/generate-deliverable.test.js`
Expected: FAIL — `generateDeliverable('informe-narrativo', ...)` tira `Tipo de entregable desconocido o no implementado todavía: "informe-narrativo"`.

- [ ] **Step 3: Implementar el wiring**

Agregar el import al inicio de `src/reporter/generate-deliverable.js` (junto a los demás imports de builders):
```javascript
import { buildInformeNarrativoJson, buildInformeNarrativoHtml } from './informe-narrativo-deliverable.js';
```

Agregar esta entrada al objeto `BUILDERS` (junto a las demás, ej. después de `matriz`):
```javascript
  'informe-narrativo': async (data, outputDir) => {
    const naCriteria = computeNaCriteria(data.axe_results ?? data.axeResults ?? [], { includeExtended: false });
    const jsonPath = await writeJsonFile(outputDir, 'informe-narrativo.json', buildInformeNarrativoJson({
      jobId: data.jobId, channel: data.channel, findings: data.findings, naCriteria, essentialFlows: data.essentialFlows
    }));
    const htmlPath = await writeTextFile(outputDir, 'informe-narrativo.html', buildInformeNarrativoHtml({
      jobId: data.jobId, channel: data.channel, findings: data.findings, naCriteria, essentialFlows: data.essentialFlows
    }));
    return [jsonPath, htmlPath];
  },
```

(`computeNaCriteria` ya está importado en este archivo desde el plan anterior de `parcialmente_conforme`/`no_aplica` — no agregar un import duplicado, verificar primero que ya existe.)

- [ ] **Step 4: Correr el test y confirmar que pasa**

Run: `node --test src/reporter/generate-deliverable.test.js`
Expected: todos los tests (viejos y nuevos) PASAN.

- [ ] **Step 5: Correr la suite completa del repo**

Run: `npm test`
Expected: todos los tests PASAN, sin regresiones.

- [ ] **Step 6: Commit**

```bash
git add src/reporter/generate-deliverable.js src/reporter/generate-deliverable.test.js
git commit -m "feat: wire the informe-narrativo deliverable into generate_deliverable"
```

---

## Nota final para quien ejecute este plan

Después de la Task 3, actualizar la memoria del proyecto documentando el nuevo 6to entregable y el spike sobre Lighthouse/WAVE/Accessibility Insights/ARC Toolkit (para que quede registrado por qué no se integraron, y no se vuelva a investigar lo mismo en el futuro).
