# Diseño: auditoría en tres secciones + pruebas de teclado del Agente

**Fecha:** 2026-09-30
**Estado:** diseño aprobado en chat (partes 1-3), pendiente de revisión del spec escrito.
**Motivado por:** revisión de qué cuentan las tarjetas del panel. La revisión con IA (visual + UX)
evaluaba cosas que no puede ver (foco, hover, errores de formulario, coherencia entre páginas) y
las guías caseras pedían más que la norma BCRA. Se compararon además los skills
`wshobson/agents` → `wcag-audit-patterns` y `screen-reader-testing`.

## Objetivo

Reorganizar la auditoría en tres secciones independientes, cada una con su propia tarjeta en el
panel y su propio bloque en los informes:

1. **Compliance WCAG** (normativa BCRA = WCAG 2.0 A/AA; + WCAG 2.1/2.2 si se marca "Sumar WCAG 2.2").
   Única sección que habla de cumplimiento.
2. **Buenas prácticas** (reglas `best-practice` de axe-core). Complementaria, puntaje propio.
3. **Pruebas de teclado del Agente** (Playwright + interpretación con IA). Complementaria,
   puntaje propio. Reemplaza la revisión visual y la de UX.

Ninguna sección complementaria modifica a otra.

## Sección 1 — Compliance WCAG

### Estados por criterio (consolidado entre páginas)

| Estado | Regla |
|---|---|
| **OK** | axe-core tiene reglas para el criterio, al menos una se evaluó (`passes`) y ninguna falló ni quedó `incomplete` en ninguna página. |
| **NOK** | Al menos una violación de axe-core en al menos una página. |
| **A validar** | El criterio no tiene reglas automáticas (los 21 de `MANUAL_REVIEW` en `report-helpers.js`, u otros sin cobertura), o tiene algún resultado `incomplete` sin ninguna violación. Lleva el método de validación (lector de pantalla, teclado, revisión visual, etc.). |
| **No aplica** | Regla actual de `na-criteria.js`: todas sus reglas salieron solo `inapplicable` en todas las páginas. Sale del denominador. |

Cambio clave respecto de hoy: **"A validar" ya no cuenta como conforme.** Hoy un criterio
`no_evaluado` se suma a `onti_criteria_compliant`.

### Resultado: sin veredicto

- Se muestra solo el conteo: `OK X · NOK Y · A validar Z (de N)`, donde N = criterios en alcance
  menos los que no aplican.
- **Se eliminan** el umbral ≥30/38, `onti_conformance`, `effective_conformance_threshold` y todo
  texto "Conforme / No conforme" a nivel sitio, en el panel y en los informes.
- El veredicto queda para después de que una persona complete la validación (fuera de alcance).
- Por página y por módulo (`calculate-score.js`) se aplica el mismo conteo; se elimina el
  porcentaje de cumplimiento.

### Tarjetas del panel

- **"Compliance WCAG"**: `OK 22 · NOK 5 · A validar 11 (de 38)`. El anillo muestra la proporción
  validada ((OK+NOK)/N), no un % de cumplimiento. Rótulo: "WCAG 2.0 (BCRA)" o "WCAG 2.0 (BCRA) + 2.2".
- **"Problemas WCAG"** (ya existente, `buildSeverityCard`): se mantiene como desglose por severidad
  de las violaciones que generan los NOK.

## Sección 2 — Buenas prácticas

- El escaneo suma el tag `best-practice` a `wcagTags` (`demo-config.js`), siempre activo.
- Las violaciones `best-practice` **no** entran a la Sección 1 ni a la tarjeta "Problemas WCAG"
  (ya filtradas por tag en `countViolationsByImpact`).

### Estados por regla (consolidado entre páginas)

| Estado | Regla |
|---|---|
| **Cumple** | `passes` en todas las páginas donde aplica. |
| **Mejora sugerida** | `violation` o `incomplete` en al menos una página. |
| **No aplica** | Solo `inapplicable`. |

### Puntaje ponderado por impacto

- Peso por impacto de la regla en axe-core: crítica 4 · seria 3 · moderada 2 · menor 1. Una regla
  en `passes`/`inapplicable` no trae `impact`: se toma el impacto declarado por la regla en
  axe-core (`axe.getRules()` / metadata de la regla); si no hay, peso 2.
- Puntaje = Σ peso(Cumple) / Σ peso(Cumple + Mejora sugerida). "No aplica" queda afuera.
- Tarjeta **"Buenas prácticas"**: `82% · 18 cumplen · 6 a mejorar · 11 no aplican`.

## Sección 3 — Pruebas de teclado del Agente

Cubre 4 de los criterios que requieren tecnología asistiva: **2.1.2, 2.4.3, 2.4.7, 3.2.1**.

### Recorrido (`src/keyboard/keyboard-walk.js`, determinístico)

- Corre en el mismo `page` de `scanOne` (`src/scanner.js`, opción nueva `captureKeyboard`), después
  de axe-core. No recarga la página.
- Presiona Tab hasta **60 paradas** (`MAX_TAB_STOPS`) o hasta que el foco vuelve al primer elemento.
- Por parada registra: `index`, `tag`, `role`, `name` (nombre accesible), `selector`, `bbox`
  (posición en pantalla), y dos recortes JPEG de la misma zona (con padding): **con foco** y
  **sin foco** (tras `blur()`).
- Señales:
  - **2.1.2 trampa**: el foco repite un ciclo corto de elementos sin haber recorrido la página y
    Shift+Tab no lo saca.
  - **3.2.1 al recibir foco**: cambia la URL, se abre una pestaña/ventana o aparece un diálogo solo
    por recibir foco.
  - **2.4.3 saltos**: paradas donde el foco retrocede claramente hacia arriba o cruza contra el
    orden de lectura (tolerancia de misma fila).
  - **2.4.7 cambio visual**: % de píxeles distintos entre recorte con foco y sin foco.
- 2.1.2 y 3.2.1 se deciden solo con estas reglas.

### Hoja de contactos (`src/keyboard/contact-sheet.js`)

- Una imagen por página: pares con foco / sin foco, numerados, en grilla. Se genera renderizando
  un HTML en Playwright y capturándolo (sin dependencias nuevas).

### Interpretación con IA (`src/keyboard/keyboard-review.js`)

- **Una consulta por página** (modelo `AI_MODEL`, cliente Anthropic inyectado).
- Entrada: hoja de contactos + lista de paradas en texto + señales automáticas (saltos, % de cambio).
- Salida vía tool (`report_keyboard_review`): para **2.4.3** y **2.4.7**, `sin_indicios` |
  `con_indicios`, paradas involucradas y una oración de motivo.
- Se mantiene la protección anti prompt-injection: el contenido del sitio es dato, no instrucción.
- Se conservan `cache_control` en el bloque estático y la contabilidad de uso (`usage-cost.js`).

### Estados y puntaje

- Por página × criterio: **Sin indicios / Con indicios / No evaluable** (recorrido fallido o sin
  elementos enfocables).
- Puntaje = % de pares página×criterio "Sin indicios" sobre los evaluables.
- Tarjeta **"Pruebas de teclado del Agente"**: `75% · 3 con indicios · 12 sin indicios`.
- Tarjeta **"Consumo de IA"**: se mantiene.
- **Nunca cambia la Sección 1:** los 4 criterios siguen "A validar"; la evidencia de teclado se
  adjunta a ese criterio como ayuda para quien valida.

### Manejo de errores

- Recorrido falla → página "No evaluable" para los 4 criterios; la auditoría sigue.
- IA falla → se usan solo las señales automáticas (2.4.7: 0% de cambio = con indicios; 2.4.3:
  saltos detectados = con indicios) y el resultado se marca "sin interpretación del Agente".

## Panel del demo

- Configuración: las casillas `visualAudit` y `uxReview` se reemplazan por una sola
  `keyboardReview` — "Pruebas de teclado del Agente (orden y visibilidad del foco, trampas de
  teclado, cambios al recibir foco)".
- `STEP_LABELS`: `'Relevar páginas', 'Escanear', 'Clasificar ONTI/BCRA', 'Pruebas de teclado del
  Agente', 'Informes'` (los pasos 4 y 5 se fusionan en uno).
- El paso de teclado muestra la hoja de contactos de cada página con las paradas "con indicios"
  marcadas. El recorrido corre durante el escaneo; la IA en segundo plano (`startAiReviews`
  adaptado, misma concurrencia `AI_CONCURRENCY`).
- Tarjetas, en orden: Compliance WCAG · Problemas WCAG · Buenas prácticas · Pruebas de teclado del
  Agente · Consumo de IA.

## Informes (`src/reporter/`)

Los 9 entregables se reorganizan en las tres secciones, en el orden del panel.

- **Dashboard, informe narrativo, PDF, matriz**: Sección 1 con conteo por criterio, sin veredicto ni
  umbral; cada "A validar" con su método y, si existe, la evidencia de teclado. Sección 2: tabla de
  reglas con estado y puntaje. Sección 3: por página, los 4 criterios con hoja de contactos y motivos.
- **Matriz (HTML/Excel)**: estados OK / NOK / A validar / No aplica; hoja nueva "Buenas prácticas".
- **Inventario y roadmap**: el roadmap de remediación contiene solo los NOK de la Sección 1; las
  buenas prácticas van en una sección "Mejoras sugeridas" aparte.
- **Consolidado multi-job** (`consolidate-jobs.js`, `consolidated-dashboard-deliverable.js`): suma
  los conteos de las tres secciones; se elimina el promedio de cumplimiento.
- `finding-sources.js`: `COMPLEMENTARY_SOURCES` pasa a `['keyboard_review']`.

## Agente autónomo, configuración y SPEC

Además del demo, el agente (`src/agent-loop.js` + `src/tools/tool-registry.js`) usa lo mismo:

- **Tools**: se eliminan `visual_audit` y `ux_compliance_review`; se agrega `keyboard_review`
  (`url` + `keyboard_path` persistido a disco por `scan_url`/`scan_batch` con
  `capture_keyboard: true`, mismo patrón de "path, no blob inline" que hoy usan screenshot/html).
  `scan_url`/`scan_batch` reemplazan `capture_screenshot`/`capture_html` por `capture_keyboard`.
- **`calculate_score`**: se elimina el parámetro `conformance_threshold`; devuelve los conteos de
  las tres secciones.
- **Prompt del agente** (`agent-loop.js:5`): se quita "umbral X/38" y se describe el resultado como
  conteo OK / NOK / A validar sin veredicto.
- **Config** (`src/config/validate-config.js`): `skills` pasa a
  `{ keyboard_review: true, generate_remediation_plan: true }`; `wcag.conformance_threshold` se
  elimina (validar que una config vieja con ese campo o con `visual_audit`/`ux_compliance_review`
  no rompa: se ignora con aviso).
- **SPEC**: `docs/reference/SPEC-agente-f1-compliance-v0.3.md` → **v0.4**. §19.2 registra que
  `antfu/rams` y `Leonxlnx/web-design-guidelines` se reemplazan por `keyboard_review` (el segundo
  repo no existe; ambos evaluaban cosas que no se pueden ver en una captura o HTML estático) y que
  `ibelick/improve-ui` se mantiene como sub-proyecto 5. Se actualizan también las secciones de
  umbral de conformidad y de entregables afectadas.

## Se elimina

- `src/visual-review/visual-audit.js`, `ux-compliance-review.js`, `clean-html.js`,
  `references/rams-visual-guidelines.md`, `references/ux-interaction-guidelines.md` y sus tests.
- `report-findings-schema.js` se reemplaza por el esquema de `report_keyboard_review`.
- La captura de página completa y el HTML de `scanOne` que solo servían a esas revisiones
  (`captureScreenshot`/`captureHtml`), salvo que otro consumidor los use (verificar en el plan).

## Pruebas (TDD)

- **Unitarias (lógica pura)**: estados de la Sección 1; estados y puntaje ponderado de la Sección 2;
  puntaje de la Sección 3; detección de trampa, saltos, cambio al recibir foco y % de cambio de
  píxeles con datos armados a mano; tarjetas del panel (`demo-results.js`).
- **Recorrido de teclado**: fixtures HTML locales con Playwright real (sin mocks): trampa de foco,
  orden roto, `outline: none`, cambio de página al recibir foco, página sin enfocables.
- **IA**: cliente Anthropic inyectado y mockeado (excepción ya documentada del repo).
- **Informes**: tests existentes actualizados a la nueva estructura.
- **Validación en vivo**: corrida real del demo contra el sitio de referencia; parámetros (60
  paradas, tolerancias) se ajustan después según cómo responda.

## Fuera de alcance (sub-proyectos siguientes)

1. Checklist manual con lector de pantalla basado en `screen-reader-testing`, completado con los
   criterios BCRA que le faltan (1.4.2, 1.4.5, 2.4.5).
2. `generate_remediation_plan` (`ibelick/improve-ui`, SPEC §19.2): verificar que el skill exista y
   analizarlo; generar por cada NOK de la Sección 1 (y opcionalmente cada "Mejora sugerida" de la
   Sección 2) problema, criterio, código correcto de ejemplo, esfuerzo estimado (completa
   `roadmap.estimated_effort`, hoy `null`) y dependencias. Absorbe los patrones de corrección con
   código de `wcag-audit-patterns` para la columna "Cómo corregir".
3. Hoja de contactos con el recorrido dibujado sobre la captura (enfoque 2), si hace falta.
4. Veredicto de cumplimiento tras la validación humana.

## Enmienda 2026-09-30 — informe alineado con el panel (adelanta parte del Plan C)

Motivo: el panel ya mostraba el cálculo nuevo ("8 OK · 5 NOK · 24 a validar (de 37)") mientras
el informe "Score de cumplimiento inicial" seguía diciendo "32/37 CONFORME" (los 24 sin
verificar contados como conformes) y sus tablas usaban una tercera lógica propia.

- **Única fuente**: `computeWcagSection` agrega `reason: { code, text }` por criterio:
  - `ok` → `verificado`: "Verificado automáticamente, sin problemas".
  - `nok` → `con_problemas`: "Problemas en N página(s)".
  - `a_validar` → `indeterminado` (axe `incomplete`: "El agente no pudo determinarlo
    automáticamente"), `requiere_asistiva` / `requiere_manual` (criterio sin reglas automáticas;
    método de `MANUAL_REVIEW`, que se mueve a `src/classification/manual-review.js`) o
    `sin_elementos` (tiene reglas, pero ninguna encontró elementos en las N páginas — decisión
    del usuario: sigue "A validar", con motivo).
  - `no_aplica` → `sin_multimedia`: "No se encontró audio ni video en las N página(s) evaluadas".
- **Informe "Score de cumplimiento inicial"** (dashboard, y por lo tanto el PDF): bloque superior
  con los mismos números y rótulo que la tarjeta del panel; **sin** "CONFORME / NO CONFORME",
  **sin** umbral (decisión del usuario) y sin porcentaje. Nivel A/AA como conteos. Tablas por
  pauta y de los 38 criterios con los mismos estados; tabla nueva "Criterios a validar y no
  aplicables" con motivo por criterio; anexo "Reglas evaluadas por página".
- **Portada del PDF y resumen del informe narrativo**: mismos conteos, sin veredicto.
- **Log por página del demo**: distingue reglas y criterios —
  "WCAG — X reglas con problemas, Y a revisar, Z aprobadas (N criterios con verificación) ·
  Buenas prácticas — A a mejorar, B cumplen".
- Quedan en el Plan C: matriz por página, consolidado multi-job, agente/config, SPEC v0.4.
