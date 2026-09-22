# Informe: Set de pruebas MCP Playwright + axe-core

2026-09-16

## Objetivo

Validar, antes de escribir `scanner.js` (Sub-plan B del agente F1), que el mecanismo de inyección de axe-core vía Playwright MCP funciona de punta a punta: navegar a una URL, inyectar la librería, correr el análisis y leer los resultados en formato estructurado. Para eso se armó un set de 4 páginas de prueba elegidas para cubrir casos distintos de severidad y volumen de violaciones.

## Metodología

Se usó el MCP de Playwright (`mcp__playwright__*`) para navegar cada URL y luego se inyectó axe-core mediante `browser_evaluate`, con esta función reutilizable:

```js
async () => {
  if (!window.axe) {
    await new Promise((resolve, reject) => {
      const s = document.createElement('script');
      s.src = 'https://cdnjs.cloudflare.com/ajax/libs/axe-core/4.10.2/axe.min.js';
      s.onload = resolve;
      s.onerror = reject;
      document.head.appendChild(s);
    });
  }
  const results = await window.axe.run();
  return {
    url: location.href,
    violationCount: results.violations.length,
    violations: results.violations.map(v => ({ id: v.id, impact: v.impact, nodes: v.nodes.length, help: v.help })),
    passCount: results.passes.length
  };
}
```

Este mismo patrón (inyectar la librería vía CDN si no está presente, correr `axe.run()`, y mapear `violations`/`passes` a un objeto liviano) es el candidato directo para la función de escaneo dentro de `scanner.js`.

## Resultados por página

| Página | Rol en el set | Violaciones | Críticas | Serias | Moderadas | Passes |
|---|---|---|---|---|---|---|
| `example.com` | Baseline limpio | 2 | 0 | 0 | 2 | 13 |
| W3C WAI *before* (`w3.org/WAI/demos/bad/before/home.html`) | Sitio intencionalmente malo | 7 | 2 | 3 | 2 | 22 |
| W3C WAI *after* (`w3.org/WAI/demos/bad/after/home.html`) | Misma página, corregida | 2 | 0 | 0 | 2 | 24 |
| Deque Mars (`dequeuniversity.com/demo/mars/`) | Demo compleja de referencia de la industria | 12 | 3 | 6 | 3 | 38 |

### Detalle de violaciones

**`example.com`** (2): `landmark-one-main` (moderate, 1 nodo), `region` (moderate, 1 nodo).

**W3C WAI before** (7): `image-alt` (critical, 33 nodos), `select-name` (critical, 1 nodo), `color-contrast` (serious, 2 nodos), `html-has-lang` (serious, 1 nodo), `link-name` (serious, 7 nodos), `landmark-one-main` (moderate, 1 nodo), `region` (moderate, 22 nodos).

**W3C WAI after** (2): `landmark-one-main` (moderate, 1 nodo), `region` (moderate, 14 nodos).

**Deque Mars** (12): `button-name` (critical, 1 nodo), `image-alt` (critical, 4 nodos), `select-name` (critical, 2 nodos), `color-contrast` (serious, 7 nodos), `frame-title` (serious, 1 nodo), `html-has-lang` (serious, 1 nodo), `link-in-text-block` (serious, 1 nodo), `link-name` (serious, 8 nodos), `tabindex` (serious, 4 nodos), `landmark-one-main` (moderate, 1 nodo), `landmark-unique` (moderate, 1 nodo), `region` (moderate, 35 nodos).

## Hallazgos y conclusiones

- El mecanismo de inyección (crear un `<script>` con axe-core desde CDN + `axe.run()` vía `browser_evaluate`) funcionó sin fricción en las 4 páginas. Es viable como base directa de `scanner.js`.
- El contraste antes/después del sitio W3C WAI (7 → 2 violaciones, 2 críticas → 0) confirma que axe-core es sensible a mejoras reales de accesibilidad — buena señal para que el scoring del agente refleje cambios genuinos.
- La demo de Deque Mars sumó una violación `frame-title` por un iframe embebido. Axe-core por defecto solo escanea el frame donde corre el script, así que hay que decidir si `scanner.js` va a inyectar también dentro de iframes anidados o si eso queda fuera de alcance de F1.
- Ningún `rule id` de axe-core mapea 1:1 a un criterio ONTI. El `classifier` (Sub-plan C) va a necesitar una tabla de traducción explícita rule-id → criterio WCAG → ítem ONTI (ej. `image-alt` → 1.1.1 → criterio ONTI correspondiente).

## Próximos pasos

- Convertir el snippet de inyección en una función reutilizable de `scanner.js` (Sub-plan B), en vez de repetirlo a mano en cada `browser_evaluate`.
- Decidir el alcance de escaneo de iframes (afecta a páginas como Deque Mars y probablemente al canal real de la entidad financiera).
- Armar la tabla de mapeo rule-id de axe-core → criterio ONTI para el `classifier` de Sub-plan C, usando estas 4 corridas como casos de prueba de referencia.
