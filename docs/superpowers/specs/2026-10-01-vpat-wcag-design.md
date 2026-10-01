# Diseño: informe VPAT 2.5 (edición WCAG) en PDF

**Fecha:** 2026-10-01
**Estado:** diseño aprobado en chat (secciones 1-3), pendiente de revisión del spec escrito.
**Motivado por:** al terminar la corrida del agente se necesita una declaración de conformidad en
el formato estándar que piden las áreas de compras: VPAT® 2.5, edición WCAG (ITI).

## Objetivo

Al finalizar cada corrida, generar `vpat-wcag.pdf` en la carpeta del job: un Informe de
Conformidad de Accesibilidad con la estructura de VPAT 2.5 edición WCAG, completo (Tablas 1, 2 y
3), en español, con los niveles de conformidad en los términos oficiales en inglés.

Es un entregable más, independiente del `informe-consolidado.pdf` (no lo reemplaza ni se mezcla
con él). Su contenido sale de la misma fuente que el panel y el resto de los informes
(`computeWcagSection`), así que nunca los contradice.

## Alcance normativo

- **Siempre:** WCAG 2.0 — Tabla 1 (A, 25 criterios), Tabla 2 (AA, 13), Tabla 3 (AAA, 23).
- **Con el check "Sumar WCAG 2.2"** (`includeExtended`): se suman los criterios de 2.1 y 2.2 —
  Tabla 1 (A, 32), Tabla 2 (AA, 24), Tabla 3 (AAA, 31). Cada criterio indica su versión de origen,
  ej. "2.5.3 Etiqueta en el nombre (WCAG 2.1)".
- La sección "Estándares aplicables" refleja eso: WCAG 2.0 A/AA/AAA = Sí; WCAG 2.1 y 2.2 = Sí solo
  con el check.

## Contenido del documento

1. **Portada / encabezado:** "Informe de Conformidad de Accesibilidad — Edición WCAG (basado en
   VPAT® 2.5)", con la marca CFOTech (mismo estilo que el consolidado).
2. **Datos del producto:** Nombre del producto/versión, Fecha del informe, Descripción del producto,
   Contacto, Notas, Métodos de evaluación utilizados (siempre automático: axe-core con Playwright,
   pruebas de teclado del Agente si se ejecutaron, cantidad de páginas evaluadas y canal).
3. **Estándares aplicables** (ver arriba) y **tabla de términos** con la definición de cada nivel
   de conformidad, incluida la aclaración de *Not Evaluated (to validate)*: el agente no pudo
   verificarlo automáticamente y requiere validación humana; no implica cumplimiento.
4. **Tabla 1 (A), Tabla 2 (AA), Tabla 3 (AAA).** Columnas: Criterio · Nivel de conformidad ·
   Observaciones y explicaciones.

### Mapeo de estados

| Estado del agente | Nivel de conformidad VPAT | Observaciones |
|---|---|---|
| OK | Supports | "Verificado automáticamente, sin problemas" |
| NOK en todas las páginas evaluadas | Does Not Support | "Problemas en N de N páginas: <reglas axe>" |
| NOK en algunas páginas | Partially Supports | "Problemas en X de Y páginas: <reglas axe>" |
| A validar | Not Evaluated (to validate) | el motivo actual de `wcag-section` (requiere lector de pantalla, sin multimedia, indeterminado, etc.) |
| Criterio AAA | Not Evaluated | "Fuera del alcance de la evaluación (norma A+AA)" |

- Las reglas axe de un NOK son los `rule_id` de los findings confirmados del criterio, sin repetir.
- "A validar" nunca se informa como Supports.
- **4.1.1 Parsing:** se informa el resultado real del agente. Con el check de 2.2 marcado, se agrega
  en observaciones: "Obsoleto en WCAG 2.2; se considera satisfecho". Sin el check, sin nota.
- Una corrida sin páginas escaneadas igual genera el VPAT: los A/AA quedan Not Evaluated (to
  validate) y los métodos dicen "0 páginas evaluadas". Nunca se inventan Supports.

## Datos del producto (bloque opcional `vpat`)

```json
"vpat": { "product_name": "", "product_version": "", "description": "", "contact": "" }
```

Opcional en la config del agente y en el formulario del demo. Lo que falte se completa con
defaults (`resolveVpatInfo`):

| Campo | Default |
|---|---|
| `product_name` | dominio del sitio; fuente local (`file:`) o URL inválida → nombre del archivo/carpeta |
| `product_version` | "Evaluado el <fecha>" |
| `description` | canal + URL auditada |
| `contact` | CFOTech |

## Componentes

### Nuevos

- `src/classification/wcag-aaa-criteria.json` — 31 criterios AAA (`wcag_criterion`, `level: "AAA"`,
  `source: "wcag20" | "wcag21" | "wcag22"`, `description` en español): 23 de 2.0, 5 de 2.1, 3 de 2.2.
- `src/reporter/vpat-deliverable.js` — funciones puras:
  - `buildVpatRows({ findings, axeResults, includeExtended })` → filas por tabla (A/AA/AAA) con
    criterio, versión, nivel VPAT y observaciones. Usa `computeWcagSection` + el mapeo de arriba.
  - `resolveVpatInfo(vpat, { target, channel, date })` → datos del producto con defaults.
  - `buildVpatHtml({ jobId, channel, urls, info, rows, includeExtended, keyboardRan })` → HTML
    imprimible con `DS_CSS`. Escapa todo dato cargado por el usuario.

### Cambios

- `src/reporter/generate-deliverable.js` — builder `vpat`: arma el HTML y lo pasa a `renderPdf`
  (existente, Chromium vía Playwright, sin dependencias nuevas) → `vpat-wcag.pdf`. `renderPdf` gana
  un parámetro opcional para el texto del pie: "CFOTech · Informe de Conformidad de Accesibilidad
  (VPAT®)" (el consolidado mantiene el suyo).
- `src/config/validate-config.js` — acepta el bloque opcional `vpat`; campos no-string se ignoran
  con un aviso (mismo patrón que los campos retirados).
- `src/tools/tool-registry.js` — `generate_deliverable` documenta el tipo `vpat`.
- `scripts/demo-config.js` — grupo opcional "Datos para el VPAT" (nombre, versión, descripción,
  contacto); viajan a `config.vpat`; el resumen previo los muestra solo si se cargaron.
- `scripts/demo.js` — se agrega `{ type: 'vpat', key: 'vpat', label: 'VPAT 2.5 (WCAG)', open:
  'vpat-wcag.pdf' }` a `DELIVERABLES` y se pasa `vpat` en los datos del entregable. Aparece en el
  visor de informes junto al PDF consolidado.

No se tocan `demo-panel.html` ni `demo-page-selection.js` (tienen cambios del usuario sin commitear).

## Flujo

Fin de corrida → `demo.js` (o el agente vía `generate_deliverable`) llama
`generateDeliverable('vpat', { jobId, channel, findings, axeResults, urls, includeExtended,
keyboardResults, vpat, target })` → `buildVpatRows` + `resolveVpatInfo` + `buildVpatHtml` →
`renderPdf` → `<outputDir>/vpat-wcag.pdf`.

## Errores

- Si falla el PDF (ej. Chromium no arranca), el demo marca como fallido solo ese entregable con
  `friendlyError` y sigue con los demás (comportamiento actual del loop de `DELIVERABLES`).
- Datos del producto inválidos nunca frenan la corrida: se ignoran con aviso y se usan defaults.

## Tests (`node --test`, TDD)

- `src/reporter/vpat-deliverable.test.js`
  - Mapeo: OK→Supports; NOK en todas las páginas→Does Not Support; NOK en 2 de 5→Partially Supports
    con "Problemas en 2 de 5 páginas" y las reglas axe; A validar→"Not Evaluated (to validate)" con
    el motivo de `wcag-section`.
  - Alcance: sin check solo 2.0 (25/13/23); con check suma 2.1/2.2 (32/24/31) y cada fila lleva su
    versión.
  - AAA: todas Not Evaluated con la observación de fuera de alcance.
  - 4.1.1: la nota de obsoleto aparece solo con el check.
  - Consistencia: los conteos Supports + Partially + Does Not + Not Evaluated (to validate) de A/AA
    coinciden con ok / nok / a_validar de `computeWcagSection`.
  - Corrida sin páginas: ningún Supports.
  - `resolveVpatInfo`: usa los datos cargados; vacíos → defaults; URL inválida y `file:` → nombre
    del archivo/carpeta.
  - HTML: escapa `<script>` en el nombre del producto; contiene las tres tablas, la tabla de
    términos y los estándares aplicables según el check.
- `src/reporter/generate-deliverable.test.js` — un test del builder `vpat` que genera el PDF real
  con Chromium y verifica que `vpat-wcag.pdf` existe y empieza con `%PDF`.
- `src/config/validate-config.test.js` — acepta `vpat`; ignora no-strings con aviso; sin `vpat`
  sigue válida.
- `scripts/demo-config.test.js` — los campos opcionales viajan a `config.vpat`; el resumen los
  muestra solo si se cargaron.

## Fuera de alcance

- Tabla de Revised Section 508 / EN 301 549 (otras ediciones de VPAT).
- Traducción al inglés o versión bilingüe.
- Edición manual del VPAT desde el panel después de la corrida (los "to validate" se resuelven
  fuera del agente por ahora).
