# Cartografía de la Torre de control

Dos activos, con ciclos de vida opuestos. No se tratan igual porque no cambian igual.

| Activo | Peso | Dónde vive | Cada cuánto cambia |
| --- | --- | --- | --- |
| Geometría comunal DPA 2023 | 113 KB | `public/mapas/comunas-rm.topojson.json`, **versionado** | Cuando la SUBDERE publica una DPA nueva (años) |
| Basemap PMTiles de la RM | ~19 MB | Bucket público `contexto-mapas`, **fuera del repo** | Cuando se quiera OSM más fresco |

El módulo funciona sin el basemap: pinta las zonas sobre Papel, sin el plano urbano
debajo. Sin la geometría comunal, en cambio, no hay mapa — por eso esa sí se versiona.

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
