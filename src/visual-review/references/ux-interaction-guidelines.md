# Guía de coherencia de navegación y UX (snapshot 2026-09-22)

> El repo "Leonxlnx/web-design-guidelines" nombrado en la SPEC v0.3 §19.2 no existe con ese
> nombre exacto (ver spike en `docs/superpowers/specs/2026-09-22-visual-ux-review-design.md`).
> Este archivo es una curación propia de criterios de UX/interacción relevantes a WCAG,
> pensada para aplicarse sobre el HTML/DOM de una página (no sobre una screenshot).

## Coherencia de navegación (WCAG 3.2.3, 3.2.4)
- Elementos de navegación repetidos (menú, breadcrumbs) que cambiarían de orden o ubicación
  entre páginas del mismo módulo sin razón aparente.
- Componentes con la misma función (ej. un botón "Confirmar") con etiquetas o iconografía
  inconsistente.

## Mensajes de error y validación de formularios (WCAG 3.3.1, 3.3.3)
- Errores de formulario que solo se comunican por color (sin texto ni ícono asociado en el DOM).
- Mensajes de error genéricos ("Error", "Campo inválido") sin indicar qué corregir.
- Errores sin asociación programática visible al campo que los originó (ej. sin `aria-describedby`
  ni texto adyacente identificable).

## Identificación de componentes (WCAG 4.1.2 aplicado a UX)
- Botones o links sin texto accesible claro sobre su destino o acción ("Click aquí", "Más").
- Campos de formulario sin `<label>` asociado o `aria-label` equivalente.

## Flujos de interacción
- Pasos de un flujo multi-página (alta de cliente, transferencia) sin indicación de progreso
  ni forma evidente de volver atrás sin perder datos ingresados.
