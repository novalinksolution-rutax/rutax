# Prompt para continuar el rediseño en otra sesión

> Ejecutar en **modo plan**. Copiar el bloque completo.
> Actualizado: 22-08-2026, con el checklist abierto.

```
Seguimos con la bajada a código del rediseño de Rutax. El diseño está terminado; los bloques
1 a 3 están aplicados y falta del 4 al 8.

Empieza por acá, en este orden:

1. `docs/diseno/CHECKLIST-REDISENO.md` — el documento de trabajo. Dice en qué va cada bloque,
   qué falta, qué depende de qué y qué está bloqueado por una decisión mía. Su tablero de
   estado se lee en un minuto. **Es el que se marca al terminar cada cosa.**

2. `git log --oneline -4` y `git status`. Lo que esté sin commitear fuera de `docs/diseno/`
   es trabajo en curso ajeno al rediseño: NO lo toques.

3. Del bloque que vayamos a hacer, lee su sección del checklist entera y de ahí salta a lo que
   cite: `RUTAX-SISTEMA-DE-DISENO.md` para las reglas, `RUTAX-REGISTRO-DE-OBJETOS.md` para los
   estados de cada objeto, `RUTAX-SISTEMA-DE-MENSAJES.md` para los textos (ya están escritos,
   no hay que redactar), `tokens.css` para los valores.

4. `docs/rediseno-2026/RUTAX-INVENTARIO.md` — lo que el producto hace HOY, leído del código.
   Su §5 es el árbol de pantallas y su §13 las 35 brechas de diseño con su evidencia.
   ⚠️ Cita ocho anexos (`ANEXO-A` a `ANEXO-H`) y un `HALLAZGOS-TECNICOS.md` que **NO EXISTEN**:
   ni en el repo ni en el proyecto de Claude Design. No los busques. El maestro alcanza.

5. El código del sistema nuevo, para no repetirlo: `src/app/rx-tokens.css`,
   `src/app/rx-puente.css`, `src/lib/ui/tonos-estado.ts`,
   `src/components/ui/distintivo-estado.tsx`, `barra-cajones.tsx`, `barra-seleccion.tsx`
   y `cambios-pendientes.tsx`. Y `/kitchen-sink`, que es donde se ven todos juntos.

Tres cosas que hay que saber antes de tocar nada:

· El sistema de diseño ANTERIOR se retiró en el commit `234613d`. `DESIGN_SYSTEM.md` en la
  raíz es ahora solo un redirector — no es autoridad, y lo que diga cualquier comentario
  viejo de `src/` que lo cite tampoco.

· La regla de trabajo que está funcionando: se construye el componente nuevo y el viejo
  delega en él, para que las pantallas existentes hereden sin tocarlas. Esto se monta sobre
  un producto en producción: lo nuevo y lo viejo conviven meses. `badge-estado` delegando en
  `DistintivoEstado` es el molde.

· Los tableros visuales se traen con la herramienta DesignSync (`get_file`) desde el proyecto
  de Claude Design `184f328b-adb3-4f5a-93f5-69bf43becdb6`. Solo funciona en la sesión
  principal, no en subagentes. Trae solo el del bloque en curso: el checklist dice cuál.
```

## Los tableros que ya están locales

En `pantallas/`: `Rutax Componentes.dc.html` y `Rutax B7b Autenticacion.dc.html`, más el
`support.js` que necesitan. Los otros 29 se traen con DesignSync. Ver `pantallas/LEEME.md`.
