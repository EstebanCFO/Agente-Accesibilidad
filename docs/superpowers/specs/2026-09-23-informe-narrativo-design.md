# Diseño: Informe Narrativo (Crítico/Alto/Medio/Bajo) — 6to entregable

**Fecha:** 2026-09-23
**Motivado por:** pedido del usuario de sumar el "Prompt de Evaluación WCAG 2.0 A y AA" (bloque por criterio + escala de criticidad Crítico/Alto/Medio/Bajo + corrida secuencial de herramientas) a la responsabilidad general del agente.
**Estado:** aprobado en chat, pendiente de plan de implementación.

## Spike previo: qué de "la corrida secuencial de 5 herramientas" es real

El pedido original exige correr axe-core → Lighthouse → WAVE → Accessibility Insights → ARC Toolkit en secuencia. Investigación real (no supuesta) antes de diseñar:

| Herramienta | Veredicto verificado |
|---|---|
| **axe-core** | Ya integrado (motor real de este proyecto). |
| **Lighthouse** | El paquete npm `lighthouse` (v13.5.0) tiene `axe-core: ^4.13.0` como dependencia directa — confirmado con `npm view lighthouse dependencies`. Su categoría de Accessibility está construida sobre el mismo axe-core que ya usamos. **No aporta motor de detección nuevo.** |
| **Accessibility Insights** (Microsoft) | El paquete automatizable `accessibility-insights-scan` depende de `axe-core`/`@axe-core/puppeteer` — confirmado leyendo su manifiesto de dependencias. Mismo motor, otra marca. FastPass/Assessment (tab-stops, checklist manual) son explícitamente para un humano con la extensión de navegador, no automatizables. |
| **WAVE** (WebAIM) | Sin motor local ni gratuito. Solo vía API paga de WebAIM (por crédito o licencia Enterprise on-prem), y la API hosteada manda la URL/contenido de la página a los servidores de WebAIM — riesgo real de exposición de datos si se audita un sitio no público de un cliente bancario. |
| **ARC Toolkit** (TPGi) | La extensión gratuita es 100% manual, sin API. La automatización solo existe en "ARC Platform" (Vispero), un producto empresarial pago aparte, distinto del ARC Toolkit gratuito que nombra el pedido. |

**Decisión (confirmada con el usuario):** no se integra ninguna herramienta nueva. axe-core sigue siendo la única fuente automática de detección (más la revisión con IA con visión ya existente, `visual_audit`/`ux_compliance_review`, que sí es una capa de detección genuinamente adicional). El informe narrativo documenta explícitamente esta decisión y por qué — no se omite en silencio.

## Escala de criticidad (Crítico/Alto/Medio/Bajo)

Mapeo determinístico a partir de datos que el pipeline ya produce por finding (`wcag_level`, `severity` de axe-core, `affected_urls.length` como proxy de "componente reutilizado en muchas pantallas") — sin pedir tags de negocio nuevos. Evaluado en este orden de prioridad (primer match gana):

1. **Crítico**: `wcag_level === 'A'` y `severity === 'critical'`.
2. **Bajo**: `severity === 'minor'` — gana incluso sobre un criterio Nivel AA. Ajuste explícito sobre la propuesta original: "Bajo" (incumplimiento puntual sin impacto funcional) es más fiel a lo que describe un `minor` de axe-core que forzarlo a "Medio" solo por ser AA.
3. **Alto**: `wcag_level === 'A'` con `severity` en `serious`/`moderate`, **o** el finding afecta más de una URL escaneada (proxy de "componente reutilizado en muchas pantallas").
4. **Medio**: cualquier otro caso Nivel AA (afecta una sola URL, severidad serious/moderate).
5. Si ninguna de las anteriores aplica (no debería pasar con los 38 ONTI, todos A o AA): Bajo, por defecto conservador.

Cuando un criterio tiene varios findings `confirmado` (distintas URLs/reglas), se toma el **peor caso** (Crítico > Alto > Medio > Bajo), mismo patrón que ya usa `worseSeverity` en `classify-findings.js`.

## Estado por criterio (7 valores)

Evaluado en este orden de prioridad para cada uno de los 38 criterios ONTI:

1. **`No aplica`** — el criterio está en la lista de N/A (`computeNaCriteria`, ya construido).
2. **Crítico / Alto / Medio / Bajo** — hay al menos un finding `review_status:'confirmado'` para este criterio; el valor es la criticidad del peor de esos findings (sección anterior).
3. **`Requiere revisión`** — no hay ningún finding `confirmado`, pero sí al menos uno `review_status:'requiere_revision'` (axe-core marcó `incomplete`, no pudo confirmar solo). Se mantiene como estado propio en vez de degradarlo a "Bajo" — perder esa distinción rompería el principio de "nunca asumir éxito" que ya rige el resto del pipeline.
4. **`Cumple`** — no hay ningún finding para este criterio (y no es N/A).

## "Impacto en flujos esenciales"

No existe hoy ningún dato que etiquete una URL como "flujo esencial" (login, transferencia, alta de producto). En vez de inventar una heurística sobre el nombre del módulo (frágil y potencialmente engañosa en un reporte regulatorio), este campo:

- Si el job trae un nuevo campo de config opcional `essential_flows` (array de `{ name, url_pattern }`, ej. `{name: "Login", url_pattern: "*/login*"}`), se usa para marcar qué findings afectan un flujo nombrado.
- Si no viene esa config, el campo queda explícitamente `"No determinado — requiere que el cliente indique qué páginas corresponden a flujos esenciales (login, transferencias, alta de producto)."` — no se adivina.

## Estructura del entregable nuevo

**Archivos:** `informe-narrativo.json` + `informe-narrativo.html` (JSON + HTML, sin XLSX — igual que `score`/`dashboard`, que tampoco lo llevan; este es un informe narrativo, no una planilla de trabajo como inventario/roadmap/matriz).

**`informe-narrativo.json`** — envelope `{job_id, channel, generated_at, criterios: [...38 bloques ordenados por número...], resumen}`. Cada bloque:
```json
{
  "numero": 1,
  "criterio": "1.1.1",
  "nombre": "Contenido no textual",
  "principio": "Perceptible",
  "nivel": "A",
  "estado": "Alto",
  "hallazgos": [
    {
      "descripcion": "...",
      "herramientas": ["axe-core"],
      "elementos_afectados": ["<img src=\"...\">"],
      "impacto_flujo": "No determinado - ..."
    }
  ],
  "recomendacion": "..."
}
```
`principio` se deriva del primer dígito de `criterio` (1→Perceptible, 2→Operable, 3→Comprensible, 4→Robusto) — no es un campo nuevo en `onti-38-criteria.json`, se calcula. Los 38 criterios se ordenan numéricamente (no en el orden interno actual del JSON, que agrupa por nivel A/AA) para que salgan agrupados por Principio tal como los listó el usuario — verificado: son exactamente los mismos 38, ya confirmados.

**Cada elemento de `hallazgos[]` corresponde a un finding completo** (no a un elemento DOM individual dentro de un finding) — un criterio puede tener varios findings si distintas reglas/fuentes lo tocan (ej. una regla de axe-core + un hallazgo de `visual_audit` sobre el mismo criterio). Mapeo campo a campo desde el finding ya existente:
- `descripcion` ← `finding.failure_summary`
- `herramientas` ← `[finding.source]`, traducido a etiqueta legible: `axe-core` → `"axe-core"`, `visual_audit` → `"IA (revisión visual)"`, `ux_review` → `"IA (revisión UX)"`
- `elementos_afectados` ← `[finding.element_sample]` (un solo elemento de muestra por finding, tal como ya lo guarda `classify-findings.js`/`report-findings-schema.js` — no se inventa una lista de elementos que el pipeline no captura)
- `impacto_flujo` ← resuelto contra `essential_flows` de la config si vino, si no el texto fijo de "No determinado"

**`informe-narrativo.html`** — el mismo contenido en el formato de bloque de texto pedido literalmente (Número/Nombre, Principio, Nivel, Estado, Hallazgos, Recomendación por criterio), más una nota fija documentando la decisión de herramientas (tabla del spike de arriba, resumida), más el **resumen final obligatorio**: cantidad de criterios por estado, listado priorizado de Crítico+Alto, flujos esenciales afectados (o la nota de "no determinado"), y una recomendación general de priorización (ej. "atender primero los N criterios Crítico, luego los M Alto que afectan componentes reutilizados").

## Fuera de alcance (documentado, no bloquea)

- No se integra Lighthouse/WAVE/Accessibility Insights/ARC Toolkit — decisión ya tomada arriba.
- Este entregable no reemplaza la Matriz de Criticidad existente (grilla compacta criterio×URL/módulo) — son complementarios, uno para vista rápida, este para detalle narrativo de auditoría.
- `essential_flows` en la config es un campo nuevo opcional — si el cliente nunca lo completa, el informe simplemente lo deja explícito como pendiente, no bloquea la generación del entregable.
