# Guía de accesibilidad visual (snapshot 2026-09-22)

> Curación propia de criterios de accesibilidad visual inspirados en las categorías que cubre
> el skill `antfu/rams` (contraste, spacing, tipografía, touch targets) — no es una copia
> verbatim del contenido dinámico que ese skill trae en tiempo real desde su fuente remota.
> Ver contexto completo en `docs/superpowers/specs/2026-09-22-visual-ux-review-design.md`.

## Contraste
- Contraste "al límite" del mínimo técnico (ej. 4.5:1 justo para WCAG 1.4.3) puede seguir
  siendo ilegible en condiciones reales (brillo bajo, luz solar directa, baja visión). Marcá
  como hallazgo cualquier texto con contraste visualmente ajustado, aunque pase el mínimo.
- Texto sobre imágenes o gradientes sin overlay de contraste suficiente.

## Espaciado y touch targets
- Elementos interactivos (botones, links, checkboxes) con área táctil aparente menor a 44×44px.
- Elementos interactivos demasiado próximos entre sí, con riesgo de toque accidental.

## Tipografía
- Tamaño de fuente de cuerpo aparentemente menor a ~14px efectivos.
- Interlineado ajustado que dificulta la lectura de párrafos largos.
- Bajo contraste entre texto secundario/placeholder y su fondo.

## Foco e interacción
- Indicadores de foco (outline) ausentes o poco visibles en elementos interactivos.
- Estados hover/focus/active que no se distinguen visualmente entre sí.

## Movimiento
- Animaciones o contenido con auto-play sin mecanismo aparente de pausa.
