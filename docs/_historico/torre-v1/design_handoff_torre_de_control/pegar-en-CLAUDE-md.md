# Pegar en CLAUDE.md del repo

Copia este bloque al final de `CLAUDE.md` (o de `AGENTS.md`) del repo `saas-courier`.
Es lo único que hace falta para que cualquier sesión de Claude Code sepa que el diseño
está ahí y lo use en vez de improvisar uno.

---

## Torre de control — el diseño ya existe, úsalo

El módulo **Torre de control** tiene una propuesta de interfaz completa y aprobada en
`design_handoff_torre_de_control/`. **Antes de escribir una línea de UI de este módulo,
lee `design_handoff_torre_de_control/README.md`.** No diseñes desde cero y no infieras
el layout desde los tipos.

Qué hay ahí:

- `README.md` — especificación completa: tokens exactos, las 7 reglas de producto, layout
  de las 6 regiones, geometría del mapa con su proyección, los 6 estados de `EstadoPantalla`
  con sus copys literales, atajos de teclado, forma del estado y estados de los controles.
- `tokens.css` — los tokens listos para pegar como capa `@theme` de Tailwind 4.
- `capturas/` — cómo se ve cada pantalla. Referencia visual rápida.
- `Torre de control.dc.html` — el prototipo **interactivo**. Ábrelo en el navegador para ver
  el comportamiento real (selección de zona, tope de capas, ⌘K, teclas). Los HTML son
  **referencias de diseño**, no código para copiar: hay que recrearlos en Next + Tailwind + shadcn.

Tres cosas que no se negocian y que se rompen fácil por descuido:

1. **Este módulo tiene lenguaje visual propio.** Fue diseñado con instrucción explícita de
   **no** usar `DESIGN_SYSTEM.md` ni `docs/torre-de-control/lenguaje-visual.md`. Los tokens
   que manda son los de `tokens.css`. Radio 0 en todo. El rojo `#ec3013` está **reservado**
   para lo crítico y accionable — nunca decorativo.
2. **Los datos salen solo de `docs/torre-de-control/estructura.md` y `datos-dummy.ts`.**
   Sus tipos son el contrato del endpoint. No inventes campos ni datos de relleno.
3. **Las 7 reglas de producto del README** (jerarquía de tres niveles, tope de 2 capas,
   silencio por defecto, el color nunca solo, contador de sin ubicar, cifras tabulares,
   equivalente sin mapa) son de producto, no estéticas. Están en §2 del README.
