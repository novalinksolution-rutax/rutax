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

## Qué hay acá

| Archivo | Qué es |
|---|---|
| `Rutax Componentes.dc.html` | El catálogo con sus variantes, sus nueve estados y el costo de cada uno |
| `Rutax B7b Autenticacion.dc.html` | Los tres accesos: backoffice, portal del seller y backstage |
| `support.js` | El runtime que necesitan para renderizar |

## Qué falta

**29 de los 31 tableros.** Están en el proyecto de Claude Design `184f328b-adb3-4f5a-93f5-69bf43becdb6`
y se traen con la herramienta `DesignSync` (`get_file`), que **solo funciona desde la sesión
principal, no desde un subagente**.

Los que faltan, por si hay que priorizar: `Marca` · `Fundamentos` · `Paleta` · `Tipografia` ·
`Estados` · `Movimiento` · `Objetos y Voz` · `Subsistemas` · `Mensajes` · los siete arquetipos
`P1`–`P7` · los bloques `B1a` `B1b` `B1c` `B2a` `B2b` `B3a` `B3b` `B4` `B5` `B6` `B7` `B8` ·
`Sitio comercial`.

**No hace falta traerlos todos de una.** Se trae el del bloque que se está implementando: pesan
entre 60 y 100 KB cada uno y leerlos completos tiene costo. Para los bloques 1 a 3 —tokens,
estado y tablas— no hicieron falta, porque son sistémicos y las reglas de los `.md` alcanzaron.
Del bloque 4 en adelante sí, porque son pantallas.
