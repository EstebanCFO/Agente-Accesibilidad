# SPEC — Agente Autónomo de Compliance de Accesibilidad · Fase 1

**Proyecto:** CFOTech IT Global Services — Propuesta Entidad Financiera  
**Versión:** 0.3  
**Fecha:** Septiembre 2026  
**Estado:** Pre-construcción — pendiente de aprobación  
**Cambios v0.2:** Incorporación de skills externos (ui-skills.com + agentskills.io) · Mapeo normativo completo ONTI 38 criterios + WCAG 2.2 · Actualización de arquitectura, tool set, stack y criterios de aceptación  
**Cambios v0.3 (alineación con Propuesta_Accesibilidad_EntidadFinanciera_v7.pptx):**
- **Marco normativo base (decisión D6):** el scope primario de F1 es **WCAG 2.0 A+AA — los 38 criterios de la ONTI Disp. 6/2019 (25 A + 13 AA), umbral de conformidad ≥ 30/38**, tal como lo detallan las láminas 9 y 10 de la propuesta. La evaluación y el score del agente se calculan sobre esos 38 criterios.
- **WCAG 2.2 AA = capa extendida opcional (decisiones D6/D7):** no exigida por BCRA/ONTI. Se activa por config (`wcag.extended_22`); cuando está activa, el agente evalúa además los criterios nuevos de WCAG 2.1/2.2 relevantes para banca con un **score separado** que no altera el % de compliance ONTI. Con la capa desactivada, los hallazgos fuera de los 38 se descartan.
- Se explicita el umbral regulatorio ONTI: **mínimo 30 de los 38 criterios** (Disp. 6/2019).
- Modelo del cerebro actualizado a la generación vigente: `claude-sonnet-5` (antes `claude-sonnet-4-5`).
- Sección 8.4: la "Matriz de Criticidad" se compone de **dos vistas** — matriz de conformidad criterio × módulo (los 38 ONTI) **y** grilla severidad × impacto (decisión D1, confirmada).
- Sección 8: los entregables se emiten en **JSON + HTML (fuente de verdad) y además XLSX** (inventario, matriz y roadmap) en todos los jobs (decisión D3, confirmada).
- Sección 15: la limitación de apps nativas se detalla contra el alcance de App Mobile descripto en la propuesta (biometría, gestos táctiles, push, escala de fuente del OS, modo oscuro, orientación).
- Secciones 6, 8.2, 9, 10 y 16: se incorpora el **paso de consolidación multi-canal** — el agente corre un canal por job y un paso posterior agrega los jobs de HB / iOS / Android en un dashboard ejecutivo unificado con score global (decisión D5, confirmada).

---

## 1. Propósito

Este documento especifica el comportamiento, la arquitectura, los contratos de interfaz y los entregables del **Agente Autónomo F1**: el componente de software responsable de ejecutar completamente la Fase 1 del servicio de compliance de accesibilidad digital descripto en la propuesta a la Entidad Financiera.

El agente opera como un **sistema SaaS autónomo**: recibe un objetivo de configuración, planifica y ejecuta el escaneo sin intervención humana paso a paso, y produce los entregables formales de F1 como salida.

---

## 2. Marco Normativo que Cubre

| Normativa | Rol en la evaluación del agente |
|---|---|
| BCRA Com. "A" 7517 | Accesibilidad en canales digitales de entidades financieras. Obligaciones propias (reproductor de texto-a-voz, texto alternativo en avisos y publicidades) **y** remisión "en lo pertinente" a la ONTI |
| ONTI Disposición 6/2019 | **Marco de referencia del agente.** Adopta WCAG 2.0 y selecciona **38 criterios de éxito** (25 Nivel A + 13 Nivel AA). **Umbral de conformidad: mínimo 30 de los 38** |
| WCAG 2.0 Nivel A | 25 criterios — obligatorios; bloqueos críticos para usuarios con discapacidad |
| WCAG 2.0 Nivel AA | 13 criterios adicionales (38 en total) — nivel regulatorio completo exigido |
| WCAG 2.2 AA | **Capa extendida opcional** (config `wcag.extended_22`). No exigida por BCRA ni ONTI. Se audita solo si la Entidad lo solicita, con score separado que no altera el compliance ONTI |

El agente evalúa y puntúa contra los **38 criterios WCAG 2.0 A+AA de la ONTI Disp. 6/2019** (umbral ≥ 30/38) como scope primario de F1 — el detalle criterio por criterio está en las láminas 9 y 10 de la propuesta y en la Sección 18.1. Si se activa la capa extendida, el agente evalúa adicionalmente los criterios nuevos de WCAG 2.1/2.2 más relevantes para banca (p. ej. 2.5.8 target size, 2.4.11 foco no obscurecido, 3.3.8 autenticación accesible, 3.2.6 ayuda coherente, 3.3.7 entrada redundante) con un score separado.

> Ver Sección 18 para el mapeo normativo completo.

---

## 3. Canales en Alcance

| Canal | Tecnología | Método de evaluación automática |
|---|---|---|
| Home Banking Web | SPA / MPA (browser) | axe-core vía Playwright headless |
| App Mobile iOS | WebView híbrida | axe-core vía Playwright (modo mobile viewport) |
| App Mobile Android | WebView híbrida | axe-core vía Playwright (modo mobile viewport) |

> **Limitación conocida:** axe-core cubre ~57% de los hallazgos por volumen (fuente GDS UK). Los criterios que requieren evaluación con AT reales (NVDA, JAWS, VoiceOver, TalkBack) pertenecen a F2, fuera del alcance de este agente.
>
> **Alcance real de App Mobile en F1:** el agente evalúa únicamente la capa WebView / web responsive de las apps híbridas. Los aspectos nativos que la propuesta lista para App Mobile — biometría / FaceID, gestos táctiles, notificaciones push, escala de fuente del OS, modo oscuro, orientación portrait/landscape y las diferencias iOS vs Android — no son verificables por axe-core + Playwright y se cubren en F2 con VoiceOver / TalkBack.

---

## 4. Identidad y Comportamiento del Agente

### 4.1 Principio fundamental

El agente es **dueño de su propio flujo de control**. El usuario (operador) entrega un objetivo de configuración; el agente decide la estrategia, el orden de acciones y cuándo ha terminado. No sigue una secuencia de pasos hardcodeada.

### 4.2 Loop autónomo obligatorio

```
OBSERVAR  →  estado actual + resultado real de herramientas
PLANIFICAR →  qué pasos lógicos faltan
ACTUAR     →  elegir y ejecutar la mejor herramienta
EVALUAR    →  resultado real obtenido (ground truth)
AJUSTAR    →  actualizar el plan
REPETIR    →  hasta criterios de parada
```

El agente **nunca asume** que un paso fue exitoso. Toda evaluación se basa en el output real de las herramientas.

### 4.3 Criterios de parada

El agente se detiene y devuelve control al operador cuando:

- Todos los entregables de F1 están generados y validados.
- Se alcanzó el límite máximo de iteraciones sin progreso (configurable, default: 30).
- Un bloqueo requiere decisión humana (ej: acceso denegado, MFA no resuelto).
- Continuar implica una acción irreversible sin confirmación (ej: sobrescribir reportes previos).

### 4.4 Transparencia

En cada iteración el agente registra:
- Estado actual del loop
- Herramienta que va a ejecutar y por qué
- Resultado real observado
- Ajuste al plan (si lo hay)

---

## 5. Arquitectura del Sistema

```
┌──────────────────────────────────────────────────────────────┐
│                      AGENTE F1 (SaaS)                        │
│                                                              │
│  ┌───────────────────────────────────────────────────────┐   │
│  │              REST API (entrada/salida)                 │   │
│  │  POST /jobs       → submite config, inicia job         │   │
│  │  GET  /jobs/:id   → estado actual del agente           │   │
│  │  GET  /jobs/:id/reports → descarga entregables         │   │
│  └───────────────────────────────────────────────────────┘   │
│                          │                                   │
│  ┌───────────────────────▼───────────────────────────────┐   │
│  │              AGENT CORE (cerebro)                      │   │
│  │                                                        │   │
│  │  Claude claude-sonnet-5 (API Anthropic)                │   │
│  │  → recibe estado actual                                │   │
│  │  → decide qué herramienta llamar                       │   │
│  │  → evalúa resultado real · ajusta plan                 │   │
│  └───────────────────────────────────────────────────────┘   │
│         │           │           │           │                │
│  ┌──────▼──┐  ┌─────▼─────┐  ┌─▼──────┐  ┌▼────────────┐   │
│  │ CRAWLER │  │  SCANNER  │  │ SKILLS │  │  REPORTER   │   │
│  │         │  │           │  │  LAYER │  │             │   │
│  │ Descubre│  │ axe-core  │  │        │  │ Genera los  │   │
│  │ URLs o  │  │ Playwright│  │ rams   │  │ 5 entrega-  │   │
│  │ valida  │  │ headless  │  │ web-dg │  │ bles de F1  │   │
│  │ lista   │  │           │  │ imp-ui │  │             │   │
│  └─────────┘  └───────────┘  └────────┘  └─────────────┘   │
│                                                              │
│  ┌───────────────────────────────────────────────────────┐   │
│  │                      JOB STORE                         │   │
│  │  Estado del job · URLs procesadas · Hallazgos         │   │
│  │  In-memory (MVP) → Postgres/Redis (producción)        │   │
│  └───────────────────────────────────────────────────────┘   │
└──────────────────────────────────────────────────────────────┘
```

---

## 6. Herramientas del Agente (Tool Set)

El cerebro (Claude) puede llamar a las siguientes herramientas. Él decide cuál usar en cada iteración.

### 6.1 Herramientas core

| Herramienta | Input | Output | Descripción |
|---|---|---|---|
| `validate_config` | config JSON | validation_result | Verifica que la config sea completa y coherente |
| `crawl_site` | root_url, options | url_list[] | Descubre todas las URLs del canal desde una raíz |
| `validate_url_list` | url_list[] | validated_list[], errors[] | Verifica accesibilidad HTTP de cada URL antes de escanear |
| `scan_url` | url, wcag_tags[], auth | axe_results | Escanea una URL con axe-core vía Playwright |
| `scan_batch` | url_list[], wcag_tags[], workers | axe_results[] | Escanea múltiples URLs en paralelo (hasta N workers) |
| `classify_findings` | axe_results[] | classified_findings | Deduplica, agrupa por criterio WCAG y asigna severidad |
| `calculate_score` | classified_findings | compliance_scores | Calcula % de cumplimiento por canal y por criterio |
| `generate_deliverable` | type, data | file_path[] | Genera uno de los 5 entregables de F1 en sus formatos (JSON/HTML y, para inventario/matriz/roadmap, también XLSX) |
| `consolidate_jobs` | job_ids[] | consolidated_report | Agrega los resultados de varios jobs (uno por canal) en un dashboard ejecutivo unificado + score global multi-canal |
| `request_clarification` | question, context | human_response | Pausa y solicita decisión al operador |
| `log_progress` | message, level | — | Registra estado en el log del job |

### 6.2 Herramientas de skills externos (nuevas en v0.2)

| Herramienta | Skill base | Input | Output | Descripción |
|---|---|---|---|---|
| `visual_audit` | `antfu/rams` | url, screenshot, dom_snapshot | visual_findings[] | Detecta issues de contraste/spacing/touch-target que axe-core no reporta por análisis de DOM estático. Actúa como segunda pasada visual post-scan. |
| `ux_compliance_review` | `Leonxlnx/web-design-guidelines` | url, axe_results, interaction_flows | ux_findings[] | Revisa criterios WCAG que requieren evaluación de patrones de interacción (flujos de formularios, mensajes de error, coherencia de navegación) no detectables solo con el DOM. |
| `generate_remediation_plan` | `ibelick/improve-ui` | classified_findings, ux_findings, visual_findings | remediation_plans[] | Genera planes de implementación autocontenidos y priorizados por hallazgo, listos para ser ejecutados por el equipo de desarrollo de la Entidad. Alimenta el Entregable 5 (Roadmap). |

> **Nota de integración:** Las herramientas de skills externos se invocan **después** del scan axe-core, como enriquecimiento de la capa de análisis. No reemplazan al scanner; lo complementan. El agente decide si invocarlas según la cobertura alcanzada por axe-core.

---

## 7. Configuración de Entrada (Input Contract)

El operador entrega un JSON de configuración al iniciar un job.

```json
{
  "job_id": "string (auto-generado si no se provee)",
  "description": "string — descripción libre del job",

  "target": {
    "channel": "home_banking | app_ios | app_android",
    "mode": "url_list | crawl",
    "root_url": "string | null  — requerido si mode=crawl",
    "urls": ["string"]           
  },

  "auth": {
    "type": "none | basic | form | cookie | bearer",
    "config": {
      "login_url": "string",
      "username_selector": "string",
      "password_selector": "string",
      "submit_selector": "string",
      "username": "string (env var recomendado)",
      "password": "string (env var recomendado)",
      "cookies": [{ "name": "string", "value": "string", "domain": "string" }],
      "bearer_token": "string"
    }
  },

  "wcag": {
    "baseline": "onti_2019",
    "levels": ["A", "AA"],
    "base_tags": ["wcag2a", "wcag2aa"],
    "conformance_threshold": 30,
    "extended_22": false,
    "extended_22_tags": ["wcag21a", "wcag21aa", "wcag22aa"]
  },

  "scope": {
    "max_urls": 100,
    "timeout_per_url": 30000,
    "parallel_workers": 3,
    "wait_for": "networkidle | domcontentloaded | load",
    "viewport": {
      "desktop": { "width": 1280, "height": 800 },
      "mobile": { "width": 390, "height": 844, "is_mobile": true }
    },
    "include_patterns": ["string"],
    "exclude_patterns": ["string"]
  },

  "skills": {
    "visual_audit": true,
    "ux_compliance_review": true,
    "generate_remediation_plan": true
  },

  "output": {
    "formats": ["html", "json", "xlsx"],
    "path": "./reports",
    "include_screenshots": true,
    "language": "es"
  },

  "agent": {
    "max_iterations": 30,
    "log_level": "info | debug | warn",
    "model": "claude-sonnet-5"
  }
}
```

> **Campo `skills`:** permite al operador activar o desactivar cada skill externo por job. Default: todos `true`.  
> **Campo `wcag.baseline`:** `onti_2019` (default) → el agente evalúa y puntúa sobre los 38 criterios WCAG 2.0 A+AA de la ONTI.  
> **Campo `wcag.conformance_threshold`:** mínimo de criterios ONTI conformes para declarar conformidad (default 30, según Disp. 6/2019).  
> **Campo `wcag.extended_22`:** `false` (default) → los hallazgos de criterios fuera de los 38 se descartan. `true` → el agente evalúa además los criterios nuevos de WCAG 2.1/2.2 (`extended_22_tags`) y reporta un **score separado** de la capa extendida.

---

## 8. Entregables de F1 (Output Contract)

Los 5 entregables formales que el agente debe producir al finalizar, según la propuesta.

> **Formatos (decisión D3):** el agente emite **JSON + HTML** como fuente de verdad y, además, **XLSX** para el inventario de hallazgos, la matriz de criticidad y el roadmap de remediación — en **todos los jobs**, no como opción. El XLSX se genera en el paso de reporte a partir del mismo `classified_findings` (librería tipo `exceljs`); el skill `xlsx` del Plan de Construcción define el layout/plantilla de referencia. El JSON sigue siendo el contrato de datos; el XLSX es la vista de trabajo para analistas y backlog.
>
> **Consolidación multi-canal (decisión D5):** cada job cubre **un canal** (`home_banking` | `app_ios` | `app_android`). Cuando se evalúan los tres, un paso posterior (`consolidate_jobs`) agrega los outputs en un **dashboard ejecutivo unificado** con score global multi-canal. Los entregables por-job se generan siempre; el consolidado es un entregable adicional cuando hay más de un canal en alcance.

### 8.1 Score de Cumplimiento Inicial

**Archivo:** `score-compliance.json`

```json
{
  "job_id": "string",
  "generated_at": "ISO8601",
  "channel": "string",
  "baseline": "ONTI 6/2019 — WCAG 2.0 A+AA (38 criterios)",
  "coverage_note": "Score sobre los 38 criterios ONTI por detección automática (~57% de barreras). Los criterios que requieren AT reales se evalúan en F2.",
  "summary": {
    "total_urls_evaluated": 0,
    "onti_criteria_evaluated": 38,
    "onti_criteria_compliant": 0,
    "onti_compliance_percentage": 0.0,
    "onti_conformance": false,
    "conformance_threshold": 30,
    "score_level_a": 0.0,
    "score_level_aa": 0.0
  },
  "extended_22": null,
  "by_url": [
    {
      "url": "string",
      "module": "string",
      "onti_compliance_percentage": 0.0,
      "violations": 0,
      "incomplete": 0
    }
  ]
}
```

> `onti_conformance` es `true` cuando `onti_criteria_compliant >= conformance_threshold` (30). `score_level_a` y `score_level_aa` se calculan sobre los 25 criterios A y los 13 AA de la ONTI respectivamente.  
> `extended_22` es `null` salvo que `wcag.extended_22=true`, en cuyo caso contiene `{ criteria_evaluated, criteria_compliant, compliance_percentage, by_criterion[] }` de la capa WCAG 2.1/2.2 — **sin mezclarse** con el score ONTI.

### 8.2 Dashboard Ejecutivo

**Archivo:** `dashboard.html` (por job) · `dashboard-consolidado.html` (multi-canal, vía `consolidate_jobs`)

Página HTML standalone (sin dependencias externas) que incluye:
- **Score ONTI (X/38 criterios conformes, %)** como indicador regulatorio primario, con gauge visual
- **Estado de conformidad ONTI:** conforme / no conforme según el umbral ≥ 30/38
- Score por nivel dentro de la ONTI (25 criterios A vs 13 AA) separados
- Tabla de issues por severidad (Critical / Serious / Moderate / Minor)
- Top 10 criterios ONTI más vulnerados
- Gráfico de distribución por módulo/URL
- Sección de hallazgos visuales/UX (de skills externos, si activados)
- **Bloque "Capa extendida WCAG 2.2"** solo si `wcag.extended_22=true`: score separado, claramente rotulado como no exigido por BCRA/ONTI
- Generado en español, con logo CFOTech

**Versión consolidada (`dashboard-consolidado.html`):** cuando hay jobs de más de un canal, agrega Home Banking + App iOS + App Android en una sola vista — tabla resumen por canal, score global ponderado y desglose ONTI/WCAG por canal. Es la vista que alimenta la presentación ejecutiva al cliente.

### 8.3 Inventario de Hallazgos Consolidado

**Archivos:** `inventario-hallazgos.json` + `inventario-hallazgos.xlsx`

> El `.xlsx` incluye: Hoja 1 todos los hallazgos, Hoja 2 pivot por criterio WCAG, Hoja 3 solo hallazgos ONTI (38 criterios), Hoja 4 gráficos resumen. El `.json` es el contrato de datos.

```json
{
  "job_id": "string",
  "total_findings": 0,
  "findings": [
    {
      "id": "uuid",
      "source": "axe-core | visual_audit | ux_review",
      "wcag_criterion": "1.1.1",
      "wcag_level": "A",
      "wcag_description": "Texto alternativo",
      "onti_criterion": true,
      "in_scope": "onti | extended_22",
      "severity": "critical | serious | moderate | minor",
      "rule_id": "string (axe rule id)",
      "affected_urls": ["string"],
      "occurrences": 0,
      "element_sample": "string (HTML snippet)",
      "failure_summary": "string",
      "remediation_hint": "string"
    }
  ]
}
```

> **Campo `source`:** identifica si el hallazgo fue detectado por axe-core (automático), visual_audit (rams) o ux_review (web-design-guidelines).  
> **Campo `onti_criterion`:** booleano — el criterio pertenece a los 38 de ONTI 6/2019.  
> **Campo `in_scope`:** `onti` (criterio de los 38, cuenta para el score) o `extended_22` (criterio nuevo 2.1/2.2, solo presente si `wcag.extended_22=true`, cuenta para el score separado). Los hallazgos que no caen en ninguno de los dos **no se incluyen** en el inventario.

### 8.4 Matriz de Criticidad

**Archivos:** `matriz-criticidad.json` + `matriz-criticidad.html` + `matriz-criticidad.xlsx`

**Decisión D1 (confirmada):** la "Matriz de Criticidad" que exige la propuesta se compone de **dos vistas** derivadas del mismo conjunto de hallazgos:

**Vista principal — Matriz de conformidad (criterio × módulo).** Filas: los **38 criterios ONTI** (25 A + 13 AA). Columnas: módulos del canal. Estado por celda:
- `conforme` — ningún issue detectado
- `no_conforme` — uno o más issues detectados
- `parcialmente_conforme` — issues de tipo `incomplete` (requiere revisión manual)
- `no_aplica` — criterio no aplicable al canal

**Columna `nivel`:** A / AA dentro de la ONTI.  
**Filas de la capa extendida:** si `wcag.extended_22=true`, se agregan al final las filas de los criterios nuevos 2.1/2.2, claramente separadas y rotuladas como "no exigido por BCRA/ONTI".

**Vista secundaria — Grilla de criticidad (severidad × impacto).** Resumen tipo matriz de riesgo: eje severidad (crítico / alto / medio / bajo) × eje impacto (bloqueante / degradado / menor), con el conteo de hallazgos por cuadrante y drill-down al inventario. Se incluye también embebida en el Dashboard Ejecutivo (8.2).

Ambas vistas van en los tres formatos (`.json` con las dos estructuras, `.html` con las dos tablas, `.xlsx` con una hoja por vista).

### 8.5 Roadmap Preliminar de Remediación

**Archivos:** `roadmap-remediacion.json` + `roadmap-remediacion.html` + `roadmap-remediacion.xlsx`

Lista priorizada de acciones de corrección. Prioridad calculada por:
- **Criterios ONTI primero** (obligación regulatoria); los de la capa extendida 2.2, si está activa, van después
- Nivel WCAG (A antes que AA) — los 25 criterios A de la ONTI son bloqueantes
- Severidad del issue (Critical > Serious > Moderate > Minor)
- Frecuencia de aparición (cuántos módulos afecta)
- Cercanía al umbral: los criterios cuya corrección hace pasar la conformidad de < 30 a ≥ 30/38 se marcan como "quick win regulatorio"
- Estimación de esfuerzo (Low / Medium / High — generada por el skill `improve-ui`)

> **Mejora v0.2:** el skill `ibelick/improve-ui` genera planes de implementación autocontenidos por hallazgo (no solo descripciones), listos para que el equipo de desarrollo de la Entidad los ejecute directamente.

---

## 9. Flujo de Ejecución Detallado

```
START
  │
  ▼
[1] INIT
    Validar config → si inválida: request_clarification → STOP
    Crear job_id y estado inicial en Job Store
    Log: "Job iniciado. Modo: {url_list|crawl}. Canal: {channel}."

  │
  ▼
[2] DISCOVER
    Si mode=url_list:
      → validate_url_list(urls)
      → si errores HTTP: log advertencias, excluir URLs no accesibles
    Si mode=crawl:
      → crawl_site(root_url, options)
      → validate_url_list(discovered_urls)
    Resultado: lista final de URLs a escanear

  │
  ▼
[3] PLAN
    Calcular batches según parallel_workers
    Estimar tiempo (urls × avg_scan_time)
    Definir tags de scan: base_tags (wcag2a, wcag2aa) siempre
      + extended_22_tags si wcag.extended_22=true
    Determinar qué skills externos activar según config
    Log: "{N} URLs. Base: WCAG 2.0 A+AA (38 ONTI). Capa 2.2: {on|off}. Skills: {lista}."

  │
  ▼
[4] SCAN (loop por batches)
    Para cada batch:
      → scan_batch(urls, wcag_tags, workers)
      → EVALUAR: ¿scan exitoso? ¿errores de timeout/auth?
      Si timeout: reintentar URL individualmente (1 retry)
      Si auth error: request_clarification("Se requiere autenticación en {url}")
      Acumular resultados en Job Store

  │
  ▼
[4b] ENRICH CON SKILLS EXTERNOS (si activados)
    Si visual_audit=true:
      → visual_audit(urls_escaneadas, screenshots)
      → EVALUAR: ¿encontró issues adicionales de contraste/spacing/touch-target?
    Si ux_compliance_review=true:
      → ux_compliance_review(urls, axe_results, interaction_flows)
      → EVALUAR: ¿encontró issues de coherencia/formularios/errores?
    Acumular findings adicionales en Job Store

  │
  ▼
[5] ANALYZE
    → classify_findings(axe_results + visual_findings + ux_findings)
       - mapea cada hallazgo a criterio WCAG y setea in_scope: "onti" | "extended_22"
       - descarta los hallazgos que no son ONTI si wcag.extended_22=false (decisión D7)
    → calculate_score(classified_findings)
       - onti_compliance_percentage + onti_conformance (>= 30/38)
       - extended_22 score separado si la capa está activa
    EVALUAR: ¿cobertura mínima alcanzada? (>= 80% de URLs escaneadas)
    Si < 80%: log advertencia, continuar de todas formas con nota en reporte

  │
  ▼
[6] GENERATE DELIVERABLES (en orden)
    → generate_deliverable("score", data)          → score-compliance.json
    → generate_deliverable("dashboard", data)       → dashboard.html
    → generate_deliverable("inventario", data)      → inventario-hallazgos.{json,xlsx}
    → generate_deliverable("matriz", data)          → matriz-criticidad.{json,html,xlsx}
    Si generate_remediation_plan=true:
      → generate_remediation_plan(findings)         → planes autocontenidos por hallazgo
    → generate_deliverable("roadmap", data)         → roadmap-remediacion.{json,html,xlsx}
    EVALUAR: verificar que cada archivo existe y tiene contenido válido

  │
  ▼
[7] DONE
    Marcar job como COMPLETED en Job Store
    Log: resumen ejecutivo de lo realizado
    Exponer resultados vía GET /jobs/:id/reports
    DEVOLVER CONTROL AL OPERADOR
```

**[8] CONSOLIDATE (paso separado, cuando hay > 1 canal en alcance)**

```
Trigger: POST /api/jobs/consolidate  { job_ids: [hb_job, ios_job, android_job] }
  → consolidate_jobs(job_ids)
     - valida que todos los jobs estén COMPLETED
     - agrega score por canal + score global ponderado
     - agrega inventario y matriz cruzando los 3 canales
  → genera dashboard-consolidado.html + score-consolidado.json
  EVALUAR: verificar que los 3 canales estén representados
```

---

## 10. API REST

### Endpoints

| Método | Path | Descripción |
|---|---|---|
| `POST` | `/api/jobs` | Crea e inicia un nuevo job |
| `GET` | `/api/jobs/:id` | Estado actual del job y métricas en tiempo real |
| `GET` | `/api/jobs/:id/reports` | Lista de entregables generados con URLs de descarga |
| `GET` | `/api/jobs/:id/reports/:file` | Descarga un entregable específico |
| `POST` | `/api/jobs/consolidate` | Consolida varios jobs (uno por canal) en un dashboard ejecutivo unificado. Body: `{ "job_ids": ["...", "..."] }` |
| `DELETE` | `/api/jobs/:id` | Cancela un job en curso |
| `GET` | `/api/health` | Health check del servicio |

### Respuesta de estado de job

```json
{
  "job_id": "string",
  "status": "pending | running | completed | failed | cancelled",
  "phase": "INIT | DISCOVER | PLAN | SCAN | ENRICH | ANALYZE | GENERATE | DONE",
  "progress": {
    "urls_total": 0,
    "urls_scanned": 0,
    "urls_failed": 0,
    "urls_enriched": 0,
    "percentage": 0.0
  },
  "current_action": "string — qué está haciendo el agente ahora",
  "iterations": 0,
  "started_at": "ISO8601",
  "estimated_completion": "ISO8601 | null",
  "reports": ["score-compliance.json", "dashboard.html"]
}
```

> **Nueva fase `ENRICH`:** aparece entre SCAN y ANALYZE cuando los skills externos están activos.

---

## 11. Variables de Entorno

```bash
# Requeridas
ANTHROPIC_API_KEY=sk-ant-...       # Clave API de Anthropic para el cerebro del agente

# Opcionales
PORT=3000                          # Puerto del servidor API (default: 3000)
LOG_LEVEL=info                     # Nivel de log: debug | info | warn | error
MAX_CONCURRENT_JOBS=3              # Jobs en paralelo máximos (default: 3)
REPORTS_PATH=./reports             # Directorio base para entregables
PLAYWRIGHT_BROWSERS_PATH=/opt/pw-browsers  # Path a browsers pre-instalados (Docker)

# Auth (se pueden setear por env en lugar de en la config)
SCAN_USERNAME=
SCAN_PASSWORD=

# Skills externos (opcional — permiten override global)
SKILLS_VISUAL_AUDIT=true
SKILLS_UX_REVIEW=true
SKILLS_REMEDIATION_PLAN=true
```

---

## 12. Stack Tecnológico

| Componente | Tecnología | Justificación |
|---|---|---|
| Runtime | Node.js 20+ | Ecosistema natural de axe-core y Playwright |
| Cerebro del agente | Anthropic SDK + Claude claude-sonnet-5 | Loop autónomo con tool-use real (decisión D2). `claude-opus-5` queda como alternativa documentada si en pruebas el loop no rinde. |
| Motor de escaneo | axe-core + @axe-core/playwright | Herramienta mencionada en la propuesta, mayor cobertura WCAG |
| Browser headless | Playwright | Mejor soporte de SPAs bancarias que Puppeteer |
| Crawling | crawlee (Playwright mode) | Crawler de producción con deduplicación y rate limiting |
| Skills externos | ui-skills.com (rams, web-design-guidelines, improve-ui) | Capa de análisis visual, UX y generación de planes de remediación |
| Empaquetado del agente | Agent Skills format (agentskills.io) | Portabilidad entre Claude Code, Cowork y cualquier cliente compatible |
| API | Express.js | Liviano, bien conocido, sin overhead |
| Paralelismo | p-limit | Control de concurrencia para workers de scan |
| Logs | winston | Structured logging JSON para cloud |
| Contenedor | Docker + docker-compose | Deploy en cualquier cloud (Render, Fly.io, AWS, GCP) |

---

## 13. Diagrama de Secuencia — Job Típico

```
Operador          API          Agent Core       Scanner     Skills Layer    Reporter
   │               │                │               │              │            │
   │ POST /jobs    │                │               │              │            │
   │──────────────►│                │               │              │            │
   │               │ iniciar job    │               │              │            │
   │               │───────────────►│               │              │            │
   │  { job_id }   │                │               │              │            │
   │◄──────────────│                │               │              │            │
   │               │   [OBSERVE] validar config     │              │            │
   │               │   [PLAN]   decidir estrategia  │              │            │
   │               │                │               │              │            │
   │               │                │ scan_batch()  │              │            │
   │               │                │──────────────►│              │            │
   │               │                │  axe_results  │              │            │
   │               │                │◄──────────────│              │            │
   │               │   [EVALUATE]   │               │              │            │
   │               │   [ADJUST]     │               │              │            │
   │               │                │               │ visual_audit()│           │
   │               │                │───────────────────────────►  │            │
   │               │                │               │  visual_findings          │
   │               │                │◄───────────────────────────  │            │
   │               │                │               │ ux_review()  │            │
   │               │                │───────────────────────────►  │            │
   │               │                │               │  ux_findings │            │
   │               │                │◄───────────────────────────  │            │
   │               │   [ANALYZE]    │               │              │            │
   │               │                │               │              │            │
   │               │                │               │ gen_remediation_plan()    │
   │               │                │───────────────────────────►  │            │
   │               │                │◄───────────────────────────  │            │
   │               │                │ generate_deliverables()                   │
   │               │                │──────────────────────────────────────────►│
   │               │                │◄──────────────────────────────────────────│
   │               │  job COMPLETED │                                            │
   │               │◄───────────────│                                            │
   │ GET /reports  │                │                                            │
   │──────────────►│                │                                            │
   │  [archivos]   │                │                                            │
   │◄──────────────│                │                                            │
```

---

## 14. Consideraciones de Seguridad

- Las credenciales de auth nunca se persisten en logs ni en el Job Store.
- El `ANTHROPIC_API_KEY` se inyecta solo por variable de entorno, nunca en config JSON.
- El agente escanea únicamente las URLs explícitamente en alcance (no sigue links externos).
- Los reportes generados se almacenan en el servidor; el operador descarga vía API autenticada.
- En producción: agregar autenticación a la API (`Bearer token` por job o `API Key` global).

---

## 15. Limitaciones Conocidas (Alcance F1)

| Limitación | Impacto | Mitigación |
|---|---|---|
| axe-core detecta ~57% de barreras WCAG | El score F1 es una línea base, no un compliance final | Documentado en todos los reportes; skills externos elevan cobertura |
| No evalúa apps nativas iOS/Android | Solo cubre la WebView | F2 cubre evaluación con VoiceOver / TalkBack |
| No evalúa flujos post-login sin auth config | Módulos autenticados quedan sin cubrir | El operador debe proveer credenciales de test en la config |
| No evalúa contenido dinámico por usuario | Personalización post-login puede tener estados distintos | Se documenta en la nota de alcance del reporte |
| No genera el ACR/VPAT® | Ese entregable corresponde a F3 | El roadmap de F1 alimenta el proceso F2→F3 |
| Skills externos dependen de la API de Anthropic | Si la API no está disponible, el paso ENRICH se omite | El agente continúa sin los skills y lo documenta en el reporte |

---

## 16. Criterios de Aceptación del Agente

El agente F1 se considera funcional cuando:

**Core:**
- [ ] Acepta configuración en modo `url_list` y en modo `crawl`.
- [ ] Ejecuta el loop autónomo sin intervención para un job estándar de 8 URLs.
- [ ] Genera los 5 entregables de F1 en formato válido.
- [ ] El `score-compliance.json` contiene `onti_compliance_percentage` y `onti_conformance` (≥ 30/38) correctamente calculados sobre los 38 criterios ONTI.
- [ ] Con `wcag.extended_22=true`, el `score-compliance.json` incluye el objeto `extended_22` con score separado; con `false`, los hallazgos fuera de los 38 no aparecen.
- [ ] El `dashboard.html` es standalone (sin red), abre en browser y muestra el score ONTI y su estado de conformidad.
- [ ] La `matriz-criticidad` cubre los 38 criterios ONTI (25 A + 13 AA) en las dos vistas (conformidad y severidad × impacto); si `extended_22=true`, agrega las filas 2.1/2.2 separadas.
- [ ] El `roadmap-remediacion` lista hallazgos ordenados por prioridad (ONTI primero, luego severidad).
- [ ] `inventario-hallazgos`, `matriz-criticidad` y `roadmap-remediacion` se generan también en `.xlsx` en todos los jobs, abren en Excel y muestran los datos.
- [ ] Con jobs de más de un canal, `POST /api/jobs/consolidate` produce `dashboard-consolidado.html` con los 3 canales y un score global.
- [ ] El job se completa o detiene con criterio de parada claro en ≤ 30 iteraciones.
- [ ] Los logs muestran el estado del loop en cada iteración (transparencia).
- [ ] El agente solicita clarificación en lugar de fallar si encuentra un bloqueo.

**Skills externos:**
- [ ] Si `visual_audit=true`, el inventario incluye hallazgos con `source: "visual_audit"`.
- [ ] Si `ux_compliance_review=true`, el inventario incluye hallazgos con `source: "ux_review"`.
- [ ] Si `generate_remediation_plan=true`, el roadmap incluye planes de implementación autocontenidos por hallazgo.
- [ ] Si la API falla durante ENRICH, el agente continúa sin los skills y lo documenta.

**Empaquetado:**
- [ ] El agente está empaquetado como Agent Skill (formato agentskills.io) con `SKILL.md`, `scripts/`, `references/` y `assets/`.
- [ ] El skill es invocable desde Claude Code y desde Cowork sin modificaciones.

---

## 17. Preguntas Abiertas para Revisión

Antes de iniciar la construcción, se requiere definición de los siguientes puntos:

1. **Auth del HB:** ¿El entorno de prueba de la Entidad usa MFA? Si sí, ¿el agente puede usar un usuario de test sin MFA o se necesita resolver el token previamente?
2. **Almacenamiento de reportes:** ¿Los reportes se entregan vía API interna o deben subirse a un bucket (S3/GCS) para que el equipo los acceda directamente?
3. **Deploy target:** ¿La Entidad tiene preferencia de cloud (AWS / GCP / Azure / Render)?
4. **Retención de jobs:** ¿Cuánto tiempo se conservan los resultados de un job en el sistema?
5. **Multi-tenancy:** ¿El SaaS debe soportar múltiples entidades financieras cliente o es mono-tenant para esta propuesta?
6. **Notificaciones:** ¿El operador necesita recibir notificación (email/webhook) cuando un job finaliza?

**Decisiones resueltas en la alineación con la propuesta (v0.3):**

| ID | Decisión | Resolución |
|---|---|---|
| D1 | Composición del entregable "Matriz de Criticidad" (ver 8.4) | **Ambas vistas:** matriz de conformidad criterio × módulo **+** grilla severidad × impacto |
| D2 | Modelo del cerebro del agente | **`claude-sonnet-5`.** `claude-opus-5` queda documentado como alternativa si en pruebas el loop no rinde |
| D3 | Formato de los entregables | **JSON + HTML + XLSX** en todos los jobs (XLSX para inventario, matriz y roadmap). JSON = contrato de datos |
| D4 | Marco de referencia en los reportes al cliente | **Superada por D6.** El reporte se basa en los 38 criterios ONTI (WCAG 2.0 A+AA), umbral 30 |
| D5 | Vista ejecutiva de los 3 canales (1 canal = 1 job) | **Job por canal + paso `consolidate_jobs`** que agrega HB / iOS / Android en `dashboard-consolidado.html` con score global |
| D6 | Estándar WCAG base de F1 | **WCAG 2.0 A+AA — 38 criterios ONTI Disp. 6/2019 (25 A + 13 AA), umbral ≥ 30/38** (láminas 9 y 10 de la propuesta). WCAG 2.2 AA = capa extendida opcional (`wcag.extended_22`) con score separado |
| D7 | Hallazgos de criterios fuera de los 38 (2.1/2.2) | Se **descartan** por defecto. Solo entran al inventario y a un score separado si `wcag.extended_22=true` |

---

## 18. Mapeo Normativo: ONTI 38 Criterios (base) + Capa Extendida WCAG 2.2 (opcional)

El **scope base y obligatorio de F1** es 18.1 (los 38 criterios ONTI). La sección 18.2 es la **capa extendida opcional** que solo se evalúa con `wcag.extended_22=true`.

### 18.1 ONTI Disposición 6/2019 — Los 38 Criterios de Conformidad (BASE DE F1)

La ONTI adopta **WCAG 2.0** (no 2.1 ni 2.2). Selecciona exactamente **38 criterios**:
- **25 criterios de Nivel A**
- **13 criterios de Nivel AA**

| # | Criterio WCAG 2.0 | Nivel | Descripción breve | Automatizable con axe-core / pa11y | Requiere revisión manual / agente |
|---|-------------------|-------|-------------------|------------------------------------|-----------------------------------|
| 1 | 1.1.1 | A | Contenido no textual | Parcial (detecta ausencia de alt) | Sí — calidad del texto alternativo |
| 2 | 1.2.1 | A | Solo audio y solo vídeo (pregrabado) | No | Sí |
| 3 | 1.2.2 | A | Subtítulos (pregrabados) | No | Sí |
| 4 | 1.2.3 | A | Audiodescripción o Media Alternative | No | Sí |
| 5 | 1.3.1 | A | Información y relaciones | Parcial (estructura, headings, lists) | Sí — semántica compleja |
| 6 | 1.3.2 | A | Secuencia significativa | Parcial | Sí |
| 7 | 1.3.3 | A | Características sensoriales | No | Sí |
| 8 | 1.4.1 | A | Uso del color | Parcial | Sí |
| 9 | 1.4.2 | A | Control del audio | No | Sí |
| 10 | 2.1.1 | A | Teclado | Parcial (focusable) | Sí — trampas y flujos completos |
| 11 | 2.1.2 | A | Sin trampas de teclado | Parcial | Sí |
| 12 | 2.2.1 | A | Tiempo ajustable | No | Sí |
| 13 | 2.2.2 | A | Pausar, detener, ocultar | No | Sí |
| 14 | 2.3.1 | A | Umbral de tres destellos | Parcial | Sí |
| 15 | 2.4.1 | A | Evitar bloques | Sí (skip links, landmarks) | Parcial |
| 16 | 2.4.2 | A | Página titulada | Sí | No |
| 17 | 2.4.3 | A | Orden del foco | Parcial | Sí |
| 18 | 2.4.4 | A | Propósito de los enlaces (en contexto) | Parcial | Sí — claridad del propósito |
| 19 | 3.1.1 | A | Idioma de la página | Sí | No |
| 20 | 3.2.1 | A | Al recibir el foco | No | Sí |
| 21 | 3.2.2 | A | Al recibir entradas | No | Sí |
| 22 | 3.3.1 | A | Identificación de errores | Parcial | Sí |
| 23 | 3.3.2 | A | Etiquetas o instrucciones | Parcial | Sí |
| 24 | 4.1.1 | A | Procesamiento (Parsing) | Sí (obsoleto en 2.2 pero aún en ONTI) | No |
| 25 | 4.1.2 | A | Nombre, función, valor | Sí (ARIA) | Parcial |
| 26 | 1.2.4 | AA | Subtítulos (en directo) | No | Sí |
| 27 | 1.2.5 | AA | Audiodescripción (pregrabada) | No | Sí |
| 28 | 1.4.3 | AA | Contraste (mínimo) | Sí | No |
| 29 | 1.4.4 | AA | Cambio de tamaño del texto | Parcial | Sí |
| 30 | 1.4.5 | AA | Imágenes de texto | Parcial | Sí |
| 31 | 2.4.5 | AA | Múltiples vías | No | Sí |
| 32 | 2.4.6 | AA | Encabezados y etiquetas | Parcial | Sí — claridad |
| 33 | 2.4.7 | AA | Foco visible | Parcial | Sí |
| 34 | 3.1.2 | AA | Idioma de las partes | Sí | No |
| 35 | 3.2.3 | AA | Navegación coherente | No | Sí |
| 36 | 3.2.4 | AA | Identificación coherente | No | Sí |
| 37 | 3.3.3 | AA | Sugerencias ante errores | No | Sí |
| 38 | 3.3.4 | AA | Prevención de errores (legales, financieros, datos) | No | Sí |

**Resumen ONTI 38 criterios:**
- Totalmente o altamente automatizables: ~12–14
- Parcialmente automatizables: ~10–12
- Requieren revisión manual / agente / AT reales: ~14–16

---

### 18.2 Capa Extendida WCAG 2.2 — Opcional (no exigida por BCRA ni ONTI)

Se evalúa **solo si `wcag.extended_22=true`**, con score separado del compliance ONTI. Son los criterios que WCAG 2.1 y 2.2 agregan por encima de los 38 de la ONTI (WCAG 2.0 A+AA). **18 criterios**, varios muy relevantes para banca:

#### Suma WCAG 2.1 (12 criterios)

| Criterio | Nivel | Relevancia banca |
|---|---|---|
| 2.1.4 Atajos de teclado con caracteres | A | Home banking con shortcuts |
| 2.5.1 Gestos de puntero | A | App: pinch/swipe con alternativa |
| 2.5.2 Cancelación del puntero | A | Evitar acciones al soltar |
| 2.5.3 Etiqueta en el nombre accesible | A | Botones "Transferir", "Pagar" |
| 2.5.4 Actuación por movimiento | A | Sacudir para deshacer |
| 1.3.4 Orientación | AA | No forzar portrait/landscape |
| 1.3.5 Identificar el propósito de la entrada | AA | Autocompletar CBU/CVU, DNI |
| 1.4.10 Reajuste (reflow) | AA | Zoom 400% sin scroll horizontal |
| 1.4.11 Contraste de elementos no textuales | AA | Bordes de inputs, íconos de estado |
| 1.4.12 Espaciado del texto | AA | Sin recortes al aumentar interlineado |
| 1.4.13 Contenido en hover/focus | AA | Tooltips de ayuda descartables |
| 4.1.3 Mensajes de estado | AA | "Transferencia enviada" anunciado por lector |

#### Suma WCAG 2.2 (6 criterios)

| Criterio | Nivel | Relevancia banca |
|---|---|---|
| 3.2.6 Ayuda coherente | A | "Contactar" siempre en el mismo lugar |
| 3.3.7 Entrada redundante | A | No re-pedir datos ya ingresados en el flujo |
| 2.4.11 Foco no oscurecido (mínimo) | AA | Sticky headers que tapan el foco |
| 2.5.7 Movimientos de arrastre | AA | Sliders de monto con alternativa |
| 2.5.8 Tamaño del objetivo (mínimo 24×24) | AA | Botones y teclado numérico táctil |
| 3.3.8 Autenticación accesible | AA | **Login / MFA sin prueba cognitiva** (captcha, recordar) |

> WCAG 2.2 elimina 4.1.1 (Parsing); ese criterio **sí** sigue vigente en ONTI (18.1, #24) y el agente lo evalúa siempre como parte de los 38. El Nivel AAA de WCAG no se evalúa en ninguna capa.

---

### 18.3 Capacidad de Automatización del Agente F1

| Método | Cobertura aproximada | Criterios cubiertos principalmente |
|--------|----------------------|------------------------------------|
| **axe-core (automático)** | ~55–57% de los hallazgos por volumen | Contraste, alt vacío, ARIA inválida, labels, lang, títulos, skip links, target-size, focus visible parcial |
| **Skills externos (visual_audit + ux_review)** | Eleva cobertura ~5–8% adicional | Contraste límite, touch targets, coherencia de navegación, patrones de formularios, mensajes de error |
| **Parcial / incomplete** | — | El agente marca como `parcialmente_conforme` y eleva a revisión manual o F2 |
| **Revisión manual / AT reales (F2)** | Resto ~35–40% | Calidad de textos alternativos, flujos de teclado completos, subtítulos, audiodescripción, prevención de errores financieros, etc. |

**Política del agente:**

El agente genera el score automático sobre los **38 criterios ONTI (WCAG 2.0 A+AA)** con axe-core + skills externos, y marca explícitamente en todos los reportes:

> *"Este score corresponde a la detección automática sobre los 38 criterios de la ONTI Disp. 6/2019 (~57–65% de las barreras con skills activos). Los criterios que requieren evaluación con tecnologías de asistencia o juicio humano se tratan en Fase 2. La capa WCAG 2.2, si se auditó, se reporta por separado y no incide en el compliance ONTI."*

En la matriz de criticidad distingue: `conforme` | `no_conforme` | `parcialmente_conforme` (incomplete) | `no_aplica`.

---

### 18.4 Impacto en los Entregables de F1

- El **Score de Cumplimiento** se calcula sobre los **38 criterios ONTI (WCAG 2.0 A+AA)**, con el estado de conformidad según el umbral 30/38. Si `wcag.extended_22=true`, se agrega un objeto `extended_22` con score separado de los 18 criterios de la capa.
- La **Matriz de Criticidad** cruza los 38 criterios ONTI × módulo (columna `nivel` A/AA). Con la capa extendida activa, suma las filas 2.1/2.2 al final, rotuladas como no exigidas.
- El **Roadmap de Remediación** prioriza los 25 criterios A de la ONTI (bloqueantes), luego los 13 AA, luego severidad y frecuencia; marca los "quick wins" que cruzan el umbral 30/38. Los ítems de la capa extendida van al final.
- El **Dashboard Ejecutivo** muestra el score ONTI y su estado de conformidad como KPI regulatorio primario. La capa WCAG 2.2, si se auditó, aparece en un bloque separado y secundario.

---

## 19. Skills Externos — Detalle de Integración

### 19.1 Origen y formato

Los skills se obtienen del catálogo **ui-skills.com** y se integran siguiendo el estándar **Agent Skills** (agentskills.io), el formato abierto desarrollado por Anthropic para empaquetar conocimiento especializado como instrucciones portables.

Cada skill es una carpeta con:
```
skill-name/
├── SKILL.md       # metadata + instrucciones que el agente carga en contexto
├── scripts/       # código ejecutable (opcional)
├── references/    # documentación de referencia (opcional)
└── assets/        # templates y recursos (opcional)
```

### 19.2 Skills integrados

#### `antfu/rams` → herramienta `visual_audit`

**Qué aporta:** análisis de diseño en tiempo real con foco en accesibilidad visual: contraste, spacing, tipografía, touch targets y calidad de componentes. Detecta issues que axe-core no puede evaluar solo con el DOM (por ejemplo: contraste que está en el límite técnico pero falla en condiciones reales, o touch targets de 40px que pasan el mínimo técnico pero son difíciles de usar).

**Cuándo se invoca:** después del scan axe-core, sobre las URLs ya procesadas, usando screenshots y snapshots del DOM como input.

**Output:** `visual_findings[]` — lista de hallazgos visuales con severidad y recomendación.

#### `Leonxlnx/web-design-guidelines` → herramienta `ux_compliance_review`

**Qué aporta:** revisión de conformidad con guías de interfaz web, incluyendo criterios WCAG de UX y buenas prácticas de accesibilidad que requieren evaluación de patrones de interacción (coherencia de navegación, mensajes de error, flujos de formularios).

**Cuándo se invoca:** en paralelo con visual_audit, analizando los flujos de interacción detectados durante el crawling.

**Output:** `ux_findings[]` — hallazgos de coherencia y UX, mapeados a criterios WCAG cuando aplica.

#### `ibelick/improve-ui` → herramienta `generate_remediation_plan`

**Qué aporta:** audita la superficie existente del producto, identifica problemas verificados y genera planes de implementación autocontenidos listos para ser ejecutados por otro agente o por el equipo de desarrollo. No modifica el código fuente — solo planifica.

**Cuándo se invoca:** en la fase GENERATE, después de consolidar todos los hallazgos (axe-core + visual_audit + ux_review), para producir los planes de fix del Entregable 5 (Roadmap).

**Output:** `remediation_plans[]` — un plan por hallazgo, con: descripción del problema, criterio WCAG afectado, código de ejemplo correcto, estimación de esfuerzo y dependencias.

### 19.3 Empaquetado del agente como Agent Skill

El agente F1 completo se empaqueta como un Agent Skill siguiendo el estándar agentskills.io:

```
f1-compliance-agent/
├── SKILL.md                  # metadata del agente + instrucciones del loop autónomo
├── scripts/
│   ├── crawler.js            # módulo de crawling
│   ├── scanner.js            # módulo axe-core
│   ├── classifier.js         # clasificación de hallazgos
│   └── reporter.js           # generación de entregables
├── references/
│   ├── onti-38-criteria.json      # los 38 criterios ONTI 6/2019 — BASE de F1
│   ├── wcag-22-extended.json      # los 18 criterios 2.1/2.2 de la capa opcional
│   └── bcra-7517-summary.md       # resumen de obligaciones BCRA
└── assets/
    ├── dashboard-template.html
    ├── matriz-template.html
    └── roadmap-template.html
```

**Ventaja:** el agente es portable y corre sin modificaciones en Claude Code, Cowork y cualquier cliente compatible con el estándar Agent Skills.

---

*Documento preparado por CFOTech IT Global Services · Equipo de Delivery · Septiembre 2026*  
*v0.1 → v0.2: incorporación de skills externos (ui-skills.com / agentskills.io) y mapeo normativo completo ONTI + WCAG 2.2*  
*v0.2 → v0.3: alineación con Propuesta_Accesibilidad_EntidadFinanciera_v7.pptx (láminas 9-10 como base) — marco base WCAG 2.0 / 38 criterios ONTI, umbral 30/38 (D6); WCAG 2.2 AA como capa extendida opcional con score separado (D6/D7); modelo `claude-sonnet-5` (D2); matriz de criticidad de dos vistas (D1); entregables JSON+HTML+XLSX en todos los jobs (D3); consolidación multi-canal `consolidate_jobs` (D5); alcance WebView de App Mobile*
