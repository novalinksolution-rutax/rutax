# Mapa de la Torre v2 — qué tecnología cartográfica usar

Investigado el 2026-08-03, a pedido del usuario:

> «Quiero que el mapa se vea más premium y más navegable y fluido. Dado que no
> vamos a ver ni clima ni nada por el estilo, es importante replantear el tipo de
> mapa que vamos a usar e investigar qué otra opción buena tenemos.»

**Recomendación en una línea:** quedarse con **MapLibre + PMTiles auto-hospedado**
y gastar el esfuerzo en **encender etiquetas y rehacer el estilo**, no en cambiar
de proveedor. Las cuatro alternativas alojadas que parecían candidatas **prohíben
el uso comercial en su tier gratuito** — la misma trampa de Open-Meteo, cuatro
veces. Y la medición dice que el mapa de hoy no es lento: es **mudo**.

---

## 1. Corrección de encuadre: OpenWeather no dibuja el mapa

Esto hay que decirlo primero porque cambia la pregunta. La cartografía de hoy son
cuatro piezas y **ninguna de ellas es OpenWeather**:

| Pieza | Qué es | Dónde vive |
|---|---|---|
| Motor de render | `maplibre-gl` **5.24.0** (versión exacta; no subir a 6.x — falla mudo con Turbopack) | `package.json` |
| Basemap | PMTiles de ~19 MB recortado del build público de **Protomaps** (datos OSM), servido desde el bucket público `contexto-mapas` con requests de rango HTTP | `scripts/mapa/`, `NEXT_PUBLIC_MAPA_BASEMAP_URL` |
| Geometría comunal | TopoJSON **DPA 2023** de SUBDERE/INE, 113 KB, versionado en el repo. Comunal, nunca disuelto por zona | `public/mapas/comunas-rm.topojson.json` |
| OpenWeather | **Solo datos** de clima y calidad del aire. No dibuja un píxel. Su única presencia visual es una línea de atribución al pie | `_lib/mapa/config.ts` → `ATRIBUCIONES` |

Así que la pregunta real nunca fue «¿sirve OpenWeather?». Es **«¿sirve el basemap
Protomaps auto-hospedado, y sirve MapLibre?»**.

Y hay un dato que decide media discusión:

> **El basemap actual está deliberadamente castrado.** Se construyó acromático y
> **sin una sola etiqueta**: ni nombres de calle, ni de comuna, ni de lugar. Por
> eso el estilo ni siquiera necesita `glyphs`, y no hay PBFs de fuente
> publicados. Fue una **decisión de diseño del handoff** —«el basemap no es el
> mapa»— no un límite de la tecnología.

Es decir: **hoy el mapa es poco navegable por decisión, no por herramienta.**
Publicar glifos y encender etiquetas es trabajo de horas sobre el stack que ya
existe. Con el handoff retirado, esa decisión ya no ata a nadie.

Nota aparte: al apagarse clima y aire (decisión del rediseño v2), **la atribución
de OpenWeather desaparece del pie del mapa** — deja de haber dato de OpenWeather
en el producto. La de OpenStreetMap/Protomaps y la de la DPA 2023 se quedan
mientras exista el basemap.

---

## 2. La medición: dónde se van los milisegundos

El prompt sospechaba que el cuello no estaba en MapLibre sino en la capa HTML de
placas, y pedía medirlo antes de tocar el motor. Se midió.

**Método.** Se reprodujo el algoritmo exacto de `reposicionar()`
(`_componentes/mapa/mapa-zonas.tsx:302`) en un banco aislado: proyección de cada
ancla a píxeles, lectura de `offsetWidth`/`offsetHeight`, des-solapado contra
todas las cajas ya colocadas y escritura de `transform`. Un frame de arrastre es
una llamada. Se midió cada escenario 120 veces (20 en los más grandes) en el
navegador real, y se midió además una variante idéntica que **no lee layout**
(medidas cacheadas), para separar los dos costos.

| Escenario | Anclas HTML | ms/frame (código actual) | ms/frame (sin leer layout) | ¿Cabe en 16,7 ms? |
|---|---:|---:|---:|---|
| **Hoy**: 5 placas de zona | 5 | **0,04** | 0,01 | sí, con 400× de margen |
| Hoy + 10 conductores | 15 | 0,10 | 0,02 | sí |
| **v2**: 32 comunas de la RM | 32 | **0,23** | 0,04 | sí |
| **v2**: 32 comunas + 30 conductores | 62 | **0,57** | 0,16 | sí, con 29× de margen |
| 150 anclas | 150 | 2,96 | 0,34 | sí, justo |
| **600 pedidos como anclas HTML** | 600 | **31,77** | 2,74 | **NO** (≈31 fps) |
| 1.000 anclas HTML | 1.000 | **92,74** | 4,42 | **NO** (≈11 fps) |

### Tres conclusiones, y ninguna favorece cambiar de proveedor

**1. El mapa de hoy no tiene un problema de rendimiento.** 0,04 ms de un
presupuesto de 16,7 ms por frame. Lo que se percibe como «poco fluido» no es
velocidad: es que un plano sin una sola etiqueta no da referencias mientras te
mueves, así que el arrastre no *parece* llevarte a ninguna parte.

**2. La v2 tal como la pediste tampoco lo tiene.** 32 comunas + 30 conductores
como anclas HTML cuestan 0,57 ms/frame — 29 veces por debajo del presupuesto. El
cambio de zona a comuna no rompe nada.

**3. El punto de quiebre es uno solo, y está identificado: promover los PEDIDOS a
anclas HTML.** A 600 pedidos el frame cuesta 31,77 ms y el mapa cae a ~31 fps.
Hoy eso **no pasa**, porque los pedidos ya van por la fuente GeoJSON de MapLibre
y los dibuja la GPU (`IDS_FUENTES.pedidos`, `mapa-zonas.tsx:482`). La regla para
la v2 es simplemente **no moverlos de ahí nunca**.

### El culpable no es el que se sospechaba

El prompt apuntaba al des-solapado cuadrático. La medición dice otra cosa: a 600
anclas, **31,77 ms con lectura de layout contra 2,74 ms sin ella**. El 91 % del
costo no es el algoritmo de colisiones — es el **layout thrash**: el bucle
intercala `offsetWidth`/`offsetHeight` (lectura que fuerza recálculo de estilo)
con escrituras de `style.transform`, así que el navegador recalcula layout una
vez por ancla y por frame.

Consecuencia práctica: si algún día hiciera falta subir el número de anclas HTML,
**la corrección barata es medir una sola vez y cachear**, no rediseñar el
des-solapado. Eso solo llevaría 600 anclas de 31,77 a 2,74 ms.

Y la consecuencia que importa para este documento: **ninguno de estos números
cambia si se cambia de proveedor de tiles.** MapLibre y Protomaps no aparecen en
la medición. Cambiar de proveedor por un problema de fluidez sería pagar una
migración por un problema que no está ahí.

---

## 3. La trampa de licencia, otra vez

Este repo ya perdió tiempo con Open-Meteo: se integró y después se descubrió que
su tier libre prohíbe el uso comercial y define como comercial «apps con
suscripciones» — exactamente lo que es Rutax. Hubo que migrar todo a OpenWeather.

**Se verificó cada candidato contra sus propios términos. El resultado es que la
trampa se repite cuatro veces:**

| Proveedor | ¿Tier gratuito permite un SaaS de pago? | Cita |
|---|---|---|
| **MapTiler** | **NO.** «With a free account, you may only use the Services up to the quota allowed under the free tiers» — el uso comercial exige plan pagado | [maptiler.com/terms](https://www.maptiler.com/terms/) |
| **Stadia Maps** | **NO.** El plan gratuito dice literalmente «Commercial use not allowed». 200.000 créditos/mes, sin opción de excedente | [stadiamaps.com/pricing](https://stadiamaps.com/pricing/) |
| **Jawg** | **NO.** «Non-commercial use is authorized for publicly available websites (no login), with no commercial purposes only (NPOs, organizations…)». Rutax tiene login y cobra suscripción: dos descalificaciones | [jawg.io/en/pricing](https://www.jawg.io/en/pricing/) |
| **Protomaps API** (el servicio alojado) | **NO gratis.** «Noncommercial use is free; for commercial use, become a GitHub Sponsor» | [protomaps.com](https://protomaps.com/) |
| **Mapbox** | **Sí** — su tier gratuito es una franquicia de facturación, no una licencia no-comercial. Pero ver la advertencia de abajo | [mapbox.com/pricing](https://www.mapbox.com/pricing) |
| **Google Maps Platform** | **Sí**, con 10.000 eventos facturables gratis al mes | [developers.google.com/maps/billing-and-pricing/pricing](https://developers.google.com/maps/billing-and-pricing/pricing) |
| **Protomaps builds públicos** (lo que ya usamos) | **Sí.** ODbL como obra derivada de OSM; el propio proyecto **recomienda auto-hospedar**: «you should copy the tileset to your own Cloud Storage» | [docs.protomaps.com/basemaps/downloads](https://docs.protomaps.com/basemaps/downloads) |

### ⚠️ Dos advertencias específicas sobre Mapbox que aplican justo a Rutax

Los Product Terms de Mapbox traen dos cláusulas que este producto toca de frente:

1. **Uso vehicular.** «A Commercial Application License is required for
   non-production and/or production use of Mapbox services for vehicle usage
   (including ground, aerial, manned and unmanned vehicles).» Rutax es
   despacho de última milla con flota: es difícil argumentar que no es uso
   vehicular.
2. **Modelo *service bureau*.** Está prohibido «offering access to the Services
   Offerings under a "time-sharing" or "service bureau" model». Un SaaS
   multi-tenant donde 20 couriers ven mapas a través de la cuenta de Rutax es
   exactamente la figura que esa cláusula describe.

Ninguna de las dos es una certeza de incumplimiento, pero las dos exigirían
pasar por ventas de Mapbox y firmar antes de construir. Para un módulo que hoy
no cuesta nada, es un riesgo caro.
[Product Terms (PDF, oct-2025)](https://cdn.prod.website-files.com/609ed46055e27a02ffc0749b/68dddd2815cb3d82685f0096_Mapbox%20Product%20Terms%20(October%201,%202025).pdf)

---

## 4. Las seis opciones contra los criterios

Pesos según lo que respondió el usuario: presupuesto **cero, auto-hospedado**;
«premium» = **calidad cartográfica y tipográfica del plano** (referencia
Uber/Rappi), no 3D; **claro y oscuro**; nombres de calle **sí**; **>600 pedidos**
y 30+ conductores.

| Criterio | 1. MapLibre + PMTiles propio, re-estilado | 2. MapLibre + tiles alojados | 3. Mapbox GL JS v3 | 4. Google Maps | 5. Capa de render dedicada (deck.gl / WebGL) | 6. Sin plano urbano |
|---|---|---|---|---|---|---|
| **Licencia para SaaS comercial** | ✅ ODbL, auto-hospedaje recomendado por el proyecto | ❌ **Excluyente**: los 4 candidatos prohíben comercial en gratis | ⚠️ Permitido, pero con cláusula vehicular y de *service bureau* | ✅ Permitido | ✅ deck.gl es MIT; no es un proveedor | ✅ Sin terceros |
| **Costo a 20 couriers** | **USD 0** | USD 20–250/mes según proveedor | USD 0 (2.640 cargas < 50.000 gratis) | USD 0 (2.640 < 10.000 gratis) | USD 0 | USD 0 |
| **Costo a 500 couriers** | **USD 0** | USD 80–250/mes | ~USD 80/mes | ~USD 392/mes | USD 0 | USD 0 |
| **Cartografía de Santiago** | OSM: buena y actual en la RM | OSM (mismo dato) o propietaria | Propietaria, muy pulida | La mejor reconocibilidad | n/a (va encima) | ninguna |
| **Etiquetas y glifos** | ⚠️ Hay que publicarlos — **es el trabajo real** | ✅ Vienen en el estilo | ✅ | ✅ | n/a | ❌ |
| **Control del estilo** | ✅ Total (importa: viene un rediseño visual) | ⚠️ Según el editor del proveedor | ⚠️ Studio, bueno pero suyo | ❌ Muy limitado | ✅ Total | ✅ Total |
| **Rendimiento a 600+ puntos** | ✅ Ya resuelto: van por GeoJSON/WebGL | ✅ Igual | ✅ | ⚠️ Peor con muchos marcadores | ✅ Es su especialidad | ✅ |
| **Local y sin cuenta** | ✅ Sin API key en desarrollo | ❌ Key obligatoria a diario | ❌ Key | ❌ Key + tarjeta | ✅ | ✅ |
| **Modo de degradación** | ✅ Ya existe: zonas sobre Papel | ⚠️ Depende del proveedor | ⚠️ | ⚠️ | n/a | es el modo mismo |
| **Riesgo de proveedor** | ✅ Ninguno: el archivo es tuyo | ❌ Alto (precios, cierre del tier) | ⚠️ Medio-alto | ⚠️ Medio | ✅ Ninguno | ✅ Ninguno |
| **Esfuerzo de migración** | **Nulo** (ya está construido) | Medio | Medio | Alto | Bajo (aditivo) | Nulo (ya es el fallback) |

Sobre el costo: **a la escala real de hoy, el costo no discrimina** — Mapbox y
Google también saldrían gratis a 20 couriers. Lo que discrimina es licencia,
control de estilo y fricción diaria de desarrollo. Y ahí gana lo que ya existe.

**La opción 6 (sin plano urbano) queda descartada por una respuesta de producto**,
no por gusto: el usuario quiere hacer zoom hasta el punto de entrega y leer su
dirección. Una dirección sobre un fondo liso, sin la calle debajo, no ubica a
nadie.

**La opción 5 no compite con la 1: se suma.** No sustituye al basemap; resuelve
dibujar miles de puntos fuera del DOM. Y la medición dice que hoy **no hace
falta**: los pedidos ya van por WebGL vía la fuente GeoJSON de MapLibre, que
aguanta el volumen. Queda como carta guardada para si aparece un caso que
MapLibre no cubra (miles de puntos con animación por punto).

---

## 5. Recomendación

**Opción 1: quedarse con MapLibre 5.24 + PMTiles auto-hospedado, y re-estilar.**
Costo por carga: cero. Migración: ninguna. Riesgo de proveedor: ninguno. Y
resuelve lo que el usuario pidió, porque lo que falta no es el motor: son las
etiquetas y el estilo.

### Plan de trabajo (en la pasada de implementación, no ahora)

1. **Publicar glifos.** Extraer los PBF de fuente y publicarlos junto al basemap;
   añadir `glyphs` al estilo. Es el desbloqueo de todo lo demás. *(~medio día)*
2. **Encender etiquetas** en tres niveles jerárquicos: comuna (siempre), ejes
   principales (zoom medio), calle local (zoom alto, que es cuando se lee la
   dirección de un pedido). *(~1 día)*
3. **Rehacer el basemap con jerarquía vial.** Hoy los ejes van todos en el mismo
   gris tenue; separar autopista / troncal / local es la mitad de lo que hace que
   un plano se vea «fino» al estilo Uber/Rappi. Requiere re-recortar con más
   capas OSM: el pipeline de `scripts/mapa/` ya lo hace. *(~1 día)*
4. **Dos temas de mapa, claro y oscuro**, siguiendo el tema del sistema. Es un
   segundo objeto de estilo sobre las mismas tiles — no duplica el basemap.
   *(~1 día)*
5. **Regla dura de rendimiento:** los pedidos y todo lo que escale con el volumen
   se quedan en fuentes GeoJSON/WebGL. La capa HTML es solo para las ~32 placas
   de comuna y los conductores. Si alguna vez se cruza, cachear las medidas antes
   de tocar nada más.

### Costo total

USD 0/mes de cartografía, a cualquier escala. El único costo es el
almacenamiento del PMTiles en Supabase Storage (~19 MB) y el ancho de banda de
los rangos HTTP, que ya se está pagando.

---

## 6. Qué se retira, y qué NO

**No se retira nada de cartografía**, porque no se cambia de camino:
`scripts/mapa/`, el bucket `contexto-mapas`, el artefacto de 19 MB en
`.artefactos/` y `public/mapas/comunas-rm.topojson.json` **se conservan** — y
pasan de ser infraestructura tolerada a ser la decisión.

Lo que sí cae, por la decisión de producto de apagar clima y aire:

- La **atribución de OpenWeather** del pie del mapa (`ATRIBUCIONES` en
  `_lib/mapa/config.ts`). Se puede quitar **solo** cuando no quede ningún dato de
  OpenWeather en el producto — no antes.
- Las capas de **clima** y **aire** del estilo y sus fuentes GeoJSON
  (`IDS_FUENTES.clima`, `IDS_FUENTES.aire`), las etiquetas HTML de lluvia y las
  tramas asociadas.

Se **conservan por licencia**, no por gusto: `© OpenStreetMap` y
`Límites DPA 2023 · SUBDERE/INE`. La primera la exige la ODbL para cualquier obra
derivada; quitarla es incumplir.

### Detalle menor, detectado de paso

`_lib/mapa/config.ts` cita `scripts/mapa/publicar-cartografia.mjs`, pero el
archivo real se llama **`publicar-basemap.mjs`**. Corregirlo al tocar ese archivo
en la pasada de implementación (no se toca ahora: el archivo está bajo
`(consola)/`, congelado en esta sesión).

---

## 7. Lo que este documento NO decide

- El lenguaje visual del mapa (paleta, tipografía, densidad de etiquetas). Eso es
  de la sesión de rediseño visual. Este documento solo garantiza que la
  herramienta elegida **puede acompañar** cualquier decisión que se tome ahí:
  control de estilo total es precisamente la ventaja de la opción 1.
- Si en el futuro aparece un caso de miles de puntos animados, **reabrir la
  opción 5** (deck.gl como capa encima). No exige cambiar de basemap ni de motor.
