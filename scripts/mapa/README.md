# Cartografía de la Torre de control

Tres activos, con ciclos de vida distintos. No se tratan igual porque no cambian igual.

| Activo | Peso | Dónde vive | Cada cuánto cambia |
| --- | --- | --- | --- |
| Geometría comunal DPA 2023 | 113 KB | `public/mapas/comunas-rm.topojson.json`, **versionado** | Cuando la SUBDERE publica una DPA nueva (años) |
| Basemap PMTiles de la RM | ~19 MB | Bucket público `contexto-mapas`, **fuera del repo** | Cuando se quiera OSM más fresco |
| Glifos de Noto Sans (PBF) | ~406 KB | Bucket público `contexto-mapas`, **fuera del repo** | Casi nunca: solo si el estilo pide otro peso |

El módulo funciona sin el basemap: pinta las comunas sobre el color de tierra, sin el
plano urbano debajo. Sin la geometría comunal, en cambio, no hay mapa — por eso esa sí
se versiona. Y sin glifos el plano queda **mudo**: MapLibre descarta la capa `symbol`
entera, así que no se dibuja ni un nombre de calle ni la cifra de una burbuja.

---

## Basemap (automatizado)

```bash
node scripts/mapa/construir-basemap.mjs
```

Descarga el CLI `pmtiles` a `.artefactos/mapa/` y recorta el bbox de la RM del build
público de Protomaps pidiendo solo los rangos HTTP que necesita: ~20 MB transferidos
de un archivo de ~120 GB. Tarda menos de un minuto.

```bash
node scripts/mapa/publicar-basemap.mjs
```

Lo sube a `contexto-mapas/basemap/<version>/rm.pmtiles` con `SUPABASE_SERVICE_ROLE_KEY`
e imprime la URL que hay que poner en `NEXT_PUBLIC_MAPA_BASEMAP_URL`.

**Por qué no Planetiler.** Construir el basemap desde un `.osm.pbf` pide Java;
`tippecanoe` pide Go; `ogr2ogr` pide GDAL. Este entorno no tiene ninguno de los tres.
`pmtiles extract` evita el problema entero: el planeta ya está teselado y publicado, y
el formato PMTiles permite extraer un bbox por rangos.

---

## Glifos (automatizado)

```bash
node --env-file=.env.local scripts/mapa/publicar-glifos.mjs
```

Descarga los cuatro PBF de `protomaps/basemaps-assets` —Noto Sans Regular y Medium,
rangos `0-255` (español completo) y `256-511` (latín extendido)— junto con el `OFL.txt`,
los cachea en `.artefactos/mapa/glifos/` y los sube a `contexto-mapas/glifos/<version>/`.
Imprime la URL que va en `NEXT_PUBLIC_MAPA_GLIFOS_URL`.

**No hay pipeline que construir, y esa fue la sorpresa buena de la Vía B.** La
estimación original marcaba los glifos como el riesgo del mapa v2, porque generar PBF
desde un `.ttf` pide `fontnik` → `node-gyp` → toolchain nativa. El build público de
Protomaps ya los publica: son cuatro descargas y una subida.

**Por qué Noto Sans y no Inter**, que es la fuente de la interfaz: no existen glifos PBF
publicados de Inter, y generarlos exigiría justamente ese pipeline. A tamaño de mapa
(9–14 px) la diferencia en una etiqueta de calle es imperceptible.

**El `OFL.txt` no es opcional.** La SIL Open Font License exige que el aviso viaje junto
a los archivos de fuente, así que se sube al mismo directorio.

---

## Geometría comunal DPA 2023 (manual, rara vez)

No hay script porque el origen pesa 250 MB en `.rar`, se descarga una vez cada varios
años y automatizarlo costaría más de lo que ahorra. El procedimiento completo:

1. Descargar la DPA vigente de la SUBDERE:
   <https://ide.subdere.gov.cl/descargas/SHP/Limite_DPA_03082023.rar>
2. Extraer solo `DPA_2023/COMUNAS/` (el `.shp` son 108 MB; el resto del `.rar` es
   documentación y las capas de provincias y regiones, que no se usan).
3. Filtrar la Región Metropolitana, simplificar y exportar:

```bash
npx mapshaper -i DPA_2023/COMUNAS/COMUNAS_v1.shp encoding=utf8 \
  -filter "CUT_REG === '13'" \
  -filter-fields COMUNA,CUT_COM \
  -rename-fields comuna=COMUNA,cut=CUT_COM \
  -simplify visvalingam weighted 15% keep-shapes \
  -clean \
  -rename-layers comunas \
  -o public/mapas/comunas-rm.topojson.json format=topojson quantization=1e5
```

### Lo que no se puede cambiar sin romper el mapa

- **Comunal, nunca disuelto por zona.** Cada courier agrupa sus comunas distinto; la
  disolución comuna→zona la hace el cliente con `topojson-client.merge()`. Un TopoJSON
  pre-disuelto congelaría la agrupación de un tenant para todos los demás.
- **La capa se llama `comunas`** y cada feature lleva `comuna` y `cut`. Lo lee
  `_lib/mapa/config.ts` (`CAPA_TOPOJSON`) y `_lib/mapa/geometria.ts`.
- **Los 52 nombres tienen que cuadrar con `src/lib/ui/comunas-rm.ts`.** Cuadran hoy,
  nombre a nombre y con acentos. El emparejamiento normaliza acentos y caja, pero no
  resuelve sinónimos: si la DPA renombrara una comuna, la zona que la contenga
  perdería esa pieza de geometría en silencio.
- **`15%` es el punto elegido**, no un valor arbitrario: 113 KB contra un presupuesto
  de 200 KB, y conserva la forma de las comunas urbanas pequeñas. Al 4 % ya se notan
  los cortes rectos en Providencia y Ñuñoa.

El sistema de referencia del origen es SIRGAS-Chile en grados, equivalente a WGS84
para este uso, así que **no hay reproyección** — mapshaper lo confirma reportando
`+proj=longlat +ellps=GRS80`.
