#!/usr/bin/env node
// =============================================================================
// Sube el basemap recortado al bucket público `contexto-mapas`.
//
// El bucket es PÚBLICO solo de LECTURA: no hay políticas sobre
// `storage.objects`, así que la escritura exige `SUPABASE_SERVICE_ROLE_KEY`.
// Ese es el motivo de que esto sea un script de operador y no un job.
//
// Convención de path (la fija la migración 20260725000001):
//   basemap/<version>/rm.pmtiles
// La versión va en el path para que publicar OSM más fresco no invalide la
// caché del CDN a mitad de una sesión de nadie: se sube una versión nueva, se
// cambia la variable de entorno, y la anterior sigue sirviendo hasta que se
// borre a mano.
//
// Uso:
//   node scripts/mapa/publicar-basemap.mjs [--version AAAAMMDD]
//
// Requiere en el entorno (ya presentes en .env.local):
//   NEXT_PUBLIC_SUPABASE_URL · SUPABASE_SERVICE_ROLE_KEY
// =============================================================================
import { readFile, stat } from "node:fs/promises";
import { resolve } from "node:path";

const BUCKET = "contexto-mapas";
const ARCHIVO = resolve(".artefactos/mapa/rm.pmtiles");

function argumento(nombre, porDefecto) {
  const i = process.argv.indexOf(`--${nombre}`);
  return i >= 0 && process.argv[i + 1] ? process.argv[i + 1] : porDefecto;
}

async function main() {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const clave = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !clave) {
    throw new Error(
      "Faltan NEXT_PUBLIC_SUPABASE_URL y/o SUPABASE_SERVICE_ROLE_KEY en el entorno.",
    );
  }

  await stat(ARCHIVO).catch(() => {
    throw new Error(`No existe ${ARCHIVO}. Corre antes: node scripts/mapa/construir-basemap.mjs`);
  });

  const version = argumento("version", new Date().toISOString().slice(0, 10).replaceAll("-", ""));
  const ruta = `basemap/${version}/rm.pmtiles`;
  const contenido = await readFile(ARCHIVO);

  console.log(`· Subiendo ${(contenido.byteLength / 1024 / 1024).toFixed(1)} MB a ${BUCKET}/${ruta}…`);
  const respuesta = await fetch(`${url}/storage/v1/object/${BUCKET}/${ruta}`, {
    method: "POST",
    headers: {
      authorization: `Bearer ${clave}`,
      "content-type": "application/octet-stream",
      "cache-control": "public, max-age=31536000, immutable",
      "x-upsert": "true",
    },
    body: contenido,
  });

  if (!respuesta.ok) {
    throw new Error(`Falló la subida (HTTP ${respuesta.status}): ${await respuesta.text()}`);
  }

  const publica = `${url}/storage/v1/object/public/${BUCKET}/${ruta}`;
  console.log("✓ Publicado.");
  console.log("  Apunta el frontend con esta variable de entorno:");
  console.log(`  NEXT_PUBLIC_MAPA_BASEMAP_URL=${publica}`);
}

main().catch((error) => {
  console.error(`✗ ${error.message}`);
  process.exit(1);
});
