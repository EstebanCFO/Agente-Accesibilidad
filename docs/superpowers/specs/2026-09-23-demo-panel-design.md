# Diseño: Panel de Control Web para la Demo (reemplaza la terminal)

**Fecha:** 2026-09-23
**Motivado por:** el presentador quiere una experiencia más integrada para la demo de `npm run demo` frente a directorio — poder ver la selección de opciones y el avance paso a paso sin depender de una terminal, con el navegador que audita el sitio real visible al mismo tiempo, sin superponerse.
**Estado:** aprobado en chat tras un spike visual real (ver más abajo), pendiente de plan de implementación.

## Decisión de layout (ya validada con un spike real, no es teórica)

Dos ventanas reales de Chromium, una arriba de la otra, sin superponerse:
- **Panel de control** (arriba, franja de **260px de alto**, ancho completo de la pantalla): título, stepper horizontal de los 6 pasos, botones de selección/texto según lo que se esté preguntando, y un log en vivo de las últimas líneas.
- **Navegador de prueba** (abajo, ocupa el resto de la pantalla): es el mismo navegador que ya usa `demo.js` hoy para navegar el sitio real, resaltar violaciones y al final abrir la pestaña del dashboard — sin cambios en esa lógica, solo se reposiciona.

Se descartaron explícitamente 3 alternativas antes de llegar a esta (discutidas en chat): iframe directo del sitio auditado (falla en al menos 1 de los 3 sitios de referencia por `CSP frame-ancestors`, y no mostraría los resaltados que se inyectan en la ventana aparte), proxy propio con HTML reescrito (resuelve lo anterior pero con mucha más superficie de riesgo para el día de la demo), y streaming en vivo vía CDP screencast (más vistoso pero mucho más frágil). Dos ventanas OS reales, sin overlap, es la opción más simple y confiable.

## Dos bugs reales encontrados en el spike — cualquiera que implemente esto los va a pisar si no los conoce

1. **`browser.newContext()` sin `{ viewport: null }` rompe todo el layout.** Por default Playwright fuerza un viewport emulado de 1280x720 *desacoplado del tamaño real de la ventana OS* — aunque se cambie el tamaño de la ventana con CDP, el contenido de la página sigue renderizando como si la ventana midiera 1280x720. Sin este flag, achicar la ventana del panel a 260px de alto deja visible solo la punta de una página cuyo contenido queda centrado mucho más abajo, fuera del área visible ("página en blanco" fue el síntoma real observado). **Toda ventana headed de este panel tiene que crear su context con `{ viewport: null }`** (mismo patrón que ya usa `demo.js` para el navegador de prueba).
2. **`Browser.setWindowBounds` de CDP necesita 2 llamadas, no 1.** Pasar `{left, top, width, height, windowState:'normal'}` en una sola llamada fue silenciosamente ignorado en la práctica (CDP devolvía éxito y hasta reportaba el bounds correcto en un `Browser.getWindowBounds` posterior, pero la ventana real en pantalla no cambiaba de tamaño). Hace falta primero **forzar `windowState:'normal'` en su propia llamada**, y **recién después** mandar los bounds reales en una segunda llamada.

Ambos bugs están resueltos y verificados visualmente (screenshot real + confirmación del usuario mirando su propia pantalla) antes de escribir esta spec.

## Arquitectura

```
scripts/
  demo-prompt-broker.js      (nuevo, con tests) - coordina preguntas/respuestas, sin I/O
  demo-window-layout.js      (nuevo, con tests) - calcula los 2 rects de ventana, sin I/O
  demo-server.js             (nuevo, sin tests) - Express: sirve el panel, SSE, recibe respuestas
  demo-panel.html            (nuevo, sin tests) - la página del panel (HTML+CSS+JS inline)
  demo.js                    (modificado, sin tests) - misma secuencia de 6 pasos, sin readline
  demo-site-selection.js     (sin cambios - resolveReferenceSiteUrl/resolveTargetUrl se siguen usando igual)
  demo-page-selection.js     (sin cambios)
  demo-local-source.js       (sin cambios)
  demo-highlight.js          (sin cambios)
```

**Regla de testing (ya establecida en este proyecto para `scripts/`, se mantiene):** los módulos de lógica pura (`demo-prompt-broker.js`, `demo-window-layout.js`) llevan tests reales con `node:test`, igual que `demo-site-selection.js`/`demo-page-selection.js`/`demo-highlight.js`. La orquestación (`demo.js`, `demo-server.js`, `demo-panel.html`) queda sin tests automatizados, por el mismo acuerdo explícito ya vigente para `demo.js`.

### `demo-prompt-broker.js` — coordina preguntas/respuestas (reemplaza `readline`)

Antes, `demo.js` usaba `rl.question(...)` (bloquea leyendo stdin). Ahora la pregunta se manda al panel por SSE y la respuesta llega por un `POST /answer` en otro request HTTP — hace falta un broker en memoria que conecte esas dos puntas:

```javascript
export function createPromptBroker() {
  let pending = null;
  let nextId = 1;

  function ask() {
    if (pending) throw new Error('Ya hay un prompt pendiente sin responder');
    const id = String(nextId++);
    let resolve, reject;
    const promise = new Promise((res, rej) => { resolve = res; reject = rej; });
    pending = { id, resolve, reject };
    return { id, promise };
  }

  function answer(id, value) {
    if (!pending || pending.id !== id) return false;
    const { resolve } = pending;
    pending = null;
    resolve(value);
    return true;
  }

  function cancelPending(reason) {
    if (!pending) return false;
    const { reject } = pending;
    pending = null;
    reject(reason instanceof Error ? reason : new Error(String(reason)));
    return true;
  }

  function hasPending() {
    return pending !== null;
  }

  return { ask, answer, cancelPending, hasPending };
}
```

- `ask()` es síncrono y devuelve `{id, promise}` — el `id` se usa de inmediato para armar el evento SSE, `promise` es lo que `demo.js` espera con `await`.
- `answer(id, value)` solo resuelve si el `id` coincide con el pendiente actual (protege contra respuestas tardías de un prompt viejo, ej. doble click).
- `cancelPending(reason)` se usa cuando el presentador cierra una de las 2 ventanas a mitad de la demo — sin esto, `demo.js` quedaría esperando para siempre una respuesta que nunca va a llegar.
- Un solo prompt pendiente a la vez (consistente con que `demo.js` es una secuencia estrictamente lineal, nunca pregunta 2 cosas en paralelo).

### `demo-window-layout.js` — calcula los 2 rects, sin tocar ninguna ventana real

```javascript
const MIN_TEST_WINDOW_HEIGHT = 300;

export function computeWindowLayout(screenWidth, screenHeight, panelHeight) {
  const testHeight = screenHeight - panelHeight;
  if (testHeight < MIN_TEST_WINDOW_HEIGHT) {
    throw new Error(`Pantalla demasiado chica para este layout: quedarían ${testHeight}px para el navegador de prueba (mínimo ${MIN_TEST_WINDOW_HEIGHT}px). Reducí PANEL_HEIGHT o usá una pantalla más grande.`);
  }
  return {
    panel: { left: 0, top: 0, width: screenWidth, height: panelHeight },
    test: { left: 0, top: panelHeight, width: screenWidth, height: testHeight }
  };
}
```

### `demo-server.js` — Express: sirve el panel, SSE, recibe respuestas

Responsabilidades (sin tests automatizados, es orquestación/I/O — mismo criterio que `demo.js`):
- `GET /panel` → sirve `demo-panel.html` tal cual (`res.sendFile` o `readFile`+`res.type('html').send(...)`).
- `GET /events` → SSE (`Content-Type: text/event-stream`), agrega el `res` a un `Set` de clientes conectados, lo saca del set en `req.on('close', ...)`.
- `POST /answer` → body `{id, value}`, llama a `broker.answer(id, value)`; `200 {ok:true}` si coincidía, `409 {ok:false}` si no (prompt viejo o inexistente).
- Expone a `demo.js`, vía el objeto que devuelve `createDemoServer()`:
  - `askPanel({kind:'buttons'|'text', text, options?, placeholder?})` → `pushEvent('prompt', {id, kind, text, options, placeholder})` y devuelve la `promise` del broker.
  - `pushStep(activeStepNumber)` → arma el estado de los 6 pasos fijos (`STEP_LABELS`, ver abajo) y emite `pushEvent('step', {steps: [{label, state}]})`. `activeStepNumber` es **1-based** (mismo valor `n` que hoy recibe `header(n, title)`). Para cada índice `i` (0-based) de `STEP_LABELS`: `state = i < activeStepNumber - 1 ? 'done' : i === activeStepNumber - 1 ? 'active' : 'pending'`.
  - `pushLog(message)` → `pushEvent('log', {message})`.
  - `cancelPending(reason)` → delega en `broker.cancelPending`.

```javascript
const STEP_LABELS = [
  'Descubrir', 'Escanear', 'Clasificar contra ONTI/BCRA',
  'Revisión visual con IA', 'Revisión de UX con IA', 'Generar el dashboard ejecutivo'
];
```

### `demo-panel.html` — la página del panel

Un solo archivo self-contained (HTML+CSS+JS inline, mismo criterio que `dashboard-deliverable.js`: sin `<script src>`/`<link>` externos). Contenido:
- Título fijo "AGENTE F1 · PANEL DE CONTROL".
- Stepper horizontal de 6 casilleros (mismos 3 estados visuales que ya se probaron en el spike: gris pendiente / azul activo / verde hecho).
- Un área de "prompt actual": se conecta a `/events` con `EventSource`, y en cada evento `prompt` reemplaza esa área según `kind`:
  - `'buttons'` → un botón por cada `options[]`, `onclick` hace `fetch('/answer', {method:'POST', body: JSON.stringify({id, value})})`.
  - `'text'` → un `<input>` (con `placeholder` si vino) + botón "Enviar", que manda `{id, value: input.value}`.
  - Mientras no hay ningún prompt activo (el servidor está trabajando, ej. corriendo el crawler o llamando a la IA), el área muestra "Trabajando..." sin controles.
- Un área de log: mantiene las últimas 6 líneas recibidas por evento `log`, más nuevas abajo.
- Reusa la paleta ya usada en `dashboard-deliverable.js` (`#2a78d6` azul, `#0ca30c` verde, gris neutro para pendiente).

### `demo.js` — misma secuencia de 6 pasos, sin `readline`

Cambios puntuales sobre el archivo actual (la estructura general del `main()` no cambia, sigue siendo lineal paso 1 a 6):

1. Se elimina el import de `node:readline/promises` y todo uso de `rl`/`createInterface`.
2. `import { createDemoServer } from './demo-server.js';` y al arrancar `main()`:
   ```javascript
   const { app, askPanel, pushStep, pushLog, cancelPending } = createDemoServer();
   const server = http.createServer(app);
   await new Promise((resolve) => server.listen(0, resolve));
   const { port } = server.address();
   ```
3. Selección inicial de sitio — reemplaza el primer `rl.question`:
   ```javascript
   const choice = await askPanel({
     kind: 'buttons', text: 'Elegí cómo vas a auditar',
     options: [
       { label: 'Sitio de referencia', value: '1' },
       { label: 'Sitio del cliente', value: '2' },
       { label: 'Otra URL o carpeta local', value: '3' }
     ]
   });
   ```
   Si `choice === '1'`, el submenú de `REFERENCE_SITES` también pasa a botones:
   ```javascript
   const subChoice = await askPanel({
     kind: 'buttons', text: 'Elegí un sitio de referencia',
     options: REFERENCE_SITES.map((site, i) => ({ label: site.label, value: String(i + 1) }))
   });
   referenceSiteUrl = resolveReferenceSiteUrl(subChoice); // sin cambios
   ```
   Si `choice` es `'2'`/`'3'`, se pide texto libre en vez de `rl.question('Pegá la URL...')`:
   ```javascript
   customInput = await askPanel({ kind: 'text', text: 'Pegá la URL o el path de una carpeta local', placeholder: 'https://... o C:\\...' });
   ```
4. Los 2 prompts de "¿cuántas subpáginas...?" (rama de carpeta local y rama de sitio crawleado) cambian de `rl.question(...)` a:
   ```javascript
   const answer = await askPanel({ kind: 'text', text: `¿Cuántas de estas querés auditar además de la principal? (0-${rest.length})`, placeholder: '0' });
   ```
   `resolveAdditionalPageCount(answer, ...)` se sigue usando exactamente igual (sin cambios en `demo-page-selection.js`).
5. `header(n, title)` pasa a también llamar `pushStep(n)` (además de seguir imprimiendo el banner por consola, como respaldo/debug).
6. `pause(nextStepLabel)` se reemplaza por:
   ```javascript
   await askPanel({ kind: 'buttons', text: nextStepLabel, options: [{ label: 'Siguiente paso →', value: 'continue' }] });
   ```
7. Cada `console.log(...)` que hoy reporta progreso real (resultados de escaneo, cantidad de hallazgos, etc.) también llama a `pushLog(mismoTexto)` — se mantiene el `console.log` en paralelo como respaldo en terminal.
8. Lanzamiento de las 2 ventanas (reemplaza el único `chromium.launch({headless:false, args:['--start-maximized']})`):
   ```javascript
   const PANEL_HEIGHT = 260;

   async function setWindowBounds(page, bounds) {
     const client = await page.context().newCDPSession(page);
     const { windowId } = await client.send('Browser.getWindowForTarget');
     await client.send('Browser.setWindowBounds', { windowId, bounds: { windowState: 'normal' } });
     await client.send('Browser.setWindowBounds', { windowId, bounds });
   }

   const panelBrowser = await chromium.launch({ headless: false });
   const panelPage = await (await panelBrowser.newContext({ viewport: null })).newPage();
   await panelPage.goto(`http://localhost:${port}/panel`);

   const { width: screenWidth, height: screenHeight } = await panelPage.evaluate(() => ({
     width: window.screen.width, height: window.screen.height
   }));
   const layout = computeWindowLayout(screenWidth, screenHeight, PANEL_HEIGHT);
   await setWindowBounds(panelPage, layout.panel);

   const browser = await chromium.launch({ headless: false });
   const context = await browser.newContext({ viewport: null });
   const page = await context.newPage();
   await setWindowBounds(page, layout.test);
   ```
   El resto del archivo (navegación, `highlightOnPage`, apertura de la pestaña del dashboard al final) usa `browser`/`context`/`page` exactamente como hoy — sin cambios de lógica, solo de dónde queda posicionada la ventana.
9. Manejo de cierre inesperado de alguna ventana:
   ```javascript
   panelBrowser.on('disconnected', () => cancelPending(new Error('Se cerró la ventana del panel')));
   browser.on('disconnected', () => cancelPending(new Error('Se cerró el navegador de prueba')));
   ```
   Esto hace que un `await askPanel(...)` pendiente rechace en vez de colgarse para siempre, y el `main().catch(...)` que ya existe hoy termina el proceso con un mensaje claro.
10. Una vez generado el dashboard (después del paso 6), se llama `pushStep(7)` — con la fórmula del punto anterior, `activeStepNumber=7` marca los 6 pasos como `'done'` y ninguno como `'active'` (no hace falta un caso especial, `i < 7-1` cubre `i` de 0 a 5). Recién ahí el cierre final: el actual `rl.question('\nDemo terminada...')` pasa a ser un último `askPanel` con un botón "Cerrar demo", y después se cierran `server`, `panelBrowser` y `browser` (en vez de solo `browser`+`rl.close()` como hoy).

## Fuera de alcance (documentado, no bloquea)

- Un solo run de demo por proceso — no hay que soportar 2 corridas concurrentes del mismo `demo-server.js` (mismo criterio de simplicidad que ya rige el resto de `scripts/demo*.js`).
- Sin reconexión automática de SSE si el panel se recarga a mitad de un prompt — si el presentador refresca por error la pestaña del panel, pierde el prompt visual (aunque el servidor sigue esperando la respuesta); no es un caso que se espere que pase en una demo guionada, se documenta como limitación conocida, no se resuelve ahora.
- Solo Chromium (ya es una restricción existente del proyecto, `Browser.setWindowBounds` es específico de Chromium/CDP de cualquier forma).
- No se toca el estilo/contenido del `dashboard.html` final ni la lógica de escaneo/clasificación — este cambio es puramente de la capa de presentación de la demo.
