# Diseño: capturar incomplete/inapplicable de axe-core → parcialmente_conforme / no_aplica

**Fecha:** 2026-09-22
**Motivado por:** refinamiento de "Cuadro de Situación de Accesibilidad" pasado por el usuario (formato por-criterio con estado Cumple/No cumple/N/A + escala de criticidad Crítico/Alto/Medio/Bajo). Resuelve la limitación #2 documentada en memoria ("`matriz` nunca emite `parcialmente_conforme` ni `no_aplica`").
**Estado:** aprobado en chat, pendiente de plan de implementación.

## Contexto y verificación previa (no se adivinó nada)

Se corrió axe-core 4.13.0 real (la versión que ya usa este proyecto) contra una página real para confirmar la forma exacta de sus 4 categorías de resultado:

- `violations[]` / `incomplete[]`: misma forma exacta — `{id, impact, tags, help, helpUrl, nodes[]}`. `incomplete` significa "axe-core no pudo determinar solo, necesita revisión manual" (ej. contraste con fondo en gradiente, donde no se puede calcular el ratio automáticamente).
- `passes[]`: reglas que se evaluaron y no encontraron problema — `{id, tags, ...}`.
- `inapplicable[]`: reglas que **no encontraron ningún elemento al que aplicarles** en esa página — `{id, impact: null, tags, nodes: []}`.

**Hallazgo importante de cobertura:** de los 5 criterios ONTI de audio/video (1.2.1–1.2.5), axe-core solo tiene reglas propias para **1.2.1** (`audio-caption`) y **1.2.2** (`video-caption`). Para 1.2.3/1.2.4/1.2.5 axe-core no tiene ninguna regla — nunca aparecen en ninguna de las 4 categorías, tenga o no tenga video el canal. Esto significa que el "N/A automático" que se construye acá **solo puede aplicar a criterios donde axe-core realmente tiene cobertura de reglas** — no resuelve ni empeora la limitación ya documentada de ~57–65% de cobertura automática para los criterios sin reglas.

Decisiones ya confirmadas con el usuario:
- Un criterio con solo `incomplete` (sin violación real) **no cuenta como conforme** para el umbral ≥30/38 — mismo criterio "el agente nunca asume éxito" que ya rige el resto del proyecto (SPEC §4.2/4.4). Se marca `parcialmente_conforme` en la matriz, mostrando que es distinto a un fallo confirmado.
- Un criterio "N/A" (no aplica) **se resta del denominador** del umbral regulatorio: si 3 criterios son N/A, el umbral pasa a ser proporcional sobre 35 en vez de 38 (mismo % que 30/38, redondeado) — criterio estándar de auditorías WCAG reales.

## Regla de determinación de N/A (algoritmo exacto)

Un criterio WCAG es N/A para el canal completo **solo si, entre todas las URLs escaneadas, todas las reglas de axe-core que lo tocan aparecieron siempre como `inapplicable` y nunca como `violation`/`incomplete`/`pass` en ninguna URL**. Si axe-core no tiene ninguna regla para ese criterio (nunca aparece en ninguna de las 4 categorías, en ninguna URL), el criterio **no** se marca N/A — se deja tal como está hoy (cuenta como conforme por defecto, limitación de cobertura ya documentada, no una respuesta inventada).

Esto requiere cruzar, por cada rule id de axe visto en cualquier categoría de cualquier URL: ¿esa regla apareció alguna vez en `violations`/`incomplete`/`passes` en cualquier URL? Si nunca — solo `inapplicable` — y **todas** las reglas que tocan ese criterio están en esa situación, el criterio es N/A.

## Componentes

### 1. `src/scanner.js` — capturar las 4 categorías completas

`toAxeResult` gana:
- `incomplete[]`: misma forma que `violations[]` (id, impact, tags, help, help_url, node_count, nodes[]) — hoy solo se guarda `incomplete_count`, se pierde el detalle.
- `passes[]`: forma liviana `{id, tags}` (no hace falta node detail, solo necesitamos saber que la regla se evaluó y no falló).
- `inapplicable[]`: forma liviana `{id, tags}` (nodes siempre vacío en axe-core, no se guarda).

Cambio puramente aditivo sobre la forma actual (`violation_count`/`pass_count`/`incomplete_count` no se tocan).

### 2. `src/classification/classify-findings.js` — findings con `review_status`

Cada finding gana un campo nuevo `review_status: 'confirmado' | 'requiere_revision'`:
- Los findings que ya se generan hoy desde `axeResult.violations` → `review_status: 'confirmado'` (axe-core está seguro de que falla).
- Findings nuevos generados desde `axeResult.incomplete` (mismo mapeo a criterio WCAG vía `classifyByWcagTags`, mismo agrupamiento por `(wcag_criterion, rule_id)`) → `review_status: 'requiere_revision'`.

Si el mismo `(wcag_criterion, rule_id)` aparece confirmado en una URL e incompleto en otra, el finding combinado queda `review_status: 'confirmado'` (peor caso gana, mismo patrón que ya usa `worseSeverity`).

### 3. `src/visual-review/report-findings-schema.js` — findings de IA siempre "confirmado"

`normalizeReportedFindings` agrega `review_status: 'confirmado'` a cada finding — un hallazgo que el modelo decide reportar es una afirmación concreta, no un "no pude determinar" (ese matiz no existe en el diseño de `report_findings`).

### 4. `src/classification/na-criteria.js` (nuevo) — determinar N/A

`computeNaCriteria(axeResults, {includeExtended})`: implementa el algoritmo de la sección anterior. Recorre `violations`/`incomplete`/`passes`/`inapplicable` de cada `axeResult`, arma qué rule ids fueron "alguna vez aplicables" en algún lado, y devuelve la lista de `wcag_criterion` (ONTI + extendidos si corresponde) donde **todas** sus reglas conocidas nunca fueron aplicables. Reusa `extractWcagCriteria` (ya exportado desde `wcag-map.js`) para mapear tags de una regla a criterios — no reimplementa ese mapeo.

### 5. `src/classification/calculate-score.js` — denominador proporcional

`calculateScore` gana uso interno de `computeNaCriteria(axeResults, {includeExtended})` (calculado una vez, a partir del `axeResults` que la función ya recibe). Cambios:
- `onti_criteria_evaluated` pasa de fijo `38` a `38 - N/A_count`.
- `ontiCriteriaCompliant`/`score_level_a`/`score_level_aa` se calculan solo sobre los criterios evaluables (excluyendo N/A) — los criterios N/A, por construcción del algoritmo, nunca tienen findings, así que no hace falta un filtro extra ahí.
- Nuevo campo `summary.effective_conformance_threshold`: el umbral `conformanceThreshold` (default 30, el número literal de la norma) escalado proporcionalmente al nuevo denominador (`Math.round(conformanceThreshold * evaluado/38)`). `onti_conformance` pasa a compararse contra este valor, no contra el `conformanceThreshold` crudo. `summary.conformance_threshold` se mantiene sin cambios (el valor de la norma, para que el reporte pueda mostrar ambos: "30/38 según la norma, ajustado a 28/35 en esta corrida por 3 criterios N/A").
- Nuevo campo `summary.onti_criteria_na`: cantidad de criterios N/A esta corrida (transparencia en el reporte).

### 6. `src/reporter/matriz-deliverable.js` — 4 estados de celda

`buildConformityMatrix`/`buildModuleConformityMatrix` ganan un parámetro `naCriteria` (array de `wcag_criterion`). Quien arma este array es **el propio caller** (`generate-deliverable.js`'s builder de `'matriz'`), llamando a `computeNaCriteria(axeResults, {includeExtended})` con el mismo `axeResults` que ya usa `calculate_score` — mismo patrón simétrico: cada consumidor llama a la función compartida con el mismo input, no se pasa un `naCriteria` ya calculado de un lado a otro. Esto implica que el `data` del tool `generate_deliverable` para `type:'matriz'` gana un campo nuevo opcional `axe_results` (mismo nombre/forma que ya acepta `calculate_score`) — si no viene, `naCriteria` queda vacío y el comportamiento es el actual (nunca `no_aplica`), sin romper llamadas existentes.

Nueva lógica de celda, evaluada en este orden:
1. Si el criterio de esa fila está en `naCriteria` → **todas** las celdas de esa fila son `no_aplica` (es una propiedad del criterio para todo el canal, no de una URL puntual).
2. Si no, existe un finding `review_status:'confirmado'` que afecta esa URL/módulo para ese criterio → `no_conforme`.
3. Si no, existe un finding `review_status:'requiere_revision'` → `parcialmente_conforme`.
4. Si no → `conforme`.

Para `buildModuleConformityMatrix` (agrega varias URLs en un módulo), la prioridad al resumir es `no_conforme > parcialmente_conforme > no_aplica > conforme` (peor caso gana, mismo criterio que el resto del pipeline — aunque en la práctica `no_aplica` es uniforme por fila, no varía entre URLs de un mismo módulo).

## Fuera de alcance (documentado, no bloquea)

- No se resuelve la cobertura cero de axe-core para 1.2.3/1.2.4/1.2.5 (ni para ningún otro criterio sin reglas) — sigue siendo la limitación de ~57-65% ya documentada.
- No se toca `roadmap-deliverable.js` ni `dashboard-deliverable.js` en este cambio — `parcialmente_conforme`/`no_aplica` quedan visibles en la matriz; extenderlos al roadmap/dashboard es un paso futuro si se pide.
- La escala de criticidad de 4 niveles (Crítico/Alto/Medio/Bajo) del "Cuadro de Situación" original del usuario es un tema **separado** de este cambio (este cambio es prerequisito de datos: sin `parcialmente_conforme`/`no_aplica`, esa escala no tenía de dónde salir completa) — se aborda en un diseño posterior.
