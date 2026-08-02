#!/usr/bin/env node
// =============================================================================
// Recorta el basemap de la Región Metropolitana desde el build público de
// Protomaps y lo deja en `.artefactos/mapa/rm.pmtiles`.
//
// POR QUÉ ESTE CAMINO Y NO PLANETILER. Construir el basemap desde un .osm.pbf
// con Planetiler exige Java, y tippecanoe/ogr2ogr exigen Go y GDAL. Este repo
// no tiene ninguno de los tres. `pmtiles extract` resuelve el problema por otro
// lado: el planeta ya está teselado y publicado como un único PMTiles, y el
// formato permite pedir por RANGO HTTP solo los tiles del bbox — se descargan
// ~20 MB de un archivo de ~120 GB, sin clonar nada.
//
// El resultado NO se versiona (pesa ~20 MB): se publica al bucket público
// `contexto-mapas` con `scripts/mapa/publicar-basemap.mjs`.
//
// Uso:
//   node scripts/mapa/construir-basemap.mjs [--fecha AAAAMMDD] [--zoom 13]
//
// La geometría comunal DPA 2023 NO se genera aquí: es un activo versionado que
// cambia una vez cada varios años. Ver `scripts/mapa/README.md`.
// =============================================================================
import { createWriteStream } from "node:fs";
import { mkdir, rm, stat, chmod } from "node:fs/promises";
import { Readable } from "node:stream";
import { pipeline } from "node:stream/promises";
import { spawn } from "node:child_process";
import { join, resolve } from "node:path";
import { execFileSync } from "node:child_process";

// Bbox de la Región Metropolitana con holgura. Deliberadamente MÁS ANCHO que
// el Santiago urbano: hay couriers que reparten en Melipilla, Colina o Paine, y
// un basemap recortado al Gran Santiago les dejaría la zona en blanco.
const BBOX = "-71.75,-34.35,-69.75,-32.90";
const VERSION_CLI = "1.31.2";
const DIRECTORIO = resolve(".artefactos/mapa");

function argumento(nombre, porDefecto) {
  const i = process.argv.indexOf(`--${nombre}`);
  return i >= 0 && process.argv[i + 1] ? process.argv[i + 1] : porDefecto;
}

/** AAAAMMDD de ayer en UTC: el build del día en curso puede no estar aún. */
function fechaPorDefecto() {
  const d = new Date(Date.now() - 24 * 60 * 60 * 1000);
  return d.toISOString().slice(0, 10).replaceAll("-", "");
}

function plataforma() {
  if (process.platform === "win32") {
    return { archivo: `go-pmtiles_${VERSION_CLI}_Windows_x86_64.zip`, binario: "pmtiles.exe" };
  }
  if (process.platform === "darwin") {
    const arco = process.arch === "arm64" ? "arm64" : "x86_64";
    return { archivo: `go-pmtiles-${VERSION_CLI}_Darwin_${arco}.zip`, binario: "pmtiles" };
  }
  return { archivo: `go-pmtiles_${VERSION_CLI}_Linux_x86_64.zip`, binario: "pmtiles" };
}

async function existe(ruta) {
  try {
    await stat(ruta);
    return true;
  } catch {
    return false;
  }
}

async function descargar(url, destino) {
  const respuesta = await fetch(url);
  if (!respuesta.ok || !respuesta.body) {
    throw new Error(`No se pudo descargar ${url} (HTTP ${respuesta.status})`);
  }
  await pipeline(Readable.fromWeb(respuesta.body), createWriteStream(destino));
}

/** Descomprime un .zip con las herramientas que ya trae cada sistema. */
function descomprimir(zip, directorio) {
  if (process.platform === "win32") {
    // `tar` de Windows 10+ lee zip. Evita depender de 7-Zip o de PowerShell.
    execFileSync("tar", ["-xf", zip, "-C", directorio], { stdio: "inherit" });
  } else {
    execFileSync("unzip", ["-o", "-q", zip, "-d", directorio], { stdio: "inherit" });
  }
}

async function main() {
  const fecha = argumento("fecha", fechaPorDefecto());
  const zoom = argumento("zoom", "13");
  const { archivo, binario } = plataforma();
  const rutaBinario = join(DIRECTORIO, binario);
  const salida = join(DIRECTORIO, "rm.pmtiles");

  await mkdir(DIRECTORIO, { recursive: true });

  if (!(await existe(rutaBinario))) {
    const url = `https://github.com/protomaps/go-pmtiles/releases/download/v${VERSION_CLI}/${archivo}`;
    console.log(`· Descargando el CLI pmtiles ${VERSION_CLI}…`);
    const zip = join(DIRECTORIO, archivo);
    await descargar(url, zip);
    descomprimir(zip, DIRECTORIO);
    await rm(zip, { force: true });
    if (process.platform !== "win32") await chmod(rutaBinario, 0o755);
  }

  const origen = `https://build.protomaps.com/${fecha}.pmtiles`;
  console.log(`· Recortando la RM desde ${origen} (zoom máx ${zoom})…`);
  await rm(salida, { force: true });

  await new Promise((cumplir, rechazar) => {
    const proceso = spawn(
      rutaBinario,
      ["extract", origen, salida, `--bbox=${BBOX}`, `--maxzoom=${zoom}`],
      { stdio: "inherit" },
    );
    proceso.on("error", rechazar);
    proceso.on("close", (codigo) =>
      codigo === 0 ? cumplir() : rechazar(new Error(`pmtiles extract salió con código ${codigo}`)),
    );
  });

  const { size } = await stat(salida);
  console.log(`✓ ${salida} — ${(size / 1024 / 1024).toFixed(1)} MB`);
  console.log("  Publícalo con: node scripts/mapa/publicar-basemap.mjs");
}

main().catch((error) => {
  console.error(`✗ ${error.message}`);
  process.exit(1);
});
