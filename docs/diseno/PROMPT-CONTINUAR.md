# Prompt para continuar el rediseño en otra sesión

> Ejecutar en **modo plan**. Copiar el bloque completo.

```
Vamos a continuar la bajada a código del rediseño completo de Rutax. Todo el trabajo de
diseño ya está hecho y guardado; falta implementarlo.

Antes de proponer nada, revisa en este orden:

1. `docs/diseno/RUTAX-FICHA-DE-CIERRE.md` — es el documento de entrada. Trae qué se diseñó,
   las 80 reglas de sistema que rigen, lo marcado NUEVO sin aprobar, lo que quedó abierto y
   lo que se decidió NO diseñar.

2. `docs/diseno/RUTAX-COSTO-DE-IMPLEMENTACION.md` — los 100 componentes con su costo
   (re-estilo / extender / de cero) y, en su §10, **el orden de dependencia en 8 bloques**.
   Ese orden manda: no lo reordenes sin decir por qué.

3. El resto de `docs/diseno/`: `tokens.css`, el registro de objetos, el sistema de diseño,
   el sistema de mensajes y el sitio comercial. Y `pantallas/LEEME.md`, que explica cómo se
   miran los tableros visuales y cuáles de los 31 todavía no están acá.

4. `docs/rediseno-2026/` — el inventario de lo que el producto hace HOY, leído del código:
   el maestro, ocho anexos por superficie con los textos literales, y `HALLAZGOS-TECNICOS.md`
   con 36 defectos que no son de diseño.

5. El código ya tocado, para no repetirlo: `src/app/rx-tokens.css`, `src/app/rx-puente.css`,
   `src/lib/ui/tonos-estado.ts`, `src/components/ui/distintivo-estado.tsx`,
   `src/components/ui/barra-cajones.tsx`, `src/components/ui/barra-seleccion.tsx`,
   `src/components/ui/cambios-pendientes.tsx`. Y mira `git status` y `git diff`.

**Estado: los bloques 1, 2 y 3 están hechos y verificados en el navegador** (tokens y puente,
sistema de estado, componentes de tabla). Faltan del 4 al 8.

**La regla de trabajo que ya está funcionando y hay que mantener:** se construye el componente
nuevo y el viejo delega en él, para que las pantallas existentes hereden sin tocarlas. Esto se
monta sobre un producto en producción: lo nuevo y lo viejo conviven meses.

Los artboards que faltan se traen con la herramienta DesignSync desde el proyecto de Claude
Design `184f328b-adb3-4f5a-93f5-69bf43becdb6`. Solo funciona en la sesión principal, no en
subagentes.

**Lo que quiero de esta sesión: el checklist completo del rediseño de Rutax**, del bloque 4 al
8, con lo que ya está hecho marcado. Que sirva para trabajar contra él sesión tras sesión: por
bloque, con sus componentes y pantallas, y señalando qué depende de qué y qué está bloqueado
por una decisión mía pendiente.
```
