"use client";

/**
 * Mapa de la Región Metropolitana con las comunas coloreadas por zona (paso 4, §3.7).
 * =============================================================================
 * Reusa la cartografía de la Torre: el mismo estilo base (MapLibre 5.24.0 +
 * PMTiles autohospedado), la misma geometría comunal DPA 2023 y la paleta
 * `paletaDe` — sin un solo color nuevo. Sin basemap publicado el mapa degrada a
 * las comunas sobre el color de tierra, y es un estado válido.
 *
 * Interacción: un clic en una comuna la alterna entre Zona 1 y Zona 2 (un gesto,
 * reversible). Hover resalta el borde y nombra la comuna con su zona. El color
 * de la zona y el hover viven en `feature-state`, no en los datos: alternar es
 * un `setFeatureState`, no volver a teselar 52 polígonos.
 *
 * Rueda: el zoom por rueda queda activo. Solo actúa con el puntero encima del
 * mapa, así que es lo más natural; `cooperativeGestures` obligaría a Ctrl+rueda,
 * y el mapa es la herramienta principal de la pantalla, no un adorno embebido.
 *
 * Nombres: capa `symbol` sobre un GeoJSON de puntos (uno por comuna). Necesita
 * glifos; sin `NEXT_PUBLIC_MAPA_GLIFOS_URL` la capa no se agrega (un `text-font`
 * sin glifos hace que MapLibre descarte la capa) y el mapa sigue funcionando.
 *
 * Minas heredadas (ver `mapa-pin.tsx` y la Torre): maplibre-gl NO sube a 6.x; el
 * CSS de maplibre va sin capa y le gana a Tailwind, así que cualquier nodo que
 * MapLibre marque se posiciona en línea; `pmtiles://` se registra una vez. Lo
 * que dibujo yo por encima (leyenda, botón, nombre al pasar) son nodos de React,
 * fuera del contenedor de MapLibre, y sí llevan utilidades.
 */

import { useEffect, useRef, useState } from "react";
import maplibregl from "maplibre-gl";
import { Protocol } from "pmtiles";
import { useTheme } from "next-themes";
import "maplibre-gl/dist/maplibre-gl.css";
import { Skeleton } from "@/components/ui/skeleton";
import { urlBasemap, urlGlifos } from "@/app/(tenant)/torre-de-control/_lib/mapa/config";
import { construirEstiloBase } from "@/app/(tenant)/torre-de-control/_lib/mapa/estilo";
import { ENCUADRE_RM, paletaDe } from "@/app/(tenant)/torre-de-control/_lib/mapa/paleta";
import {
  cargarGeometriaComunal,
  limitesDe,
  type MapaGeometrias,
} from "@/app/(tenant)/torre-de-control/_lib/geometria";
import { puntoDeEtiqueta } from "./punto-de-etiqueta";
import type { NumeroZona } from "./zonas-tarifas";

let protocoloRegistrado = false;
function registrarProtocolo() {
  if (protocoloRegistrado) return;
  maplibregl.addProtocol("pmtiles", new Protocol().tile);
  protocoloRegistrado = true;
}

const FUENTE = "zonas-comunas";
const FUENTE_NOMBRES = "zonas-nombres";
const CAPA_RELLENO = "zonas-relleno";
const CAPA_BORDE = "zonas-borde";
const CAPA_BORDE_HOVER = "zonas-borde-hover";
const CAPA_NOMBRES = "zonas-nombres";
const FUENTE_TEXTO = ["Noto Sans Medium"];

/**
 * Colores de cada zona, tomados de la paleta del mapa según el tema. Se eligen
 * para que difieran también en luminosidad, no solo en tono: claro = celeste
 * pálido vs. azul profundo; oscuro = celeste vivo vs. teal profundo.
 */
export function coloresDeZona(tema: "claro" | "oscuro"): Record<NumeroZona, string> {
  const d = paletaDe(tema).datos;
  return tema === "claro"
    ? { 1: d.cargaComuna[1], 2: d.puntoEnRuta }
    : { 1: d.puntoEnRuta, 2: d.cargaComuna[1] };
}

export interface ZonaLeyenda {
  n: NumeroZona;
  nombre: string;
  cantidad: number;
}

export function MapaZonas({
  asignacion,
  leyenda,
  onAlternar,
  onError,
  altura,
  etiqueta,
}: {
  asignacion: Readonly<Record<string, NumeroZona>>;
  leyenda: readonly ZonaLeyenda[];
  /** El usuario hizo clic en una comuna. */
  onAlternar: (comuna: string) => void;
  /** La geometría no cargó: la pantalla manda a la Lista. */
  onError: () => void;
  altura: number;
  etiqueta: string;
}) {
  const { resolvedTheme } = useTheme();
  const tema = resolvedTheme === "dark" ? "oscuro" : "claro";
  const colores = coloresDeZona(tema);
  const contenedor = useRef<HTMLDivElement>(null);
  const mapa = useRef<maplibregl.Map | null>(null);
  const listo = useRef(false);
  const limites = useRef<[[number, number], [number, number]] | null>(null);
  const ultimaAsignacion = useRef(asignacion);
  const alAlternar = useRef(onAlternar);
  const alFallar = useRef(onError);
  const [geometrias, setGeometrias] = useState<MapaGeometrias | null>(null);
  const [cargando, setCargando] = useState(true);
  const [sobre, setSobre] = useState<{ comuna: string; x: number; y: number } | null>(null);

  useEffect(() => {
    alAlternar.current = onAlternar;
    alFallar.current = onError;
  });

  // Geometría comunal (113 KB, versionada en `public/`).
  useEffect(() => {
    const senal = new AbortController();
    cargarGeometriaComunal(senal.signal)
      .then((g) => setGeometrias(g))
      .catch(() => {
        if (!senal.signal.aborted) {
          setCargando(false);
          alFallar.current();
        }
      });
    return () => senal.abort();
  }, []);

  function aplicarEstados(m: maplibregl.Map, a: Readonly<Record<string, NumeroZona>>) {
    for (const [comuna, zona] of Object.entries(a)) {
      m.setFeatureState({ source: FUENTE, id: comuna }, { zona });
    }
  }

  function encuadrar(m: maplibregl.Map, duracion: number) {
    if (limites.current) m.fitBounds(limites.current, { padding: 12, duration: duracion });
  }

  // Creación del mapa (se rehace al cambiar el tema: el estilo depende de él).
  useEffect(() => {
    if (!contenedor.current || !geometrias) return;
    registrarProtocolo();
    const cols = coloresDeZona(tema);
    const paleta = paletaDe(tema);
    const glifos = urlGlifos();
    const sinMovimiento = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    const tactil = window.matchMedia("(pointer: coarse)").matches;

    const m = new maplibregl.Map({
      container: contenedor.current,
      style: construirEstiloBase({ tema, urlBasemap: urlBasemap(), urlGlifos: glifos }),
      center: ENCUADRE_RM.centro,
      zoom: ENCUADRE_RM.zoom,
      // NO el suelo de la Torre (8,8): ese se calculó para su caja ancha de
      // ~864×473. Esta mide ~466×440 y las 52 comunas piden z≈8,4 para caber;
      // con 8,8 el encuadre inicial y «Encuadrar» quedaban recortados (Colina,
      // Lampa, Melipilla fuera) y el botón «−» deshabilitado. `maxBounds` sigue
      // impidiendo alejarse hasta ver medio país.
      minZoom: 7.5,
      maxZoom: 13,
      maxBounds: ENCUADRE_RM.limites,
      attributionControl: false,
      dragRotate: false,
      pitchWithRotate: false,
      scrollZoom: true,
    });
    m.touchZoomRotate.disableRotation();
    m.touchPitch.disable();
    m.addControl(new maplibregl.NavigationControl({ showCompass: false }), "top-right");
    mapa.current = m;
    listo.current = false;

    // Encuadre: la unión de las 52 comunas.
    let oeste = Infinity;
    let sur = Infinity;
    let este = -Infinity;
    let norte = -Infinity;
    for (const g of geometrias.values()) {
      const [[o, s], [e, n]] = limitesDe(g);
      oeste = Math.min(oeste, o);
      sur = Math.min(sur, s);
      este = Math.max(este, e);
      norte = Math.max(norte, n);
    }
    limites.current = [
      [oeste, sur],
      [este, norte],
    ];

    let resaltada: string | null = null;
    const resaltar = (comuna: string | null) => {
      if (resaltada === comuna) return;
      if (resaltada) m.setFeatureState({ source: FUENTE, id: resaltada }, { hover: false });
      if (comuna) m.setFeatureState({ source: FUENTE, id: comuna }, { hover: true });
      resaltada = comuna;
    };

    m.on("load", () => {
      m.addSource(FUENTE, {
        type: "geojson",
        promoteId: "comuna",
        data: { type: "FeatureCollection", features: [...geometrias.values()] },
      });
      m.addLayer({
        id: CAPA_RELLENO,
        type: "fill",
        source: FUENTE,
        paint: {
          "fill-color": ["match", ["feature-state", "zona"], 1, cols[1], 2, cols[2], "rgba(0,0,0,0)"],
          "fill-color-transition": { duration: sinMovimiento ? 0 : 280, delay: 0 },
          "fill-opacity": ["case", ["boolean", ["feature-state", "hover"], false], 0.78, 0.62],
          "fill-opacity-transition": { duration: sinMovimiento ? 0 : 120, delay: 0 },
        },
      });
      m.addLayer({
        id: CAPA_BORDE,
        type: "line",
        source: FUENTE,
        paint: { "line-color": paleta.datos.comunaBordeActiva, "line-opacity": 0.45, "line-width": 0.8 },
      });
      // El borde resaltado va en su propia capa, encima: en la de arriba no lo
      // tapa el trazo de la comuna vecina.
      m.addLayer({
        id: CAPA_BORDE_HOVER,
        type: "line",
        source: FUENTE,
        paint: {
          "line-color": paleta.datos.comunaBordeActiva,
          "line-width": 2.5,
          "line-opacity": ["case", ["boolean", ["feature-state", "hover"], false], 1, 0],
          "line-opacity-transition": { duration: sinMovimiento ? 0 : 100, delay: 0 },
        },
      });

      if (glifos) {
        const puntos: GeoJSON.Feature<GeoJSON.Point, { nombre: string; area: number }>[] = [];
        for (const g of geometrias.values()) {
          const p = puntoDeEtiqueta(g.geometry);
          if (p) {
            puntos.push({
              type: "Feature",
              geometry: { type: "Point", coordinates: p.punto },
              properties: { nombre: g.properties.comuna, area: p.area },
            });
          }
        }
        m.addSource(FUENTE_NOMBRES, { type: "geojson", data: { type: "FeatureCollection", features: puntos } });
        m.addLayer({
          id: CAPA_NOMBRES,
          type: "symbol",
          source: FUENTE_NOMBRES,
          layout: {
            "symbol-placement": "point",
            "text-field": ["get", "nombre"],
            "text-font": FUENTE_TEXTO,
            "text-size": ["interpolate", ["linear"], ["zoom"], 8.8, 10, 11, 13, 13, 15],
            "text-max-width": 7,
            "text-padding": 2,
            // Las comunas grandes rotulan primero; las chicas, si hay lugar.
            "symbol-sort-key": ["-", 0, ["get", "area"]],
          },
          paint: {
            "text-color": paleta.datos.agrupacionTexto,
            "text-halo-color": paleta.datos.agrupacionRelleno,
            "text-halo-width": 1.6,
          },
        });
      }

      aplicarEstados(m, ultimaAsignacion.current);
      listo.current = true;
      setCargando(false);
      encuadrar(m, 0);
    });

    m.on("click", CAPA_RELLENO, (e) => {
      const comuna = e.features?.[0]?.properties?.comuna;
      if (typeof comuna === "string") alAlternar.current(comuna);
    });
    m.on("mousemove", CAPA_RELLENO, (e) => {
      const comuna = e.features?.[0]?.properties?.comuna;
      if (typeof comuna !== "string") return;
      m.getCanvas().style.cursor = "pointer";
      resaltar(comuna);
      if (!tactil) setSobre({ comuna, x: e.point.x, y: e.point.y });
    });
    m.on("mouseleave", CAPA_RELLENO, () => {
      m.getCanvas().style.cursor = "";
      resaltar(null);
      setSobre(null);
    });
    m.on("dragstart", () => setSobre(null));

    return () => {
      listo.current = false;
      m.remove();
      mapa.current = null;
    };
  }, [tema, geometrias]);

  // La asignación cambió: repintar sin rehacer el mapa.
  useEffect(() => {
    ultimaAsignacion.current = asignacion;
    const m = mapa.current;
    if (m && listo.current) aplicarEstados(m, asignacion);
  }, [asignacion]);

  const zonaSobre = sobre ? asignacion[sobre.comuna] : undefined;

  return (
    <div className="relative w-full" style={{ height: altura }}>
      <div
        ref={contenedor}
        role="application"
        aria-label={etiqueta}
        className="size-full overflow-hidden rounded-md border border-line"
      />
      {cargando ? <Skeleton className="absolute inset-0 rounded-md" /> : null}

      {!cargando ? (
        <>
          <button
            type="button"
            onClick={() => mapa.current && encuadrar(mapa.current, 400)}
            className="absolute top-2 left-2 h-8 rounded-[3px] border border-line bg-bg px-2.5 text-sm shadow-sm outline-none hover:bg-bg-sunken focus-visible:ring-3 focus-visible:ring-ring/50 pointer-coarse:h-11"
          >
            Encuadrar
          </button>

          <ul
            aria-label="Zonas"
            className="pointer-events-none absolute bottom-2 left-2 space-y-1 rounded-[3px] border border-line bg-bg/95 px-2.5 py-2 text-xs shadow-sm"
          >
            {leyenda.map((z) => (
              <li key={z.n} className="flex items-center gap-2">
                <span
                  aria-hidden="true"
                  className="inline-block size-3 shrink-0 rounded-[2px] border border-fg/30"
                  style={{ backgroundColor: colores[z.n] }}
                />
                <span className="max-w-40 truncate">
                  Zona {z.n} · {z.nombre}
                </span>
                <span className="tabular-nums text-fg-muted">{z.cantidad}</span>
              </li>
            ))}
          </ul>

          {sobre && zonaSobre ? (
            <div
              aria-hidden="true"
              className="pointer-events-none absolute z-10 -translate-x-1/2 -translate-y-full whitespace-nowrap rounded-[3px] border border-line bg-bg px-2 py-1 text-xs shadow-md"
              style={{ left: sobre.x, top: sobre.y - 12 }}
            >
              {sobre.comuna} · Zona {zonaSobre}
            </div>
          ) : null}
        </>
      ) : null}
    </div>
  );
}
