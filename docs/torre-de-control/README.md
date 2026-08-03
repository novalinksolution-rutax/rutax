# Torre de control — dónde está cada cosa

El módulo entró en **rediseño v2** el 2026-08-03. Si buscas un archivo que
alguien te citó y no está, probablemente se archivó.

| Qué buscas | Dónde está |
|---|---|
| **Qué hace la Torre v2 y qué se retira** | `docs/torre-de-control/alcance-v2.md` — la fuente de verdad |
| Diseño técnico (esquema `contexto`, puertos, jobs, motor de riesgo, cartografía) | `docs/arquitectura/torre-de-control.md` |
| Decisión de tecnología del mapa | `docs/arquitectura/mapa-torre-v2.md` |
| Estructura de información de la v1 (referencia) | `estructura.md`, en esta carpeta |
| Tipos del payload de pantalla | `src/modules/contexto/contrato-torre.ts` — **tipo vivo y editable**, ya no un contrato congelado |
| `datos-dummy.ts`, el handoff de diseño, `lenguaje-visual.md`, `CONTINUAR-TORRE.md` | `docs/_historico/torre-v1/` |

Algunos comentarios de `src/` todavía citan `docs/torre-de-control/datos-dummy.ts`
como "contrato congelado". Es una ruta muerta: el archivo está archivado y el
contrato dejó de estar congelado. Esos comentarios se corrigen en la pasada de
implementación de la v2, cuando se toque cada archivo.
