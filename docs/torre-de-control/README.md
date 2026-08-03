# Torre de control — dónde está cada cosa

El módulo entró en **rediseño v2** el 2026-08-03. Si buscas un archivo que
alguien te citó y no está, probablemente se archivó.

| Qué buscas | Dónde está |
|---|---|
| **Qué hace la Torre v2 y qué se retira** | `docs/torre-de-control/alcance-v2.md` — la fuente de verdad |
| **Cómo se ve la Torre v2** (paleta, retícula, los dos estilos de mapa, glifos) | `docs/torre-de-control/lenguaje-visual-v2.md` — producto de la Vía B |
| Diseño técnico (esquema `contexto`, puertos, jobs, cartografía) | `docs/arquitectura/torre-de-control.md` |
| Decisión de tecnología del mapa | `docs/arquitectura/mapa-torre-v2.md` |
| Estructura de información de la v1 (referencia) | `estructura.md`, en esta carpeta |
| Tipos del payload de pantalla | `src/modules/contexto/contrato-torre.ts` — **tipo vivo y editable**, ya no un contrato congelado |
| `datos-dummy.ts`, el handoff de diseño, `lenguaje-visual.md`, `CONTINUAR-TORRE.md` | `docs/_historico/torre-v1/` |

Los dos documentos de arriba se reparten el módulo sin solaparse: `alcance-v2.md`
manda sobre **qué** muestra la pantalla, `lenguaje-visual-v2.md` sobre **cómo** se
ve. Donde el handoff archivado diga otra cosa, ganan ellos.

Las rutas muertas que este README avisaba —los comentarios de `src/` que citaban
`datos-dummy.ts` como "contrato congelado" y el `publicar-cartografia.mjs` que
nunca existió— **ya no quedan**: se fueron con el árbol de la v1 en la Vía A y
con la reescritura del mapa en la Vía B.
