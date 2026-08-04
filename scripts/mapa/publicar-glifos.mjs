#!/usr/bin/env node
// =============================================================================
// Publica los glifos de Noto Sans al bucket público `contexto-mapas`.
//
// POR QUÉ ESTO EXISTE Y ES TAN CORTO. La estimación original marcaba el pipeline
// de glifos como el riesgo del mapa v2: generar PBF desde un `.ttf` pide
// `fontnik`, que pide `node-gyp`, que pide toolchain nativa. La espiga de la
// Vía B lo descartó — el build público de Protomaps ya publica los PBF, así que
// esto **descarga cuatro archivos y los sube**. No hay nada que compilar.
//
// POR QUÉ NOTO SANS Y NO INTER, que es la fuente de la interfaz: no existen
// glifos PBF publicados de Inter, y generarlos exigiría justamente el pipeline
// nativo que se evitó. A tamaño de mapa (9–14 px) la diferencia es
// imperceptible. Es costo/beneficio, no preferencia.
//
// POR QUÉ VIAJA EL `OFL.txt`. Noto Sans se distribuye bajo la SIL Open Font
// License, que exige conservar el aviso de licencia **junto a** los archivos de
// fuente. No es cortesía: es condición de uso.
//
// Convención de path, la misma del basemap y por la misma razón — la versión va
// en el path para que republicar no invalide la caché de nadie a mitad de sesión:
//   glifos/<version>/<fontstack>/<rango>.pbf
//
// MapLibre pide `{glyphs}/{fontstack}/{range}.pbf` y **codifica el fontstack**,
// así que «Noto Sans Regular» viaja como `Noto%20Sans%20Regular`. Por eso acá se
// codifica segmento a segmento y no la ruta entera: `encodeURIComponent` sobre
// todo se comería las barras y Storage crearía un solo objeto con un nombre
// larguísimo en vez de la jerarquía.
//
// Uso:
//   node --env-file=.env.local scripts/mapa/publicar-glifos.mjs [--version AAAAMMDD]
//
// Requiere en el entorno (ya presentes en .env.local):
//   NEXT_PUBLIC_SUPABASE_URL · SUPABASE_SERVICE_ROLE_KEY
// =============================================================================
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";

const BUCKET = "contexto-mapas";
const DESTINO_LOCAL = resolve(".artefactos/mapa/glifos");

/** Origen: el build público de assets de Protomaps. */
const ORIGEN = "https://raw.githubusercontent.com/protomaps/basemaps-assets/main/fonts";

/**
 * Los cuatro archivos, y ni uno más.
 *
 * Dos pesos porque el estilo los usa como jerarquía —`Medium` para lugar y
 * comuna, `Regular` para vías— y dos rangos porque `0-255` cubre el español
 * completo y `256-511` el latín extendido. Los rangos siguientes son alfabetos
 * que este mapa no dibuja: descargarlos sería peso muerto en el bucket.
 */
const FUENTES = ["Noto Sans Regular", "Noto Sans Medium"];
const RANGOS = ["0-255", "256-511"];

function argumento(nombre, porDefecto) {
  const i = process.argv.indexOf(`--${nombre}`);
  return i >= 0 && process.argv[i + 1] ? process.argv[i + 1] : porDefecto;
}

/** Codifica cada segmento por separado: las barras tienen que sobrevivir. */
function rutaCodificada(ruta) {
  return ruta.split("/").map(encodeURIComponent).join("/");
}

/**
 * Devuelve el contenido del archivo, descargándolo solo si no está en disco.
 *
 * Se cachea en `.artefactos/` porque republicar es una operación que se repite
 * (una versión nueva por cada cambio de basemap) y bajar lo mismo cada vez es
 * tiempo regalado. `.artefactos/` está fuera del repo.
 */
async function obtener(relativa) {
  const local = resolve(DESTINO_LOCAL, relativa);
  try {
    return await readFile(local);
  } catch {
    // No estaba: se baja y se deja cacheado.
  }

  const url = `${ORIGEN}/${rutaCodificada(relativa)}`;
  console.log(`· Descargando ${relativa}…`);
  const respuesta = await fetch(url);
  if (!respuesta.ok) {
    throw new Error(`No se pudo descargar ${relativa} (HTTP ${respuesta.status}) desde ${url}`);
  }

  const contenido = Buffer.from(await respuesta.arrayBuffer());
  await mkdir(dirname(local), { recursive: true });
  await writeFile(local, contenido);
  return contenido;
}

async function subir({ url, clave, ruta, contenido, tipo }) {
  const respuesta = await fetch(
    `${url}/storage/v1/object/${BUCKET}/${rutaCodificada(ruta)}`,
    {
      method: "POST",
      headers: {
        authorization: `Bearer ${clave}`,
        "content-type": tipo,
        // Inmutable: el path lleva la versión, así que este objeto no cambia
        // nunca. Una versión nueva es un path nuevo.
        "cache-control": "public, max-age=31536000, immutable",
        "x-upsert": "true",
      },
      body: contenido,
    },
  );

  if (!respuesta.ok) {
    throw new Error(`Falló la subida de ${ruta} (HTTP ${respuesta.status}): ${await respuesta.text()}`);
  }
}

async function main() {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const clave = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !clave) {
    throw new Error(
      "Faltan NEXT_PUBLIC_SUPABASE_URL y/o SUPABASE_SERVICE_ROLE_KEY en el entorno. " +
        "Corre con: node --env-file=.env.local scripts/mapa/publicar-glifos.mjs",
    );
  }

  const version = argumento("version", new Date().toISOString().slice(0, 10).replaceAll("-", ""));

  const archivos = [];
  for (const fuente of FUENTES) {
    for (const rango of RANGOS) {
      archivos.push({ relativa: `${fuente}/${rango}.pbf`, tipo: "application/x-protobuf" });
    }
  }
  // La licencia viaja con las fuentes, no aparte.
  archivos.push({ relativa: "OFL.txt", tipo: "text/plain; charset=utf-8" });

  let total = 0;
  for (const archivo of archivos) {
    const contenido = await obtener(archivo.relativa);
    total += contenido.byteLength;
    const ruta = `glifos/${version}/${archivo.relativa}`;
    await subir({ url, clave, ruta, contenido, tipo: archivo.tipo });
    console.log(`  ✓ ${ruta} (${(contenido.byteLength / 1024).toFixed(0)} KB)`);
  }

  const base = `${url}/storage/v1/object/public/${BUCKET}/glifos/${version}`;
  console.log(`✓ Publicados ${archivos.length} archivos, ${(total / 1024).toFixed(0)} KB en total.`);
  console.log("  Apunta el frontend con esta variable de entorno:");
  console.log(`  NEXT_PUBLIC_MAPA_GLIFOS_URL=${base}`);
}

main().catch((error) => {
  console.error(`✗ ${error.message}`);
  process.exit(1);
});
