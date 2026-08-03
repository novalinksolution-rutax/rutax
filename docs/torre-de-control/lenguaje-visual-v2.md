# Torre de control v2 — lenguaje visual

**Fuente de verdad de cómo se ve la Torre.** Producto de la **Vía B** del
rediseño (2026-08-03). Su documento hermano es `alcance-v2.md`, que manda sobre
*qué* muestra la pantalla; éste manda sobre *cómo* se ve. Donde el handoff
archivado (`docs/_historico/torre-v1/`) diga otra cosa, gana este documento: ese
handoff dejó de ser autoridad.

Lo que esta vía decidió, en una línea: **la Torre deja de tener lenguaje visual
propio y pasa a ser una pantalla más de Rutax; el único trabajo visual específico
del módulo es el mapa**, porque MapLibre no puede consumir el sistema de diseño
tal cual.

---

## 1. Decisión 1 — se retiran los 12 tokens `--tc-*`

El bloque `TORRE DE CONTROL` de `src/app/globals.css` (157 líneas: paleta
papel/grafito, rampas de tinta y de señal, espaciado propio, radio 0, tres
sombras, la fuente Archivo, las alturas de la retícula de consola y las cinco
tramas de riesgo) **se retiró entero.**

Dos razones, y la segunda es la que cierra la discusión:

1. **La Torre bajó a `(tenant)`** y vive dentro del `AppShell`, con el mismo
   sidebar y el mismo conmutador de tema que el resto. Un lenguaje visual
   paralelo dentro del mismo shell no es identidad: es una pantalla que se ve
   rota al lado de las otras.
2. **No quedaba un solo consumidor.** Al retirarse el árbol de componentes de la
   v1 (Vía A), `grep -rn "tc-" src --include=*.tsx` devuelve cero. Era CSS muerto
   que además invitaba a reconstruir el módulo con reglas que ya nadie sostiene.

| Token de la v1 | Destino |
|---|---|
| `--color-tc-papel`, `--color-tc-chasis`, `--color-tc-tinta`, `--color-tc-inserto` | **Absorbidos** por `--background` / `--card` / `--foreground` / `--muted` del sistema |
| `--color-tc-senal`, `--color-tc-senal-text` (`#ec3013`) | **Absorbidos** por `--destructive` y `--destructive-subtle-foreground`. El *espíritu* sobrevive intacto: el rojo sigue reservado a la incidencia (regla 4) |
| Rampa `--color-tc-ink-100..900` | **Se retira.** El sistema ya tiene neutro cool con `muted-foreground` y `border` |
| Rampa `--color-tc-sig-100..900` | **Se retira.** Solo se usaban tres pasos, y son los del cuarteto semántico `destructive` |
| `--spacing-tc-*` | **Se retira.** Tailwind ya es rejilla de 4px |
| `--radius-tc: 0px` | **Se retira.** La esquina viva era del lenguaje de consola técnica; la Torre usa `--radius` (10px) como todo el producto |
| `--shadow-tc-sm/md/lg` | **Se retira.** Se usan `--shadow-xs/sm/md/dropdown` del ADN |
| `--font-tc` (Archivo, vía `next/font`) | **Se retira.** La UI es **Inter**, como las otras tres superficies. Una fuente menos que descargar |
| `--tc-h-barra`, `--tc-h-ola`, `--tc-h-tiempo`, `--tc-w-riel` | **Se retiran.** Eran la retícula de un viewport fijo; ver §2 |
| `--tc-trama-1..5` (tramas de riesgo de 45°) | **Se retiran** con el puntaje. Sin escala no hay nada que pintar |
| `.tc-num` (cifras tabulares) | **Absorbido** por la utilidad `tabular-nums` de Tailwind. La regla sigue: toda cifra que se refresca va tabular |
| `.tc-cargando`, `.tc-rail` | **Se retiran.** El esqueleto usa `Skeleton` del sistema; el scroll usa el estilo global |

**Lo único que el módulo conserva como valor propio es la paleta del mapa**, y no
por gusto: MapLibre no lee CSS. Un `var(--muted)` dentro de `fill-color` no se
resuelve —se ignora y la capa queda transparente—, así que los valores viven en
`_lib/mapa/paleta.ts` **con el token de origen anotado al lado de cada uno**. Ese
archivo es, además, la lista de lo que hay que mover si algún día cambia un token
del producto.

---

## 2. La retícula de la pantalla

La Torre es la **única pantalla ancha del backoffice**. Todo lo demás vive dentro
del `max-w-6xl` del `<main>` de `(tenant)`; el mapa necesita más.

| Pieza | Decisión | Por qué |
|---|---|---|
| **Ancho** | Variante ancha del `AppShell` (`max-w-[1600px]`), solo para esta ruta | `app-shell.tsx:539` ya conmuta `max-w-5xl`/`max-w-6xl` con la prop `relajado`: se le añade un valor más. **No se le quita el `max-w` a las demás pantallas** |
| **Alto del mapa** | `min(68vh, 720px)`, mínimo `420px` | Grande pero acotado, como pidió el usuario. En un portátil de 900px de alto deja ver la cabecera, las cifras y el arranque del panel sin scroll; en un monitor grande no se estira hasta lo absurdo |
| **Pantalla completa** | Fullscreen API sobre el contenedor del mapa, botón arriba a la derecha | No es ruta nueva ni layout nuevo: es estado local. Al entrar y salir hay que llamar `map.resize()` |
| **Panel lateral** | 340px fijos, a la derecha, con la misma altura que el mapa | Ancho suficiente para «`RX-8F2K-9QD1` · Providencia · Muñoz · hace 12 min» sin truncar |
| **Cifras** | Cuatro magnitudes en una fila, separadas por línea de 1px, sin cards | Principio 6 del sistema: jerarquiza el espacio y el peso, no la caja |
| **Cabecera** | `h1` + una línea de resumen, igual que toda pantalla `(tenant)` | La Torre es un módulo, no una consola |
| **`< lg`** | El mapa se retira y manda la **lista de comunas** (F10) | El móvil se resuelve fuera de este repo, en la app nativa. La lista es degradación honesta, no una segunda superficie que mantener |

Orden vertical, de arriba a abajo: **cabecera → banda de ola (si hay) → cifras →
mapa + panel**. La ola va arriba de las cifras porque es lo único que mira hacia
adelante: si estuviera abajo, competiría con lo de hoy.

---

## 3. El mapa — los dos estilos

Mismo archivo PMTiles, dos objetos de estilo. El código está en
`_lib/mapa/estilo.ts` y los colores en `_lib/mapa/paleta.ts`; acá va el porqué.

### 3.1 Plano urbano

| Rol | Claro | Oscuro | Nota |
|---|---|---|---|
| Tierra | `#f1f2f8` | `#131417` | Un punto **por debajo** de `--muted` / `--card`: el panel y las placas tienen que flotar sobre el mapa, no fundirse con él |
| Verde | `#e7eee7` | `#161d18` | Verde desaturado. Es referencia urbana, no dato |
| Equipamiento | `#edeef5` | `#181920` | Hospital, universidad, aeropuerto. Apenas perceptible |
| Agua | `#ccd5ea` | `#0d1119` | El Mapocho y el Zanjón son referencias reales de Santiago |
| Edificios | `#e7e8f0` | `#1b1d23` | Solo desde z14, con opacidad creciente: dan textura al llegar al punto y antes son ruido |
| Autopista | `#ffffff` | `#3b404c` | En claro las vías van **más claras que la tierra**: es lo que hace que un plano se lea como plano |
| Troncal | `#ffffff` | `#33373f` | |
| Secundaria | `#fafafd` | `#2a2d34` | |
| Local | `#f7f7fc` | `#232529` | Desde z12.5, con fundido de opacidad para que no aparezca de golpe |
| Borde de vía | `#dedfeb` | `#0f1013` | El contorno es lo que convierte una línea en una calle |
| Texto de lugar | `#172131` | `#eef0f4` | = `--foreground` |
| Texto de vía | `#606a78` | `#9da3ad` | = `--muted-foreground` |
| Halo | `#f1f2f8` | `#0d0e11` | |

**La jerarquía vial de cuatro anchos es la mitad del «premium».** En la v1 todos
los ejes iban en el mismo gris tenue. Que una autopista, una troncal, una
secundaria y un pasaje se dibujen distinto es lo que hace que el plano se lea
como Uber o Rappi — más que cualquier color.

Se pintan **primero todos los bordes y después todos los rellenos**. Hacerlo vía
por vía deja costuras en cada cruce.

### 3.2 Etiquetas, en tres escalones

| Escalón | Qué | Desde | Por qué ahí |
|---|---|---|---|
| 1 | Lugar (comuna, barrio) | z11 | **No antes**: bajo z11 la comuna la nombra la *placa* del módulo con su fracción, y dos textos para lo mismo es el ruido que la regla 1 prohíbe |
| 2 | Ejes estructurantes | z12 | Ya se está dentro de una comuna y hace falta saber por qué avenida se llega |
| 3 | Calle local | **z13.6** | Es **exactamente** el umbral del nivel 3 del zoom. No es coincidencia: la Torre muestra el código de envío y no la dirección, así que la calle de abajo es lo único que ubica el punto |

Se respeta el campo `min_zoom` que Protomaps trae por *feature*: es su propia
jerarquía de importancia, y es mejor que cualquiera que inventemos. Los **POIs
van apagados** (ruido puro para esta pantalla) y los **límites administrativos
del basemap también**, salvo país y región: el límite comunal lo dibuja el módulo
con la DPA 2023, y dos trazos para el mismo límite se ven como un error de
registro.

### 3.3 Dato operativo encima del plano

| Elemento | Claro | Oscuro | Regla que respeta |
|---|---|---|---|
| Carga por comuna | navy `#2a3ca0` a 8/14/22/32 % | periwinkle `#7080f5` a 12/20/30/40 % | Rampa de **un solo tono, cuatro pasos**: es intensidad de una magnitud, no una escala semántica. Siempre acompañada de la fracción en la placa |
| Borde de comuna | `#c6c9de` | `#ffffff26` | |
| Comuna activa | navy 2px | periwinkle 2px | |
| Velo (las demás) | tierra al 72 % | tierra al 77 % | Entrar en una comuna no cambia de pantalla: apaga el resto de la ciudad |
| Punto pendiente | `#2f3a4b` (= `--primary`) | `#e6e9ef` | |
| Punto en ruta | anillo navy sobre relleno del halo | anillo periwinkle | Anillo vs. relleno: se distinguen **por forma**, no solo por color |
| Punto entregado | `#a7aebd` al 75 % | `#5b6068` al 75 % | **Se apaga, no se borra.** Si lo entregado desapareciera, un día cerrado se vería igual que un día sin pedidos |
| Cerca del corte (F7) | anillo ámbar `#ff8447` | `#e97135` | Marca, no reloj. Y su cifra va siempre en la cabecera |
| **Incidencia** | **`#fb3748`** | **`#e93544`** | **El único rojo de la pantalla**, y se pinta arriba de todo |
| `+N` de agrupados | texto sobre el propio punto | ídem | Un edificio con seis entregas es UN punto con «6», no seis puntos encimados. **Sin glifos se sustituye por un anillo** — ver §6 |

**El navy como canal de dato es la única excepción a «el navy es recurso
escaso»**, y está acotada al relleno de comuna y al punto en ruta. Fuera del
mapa, el navy sigue siendo solo enlace, activo y foco.

Estas reglas no viven solo en prosa: `estilo.test.ts` falla si el rojo aparece en
una segunda capa, si un tema pierde una capa que el otro tiene, o si la etiqueta
de calle local se separa del umbral del nivel 3.

---

## 4. El escalón entre los tres niveles de zoom (F2)

**Se llega por las dos vías, y el resultado es el mismo** (decisión del usuario):
clic en una comuna → `flyTo` de 700 ms; o rueda del mouse → el nivel cambia solo
al cruzar el umbral. Nada de modos que el usuario tenga que elegir.

```
NIVEL 1 · comuna            z < 11
┌──────────────────────────────────────────────┬─────────────────┐
│  Región Metropolitana                    ⊕ ⊖ │  Incidencias    │
│                                            ⤢ │ ─────────────── │
│        ┌ Renca 12 de 28 ┐                    │ ● RX-8F2K-9QD1  │
│                    ┌ Providencia 38 de 86 ●┐ │   Providencia   │
│   ┌ Maipú 31 de 96 ┐        ┌ Las Condes ─┐  │   Muñoz · 12min │
│                                              │                 │
│   · comunas rellenas por carga (4 pasos)     │ ● 11122334455   │
│   · placa = nombre + fracción + punto rojo   │   Maipú · 26min │
└──────────────────────────────────────────────┴─────────────────┘

NIVEL 2 · agrupaciones      11 ≤ z < 13.6      (clic en comuna / rueda)
┌──────────────────────────────────────────────┬─────────────────┐
│  Región Metropolitana / Providencia      ⊕ ⊖ │  Conductores    │
│                                            ⤢ │ ─────────────── │
│   el resto de la ciudad bajo velo            │ Pérez  12 de 40 │
│           (14)      (7)                      │ ▓▓▓▓▓▓░░░░░░░░  │
│      (23)        (9)     (5)                 │ Muñoz  18 de 33 │
│                                              │ ▓▓▓▓▓▓▓▓▓░░░░   │
│   · burbujas con su cifra, tamaño por volumen│                 │
│   · etiquetas de comuna y de eje encendidas  │                 │
└──────────────────────────────────────────────┴─────────────────┘

NIVEL 3 · punto             z ≥ 13.6
┌──────────────────────────────────────────────┬─────────────────┐
│  RM / Providencia / Puntos de entrega    ⊕ ⊖ │  Comunas        │
│                                            ⤢ │ ─────────────── │
│     ● ○ ●          ┌───────────────────┐     │ Providencia 38  │
│   ○   ⦿ +3         │ RX-8F2K-9QD1      │     │ Las Condes  34  │
│      ●   ○         │ Incidencia abierta│     │ Maipú       31  │
│   nombres de calle │ Conductor  Muñoz  │     │                 │
│   legibles         │ Le faltan  9 paq. │     │                 │
│                    │ Ver en Operaciones│     │                 │
└────────────────────┴───────────────────┴─────┴─────────────────┘
```

| | Nivel 1 | Nivel 2 | Nivel 3 |
|---|---|---|---|
| Relleno de comuna | opacidad 1 | 0.45 | 0.45 |
| Placas HTML | sí | no | no |
| Burbujas | no | **sí** | no |
| Puntos | no | no | **sí** |
| Velo sobre el resto | no | sí\* | sí\* |
| Etiqueta de lugar | del módulo (placa) | del plano | del plano |

\* Solo si hay comuna activa. El velo lo produce la selección, no el zoom — ver
abajo.

**El panel de la derecha son tres pestañas, y el nivel elige cuál abre.** El
wireframe muestra `Incidencias` en el nivel 1, `Conductores` en el 2 y `Comunas`
en el 3: eso es la pestaña **por defecto** de cada nivel, no el único contenido
disponible. Las tres están siempre a un clic, y una vez que el usuario elige una,
manda su elección — cambiar de nivel no se la pisa. Es la misma mecánica que §6
ya declara para `con_incidencias` («el panel abre en la pestaña de incidencias»):
la pantalla sugiere dónde mirar, no decide por el usuario.

**Cómo se sube de nivel:** migas de pan siempre visibles arriba a la izquierda
(`Región Metropolitana / Providencia / Puntos de entrega`), `Esc`, o alejar con
la rueda. Al volver al nivel 1 se limpia la comuna activa y se apaga el velo.

**Bajar con la rueda NO es idéntico a hacer clic**, aunque arriba se diga que se
llega «por las dos vías». Es la misma cámara, pero el clic además **elige una
comuna** y la rueda no, así que hay un tercer caso que la tabla no cubre: nivel 2
o 3 **sin comuna activa**. Se resuelve así, y no es un detalle de implementación
—cambia lo que se ve:

| | Con comuna activa (clic) | Sin comuna activa (rueda) |
|---|---|---|
| Velo sobre el resto | sí | **no** — no hay «resto» del que distinguirse |
| Migas | `RM / Providencia / …` | solo `Región Metropolitana` |
| Burbujas y puntos | los de todo el encuadre | ídem |

La regla detrás: **el velo y el nombre en la miga los produce la SELECCIÓN, no el
zoom.** Apagar media ciudad porque alguien giró la rueda sería el mapa decidiendo
por el usuario. Y al revés: si se vuelve al nivel 1, la comuna activa se limpia
sola — quedarse seleccionada mientras se mira toda la región dejaría un velo que
nadie pidió.

**Ninguna capa se agrega ni se quita al cambiar de nivel**: todas existen desde
el principio y solo cambian `visibility` y opacidad. Es lo que permite que el
escalón se sienta continuo en vez de un parpadeo, y evita el bug clásico de
agregar dos veces la misma capa.

---

## 5. Glifos — la espiga que faltaba, resuelta

El plan del mapa (`docs/arquitectura/mapa-torre-v2.md` §5) marcaba el pipeline de
glifos como **la única estimación sin verificar**, y bloqueante para todo lo
demás. Se hizo la espiga. Resultado:

> **No hay pipeline que construir. Son cuatro archivos que se descargan y se
> suben.**

```bash
# Noto Sans Regular y Medium, rangos latinos, del build público de Protomaps
# (SIL Open Font License — el OFL.txt viaja al lado, es condición de la licencia)
curl -L -o "Noto Sans Regular/0-255.pbf" \
  "https://raw.githubusercontent.com/protomaps/basemaps-assets/main/fonts/Noto%20Sans%20Regular/0-255.pbf"
```

- **4 archivos, ~410 KB** en total (dos pesos × dos rangos). `0-255` cubre el
  español completo; `256-511` cubre el latín extendido.
- **Cero herramientas nativas.** No hace falta `fontnik`, ni `node-gyp`, ni
  compilar nada — que era el riesgo real de la estimación.
- Se publican en el bucket `contexto-mapas`, junto al basemap, y la base va en
  `NEXT_PUBLIC_MAPA_GLIFOS_URL`.

**Por qué Noto Sans y no Inter**, que es la fuente de la UI: no existen glifos
PBF publicados de Inter, y generarlos sí exigiría el pipeline nativo que esta
espiga evitó. Noto Sans es una grotesca neutra que a tamaño de mapa (9–14 px) se
comporta igual de bien, y la diferencia con Inter en una etiqueta de calle es
imperceptible. **Es una decisión de costo/beneficio, no una preferencia**: si
alguna vez se quiere Inter en el mapa, lo que hay que resolver es el generador de
glifos, no el estilo.

### Corrección al plan del mapa

`mapa-torre-v2.md` §5 paso 3 dice que la jerarquía vial «requiere re-recortar con
más capas OSM». **Es incorrecto, y se verificó leyendo los metadatos del propio
PMTiles.** El extracto ya trae el esquema Protomaps completo:

| Capa | Zooms | ¿`name`? | ¿`kind`? |
|---|---|---|---|
| `roads` | 3–15 | **sí** | sí (`highway`, `major_road`, `medium_road`, `minor_road`, `path`, `rail`…) |
| `places` | 1–15 | **sí** | sí (`locality`, `borough`, `neighbourhood`…) |
| `water`, `landuse`, `buildings`, `boundaries`, `earth` | varios | agua sí | sí |

`pmtiles extract` recorta por bbox, **no por capas**: nunca hubo nada que
descartar. La jerarquía vial es puro estilo, y ya está escrita. Se ahorra el día
que el plan le asignaba.

**Lo que sí hay que saber del extracto:** llega hasta **z13**, y por eso la
fuente declara `maxzoom: 13`. Sin eso MapLibre deja de pedir tiles al pasar z13 y
el plano **desaparece justo en el nivel del punto de entrega**. Hay un test que
lo bloquea.

---

## 6. Los estados de la pantalla

Cuatro estados de diseño de primera clase (`EstadoPantalla` en el contrato), más
dos condiciones que se cruzan con cualquiera de ellos:

| Estado | Cómo se ve |
|---|---|
| `tranquilo` | El silencio es el estado normal. Cifras + mapa; el panel de incidencias dice «Sin incidencias abiertas. El día va bien.» Nada rojo en pantalla |
| `con_incidencias` | La cifra de incidencias toma el rojo, los puntos afectados se encienden y el panel abre en la pestaña de incidencias |
| `sin_pedidos` | El mapa se atenúa con una sola frase encima: «No hay pedidos con compromiso para hoy». Las comunas siguen dibujadas: la ciudad no desaparece porque sea domingo |
| `cargando` | Esqueleto con la forma final (cifras, caja del mapa, filas del panel). Nunca un spinner de página |
| **Frescura atrasada** (F6) | Chip ámbar en la cabecera: «Sin cierres hace 52 min». **Invisible mientras el dato está fresco** — un indicador que siempre está ahí deja de leerse justo el día que importa |
| **Sin basemap** | El mapa dibuja las comunas sobre el color de tierra, sin plano urbano. Es un estado válido y se declara; lo que se pierde ahí es ubicar el punto |
| **Sin glifos** | No se dibuja **ninguna** capa de texto, ni del plano ni del dato. No es una preferencia: un `text-font` sin glifos publicados hace que MapLibre **descarte la capa entera** y lo repita una vez por tesela. Se pierden dos cifras, y no pesan igual — ver abajo |

**Sin glifos, la cifra de la burbuja se puede perder; el `+N` no.** El radio de
la burbuja del nivel 2 ya codifica el volumen (13→28 px), así que sin su número
la magnitud se sigue leyendo, solo que sin precisión. El punto del nivel 3 es
distinto: su radio depende **solo del zoom**, así que sin el `+N` un edificio con
seis entregas quedaría idéntico a uno con una. Eso es el mapa **escondiendo
carga**, que es justo lo que prohíbe la regla 5 del alcance. Por eso, sin glifos,
el `+N` se sustituye por un **anillo** alrededor del punto: se pierde el número,
no el hecho de que ahí hay varios. El anillo va **por debajo** de los puntos —el
punto le tapa el centro y lo deja como anillo sin dibujar un contorno aparte, y
así la incidencia sigue siendo la última marca que se pinta.

Por eso `capasDatos(tema, conEtiquetas)` lleva el segundo parámetro **sin valor
por defecto**: es el mismo `urlGlifos !== null` que recibe el estilo base, y
olvidarlo fallaría mudo. Sin default, olvidarlo no compila.

---

## 7. Lo que esta vía NO decide

- **La pantalla.** Componentes, carga de datos, realtime, enlaces profundos y la
  mudanza del ancho en `app-shell.tsx` son Vía C.
- **La banda del dashboard** (F12): se reescribe en Vía C con estos mismos
  tokens; no necesita nada propio.
- **Publicar los glifos y el basemap** al bucket: es Vía C / devops. Acá quedó
  verificado *qué* publicar y *cómo*.
- **Los pesos de fuente adicionales** (itálica para hidrografía, por ejemplo):
  existe `Noto Sans Italic` en el mismo origen si alguna vez se quiere.

---

## 8. Dónde está cada cosa

| Archivo | Qué |
|---|---|
| `src/app/(tenant)/torre-de-control/_lib/mapa/paleta.ts` | Los dos temas, los umbrales de zoom y el encuadre de la RM |
| `src/app/(tenant)/torre-de-control/_lib/mapa/estilo.ts` | Constructor del estilo base y de las capas de dato |
| `src/app/(tenant)/torre-de-control/_lib/mapa/config.ts` | Rutas de los activos y atribuciones |
| `src/app/(tenant)/torre-de-control/_lib/mapa/estilo.test.ts` | Las reglas de color y de zoom, como pruebas |
| `.artefactos/prototipo-torre-v2/` | El prototipo navegable (fuera del repo, `.gitignore`). `node .artefactos/prototipo-torre-v2/servidor.mjs` y abrir <http://localhost:4173> |
