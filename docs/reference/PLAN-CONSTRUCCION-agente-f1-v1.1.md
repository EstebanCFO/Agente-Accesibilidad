# PLAN DE CONSTRUCCIÓN — Agente Autónomo F1 · Compliance Accesibilidad

**Proyecto:** CFOTech IT Global Services — Entidad Financiera  
**Referencia:** SPEC-agente-f1-compliance-v0.3.md · Propuesta_Accesibilidad_EntidadFinanciera_v7.pptx  
**Versión:** 1.1  
**Fecha:** Septiembre 2026  
**Estado:** Aprobación pendiente — no se construye nada hasta green light  

**Cambios v1.1 (alineación con SPEC v0.3 y la propuesta):**
- Referencia actualizada a SPEC **v0.3**.
- Se separa explícitamente el **cronograma de construcción del agente** (este plan, ~3 semanas de build interno) del **plazo del servicio F1 ante el cliente** (2 semanas, S1–S2 del plan de trabajo de la propuesta). No son lo mismo.
- Fase 4: se aclara que el **ACR/VPAT® es entregable de F3**, no de F1. En este plan solo se preparan *templates* para fases posteriores.
- **Marco normativo base = WCAG 2.0 / 38 criterios ONTI (25 A + 13 AA), umbral ≥ 30/38** — según las láminas 9 y 10 de la propuesta. WCAG 2.2 AA queda como **capa extendida opcional** (`wcag.extended_22`) con score separado.
- Modelo del cerebro: `claude-sonnet-5` (antes `claude-sonnet-4-5`).
- Nombre de campo de config alineado con la SPEC: `max_urls` (no `max_pages`).

**Decisiones cerradas (D1–D7, ver SPEC v0.3 §17):**
- **D1** — La Matriz de Criticidad son **dos vistas**: conformidad criterio × módulo (los 38 ONTI) **+** grilla severidad × impacto.
- **D2** — Cerebro del agente: **`claude-sonnet-5`** (opus-5 como alternativa si en pruebas no rinde).
- **D3** — Los entregables se emiten en **JSON + HTML y además XLSX** (inventario, matriz, roadmap) en **todos los jobs**. El skill `xlsx` define el layout de referencia; el agente genera el `.xlsx` en runtime.
- **D5** — El agente corre **un canal por job**; un paso `consolidate_jobs` (endpoint `POST /api/jobs/consolidate`) agrega HB / iOS / Android en un dashboard ejecutivo unificado.
- **D6** — **Base normativa de F1 = los 38 criterios ONTI (WCAG 2.0 A+AA), umbral ≥ 30/38.** El score y todos los entregables se calculan sobre esos 38. WCAG 2.2 AA = capa extendida opcional con score separado que no incide en el compliance ONTI.
- **D7** — Los hallazgos de criterios fuera de los 38 (WCAG 2.1/2.2) **se descartan** por defecto; entran al inventario y a un score separado solo si `wcag.extended_22=true`.

---

## Principio Rector

Este plan usa los **Power Skills de Claude (Cowork)** como aceleradores de construcción. Cada skill se activa en el momento preciso de la build — no antes. El orden es: Documentar → Diseñar → Construir → Empaquetar → Presentar.

**Skills disponibles mapeados al proyecto:**

| Power Skill | Rol en este proyecto |
|---|---|
| `proceso-negocio` | Diagrama interactivo del loop autónomo del agente |
| `inception-deck` | Kickoff document del sprint de construcción |
| `valida-data-inception` | Validación del inception contra los 10 puntos del framework |
| `cfotech-brandbook` | Identidad visual CFOTech en todos los artefactos |
| `theme-factory` | Tematización de dashboards y reportes HTML |
| `docx` | Templates ACR/VPAT (uso en F3, no en F1) + informe de compliance Word |
| `pdf` | Reporte ejecutivo PDF para el cliente financiero |
| `xlsx` | Layout de referencia del inventario, la matriz y el roadmap en Excel (entregable estándar en todos los jobs, junto con JSON/HTML) |
| `pptx` | Presentación ejecutiva de resultados F1 |
| `skill-creator` | Empaquetado del agente como Agent Skill (SKILL.md) |

---

## FASE 0 — Inception del Sprint de Construcción

**Objetivo:** Documentar el proyecto de construcción antes de escribir una línea de código.  
**Prerequisito:** SPEC v0.3 aprobada.

### 0.1 — Inception Deck del Proyecto
**Skill activado:** `inception-deck`  
**Input:** SPEC-agente-f1-compliance-v0.3.md + Propuesta_Accesibilidad_EntidadFinanciera_v7.pptx  
**Output:** `inception-agente-f1.docx`  
**Contenido del documento:**
- Por qué estamos aquí (problema de compliance BCRA 7517)
- Elevator Pitch del agente SaaS
- Caja de producto (qué entrega F1)
- Lista de exclusiones (qué NO hace: F2, F3, evaluación AT real)
- Vecinos del proyecto (equipo dev, cliente, BCRA, ONTI)
- Solución técnica (arquitectura del agent loop)
- Lo que nos quita el sueño (MFA, SPAs, axe-core coverage limit)
- Talla del proyecto (estimación de esfuerzo en story points)
- Qué es lo que debe ocurrir (definition of done para F1)
- Prioridades trade-off

### 0.2 — Validación del Inception
**Skill activado:** `valida-data-inception`  
**Input:** `inception-agente-f1.docx` generado en 0.1  
**Output:** `validacion-inception-agente-f1.docx`  
**Criterio de aprobación:** ≥ 80% de completitud contra los 10 puntos del Inception Deck  
**Acción si falla:** Completar los puntos faltantes antes de avanzar a Fase 1.

---

## FASE 1 — Documentación del Proceso

**Objetivo:** Visualizar el comportamiento autónomo del agente antes de implementarlo.

### 1.1 — Diagrama del Loop Autónomo
**Skill activado:** `proceso-negocio`  
**Input:** Sección 4.2 de la SPEC (loop OBSERVAR→PLANIFICAR→ACTUAR→EVALUAR→AJUSTAR)  
**Output:** `proceso-agente-f1.html` — diagrama interactivo con branding CFOTech  
**Contenido del diagrama:**
- Caso feliz: URL recibida → crawl → scan → enrich → analyze → report → entregables
- Gateway 1: ¿autenticación requerida? → bloqueo humano (MFA)
- Gateway 2: ¿progreso sin avance después de N iteraciones? → criterio de parada
- Gateway 3: ¿todos los entregables generados y validados? → fin del loop
- Excepciones: timeout de Playwright, fallo de axe-core, skill error
- Colores por estado: azul (nominal), ámbar (warning), rojo (excepción), verde (completado)

**Uso:** Documento de referencia para el equipo de desarrollo + incluido en la presentación al cliente.

---

## FASE 2 — Scaffold y Core del Agente

**Objetivo:** Construir la estructura del proyecto y el engine del agente.  
**Skills activados:** Ninguno en esta fase — es código puro.  
**Prerequisito:** Fases 0 y 1 completadas y aprobadas.

### 2.1 — Estructura de Directorios

```
f1-compliance-agent/
├── SKILL.md                          ← empaquetado Agent Skill (Fase 5)
├── package.json
├── .env.example
├── src/
│   ├── agent-loop.js                 ← Claude API tool-use, el cerebro
│   ├── tools/
│   │   ├── crawler.js                ← crawlee: descubrimiento de URLs
│   │   ├── scanner.js                ← axe-core + Playwright: escaneo
│   │   ├── skill-runner.js           ← executor de skills externos
│   │   └── classifier.js            ← mapea hallazgos → 38 criterios ONTI (+ capa 2.2 opcional)
│   ├── reporter/
│   │   ├── score-builder.js          ← arma score-compliance.json
│   │   ├── dashboard-builder.js      ← arma dashboard.html
│   │   ├── matriz-builder.js         ← arma matriz-criticidad.{json,html,xlsx}
│   │   ├── roadmap-builder.js        ← arma roadmap-remediacion.{json,html,xlsx}
│   │   ├── xlsx-builder.js           ← genera los .xlsx (exceljs) desde classified_findings
│   │   └── consolidator.js           ← consolidate_jobs: agrega N jobs (1 x canal) → dashboard-consolidado
│   └── api/
│       ├── server.js                 ← Express REST API
│       └── routes.js                 ← POST /jobs, GET /jobs/:id, GET /jobs/:id/reports, POST /jobs/consolidate
├── references/
│   ├── onti-38-criteria.json         ← 38 criterios ONTI (25 A + 13 AA) — BASE de F1
│   ├── wcag-22-extended.json         ← 18 criterios nuevos 2.1/2.2 — capa opcional
│   └── bcra-7517-summary.md
├── assets/
│   ├── dashboard-template.html       ← generado en Fase 3
│   ├── matriz-template.html          ← generado en Fase 3
│   └── roadmap-template.html         ← generado en Fase 3
└── tests/
    ├── agent-loop.test.js
    ├── scanner.test.js
    └── fixtures/
        └── demo-hallazgos.json       ← datos de prueba para Fase 3
```

### 2.2 — Componentes Core a Implementar

**agent-loop.js**  
Motor principal. Llama a Claude claude-sonnet-5 con `tool_use`. En cada iteración:
1. OBSERVAR: leer estado del job + último resultado de tool
2. PLANIFICAR: Claude elige la próxima tool a ejecutar
3. ACTUAR: ejecutar la tool elegida (crawler / scanner / skill-runner / reporter)
4. EVALUAR: procesar el output real (no asumir éxito)
5. AJUSTAR: actualizar el plan interno
6. REPETIR: hasta criterios de parada (Sección 4.3 de la SPEC)

**crawler.js**  
Usa crawlee para descubrir URLs del sitio objetivo. Respeta `scope.max_urls` del config de entrada (SPEC §7). Devuelve `url_list[]` ordenada por profundidad.

**scanner.js**  
Para cada URL: abre Playwright headless, inyecta axe-core, ejecuta `axe.run()`, devuelve hallazgos crudos normalizados. Soporta viewport mobile para iOS/Android — evalúa la **capa WebView / web responsive**, no los aspectos nativos (biometría, gestos, push, escala de fuente del OS, modo oscuro, orientación); esos van a F2 (SPEC §3 y §15).

**skill-runner.js**  
Orquesta los 3 skills externos (ui-skills.com):
- `visual_audit` → antfu/rams
- `ux_compliance_review` → Leonxlnx/web-design-guidelines
- `generate_remediation_plan` → ibelick/improve-ui

**classifier.js**  
Toma hallazgos de axe-core + skills y los mapea a los **38 criterios ONTI** (WCAG 2.0 A+AA). Setea `onti_criterion: boolean` e `in_scope: "onti" | "extended_22"`. Los hallazgos que no son ONTI **se descartan** salvo que `wcag.extended_22=true`, en cuyo caso van a un score separado. Asigna severidad e impacto.

**xlsx-builder.js**  
Genera los `.xlsx` de inventario, matriz y roadmap con `exceljs` a partir del mismo `classified_findings`, siguiendo el layout de referencia del skill `xlsx`. Se ejecuta en todos los jobs (decisión D3).

**consolidator.js**  
Implementa `consolidate_jobs(job_ids[])`: valida que los jobs estén COMPLETED, agrega score por canal + score global ponderado, y arma `dashboard-consolidado.html` + `score-consolidado.json`. Se invoca vía `POST /api/jobs/consolidate` cuando hay más de un canal en alcance (decisión D5).

---

## FASE 3 — Templates de Entregables con Branding CFOTech

**Objetivo:** Construir los templates HTML que el reporter usará en tiempo de ejecución.

> **Formato de los entregables (decisión D3):** el agente emite en runtime **JSON + HTML (fuente de verdad) y además XLSX** para inventario, matriz y roadmap — en **todos los jobs**. El `.xlsx` lo genera `reporter/xlsx-builder.js` (exceljs) desde `classified_findings`; en esta Fase 3 el skill `xlsx` define el **layout de referencia** de cada workbook (hojas, pivots, formato), no un artefacto suelto. El JSON sigue siendo el contrato de datos.

### 3.1 — Dashboard Ejecutivo HTML
**Skill activado:** `cfotech-brandbook` + `theme-factory`  
**Output:** `assets/dashboard-template.html` (por job) + `assets/dashboard-consolidado-template.html` (multi-canal)  
**Contenido (dashboard por job):**
- Header CFOTech con logo y datos del cliente financiero
- Score gauge: % de compliance ONTI (X/38 criterios) + estado de conformidad según umbral ≥ 30/38
- Bloque "Capa extendida WCAG 2.2" solo si `wcag.extended_22=true` (score separado, rotulado como no exigido)
- KPIs: total URLs evaluadas, hallazgos críticos, hallazgos ONTI, cobertura axe-core
- Gráfico de distribución por nivel WCAG (A vs AA) y por principio (POUR)
- Sección "Próximos pasos F2" con call to action
- Variables de sustitución mustache: `{{score}}`, `{{client_name}}`, `{{date}}`, etc.

**Contenido adicional (dashboard consolidado, arma `consolidator.js` — decisión D5):**
- Tabla resumen por canal (Home Banking Web, App iOS, App Android)
- Score ONTI global ponderado + estado de conformidad + desglose por canal
- Es la vista que alimenta la presentación ejecutiva de la Fase 6

### 3.2 — Inventario de Hallazgos
**Skill activado:** `xlsx`  
**Output:** `assets/inventario-hallazgos-template.xlsx`  
**Hojas del workbook:**
- Hoja 1: Todos los hallazgos ONTI (id, url, criterio WCAG 2.0, nivel A/AA, descripción, severidad)
- Hoja 2: Pivot por criterio ONTI (frecuencia, % de módulos afectados)
- Hoja 3: Capa extendida WCAG 2.1/2.2 — solo si `wcag.extended_22=true` (score separado)
- Hoja 4: Dashboard interno (gráficos automáticos de Excel)

### 3.3 — Matriz de Criticidad
**Skill activado:** `xlsx` (layout de referencia; el agente emite `matriz-criticidad.{json,html,xlsx}` en runtime)  
**Output:** `assets/matriz-criticidad-template.xlsx`  

Según SPEC §8.4, la "Matriz de Criticidad" tiene **dos vistas** (decisión D1, confirmada — una hoja del workbook por vista):

**Vista principal — Matriz de conformidad (criterio × módulo):**
- Filas: los **38 criterios ONTI** (25 A + 13 AA) · Columnas: módulos del canal
- Estado por celda: `conforme` / `no_conforme` / `parcialmente_conforme` / `no_aplica`
- Columna `nivel`: A / AA · Filas de la capa 2.1/2.2 al final solo si `wcag.extended_22=true`

**Vista secundaria — Grilla severidad × impacto:**
- Eje X: Severidad (Crítico / Alto / Medio / Bajo)
- Eje Y: Impacto (Bloqueante / Degradado / Menor)
- Celda: cantidad de hallazgos en ese cuadrante, con drill-down a inventario
- Color coding: rojo (crítico-bloqueante) → verde (bajo-menor)

### 3.4 — Roadmap de Remediación
**Skill activado:** `xlsx`  
**Output:** `assets/roadmap-remediacion-template.xlsx`  
**Columnas:**
- Criterio WCAG / ONTI, hallazgo, URL afectada, prioridad, esfuerzo estimado (S/M/L/XL)
- Sprint sugerido (criterios ONTI van primero → luego por severidad → luego por frecuencia)
- Responsable técnico (placeholder), estado (pendiente / en progreso / resuelto)

---

## FASE 4 — Preparación de Templates para Fases Posteriores (F2 / F3)

> **Alcance:** el **ACR/VPAT® firmado es un entregable de F3**, no de F1 (propuesta, lámina "Valor Garantizado" y SPEC §15). Esta fase **no produce un informe formal de F1**: solo deja listos los *templates* que F2/F3 completarán con datos de auditoría manual. Puede ejecutarse en paralelo o diferirse sin bloquear la entrega de F1.

**Objetivo:** Dejar preparados los templates ACR/VPAT® y el reporte ejecutivo PDF para cuando F2/F3 los completen.

### 4.1 — Template ACR/VPAT en Word (para uso en F3)
**Skill activado:** `docx`  
**Output:** `assets/acr-vpat-template.docx`  
**Estructura siguiendo VPAT® v2.5Rev EN 301 549:**
- Portada con datos del cliente, fecha, versión, logo CFOTech
- Tabla de contenidos automática
- Sección 1: Información del Producto (placeholder para nombre del sistema)
- Sección 2: Resumen Ejecutivo de Conformidad
- Sección 3: Tabla de Conformidad WCAG 2.0 Nivel A (25 criterios — los de la ONTI)
  - Columnas: Criterio | Nivel | Estado (Soporta / Soporta parcialmente / No soporta / N/A) | Comentarios
- Sección 4: Tabla de Conformidad WCAG 2.0 Nivel AA (13 criterios adicionales — 38 en total)
- Sección 5: Resumen de Conformidad ONTI Disp. 6/2019 (X/38, umbral 30) + referencia a normativa argentina
- Sección 5b: Capa Extendida WCAG 2.1/2.2 — solo si se auditó (`wcag.extended_22`), marcada como no exigida por BCRA/ONTI
- Sección 6: Metodología de Evaluación (axe-core + Playwright + skills)
- Sección 7: Limitaciones y Recomendaciones (F2 pending)
- Sección 8: Declaración de Conformidad
- Variables de sustitución: `{{client_name}}`, `{{product_name}}`, `{{eval_date}}`, etc.

### 4.2 — Reporte Ejecutivo PDF
**Skill activado:** `pdf`  
**Input:** `score-compliance.json` generado por el agente + template HTML
**Output:** `score-compliance-ejecutivo.pdf`  
**Contenido:**
- 2 páginas máximo (formato C-Level)
- Score global, desglose ONTI vs WCAG
- Top 5 hallazgos críticos
- Recomendación de siguiente paso (F2)
- Firma digital CFOTech

---

## FASE 5 — Empaquetado como Agent Skill

**Objetivo:** Empaquetar el agente según el estándar agentskills.io para distribución y reutilización.

### 5.1 — SKILL.md del Agente F1
**Skill activado:** `skill-creator`  
**Output:** `SKILL.md` en la raíz del proyecto  
**Contenido del SKILL.md:**

```markdown
---
name: f1-compliance-agent
version: 1.0.0
description: >
  Agente autónomo SaaS que ejecuta la Fase 1 del assessment de 
  accesibilidad digital (WCAG 2.0 A+AA — 38 criterios ONTI 6/2019, umbral 30 /
  BCRA 7517; capa WCAG 2.2 opcional con score separado).
  Opera con loop Observe→Plan→Act→Evaluate→Adjust sin intervención humana.
  Entrega 5 artefactos formales por canal: score JSON, dashboard HTML,
  inventario (JSON+XLSX), matriz de criticidad (JSON+HTML+XLSX) y roadmap
  de remediación (JSON+HTML+XLSX); más un dashboard consolidado multi-canal.
author: CFOTech IT Global Services
license: proprietary
runtime: node >= 20
entry: src/agent-loop.js
---

# F1 Compliance Accessibility Agent

[contenido completo del skill generado por skill-creator]
```

**El skill-creator también generará:**
- Suite de evaluación (evals) del agente
- Descripción optimizada para triggering
- Casos de prueba documentados

---

## FASE 6 — Presentación Ejecutiva para el Cliente

**Objetivo:** Transformar los resultados de una corrida real del agente en una presentación para el cliente financiero.

### 6.1 — Deck de Resultados F1
**Skill activado:** `pptx` + `cfotech-brandbook`  
**Output:** `presentacion-resultados-f1.pptx`  
**Slides:**
1. Portada (logo CFOTech + datos del cliente + fecha)
2. Resumen Ejecutivo (score global, 3 KPIs clave)
3. Metodología (diagrama simplificado del agente, qué herramientas usó)
4. Hallazgos Críticos (top 5, con captura de pantalla del dashboard)
5. Compliance ONTI (tabla de los 38 criterios, semáforo, estado vs. umbral 30)
6. Desglose por nivel A vs AA dentro de la ONTI (gráfico POUR) + capa WCAG 2.2 si se auditó
7. Matriz de Criticidad (versión visual)
8. Roadmap Sprint 1 de Remediación (primeras 5 acciones de alto impacto)
9. Limitaciones del Análisis Automático (lo que F2 va a cubrir)
10. Propuesta de Continuidad (F2 — Testing con AT reales)
11. Cierre (datos de contacto CFOTech)

---

## Secuencia de Activación — Línea de Tiempo

> **Aclaración de plazos:** las "Semanas 1–3" de abajo son el **cronograma interno de construcción del agente** (build de CFOTech). No deben confundirse con las **Semanas 1–2 (S1–S2) del plan de trabajo de la propuesta**, que es el plazo del **servicio F1 ante el cliente** (evaluación + primer reporte de compliance). El agente construido aquí es la herramienta que habilita ese servicio; su construcción ocurre antes del arranque del proyecto con la Entidad.

```
SEMANA 1  (construcción — interno CFOTech)
│
├── DÍA 1-2   [FASE 0] inception-deck  → inception-agente-f1.docx
│             [FASE 0] valida-data-inception → validacion-inception.docx
│             ↓ (si validación ≥ 80%, continuar)
│
├── DÍA 3     [FASE 1] proceso-negocio → proceso-agente-f1.html
│
├── DÍA 4-5   [FASE 2] Scaffold + agent-loop.js + crawler.js
│
SEMANA 2
│
├── DÍA 6-7   [FASE 2] scanner.js + skill-runner.js + classifier.js
│
├── DÍA 8     [FASE 3] cfotech-brandbook + theme-factory → dashboard/matriz/roadmap-template.html
│             [FASE 3] xlsx → layout de referencia inventario/matriz/roadmap .xlsx
│
├── DÍA 9     [FASE 2] reporter/*.js (score, dashboard, matriz, roadmap, xlsx-builder, consolidator)
│             [FASE 2] REST API (server.js + routes.js, incl. POST /jobs/consolidate)
│
├── DÍA 10    CORRIDA DE PRUEBA en staging: 1 job por canal + consolidate_jobs
│
SEMANA 3
│
├── DÍA 11    [FASE 4] docx → acr-vpat-template.docx (template para F3)
│             [FASE 4] pdf → score-compliance-ejecutivo.pdf (template)
│
├── DÍA 12    [FASE 5] skill-creator → SKILL.md + evals
│
├── DÍA 13    [FASE 6] pptx + cfotech-brandbook → deck de resultados
│
└── DÍA 14    Revisión final + entrega a Entidad Financiera
```

---

## Reglas de Construcción

### Lo que NO cambia mientras se construye
- La SPEC v0.3 es el contrato. Si surge una necesidad no cubierta, se versiona la SPEC (v0.4) antes de implementar.
- No se agrega lógica al agente que no esté en la SPEC. El agente es autónomo, no mágico.
- El agente no genera hallazgos que no puede verificar con herramientas. No alucina compliance.

### Criterios de Done por Fase

| Fase | Done cuando… |
|---|---|
| 0 | inception.docx generado + validación ≥ 80% |
| 1 | proceso-agente-f1.html aprobado por el equipo |
| 2 | tests unitarios pasan; corrida demo de 1 job por canal + `consolidate_jobs` sin errores |
| 3 | templates HTML/JSON **y XLSX** (inventario, matriz, roadmap) abren y muestran datos de prueba |
| 4 | templates docx y pdf listos para que F2/F3 los completen (no son entregables de F1) |
| 5 | SKILL.md válido según formato agentskills.io + evals documentadas |
| 6 | Deck aprobado por CFOTech antes de enviar al cliente |

---

## Preguntas Abiertas (de SPEC Sección 17) — Bloqueantes

Estas preguntas deben responderse antes o durante Fase 2. Si no se resuelven, el agente queda con valores default de la SPEC:

| # | Pregunta | Default SPEC | Impacto |
|---|---|---|---|
| Q1 | ¿Cómo maneja MFA/2FA del home banking? | Loop interrumpido, operador resuelve | Medio — limita autonomía |
| Q2 | ¿Dónde se almacenan los reportes generados? | Filesystem local del container | Alto — SaaS requiere S3/GCS |
| Q3 | ¿Target de deploy? | Docker container standalone | Alto — define infra |
| Q4 | ¿Política de retención de reportes? | Sin definir | Medio — compliance de datos |
| Q5 | ¿Multi-tenant desde el inicio? | No (single-tenant MVP) | Alto — arquitectura API |
| Q6 | ¿Notificaciones al finalizar el job? | No (polling vía GET /jobs/:id) | Bajo — calidad de vida |

---

## Resumen de Artefactos por Skill

| Artefacto de Salida | Skill Activado | Fase |
|---|---|---|
| `inception-agente-f1.docx` | `inception-deck` | F0 |
| `validacion-inception-agente-f1.docx` | `valida-data-inception` | F0 |
| `proceso-agente-f1.html` | `proceso-negocio` | F1 |
| `assets/dashboard-template.html` | `cfotech-brandbook` + `theme-factory` | F3 |
| `assets/inventario-hallazgos-template.{html,xlsx}` | `theme-factory` + `xlsx` | F3 |
| `assets/matriz-criticidad-template.{html,xlsx}` | `theme-factory` + `xlsx` | F3 |
| `assets/roadmap-remediacion-template.{html,xlsx}` | `theme-factory` + `xlsx` | F3 |
| `assets/dashboard-consolidado-template.html` | `cfotech-brandbook` + `theme-factory` | F3 |
| `assets/acr-vpat-template.docx` (template para F3) | `docx` | F4 |
| `score-compliance-ejecutivo.pdf` (template) | `pdf` | F4 |
| `SKILL.md` + evals | `skill-creator` | F5 |
| `presentacion-resultados-f1.pptx` | `pptx` + `cfotech-brandbook` | F6 |

**Código puro (sin skill externo):**  
`agent-loop.js`, `crawler.js`, `scanner.js`, `skill-runner.js`, `classifier.js`, `reporter/*.js` (incl. `xlsx-builder.js` y `consolidator.js`), `api/server.js`

---

*Plan generado por Claude (Cowork) — CFOTech IT Global Services · Septiembre 2026*  
*Referencia: SPEC-agente-f1-compliance-v0.3.md · Propuesta_Accesibilidad_EntidadFinanciera_v7.pptx*  
*v1.0 → v1.1: alineación con SPEC v0.3 y la propuesta v7 (láminas 9-10 como base) — separación cronograma de construcción vs. plazo de servicio F1; decisiones D1–D7 cerradas (base WCAG 2.0 / 38 ONTI con umbral 30, WCAG 2.2 como capa opcional, matriz de dos vistas, claude-sonnet-5, XLSX en todos los jobs, consolidación multi-canal, descarte de hallazgos fuera de los 38); ACR/VPAT como entregable de F3; campo max_urls*

---

**Nota de estado (post Sub-plan A — Fundación):** Implementados y testeados: `validate-config.js`, `JobStore`, `tool-registry.js` (schemas de las 11 tools + `validate_config`/`log_progress`/`request_clarification` reales, resto como stubs `NotImplementedError`), `agent-loop.js` (loop real contra Claude tool-use) y la REST API mínima (`POST /api/jobs`, `GET /api/jobs/:id`, `GET /api/health`). Pendientes como sub-planes siguientes de la Fase 2: **B** crawler (`crawlee`) + scanner (`axe-core`+Playwright), **C** classifier (mapeo a los 38 ONTI) + calculate_score, **D** reporters (score/dashboard/inventario/matriz/roadmap + `xlsx-builder`), **E** skill-runner (skills externos ui-skills.com) + `consolidate_jobs` + rutas `GET /api/jobs/:id/reports`, `DELETE /api/jobs/:id`, `POST /api/jobs/consolidate`.
