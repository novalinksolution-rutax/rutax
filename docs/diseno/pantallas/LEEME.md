# Los tableros visuales

Son la **especificación visual** del rediseño: layout, proporción, disposición y las notas de
por qué cada decisión es como es. Los `.md` de la carpeta de arriba dan las reglas y el
contrato de cada componente; **estos dan la pantalla**.

## Cómo se miran

Son **HTML autónomo con estilos en línea**. Se abren directo en el navegador — doble clic, o
`file://` — sin servidor y sin compilar nada. Necesitan dos cosas que ya están o se resuelven
solas:

- `support.js`, que está en esta misma carpeta.
- Chivo y Azeret Mono, que cargan desde Google Fonts. **Sin conexión se ven con la tipografía
  del sistema**: la disposición y los colores se mantienen, solo cambia la letra.

## ⚠️ Regla de trabajo: el tablero que se trae, se guarda

`DesignSync get_file` devuelve el tablero **a la sesión**, no al disco. Si no se
escribe acá en el mismo momento, se pierde al cerrar: la sesión siguiente vuelve
a pagar la traída, y nadie más puede abrirlo.

Pasó: en las sesiones del 22-08 se trajeron `P1`, `P4`, `B2a` y `B2b` y ninguno
quedó en disco. `P1` y `B2a` se recuperaron después porque su resultado era lo
bastante grande para quedar en el caché de resultados de la sesión; `P4` y `B2b`
volvieron en línea y **no se pudieron recuperar** — hay que traerlos de nuevo.

**Al traer un tablero, guárdalo acá inmediatamente**, antes de leerlo.

## Qué hay acá

| Archivo | Qué es |
|---|---|
| `Rutax Componentes.dc.html` | El catálogo con sus variantes, sus nueve estados y el costo de cada uno |
| `Rutax B7b Autenticacion.dc.html` | Los tres accesos: backoffice, portal del seller y backstage |
| `Rutax P1 Pedidos.dc.html` | El arquetipo del listado con filtros. Fija el marco, los cajones, los filtros en URL, el refresco mixto y los cinco estados de pantalla |
| `Rutax B2a Periodos.dc.html` | Períodos de cobro y su detalle. Fija la **tabla financiera** |
| `support.js` | El runtime que necesitan para renderizar |

## Qué falta

**27 de los 31 tableros.** Dos de los que faltan —`P4 Emitir factura` y
`B2b Liquidaciones y cobranza`— **ya se trajeron y se implementaron** (bloque 5), pero no se
guardaron; hay que volver a traerlos. Sus decisiones sí quedaron escritas en
`CHECKLIST-REDISENO.md`. Están en el proyecto de Claude Design `184f328b-adb3-4f5a-93f5-69bf43becdb6`
y se traen con la herramienta `DesignSync` (`get_file`), que **solo funciona desde la sesión
principal, no desde un subagente**.

Los que faltan: `Marca` · `Fundamentos` · `Paleta` · `Tipografia` · `Estados` · `Movimiento` ·
`Objetos y Voz` · `Subsistemas` · `Mensajes` · los arquetipos `P2`–`P7` · los bloques
`B1a` `B1b` `B1c` `B2b` `B3a` `B3b` `B4` `B5` `B6` `B7` `B8` · `Sitio comercial`.

**No hace falta traerlos todos de una.** Se trae el del bloque que se está implementando: pesan
entre 60 y 100 KB cada uno y leerlos completos tiene costo. Para los bloques 1 a 3 —tokens,
estado y tablas— no hicieron falta, porque son sistémicos y las reglas de los `.md` alcanzaron.
Del bloque 4 en adelante sí, porque son pantallas.
