# Torre de control — material de la v1 (archivado 2026-08-03)

Esto fue la guía obligatoria del módulo Torre de control hasta el 2026-08-03:
el handoff de diseño aprobado, su lenguaje visual alternativo, el prompt de
traspaso de la etapa anterior y el dataset dummy que hacía de contrato de tipos.

**Ya no manda nada de esto.** El usuario decidió rediseñar la Torre: el mapa
pasa a ser exclusivamente operativo (sin capas de ambiente) y el handoff deja de
ser autoridad. La fuente de verdad de la v2 es
[`docs/torre-de-control/alcance-v2.md`](../../torre-de-control/alcance-v2.md).

Se conserva —en vez de borrarse— porque explica por qué el código que hoy corre
en `src/app/(consola)/torre-de-control/` es como es: los tokens `--tc-*`, el
radio 0, el rojo reservado, las seis regiones y la forma de `EstadoTorre` salen
de aquí.

| Archivo | Qué fue |
|---|---|
| `design_handoff_torre_de_control/` | El handoff completo: especificación, tokens, capturas y los prototipos HTML interactivos |
| `lenguaje-visual.md` | Un lenguaje visual alternativo que ya en su momento se había marcado como "no aplicar" |
| `CONTINUAR-TORRE.md` | Prompt de traspaso de la etapa anterior; su sección "No va — decidido, no re-litigar" quedó superada por el rediseño v2 |
| `datos-dummy.ts` | Dataset y tipos que fueron el "contrato congelado" del endpoint. Su papel lo toma `src/modules/contexto/contrato-torre.ts`, que pasa a ser un tipo vivo y editable |

Ojo con `datos-dummy.ts`: sus **valores** nunca fueron verdad (los umbrales de
PM2.5, por ejemplo, están mal). Solo servía como forma de los tipos.
