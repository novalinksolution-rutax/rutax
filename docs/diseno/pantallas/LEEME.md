# Los tableros visuales

Son la **especificación visual** del rediseño: layout, proporción, disposición y las notas de
por qué cada decisión es como es. Los `.md` de la carpeta de arriba dan las reglas y el
contrato de cada componente; **estos dan la pantalla**.

**Están los 32.** Los 31 del 23-08-2026, más `B5b Entrada del conductor`, traído el 24-08.
Ya no hay que traer nada de Claude
Design para trabajar: la referencia visual completa está acá, versionada.

## Por dónde entrar

`INDICE.md` — generado desde los propios archivos, da por tablero su título, su bajada y sus
secciones. Sirve para saber **cuál abrir** sin cargar 1,9 MB de HTML al contexto. Se regenera
con el script del scratchpad si algún tablero cambia.

## Cómo se miran

Son **HTML autónomo con estilos en línea**. Se abren directo en el navegador — doble clic, o
`file://` — sin servidor y sin compilar nada. Necesitan dos cosas que ya están o se resuelven
solas:

- `support.js`, que está en esta misma carpeta.
- Chivo y Azeret Mono, que cargan desde Google Fonts. **Sin conexión se ven con la tipografía
  del sistema**: la disposición y los colores se mantienen, solo cambia la letra.

## Qué hay acá

| Grupo | Archivos |
|---|---|
| **Fundamentos** | `Marca` · `Fundamentos` · `Paleta` · `Tipografia` · `Estados` · `Movimiento` · `Objetos y Voz` · `Mensajes` · `Componentes` · `Subsistemas` |
| **Arquetipos** (fijan el patrón para las demás) | `P1 Pedidos` · `P2 Asignar` · `P3 Detalle` · `P4 Emitir factura` · `P5 Registrar entrega` · `P6 Conciliacion` · `P7 Conectar cuentas` |
| **Bloques** (las pantallas, una a una) | `B1a` `B1b` `B1c` · `B2a` `B2b` · `B3a` `B3b` · `B4` · `B5` `B5b` · `B6` · `B7` `B7b` · `B8` |
| **Sitio** | `Sitio comercial` |
| **Insumos** | `tokens.css` (los tokens tal como salieron del diseño) · `support.js` (el runtime que necesitan para renderizar) |

## ⚠️ Cómo se traen, si alguna vez hay que volver a traerlos

`DesignSync get_file` devuelve el tablero **a la sesión, no al disco**. Si no se escribe acá en
el mismo momento, se pierde al cerrar. En las sesiones del 22-08 se trajeron cuatro tableros y
ninguno quedó en disco.

Dos cosas que costó descubrir y conviene no volver a descubrir:

1. **Un subagente en primer plano SÍ tiene `DesignSync`; uno en segundo plano NO.** Los cuatro
   lanzados en segundo plano el 23-08 respondieron los cuatro «la herramienta no existe»; los
   mismos cuatro, en primer plano, funcionaron a la primera. Delegar la extracción a subagentes
   en primer plano es lo que la hace barata: el HTML no pasa por el contexto de quien coordina.
2. **El resultado queda en disco igual, aunque nadie lo copie**, y en tres sitios distintos
   según el tamaño y quién preguntó: `tool-results/*.txt` (los grandes), el `.jsonl` de la
   sesión (los que vinieron en línea) y `subagents/agent-*.jsonl` (los que trajo un subagente —
   **un subagente no escribe en el transcripto del padre**). El script `volcar-tableros.py` del
   scratchpad barre los tres y escribe acá. Ese tercer sitio es el que hace viable delegar.

Y una trampa de parseo: en el transcripto de un subagente el resultado viene **doblemente
codificado** (`{\"method\":\"get_file\"...`), así que una regex escrita contra el crudo del
transcripto padre no engancha ni una. Hay que parsear el JSONL de verdad, línea por línea.
