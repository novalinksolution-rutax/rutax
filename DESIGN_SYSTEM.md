# DESIGN_SYSTEM.md — RETIRADO

> ⚠️ **Este documento ya no es autoridad.** Lo reemplazó el sistema de diseño v1.0
> (22-08-2026), que vive en **`docs/diseno/`**.

## Dónde está ahora cada cosa

| Buscabas | Ahora está en |
|---|---|
| Los tokens | `docs/diseno/tokens.css` — y aplicados en `src/app/rx-tokens.css` |
| Las reglas del sistema | `docs/diseno/RUTAX-SISTEMA-DE-DISENO.md` |
| Los estados y su tratamiento | `docs/diseno/RUTAX-REGISTRO-DE-OBJETOS.md` · `src/lib/ui/tonos-estado.ts` |
| Voz, tono y todos los mensajes | `docs/diseno/RUTAX-SISTEMA-DE-MENSAJES.md` |
| El catálogo de componentes y su costo | `docs/diseno/RUTAX-COSTO-DE-IMPLEMENTACION.md` |
| Las 80 reglas que rigen | `docs/diseno/RUTAX-FICHA-DE-CIERRE.md` §3 |

## Por qué queda este archivo en vez de borrarse

Nueve archivos de `src/` lo citan en sus comentarios. Un enlace roto deja a quien lo
sigue preguntándose si perdió algo; este redirige.

## Qué decía, y por qué contradice al sistema nuevo

Documentaba el «ADN de Retell» (v2, julio de 2026): superficie blanca, shells en
lavanda, Inter, acento navy y sombras suaves, **en modo claro únicamente**.

El sistema nuevo dice lo contrario en cada eje: **cuatro temas** con el oscuro como
base, Chivo y Azeret Mono, acento teal, **cero sombras** —la elevación se construye
con escalón de fondo más borde— y radio de 3 px en vez de 10.

No es que uno esté mal: son dos sistemas distintos, y tener los dos vigentes es lo
que hace que un producto se vea de dos maneras. Si algo del anterior hace falta,
está en el historial de git.
