# Diseño: Integración real de visual_audit y ux_compliance_review

**Fecha:** 2026-09-22
**Spec de referencia:** `docs/reference/SPEC-agente-f1-compliance-v0.3.md` §6.1 (tabla de skills externos), §8.3 (schema de finding), §19 (detalle de integración de skills).
**Estado:** aprobado en chat, pendiente de plan de implementación (superpowers:writing-plans).

## Contexto y hallazgo del spike previo

La SPEC describe `visual_audit` (`antfu/rams`) y `ux_compliance_review` (nombrado como `Leonxlnx/web-design-guidelines` en la SPEC, repo que no existe con ese nombre exacto) como si fueran APIs deterministas: input `url, screenshot, dom_snapshot` → output `visual_findings[]`/`ux_findings[]` estructurado.

Investigación real (búsqueda web + lectura de los repos): estos son archivos `SKILL.md` — prompts en markdown pensados para cargarse en el contexto de un agente LLM y guiar **su propio juicio** al revisar **código fuente**, no una URL en vivo. El output nativo es texto libre en formato `archivo:línea`, no JSON estructurado. `ui-skills.com` expone un MCP (`list_skills`/`get_skill`) que devuelve el *contenido* del skill, no un endpoint que analice una URL.

**Consecuencia de diseño:** no podemos "llamar" a estos skills como si fueran funciones puras (como `scanUrl`/`classifyFindings`). La integración real consiste en: (1) vendorizar el conocimiento/reglas de estos skills como contexto, y (2) usar ese contexto para guiar una llamada real a un modelo con visión (Claude, vía `@anthropic-ai/sdk`, ya dependencia del proyecto) sobre una screenshot de la página, forzando con tool-use que la respuesta salga en el JSON exacto que necesita el resto del pipeline (schema de finding de SPEC §8.3). Esto es un cambio de naturaleza real respecto al resto del pipeline: pasa de ser 100% código determinista y gratis a incluir una llamada de inferencia paga y no determinista por URL.

Decisiones tomadas con el usuario antes de este documento:
- Se implementan **ambos** tools esta vuelta (`visual_audit` y `ux_compliance_review`), no solo uno.
- El contenido de guía se **vendoriza** como snapshot estática en el repo (no fetch en vivo por job) — determinista, testeable, con nota de fuente + fecha.
- `ux_compliance_review` usa el HTML/DOM ya capturado por axe-core como stand-in simplificado de "interaction_flows" (no se construye un pipeline de detección de flujos de interacción — eso queda fuera de alcance, documentado como limitación aceptada).
- El cliente de Anthropic se **inyecta y se mockea** en los tests automatizados (excepción documentada a la convención "sin mocks" del resto del repo, justificada por costo real y no-determinismo de una llamada con visión). Una corrida real de punta a punta se valida a mano una sola vez, no en la suite.

## Componentes

### 1. Captura de screenshot + HTML (`src/scanner.js`)

`scanOne`/`scanUrl`/`scanBatch` ganan dos opciones nuevas y opt-in, default `false` ambas:
- `captureScreenshot`: agrega `screenshot` (string base64 PNG, `page.screenshot({ fullPage: true })`) al resultado.
- `captureHtml`: agrega `html` (string, `page.content()` — el DOM completo de la página, no el snippet de un nodo individual como el `element_sample` que ya arma `classify-findings.js` por violación) al resultado.

Cuando ambas están en `false` (el comportamiento actual de todo caller existente), ningún campo nuevo aparece — cambio puramente aditivo, no rompe ningún test ni contrato existente de `scan_url`/`scan_batch`. `ux_compliance_review` es quien necesita `captureHtml: true` (ver componente 3); `visual_audit` solo necesita `captureScreenshot: true`.

### 2. Guías vendorizadas (`src/visual-review/references/`)

- `rams-visual-guidelines.md` — snapshot de las reglas de `antfu/skills` (`web-design-guidelines`/rams) relevantes a accesibilidad visual (contraste, spacing, touch targets, tipografía). Encabezado con fuente (URL de GitHub) y fecha de captura.
- `ux-interaction-guidelines.md` — snapshot equivalente para coherencia de navegación, mensajes de error y patrones de formularios (basado en las guías de interfaz web disponibles, ya que el repo exacto que nombra la SPEC no existe — se documenta esa discrepancia en el propio archivo).

Ambos son texto estático versionado en git, igual que `onti-38-criteria.json`. Se actualizan a mano si hace falta; no hay sincronización automática con el upstream.

### 3. Módulo de review (`src/visual-review/`)

**`report-findings-schema.js`** — helper compartido: arma el `tool` de Anthropic (`report_findings`, tool-use forzado con `tool_choice`) cuyo `input_schema` es un array de objetos con la forma exacta de finding de SPEC §8.3 (`wcag_criterion`, `wcag_level`, `severity`, `failure_summary`, `remediation_hint`, y opcionalmente `element_sample`). Se le pasa al modelo la lista de los 38 criterios ONTI + 18 extendidos (reusando `ontiCriteria`/`extendedCriteria` ya exportados desde `wcag-map.js`) para que el propio modelo elija el criterio más cercano o directamente no reporte el hallazgo si no aplica ninguno (mismo criterio D7 que ya usa `classify-findings.js`).

**`visual-audit.js`** — `runVisualAudit({ url, screenshot }, { anthropicClient, model = 'claude-sonnet-5' })`:
1. Arma un mensaje `user` con un bloque de imagen (la screenshot) + el contenido de `rams-visual-guidelines.md` + instrucciones.
2. Llama a `anthropicClient.messages.create(...)` forzando la tool `report_findings`.
3. Extrae el `tool_use` de la respuesta y normaliza cada item a la forma completa de finding SPEC §8.3: `id` (uuid nuevo), `source: 'visual_audit'`, `rule_id: 'visual_audit:<slug-del-hallazgo>'`, `onti_criterion`/`in_scope` derivados del `wcag_criterion` elegido (vía la misma lógica de `classifyByWcagTags`/lookup directo contra `ontiCriteria`/`extendedCriteria`), `affected_urls: [url]`, `occurrences: 1`.
4. Normalización defensiva: si el modelo devuelve un `severity` fuera de la enum, cae a `'moderate'`; si falta `wcag_criterion` o no matchea ningún criterio conocido, ese finding puntual se descarta (no rompe el resto de la respuesta).

**`ux-compliance-review.js`** — `runUxComplianceReview({ url, html, screenshot }, { anthropicClient, model })`: mismo patrón que `visual-audit.js`, con `source: 'ux_review'`, usando `ux-interaction-guidelines.md` como guía y el `html` completo de la página (capturado con `captureHtml: true`, componente 1) como input principal para inferir formularios/navegación/mensajes de error — la screenshot es opcional, solo como contexto visual adicional, no el input primario como en `visual_audit`.

### 4. Wiring (`src/tools/tool-registry.js`, `src/api/server.js`)

- `TOOL_SCHEMAS` gana dos entradas nuevas: `visual_audit` (`{url, screenshot}` → `visual_findings[]`) y `ux_compliance_review` (`{url, html, screenshot?}` → `ux_findings[]`), ambas por URL individual (sin variante batch, igual que la tabla de SPEC §6.1 las describe). El agente obtiene `screenshot`/`html` llamando antes a `scan_url`/`scan_batch` con `capture_screenshot`/`capture_html` en `true` (nuevos inputs opcionales en esos dos schemas existentes) y pasando esos campos del resultado como input de estas tools nuevas.
- `createToolRegistry({ jobStore, anthropicClient })` gana un segundo parámetro opcional (no rompe los call sites existentes, incluidos los de los tests que no ejercitan estas dos tools); los handlers de `visual_audit`/`ux_compliance_review` delegan en `runVisualAudit`/`runUxComplianceReview` pasando ese cliente.
- `src/api/server.js` reordena la construcción: el `anthropicClient` se crea antes de `createToolRegistry(...)` (hoy se crea después, solo para `AgentLoop`) y se pasa a ambos.
- No hay orquestación hardcodeada nueva: el agente ya recibe la config completa (con `config.skills.visual_audit`/`config.skills.ux_compliance_review`) en el prompt inicial (`buildInitialPrompt`) y decide él mismo cuándo llamar estas tools, sobre qué URLs, y cómo fusionar `visual_findings`/`ux_findings` con los del `classify_findings` de axe-core antes de `calculate_score`/`generate_deliverable` — mismo principio ya usado para `scan_batch` (SPEC §4.1: el agente es dueño de su propio flujo de control).

## Testing

- `scanner.test.js`: nuevos casos reales (gratis, sin mock) verificando que `captureScreenshot: true` agrega un `screenshot` base64 no vacío y `captureHtml: true` agrega un `html` no vacío con el DOM de la página, y que por default (sin esas opciones) ninguno de los dos campos aparece.
- `visual-audit.test.js` / `ux-compliance-review.test.js`: cliente Anthropic **inyectado y mockeado** (`{ messages: { create: async () => ({...}) } }` con una respuesta `tool_use` enlatada) — testean: el prompt incluye la screenshot y el contenido de la guía; la normalización arma correctamente el finding completo; un `severity` inválido cae al default; un `wcag_criterion` que no matchea se descarta sin romper el resto.
- `tool-registry.test.js`: caso de integración con el mismo cliente mockeado, confirmando que las tools nuevas están registradas y devuelven la forma esperada.
- **Excepción documentada:** esta es la única parte del repo donde se mockea una dependencia externa en tests automatizados — justificado porque, a diferencia de axe-core/Playwright/crawlee (gratis, deterministas), una llamada real a un modelo con visión tiene costo de inferencia real y salida no determinista, lo que la hace inadecuada para correr en cada `npm test`. Una validación real de punta a punta (llamada real a Claude con una screenshot real) se hace una sola vez a mano antes de dar el trabajo por terminado, mismo patrón ya usado para validar `scanUrl` con el prototipo MCP+axe-core antes de escribir `scanner.js`.

## Fuera de alcance (documentado, no bloquea)

- `generate_remediation_plan` (`ibelick/improve-ui`, tercer skill de SPEC §19.2) — no se toca en esta vuelta; sigue siendo la razón por la que `roadmap.estimated_effort` es `null`.
- Detección real de `interaction_flows` durante el crawl — `ux_compliance_review` usa el DOM ya capturado por axe-core como aproximación, no un pipeline de detección de flujos dedicado.
- Empaquetado del agente completo como Agent Skill (`agentskills.io`, SPEC §19.3) — no forma parte de este cambio.
