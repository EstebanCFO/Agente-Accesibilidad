# Agente F1 de Compliance de Accesibilidad — Resumen Ejecutivo

> Borrador para presentación a audiencia C-level. Fecha: 2026-09-22.

## El problema que resuelve

La entidad financiera tiene obligación regulatoria (BCRA + Disposición ONTI 6/2019) de garantizar que sus canales digitales —home banking, app iOS, app Android— sean accesibles para personas con discapacidad. Hoy esa auditoría se hace de forma manual: lenta, cara, y difícil de repetir cada vez que el sitio cambia.

## Qué es el Agente F1

Un agente de inteligencia artificial autónomo que audita accesibilidad digital de punta a punta, sin intervención humana en el proceso de escaneo, y entrega los mismos documentos que hoy produciría un equipo de consultores en semanas — en una fracción del tiempo y de forma repetible.

## Cómo funciona (en 4 pasos)

1. **Descubre** — recorre el sitio o la app y arma el mapa completo de pantallas a revisar.
2. **Escanea** — audita cada pantalla contra los 38 criterios que exige la normativa argentina (ONTI/BCRA), usando el mismo estándar internacional (WCAG) que usan las auditorías profesionales.
3. **Suma una mirada experta, vía IA (análisis complementario)** — además del escaneo automático, el agente "mira" cada pantalla con inteligencia artificial con visión, para señalar lo que un chequeo técnico no puede ver por sí solo: contraste que es técnicamente válido pero difícil de leer, botones incómodos de tocar, mensajes de error confusos. Estos hallazgos se informan aparte y **no modifican el score de cumplimiento**, que se calcula solo con el escaneo automático normativo.
4. **Reporta** — genera automáticamente los 5 documentos que necesita el negocio: score de cumplimiento, dashboard ejecutivo, inventario de hallazgos, matriz de criticidad y un roadmap de remediación priorizado.

## Qué entrega, concretamente

| Entregable | Para quién |
|---|---|
| Score de cumplimiento (%) | Compliance / Directorio |
| Dashboard ejecutivo | Gerencia |
| Inventario de hallazgos | Equipo técnico |
| Matriz de criticidad | Product / UX |
| Roadmap de remediación priorizado | Desarrollo |

## Avance de esta etapa

- El score de cumplimiento se basa en la detección automática, que cubre **alrededor del 57%** de las barreras de accesibilidad sin intervención humana. El resto (~43%) requiere evaluación con tecnología asistiva real (lectores de pantalla), prevista para la Fase 2.
- Se sumó la capa de revisión con IA con visión, que antes era solo una promesa en el documento de propuesta y hoy es funcionalidad real y probada. Aporta señales adicionales (estimadas en un 5–8% más de barreras) como **análisis complementario**: orienta la revisión del especialista, pero no cambia el score regulatorio, para no alterar un indicador de cumplimiento con resultados que todavía no fueron validados por una persona.
- El sistema quedó validado técnicamente (174 pruebas automáticas verdes) y todo el desarrollo está resguardado en un repositorio corporativo.

## Estado y próximos pasos

MVP de Fase 1 funcionalmente completo. Quedan pendientes, sin bloquear el uso:

- Ajustes finos en dos de los reportes (matriz de criticidad y roadmap de remediación).
- Integración de un tercer módulo de IA que estima el esfuerzo de corrección de cada hallazgo.
- Pruebas con tecnología asistiva real — lectores de pantalla (Fase 2).

---

## Notas para seguir refinando

- [ ] Confirmar la cifra de cobertura del score (~57%, fuente GDS UK) y el aporte complementario de la IA (5–8%, estimado en la SPEC §18.3) contra la propuesta original antes de mostrarlo a cliente.
- [ ] Decidir si se muestra el detalle técnico de "cómo funciona" o se deja más alto nivel para C-level.
- [ ] Agregar slide de comparación costo/tiempo vs. auditoría manual tradicional (falta el dato de referencia).
- [ ] Decidir si se menciona el hallazgo y arreglo del bug de seguridad como caso de "control de calidad riguroso" o se omite por ser detalle interno.
