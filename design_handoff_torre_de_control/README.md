# Handoff: Torre de control

Consola de anticipación operativa para el dueño o coordinador de un courier de última milla en Santiago de Chile.

---

## 1. Qué es este paquete

Los archivos HTML de este bundle son **referencias de diseño**, no código de producción. Son prototipos que muestran la apariencia y el comportamiento buscados. La tarea es **recrear estos diseños dentro del stack que ya existe en el repo** `saas-courier`, siguiendo sus patrones establecidos — no copiar el HTML.

Stack detectado en `package.json`:

| Pieza | Versión | Cómo usarla aquí |
| --- | --- | --- |
| Next.js | ^16.2.9 (App Router) | Ruta nueva bajo `src/app` |
| React | 19.2.4 | Server Component para el fetch, Client Components para el tablero |
| Tailwind CSS | ^4 | Tokens vía `@theme` en el CSS global — ver `tokens.css` |
| shadcn/ui + radix-ui | ^4.10.0 / ^1.5.0 | Base de botones, dialog (paleta ⌘K), tooltip (motivos) |
| lucide-react | ^1.17.0 | Único set de iconos permitido |
| recharts | ^3.10.0 | **No usar** para la curva de olas ni la línea de tiempo (ver §6) |
| zod | ^4.4.3 | Validar el payload del endpoint contra los tipos de `datos-dummy.ts` |

**Fidelidad: alta (hifi).** Colores, tipografía, espaciado, estados e interacciones son finales. Recrear pixel-perfect con las librerías del repo.

### Advertencia sobre el ADN visual

Este módulo **define un lenguaje visual nuevo y deliberadamente distinto** al resto del producto. Fue diseñado con instrucción explícita de **no** usar `DESIGN_SYSTEM.md` ni `docs/torre-de-control/lenguaje-visual.md`. Los tokens de §7 son los que manda este módulo; **no los sustituyas por los del design system existente**. Si el repo tiene tokens globales que colisionan, aísla los de Torre de control bajo un scope propio (`.torre` o una capa `@theme` con prefijo `--tc-`).

### Fuentes de verdad de datos

Únicamente estos dos archivos del repo:

- `docs/torre-de-control/estructura.md` — arquitectura de información, las 6 regiones, estados obligatorios, interacciones.
- `docs/torre-de-control/datos-dummy.ts` — tipos (`EstadoTorre`, `EstadoPantalla`, etc.) y dataset completo.

Todo texto, cifra, nombre de zona, comuna, conductor y evento del prototipo sale de ese dataset. **No inventes campos ni datos de relleno.** Los tipos de `datos-dummy.ts` son el contrato del endpoint.

---

## 2. La decisión de diseño (respétala)

El riesgo se dibuja en **grafito, no en color**: una escala de cinco densidades de trama a 45°, con el puntaje numérico siempre estampado al lado. El único rojo del sistema (**Señal #ec3013**) queda reservado para lo crítico y accionable — zona sobre 76, excepción crítica, volumen que excede capacidad, fuente caída. Rojo en pantalla significa siempre lo mismo y nunca es decoración.

Lo demás es estructura: placas de papel separadas por reglas de 2 px, **radio 0 en absolutamente todo**, cifras tabulares y silencio por defecto.

### Las siete reglas de producto — no son estéticas, no se negocian

1. **Jerarquía de tres niveles.** El mapa responde *dónde*, el desglose de factores *por qué*, la lista de pedidos *qué hago*. Nada del nivel 2 se renderiza antes de que el usuario pida el nivel 2: sin zona seleccionada, el desglose **no existe en el DOM**.
2. **Máximo 2 capas de mapa activas.** Al llegar al tope, las demás se atenúan a `opacity: .42`, cambian su glifo a `⊘` y exponen el motivo en `title`/tooltip. Nunca falla en silencio; el click sobre una bloqueada es un no-op explícito.
3. **Silencio por defecto.** En `tranquilo` el módulo lo dice en una línea y se calla. El riel queda vacío a propósito. Prohibido rellenar con tarjetas para justificar el módulo.
4. **El color nunca es el único canal.** Toda escala cromática va con el valor numérico visible y la palabra del nivel (`calmo`/`bajo`/`medio`/`alto`/`crítico`).
5. **Los pedidos sin geocodificar se declaran siempre** con contador explícito, en el mapa y en móvil. Un mapa que los esconde miente sobre la carga real.
6. **Cifras tabulares en todo** número: hora, dinero, puntaje, conteo. `font-variant-numeric: tabular-nums lining-nums`. Es un tablero que se refresca solo; los dígitos que cambian de ancho al actualizarse delatan software barato.
7. **Existe un equivalente sin mapa**: lista de zonas ordenada por riesgo, navegable con teclado, sobre los mismos datos. Es accesibilidad y es la vista móvil.

### Clichés a evitar (instrucción explícita del cliente)

Fondo crema con display serif y acento terracota · casi-negro con un acento verde ácido · degradados violeta-azul · Inter o Space Grotesk · emoji como marcadores de sección · todo centrado · esquinas redondeadas uniformes · tarjetas redondeadas con barra de acento a la izquierda.

---

## 3. Idioma, moneda, formato

- Español de Chile. **Sentence case siempre, nunca Title Case.** Las únicas mayúsculas completas son las micro-etiquetas (`text-transform: uppercase` con letter-spacing).
- Moneda: `$2.081.100` → `'$' + Math.round(n).toLocaleString('es-CL')`.
- Porcentajes con coma decimal y espacio antes del signo: `+38 %`, `−2,4 %`. Variación negativa usa **minus U+2212 (−)**, no guión.
- Horas 24 h, zona `America/Santiago`. Fechas cortas: `sáb 25 jul`, `dom 9 ago`.
- Minutos de antigüedad con prime: `38′` (U+2032).
- Glifos de estado, no iconos: `·` ok · `▲` atrasada · `✕` caída · `▲/▼` variación · `■/□/⊘` capa activa/disponible/bloqueada.

---

## 4. Escritorio — layout maestro

Lienzo de referencia **1512 × 982**. Column flex con `gap: 2px` sobre fondo **Chasis #2d2b2b** — las reglas de 2 px *son el fondo asomándose*, no bordes. Cada región es una placa **Papel #f3f2f2**.

```
┌──────────────────────────────────────────────────────────────┐
│ R1  barra superior                              alto  52 px  │
├──────────────────────────────────────────────────────────────┤ ← 2px chasis
│ (banda de mensaje de estado — solo si hay mensaje)  auto      │
├──────────────────────────────────────────────────────────────┤
│ R2  ola entrante                               alto 132 px   │
├─────────────────────────────────────┬────────────────────────┤
│ R3  mapa                     1fr    │ R4/R6 riel   404 px    │
│                                     │  (único scroll)        │
├─────────────────────────────────────┴────────────────────────┤
│ R5  línea de tiempo                            alto  98 px   │
└──────────────────────────────────────────────────────────────┘
```

El **riel es el único elemento con scroll**. El mapa nunca scrollea. Scrollbar del riel estilizada: ancho 10 px, track `#eae9e9`, thumb `#bab6b6` con borde de 3 px del color del track, hover `#7d7979`.

### R1 · Barra superior (52 px)

Flex row, divisores verticales de 1 px `#d7d3d3` entre grupos.

| Grupo | Contenido | Especificación |
| --- | --- | --- |
| Marca | Cuadrado 13×13 Tinta con muesca Papel de 5×5 en `inset: 4px 4px auto auto`; «Torre de control» 15/800/-0.01em; «Andes Última Milla» 11/400 Tinta-600 | padding `0 18px 0 20px` |
| Horizonte | 4 botones segmentados: Hoy · Mañana · 72 h · Olas. Sufijo con la tecla (1-4) en 8.5/600 `opacity:.5` | 11.5/800/0.04em uppercase, padding `6px 13px 6px 12px`, borde 1px `#d7d3d3` con `border-right:0` + spacer final de 1px. Activo: fondo Tinta, texto Papel |
| Frescura | Micro-etiqueta «FRESCURA» + una celda por fuente: nombre 9/600 uppercase + edad en minutos + glifo | Fuente sana: sin borde, gris `#7d7979`, peso 400. Fuente enferma: borde 1px, peso 800, glifo `▲`; caída: color Señal y glifo `✕`. El motivo va en `title` |
| Comandos | Botón «Comandos ⌘K», borde 1px `#d7d3d3`, 11/400 | hover: `border-color` y texto a Tinta |

**La frescura no es un icono de estado: es la edad en minutos, siempre visible.** En el dataset, Tránsito está en `38′` contra una cadencia de 10 min → enferma.

### Banda de mensaje de estado (auto, solo con mensaje)

Flex row, padding `13px 22px`, gap 20. Cuadrado 8×8 Tinta · título 14/800 · cuerpo 12.5/400 Tinta-700 `max-width:760px` · botón outline opcional a la derecha (`margin-left:auto`, 12/800, borde 1px Tinta, hover invierte a fondo Tinta).

Copys por estado en §8.

### R2 · Ola entrante (132 px)

Grid `352px 1px 244px 1px 1fr` — las columnas de 1 px son divisores `#d7d3d3`.

1. **Identidad.** Micro-etiqueta «Ola entrante · arquetipo regalo» · nombre 22/800/-0.02em · fecha y cuenta atrás 11/400 · una línea que explica el arquetipo (para *regalo*: las entregas llegan **antes** del evento, la fecha es deadline y no inicio) · chip de hito vencido con borde 1px Tinta.
2. **Cifras.** Tres filas etiqueta/valor separadas por 1 px: ventana de entregas, variación esperada, brecha del día crítico. Etiqueta 9/700/0.1em uppercase Tinta-600; valor 17/800 tabular.
3. **Curva.** Una columna por día, `align-items:flex-end`, alto de pista 66 px. Por columna: barra **base** al 30 % del ancho (outline 1px `#9b9797`, relleno transparente), barra **proyectada** al 48 % pegada a la derecha (relleno Tinta), y el **exceso sobre capacidad** apilado encima en Señal. La **capacidad** es una línea `2px dashed #605d5d` a su altura proporcional. Debajo: cifra proyectada 10 px (peso 800 si es día peak, 600 si no) y día 9 px Tinta-600. Leyenda `▮ proyectado ▯ base ┄ capacidad instalada` en 9 px.

Altura de barra = `valor / 640 × 66px` (640 = techo fijo de la escala; recalcúlalo si el dataset cambia de magnitud).

### R3 · Mapa (1fr)

Composición de dos capas superpuestas:

**(a) SVG geométrico**, `viewBox="0 0 1110 718"`, `preserveAspectRatio="xMidYMid slice"`, `position:absolute; inset:0; width:100%; height:100%`.

Orden de pintado: fondo Papel → retícula de coordenadas → celdas de zona → capas activas → marca operativa → tics de registro de cada placa.

- **Retícula**: verticales cada 0,1° de longitud y horizontales cada 0,05° de latitud, `stroke:#201e1d; stroke-opacity:.09; stroke-width:1`. Etiquetas 9 px `fill-opacity:.34`, formato `70,90° O` / `33,45° S` (coma decimal, letra de hemisferio en español).
- **Celdas de zona**: relleno = `url(#trama-{nivel})`; trazo `rgba(32,30,29,.5)` 1 px, o Señal 2 px si el nivel es crítico, o Tinta 3 px si está seleccionada. Con zona seleccionada, las otras caen a `opacity:.16` con `transition: opacity .18s`. En `sin_zonas`: relleno plano `#eae7e7` y `stroke-dasharray: 7 5`.
- **Tics de registro**: cuatro segmentos de 10 px a 97 px del centro de cada placa (N/S/E/O) — la placa parece calada sobre el plano, como una viñeta de plano técnico.

**(b) Capa de etiquetas HTML** por encima, `position:absolute; top:50%; left:50%; transform:translate(-50%,-50%); aspect-ratio:1110/718; min-width:100%; min-height:100%; pointer-events:none`, con los hijos posicionados en **porcentaje** para que sigan el `slice` del SVG.

> **Nota de implementación importante.** Todo el texto del mapa vive en esta capa HTML, no en `<svg><text>`. Razones: hereda `tabular-nums` sin trucos, no se deforma con el `slice`, es seleccionable y accesible, y permite `transition`. Mantén esta separación: **SVG solo geometría, HTML todo el texto.**

**Placa de zona** (168 × 68, `pointer-events:auto`, cursor pointer, padding `7px 10px 8px`, borde 2px Tinta, fondo Papel, `justify-content: space-between`):
- Fila superior: nombre 11.5/800/0.09em uppercase + palabra del nivel 9/700/0.09em uppercase Tinta-600.
- Fila inferior, sobre `border-top: 1px solid rgba(32,30,29,.26)` con `padding-top:3px`: puntaje 30/800/-0.03em/`line-height:.88` (color Señal solo si es crítico) y, alineado a la derecha, `{n} pendientes` / `corte HH:MM` en 10/600 tabular (la segunda línea en Tinta-600).

**Controles flotantes**, todos con borde 2px Tinta y fondo Papel, a 14 px del borde:
- *Arriba izquierda* — **Capas** (ancho 196). Cabecera con «CAPAS» 9/800/0.14em y contador `{n}/2 capas`. Una fila por capa: glifo `■/□/⊘` (ancho fijo 10 px) + etiqueta 11.5/400; activa invierte a fondo Tinta/texto Papel; bloqueada `opacity:.42`. Al tope, banda `#eae7e7` con «Tope de 2 capas alcanzado. Apaga una para encender otra.» 9.5 px.
- *Arriba derecha* — Zoom segmentado (Zonas · Comunas · Pedidos) + botón «Vista de lista» con la tecla `L`.
- *Abajo izquierda* — **Leyenda de riesgo**: los 5 pasos como swatches de 66×18 con la trama real, más rango numérico 10.5/700 tabular y palabra 9 px uppercase. Cumple la regla 4.
- *Abajo derecha* — **Contador de sin ubicar**: cifra 26/800 + «pedidos sin ubicar no están en este plano.» + enlace «Revisar direcciones» en Señal-700 (#ae1800: el acento puro no alcanza contraste a tamaño de texto). Cumple la regla 5.

**Geometría de las celdas.** Las cinco celdas se derivan del campo `centro` (lat/long) de cada zona del dataset, por recorte de semiplanos entre bisectrices (partición de Voronoi) sobre el rectángulo del viewBox. Proyección lineal:

```
lonMin=-70.938  lonMax=-70.382  latMin=-33.625  latMax=-33.325
x = (lon - lonMin) / (lonMax - lonMin) * 1110
y = (latMax - lat) / (latMax - latMin) * 718
```

Paths resultantes (para reproducir el prototipo tal cual):

| Zona | `d` | centro placa |
| --- | --- | --- |
| Oriente | `M702.8 0L1110 0L1110 545.3L720.6 424.2L611.1 193.5Z` | 738.1, 200.8 |
| Centro | `M611.1 193.5L720.6 424.2L525.2 467.9L317.4 210.5Z` | 536.4, 296.5 |
| Sur | `M1110 545.3L1110 718L351.8 718L525.2 467.9L720.6 424.2Z` | 608.3, 618.2 |
| Norte | `M0 0L702.8 0L611.1 193.5L317.4 210.5L0 53.5Z` | 525.1, 99.8 |
| Poniente | `M317.4 210.5L525.2 467.9L351.8 718L0 718L0 53.5Z` | 355.4, 442.8 |

⚠️ **Esto es un placeholder honesto, no geografía real.** En producción, reemplaza los paths por los polígonos comunales **DPA 2023** del INE disuelto por zona, servidos como TopoJSON y proyectados con la misma función. La capa de etiquetas HTML no necesita cambios: solo recalcula el centroide de cada polígono. **No dibujes Santiago a mano.**

**Capas del mapa** (recuerda: máximo 2 simultáneas):

| Capa | Render |
| --- | --- |
| Riesgo | La trama de las celdas (activa por defecto) |
| Lluvia | Círculo `r` proporcional al radio en metros (0,0215 px/m a esta escala), relleno de patrón de puntos `r=1` cada 9 px a `fill-opacity:.3`, trazo Tinta 2 px `dasharray 9 6`. Placa Tinta con «LLUVIA 8 mm/h · 16:00–19:00» en Papel 10.5/700 |
| Aire | Igual patrón, sobre el polígono de la zona afectada |
| Tránsito | Rombo de 12 px (path, no `rotate`) por incidente + nombre de la vía en la capa HTML. **Bloqueada en el dataset actual** por el atraso de 38 min |
| Eventos | Círculo outline 2 px del radio del perímetro + eje vertical de 1 px + nombre, hora y aforo |
| Conductores | Círculo `r=6` relleno Tinta; `en_ruta` sólido, `sin_senal` `r=5` sin relleno con `dasharray 2 2`. Etiqueta HTML: nombre completo · entregados/total · «sin señal {n}′» cuando aplica |
| Pedidos | Requiere geocoding real. Hoy **declara el vacío**: placa centrada explicando que el dataset solo trae agregados por zona. No inventes puntos |
| Comunas | Bloque de nombres bajo cada placa, 9.5/400 `line-height:1.5`, fondo `rgba(243,242,242,.86)`, `border-left:1px solid Tinta`. Máximo 6 + «+N más» |

**Marca operativa.** Es un anotación del usuario, no una capa: **nunca se apaga** y no cuenta contra el tope de 2. Círculo punteado del radio + cuadrado de 8 px + etiqueta. Modo marca (tecla `M`): `cursor:crosshair` y toast Tinta «Haz clic en el mapa para dejar una marca operativa. Esc cancela.»; el click convierte coordenadas de pantalla a coordenadas de viewBox y deja una marca provisional (cuadrado outline 2 px + «Marca sin guardar»).

### R4/R6 · Riel (404 px, único scroll)

Apila, en este orden:

1. **Métricas** — grid 2×2, cada celda `padding:12px 14px 13px` con divisores de 1 px, cerrada por una regla de 2 px Chasis. Etiqueta 9/800/0.13em uppercase Tinta-600 · valor 22/800/-0.03em tabular `white-space:nowrap` · variación 10.5/700 con glifo `▲/▼` (o `—` si no aplica, en Tinta-500) · detalle 10/400 Tinta-600.
2. **Excepciones** (si el estado las tiene) — ver ficha abajo.
3. **Señales de prensa** — separadas por una regla de 2 px Chasis.

**Ficha de excepción** (`<article>`, `border-top:1px solid #d7d3d3`, `padding:12px 14px 14px`):

- Cabecera: chip de severidad + botón-enlace con el nombre de la zona (subrayado, `text-underline-offset:3px`; **hace focus en esa zona del mapa** y abre su nivel 2) + hora de detección en `margin-left:auto`, 9.5 px Tinta-500.
- Título 15.5/800/`line-height:1.2`, `text-wrap:pretty`.
- Cuerpo 12/400/1.45 Tinta-700.
- Si el origen es `senal`: chip «desde prensa · confianza 86 %».
- **Impacto**: grid de 3 celdas (Pedidos · Monto · Ventana) con fondo de divisores de 1 px. Si no hay pedidos afectados, una sola línea «Sin pedidos afectados todavía · {ventana}» — nunca ceros maquillados como impacto.
- **Acciones**: botones sólidos Tinta 11.5/800, flush left, padding `7px 11px` (regla del design system: la etiqueta arranca en el borde izquierdo). Más un «Descartar» outline discreto. Las acciones con `requiereConfirmacion` abren **en el sitio** una tira con borde 2px Tinta y fondo `#eae7e7`: «CONFIRMA ANTES DE EJECUTAR» + la consecuencia concreta + «Sí, ejecutar» en Señal y «Cancelar» outline. **Sin modal**: el usuario no pierde el contexto del tablero.

**Ficha de señal de prensa**: tres chips outline (confianza · N medios · N pedidos) → título 14/800 → resumen 11.5/400 → comunas · ejes · ventana en 10 px → botón «Ver las 3 fuentes» que despliega una lista de `<a>` con medio, hora y titular → Confirmar (outline que invierte en hover) / Descartar. Las señales sin impacto viven colapsadas tras «1 señal más sin impacto en tu operación →».

**Desglose de zona (nivel 2)** — reemplaza por completo la lista de excepciones cuando hay zona seleccionada:

- Cabecera de contexto en **fondo Tinta, texto Papel**: «NIVEL 2 · POR QUÉ» + botón «Cerrar desglose» outline claro.
- Encabezado: puntaje 46/800/-0.03em/`line-height:.9` (Señal si es crítico) + nombre 18/800 + «riesgo {palabra}» 10/0.12em uppercase.
- Comunas de la zona en 10/400/1.5 Tinta-700, separadas por `·`.
- Tres celdas: **Holgura** (capacidad − pendientes, con signo explícito; **Señal si es negativa**), **Corte**, **Conductores** (`disponibles de asignados`). Debajo, una línea tabular: pendientes · entregados · capacidad · monto comprometido.
- **Seis factores** — uno por fila, botón de ancho completo, hover `#eae7e7`: nombre 12/600 · «peso 35 %» 9.5 px Tinta-600 · valor 16/800 tabular alineado a la derecha (ancho fijo 30 px para que la columna no baile). Barra de 7 px sobre `#eae7e7`, relleno = paso de rampa según el valor (Señal solo si ≥ 76). Debajo: «aporta 25,2 puntos al total» 9.5 px.
- Click en un factor abre el **nivel 3** con fondo `#eae7e7`: título, cifra agregada y explicación. Hoy **declara honestamente** que el detalle por pedido lo entrega el servidor desde el geocoding y que el dataset de diseño solo trae agregados. Cuando exista el endpoint, aquí va la lista de pedidos.

### R5 · Línea de tiempo (98 px)

Grid `148px 1fr`. Izquierda: título, fecha («sáb 25 jul · Santiago») y hora actual 22/800 tabular. Derecha: pista con **tres carriles de 20 px** (el campo `carril` del dataset) y eje horario abajo (22 px, `border-top:1px`, una marca por hora con `border-left:1px` y etiqueta 9 px).

Escala: **08:00 → 21:00 = 780 minutos**. `left = (minutos_desde_08:00) / 780 × 100 %`, `width` idem para la duración.

- Bloque **extenso**: caja de 17 px, borde 1px Tinta, fondo Papel, etiqueta 9.5/600 tabular con `overflow:hidden`.
- Bloque **instantáneo** (`desde === hasta`): barra vertical de 2 px + etiqueta con `border-top` del mismo color. En Señal si es un corte en riesgo.
- Marcador **AHORA**: línea de 2 px Tinta de alto completo con placa invertida «AHORA» 9/800. Se mueve con `transition: left 4s linear` — el reloj corre, no salta.

---

## 5. Móvil (390 × 844) — el mapa cede el protagonismo

**No hay mapa.** En 390 px el coordinador no quiere ubicar, quiere resolver. Orden de la página, de arriba abajo:

1. **Cabecera sticky** (`position:sticky; top:0`, cierre `border-bottom:2px` Chasis): marca + frescura comprimida a una línea (`09:14 · 5 fuentes · 1 atrasada`) y los 4 horizontes en segmentado de ancho completo (alto 9 px de padding vertical).
2. **Titular de riesgo**: puntaje 42/800/-0.03em en Señal + «**Oriente** en riesgo crítico.» + pendientes y corte. Una sola zona, la peor.
3. **Contador de sin ubicar** en banda `#eae7e7` — regla 5, también en móvil.
4. **Excepciones** — mismas fichas, tipografía un punto mayor (título 16, cuerpo 13) y **acciones apiladas a ancho completo con `min-height:46px`** (el mínimo táctil). Es lo primero accionable: *qué hago*.
5. **Zonas por riesgo** — el equivalente sin mapa (regla 7). Grid `40px 1fr auto`, `min-height:56px`: puntaje 24/800, nombre + palabra, barra de 8 px, y pendientes/corte tabular a la derecha. Es *dónde*, después de *qué hago*.
6. **Ola entrante** — nombre, fecha, cuenta atrás y tres cifras en grid. Contexto, al final.

En escritorio, la tecla **L** conmuta a esta misma lista dentro de R3: filas de grid `44px 150px 1fr 120px 110px 100px`, recorribles con tabulador, `:focus-visible` con outline de 2 px, Enter selecciona. Mismos datos que el mapa.

---

## 6. Interacciones, estado y comportamiento

### Atajos de teclado

| Tecla | Acción |
| --- | --- |
| `1`–`4` | Horizonte: hoy · mañana · 72 h · olas |
| `L` | Conmutar mapa ↔ lista de zonas |
| `M` | Modo marca |
| `⌘K` / `Ctrl+K` | Paleta de comandos |
| `Esc` | Cierra paleta, modo marca, confirmación y nivel 3 |
| `Tab` | Recorre la lista de zonas; `Enter` selecciona |

Los atajos de una letra se ignoran mientras la paleta está abierta (no capturan la escritura).

### Paleta de comandos

Overlay `rgba(45,43,43,.5)`, panel de 560 px a 120 px del techo, borde 2px Tinta, `--shadow-lg` (la **única** sombra en uso de todo el módulo). Input sin borde salvo `border-bottom: 2px`, 14 px, autofocus, placeholder «Saltar a una zona, cambiar horizonte, encender una capa…». Filtrado por substring case-insensitive; cada resultado invierte a fondo Tinta en hover. Comandos: ir a cada zona, cambiar cada horizonte, encender cada capa, vista de lista, marcar un punto.

### Estado (nombres del prototipo, reutilizables como `useReducer`)

```ts
{
  horizonte: 'hoy' | 'manana' | '72h' | 'olas'  // seed del server
  zona: string | null            // id de zona seleccionada → nivel 2
  factor: string | null          // id de factor abierto → nivel 3
  capas: string[]                // máx. 2; ['riesgo','clima'] por defecto
  zoom: 'zonas' | 'comunas' | 'pedidos'
  lista: boolean                 // equivalente sin mapa
  paleta: boolean; filtro: string
  confirmando: string | null     // id de acción esperando confirmación
  descartadas: string[]          // ids de excepción ocultas (optimista)
  marcando: boolean; marcaProv: {x,y} | null
  senal: boolean; otras: boolean // desplegables del bloque de prensa
  ahora: number                  // minutos desde 08:00, tick de 4 s
}
```

Transiciones que importan:
- `zona` se conmuta (click en la zona ya seleccionada la deselecciona) y **resetea `factor`**.
- `capas`: si la capa está activa la quita; si no está y ya hay 2, **no hace nada** (el tope se comunica visualmente, no con un error).
- `descartadas` filtra en cliente de forma optimista; el POST de descarte va detrás.
- `ahora` avanza con un intervalo de 4 s. En Next, este componente es cliente; deriva el valor de la hora real de Santiago con `Intl.DateTimeFormat` y ojo con la hidratación (calcula el primer valor en `useEffect`, no en el render inicial, o tendrás mismatch).

### Estados de carga

**No hay spinner de página.** Cada región (`r1`…`r5`) llega por su cuenta y ninguna bloquea a otra — mapea directo a `<Suspense>` por región con Server Components. El esqueleto es una **trama diagonal animada**: `repeating-linear-gradient(135deg, #eae7e7 0 14px, #f3f2f2 14px 28px)` con `animation: barrido 1.6s linear infinite` desplazando `background-position` de `0 0` a `56px 0`, y una placa que nombra la región que falta («R3 · MAPA — CARGANDO»). Nombrar lo que falta es parte del diseño.

### Estados de los controles

| Control | Reposo | Hover | Activo/Pressed | Foco | Deshabilitado |
| --- | --- | --- | --- | --- | --- |
| Acción sólida | fondo Tinta, texto Papel | `#444141` | `#2d2b2b` | `outline: 2px solid Señal; outline-offset: 2px` | `opacity:.45`, `cursor:not-allowed` |
| Confirmación destructiva | fondo Señal | `#dd2b0f` | `#ae1800` | `outline: 2px solid Tinta` | — |
| Botón outline | borde `#d7d3d3` | `border-color` y texto a Tinta | — | outline 2px Señal | — |
| Fila de capa | glifo `□` | fondo `#eae7e7` | invierte a Tinta con `■` | outline 2px | `opacity:.42`, glifo `⊘`, motivo en tooltip |
| Fila de zona (lista) | — | fondo `#eae7e7` | — | `outline: 2px solid Tinta; outline-offset:-2px` | — |
| Input de la paleta | `border-bottom: 2px #2d2b2b` | — | — | `border-bottom-color: Señal` | — |

**Nunca dejes el focus ring azul del navegador.** Todo interactivo lleva `:focus-visible` explícito.

### Nota sobre recharts

**No uses recharts** para la curva de olas ni la línea de tiempo. Ambas son composiciones de `div` posicionados en porcentaje: no llevan ejes, ni tooltips, ni leyendas generadas, y sus proporciones (barra base al 30 %, proyectada al 48 %, exceso apilado en Señal) son deliberadas. Recharts pelearía con los tokens y añadiría ~40 kB para nada. Resérvalo para gráficos analíticos de otras pantallas.

---

## 7. Tokens

Ver `tokens.css` — listo para pegar como capa `@theme` de Tailwind 4 con prefijo `--tc-`.

### Roles de color

| Rol | Hex | Uso |
| --- | --- | --- |
| Papel | `#f3f2f2` | Fondo de toda placa. ~92 % de la pantalla |
| Chasis | `#2d2b2b` | Las reglas de 2 px entre regiones. No es un borde: es el fondo que se asoma |
| Tinta | `#201e1d` | Texto, trazo, rellenos sólidos, chip de severidad alta |
| Inserto | `#eae7e7` | Barras vacías, paneles hundidos, fondo de factor abierto |
| Señal | `#ec3013` | **Reservado**: severidad crítica, zona ≥ 76, exceso sobre capacidad, fuente caída |
| Señal 700 | `#ae1800` | El mismo rojo a tamaño de texto, donde el acento puro no alcanza 4.5:1 |

**Rampa de tinta** 100→900: `#f8f4f4 #eae7e7 #d7d3d3 #bab6b6 #9b9797 #7d7979 #605d5d #444141 #2d2b2b`

**Rampa de señal** 100→900: `#fff2ef #ffe0d9 #ffc4b8 #ff9783 #ec3013 #dd2b0f #ae1800 #7c1405 #4d170e` — en uso solo 100 (fondo de trama crítica), 500 (base) y 700 (texto).

### Escala de riesgo — 5 pasos de trama a 45°

Cada paso es un `<pattern patternTransform="rotate(45)">` con un `<rect>` de fondo y una `<line>` vertical. La **densidad es el canal primario**; la cifra y la palabra viajan siempre con ella.

| Paso | Rango | Palabra | Pitch | Grosor | Opacidad | Fondo | Tinta línea | Ejemplo del dataset |
| --- | --- | --- | --- | --- | --- | --- | --- | --- |
| 1 | 0–20 | calmo | 13 px | 1 | .34 | `#f3f2f2` | `#201e1d` | Poniente 16 |
| 2 | 21–40 | bajo | 9 px | 1 | .40 | `#f3f2f2` | `#201e1d` | Norte 28 · Sur 31 |
| 3 | 41–60 | medio | 6 px | 1 | .52 | `#f3f2f2` | `#201e1d` | Centro 54 |
| 4 | 61–75 | alto | 4 px | 1.1 | .66 | `#eae7e7` | `#201e1d` | ninguna hoy |
| 5 | 76–100 | crítico | 3 px | 1.4 | .90 | `#fff2ef` | `#ec3013` | Oriente 81 |

### Tipografía — Archivo, tres pesos

400 lectura · 600 metadatos · 800 toda cifra o título. **Toda cifra lleva `font-variant-numeric: tabular-nums lining-nums`.**

| Rol | px | Peso | Letter-spacing | Line-height |
| --- | --- | --- | --- | --- |
| Cifra mayor (puntaje de nivel 2) | 46 | 800 | −0.03em | 0.9 |
| Cifra de titular móvil | 42 | 800 | −0.03em | 0.9 |
| Cifra de placa de mapa | 30 | 800 | −0.03em | 0.88 |
| Título de sección del documento | 30 | 800 | −0.025em | 1 |
| Título de región (R2) | 22 | 800 | −0.02em | 1.1 |
| Métrica del riel | 22 | 800 | −0.03em | 1 |
| Título de ficha | 15.5 | 800 | 0 | 1.2 |
| Nombre de zona (placa) | 11.5 | 800 | 0.09em | 1.2 |
| Cuerpo | 12.5 | 400 | 0 | 1.45 |
| Metadato | 10.5 | 600 | 0 | 1.35 |
| Etiqueta de placa | 9 | 800 | 0.14em | 1.2 |
| Micro-etiqueta | 8.5 | 800 | 0.16em | 1.2 |

Archivo está en Google Fonts. Cárgala con `next/font/google` y pesos `400,600,800`; si el repo ya la tiene en `--font-heading`/`--font-body`, reutiliza esa instancia.

### Espaciado, radio, elevación

Múltiplos de 4, sin valores intermedios: **4** (cifra y su glifo) · **8** (chips y botones hermanos) · **12** (padding vertical de fila) · **16** (padding de placa) · **24** (bloques del riel) · **32** (secciones).

Medidas de la retícula: barra superior **52** · banda de ola **132** · riel **404** · línea de tiempo **98** · regla mayor **2** · regla menor **1**.

**Radio: 0 px en absolutamente todo** — botones, placas, chips, campos, la paleta. Es una decisión, no un descuido: la esquina viva es lo que hace que el conjunto lea como plano técnico.

Sombras definidas, **una sola en uso**:
- `sm` `0 1px 2px rgba(45,43,43,.14)` — sin uso
- `md` `0 3px 10px rgba(45,43,43,.16)` — placa del nivel 3
- `lg` `0 12px 32px rgba(45,43,43,.22)` — paleta ⌘K

La separación la hacen las reglas, no las sombras. Si te encuentras añadiendo una sombra, probablemente falta una regla.

---

## 8. Los seis estados de `EstadoPantalla`

Ninguno es un caso borde con un mensaje encima: **cada uno cambia qué regiones existen**.

| Estado | Qué cambia | Copy de la banda |
| --- | --- | --- |
| `con_excepciones` | Caso completo: métricas + excepciones + señales | (sin banda) |
| `tranquilo` | Riel con métricas y **una sola línea**: «Sin excepciones abiertas. El riel se queda vacío a propósito.» | **Todo tranquilo** — «Ninguna zona supera el umbral de riesgo y no hay eventos relevantes en las próximas 24 horas.» + «Ver el detalle igual» |
| `cargando` | Cada región con su propio esqueleto de trama animada, nombrando la región | (sin banda) |
| `degradado` | Fuente de tránsito marcada en Señal con `✕`; su capa bloqueada con motivo; **todo lo demás opera** | **Faltan datos de tránsito** — «La capa de tránsito muestra información de hace 38 minutos. El resto del tablero está al día.» |
| `sin_zonas` | Fallback a las 5 macro-zonas de la RM con trazo discontinuo y relleno plano | **Todavía no defines tus zonas** — «Estás viendo las cinco macro-zonas de la Región Metropolitana. Agrupa tus comunas para que el tablero refleje cómo operas.» + «Configurar zonas» |
| `sin_pedidos` | Se apagan métricas y excepciones; el riel pasa a **preparación de la ola**: hitos con su estado y tabla proyección/base/capacidad por día (la capacidad en Señal el día que se excede) | **Sin pedidos para hoy** — «No hay pedidos asignados. La próxima ola comercial es el Día del Niño, en 15 días.» + «Ver la ola entrante» |

⚠️ En `tranquilo`, el mapa del prototipo conserva los puntajes del dummy (Oriente 81), que contradicen el mensaje. **En producción este estado solo debe aparecer cuando ningún puntaje supere el umbral** — no lo fuerces con un flag sobre datos calientes.

---

## 9. Accesibilidad

- **Regla 7 es accesibilidad, no un extra.** La lista de zonas es la ruta equivalente al mapa: mismo dato, recorrible con tabulador, `Enter` selecciona. Debe existir siempre, no solo en móvil.
- El color nunca es único canal (regla 4): trama + cifra + palabra.
- Contraste: Señal `#ec3013` sobre Papel da ~3,4:1 — sirve para chrome, iconos y texto grande, **no para cuerpo**. A tamaño de texto usa Señal 700 `#ae1800`.
- Objetivos táctiles en móvil: `min-height: 46px`.
- `:focus-visible` explícito en todo interactivo, outline de 2 px con `outline-offset: 2px`.
- El contenedor del tablero es `tabIndex={0}` para capturar los atajos; asegúrate de que también tenga `aria-label` y que los atajos estén documentados en la paleta ⌘K (es su descubribilidad).
- Las capas bloqueadas necesitan `aria-disabled` y el motivo accesible, no solo un `title`.

---

## 10. Qué falta por decidir

1. Los polígonos **DPA 2023** reemplazan las celdas derivadas del centro de zona.
2. El **nivel 3** (lista de pedidos por factor) necesita el geocoding real. Hoy declara el vacío en vez de fingirlo — mantén esa honestidad hasta que exista el endpoint.
3. `RestriccionVehicular.vehiculosAfectados` es `null` en el dataset: la alerta de preemergencia es genérica hasta que el modelo guarde patentes.
4. El **horizonte** cambia el estado seleccionado pero no reemplaza el dataset: los tres horizontes precalculados aún no existen en el dummy. Define si el server los precalcula o si el cliente los pide por separado.
5. **Persistencia** de capas activas, horizonte y modo lista por usuario.
6. **Refresco**: cadencias por fuente (clima 60 min, tránsito 10 min, eventos 1440 min, prensa 30 min). Decide entre revalidación de Next o polling, y **nunca hagas saltar la posición de scroll del riel** al refrescar.

---

## 11. Archivos de este bundle

| Archivo | Qué es |
| --- | --- |
| `README.md` | Este documento. Autosuficiente |
| `pegar-en-CLAUDE-md.md` | Bloque para pegar en el `CLAUDE.md` del repo, para que cualquier sesión de Claude Code sepa que este paquete existe |
| `capturas/` | Cómo se ve cada pantalla: principal, zona seleccionada, tokens, los 5 estados y móvil |
| `tokens.css` | Tokens como custom properties, listos para `@theme` de Tailwind 4 |
| `Torre de control.dc.html` | **Ábrelo primero.** El documento de diseño: pantalla principal viva, zona seleccionada, tokens y los 6 estados, más móvil |
| `Torre consola.dc.html` | La consola en sí. Contiene el markup y la lógica de todo lo descrito arriba |
| `support.js`, `_ds/` | Runtime y hoja de estilos que necesitan los dos HTML para abrirse offline |

### Ruta de lectura sugerida

1. `capturas/01-pantalla-principal.png` — qué estamos construyendo, de un vistazo.
2. §2 de este README — la decisión de diseño y las 7 reglas. Es lo que no se puede romper.
3. `tokens.css` — pégalo en el CSS global antes de escribir componentes.
4. §4 y §5 — layout de escritorio y móvil, región por región.
5. El prototipo, para resolver dudas de comportamiento que la prosa no cubra.

Abre `Torre de control.dc.html` en un navegador: el prototipo es **interactivo**. Haz click en las zonas, abre factores, prueba el tope de capas, ⌘K, las teclas 1-4 / L / M, y «Reproducir la carga» en el marco de `cargando`. La documentación describe el comportamiento; el prototipo lo demuestra.

Fuentes de datos y de arquitectura en el repo: `docs/torre-de-control/estructura.md` y `docs/torre-de-control/datos-dummy.ts`.
