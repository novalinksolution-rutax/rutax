"use client";

/**
 * Mapa de la Región Metropolitana con las comunas coloreadas por zona (paso 4, §3.7).
 * =============================================================================
 * Reusa la cartografía de la Torre: el mismo estilo base (MapLibre 5.24.0 +
 * PMTiles autohospedado), la misma geometría comunal DPA 2023 y la paleta
 * `paletaDe` — sin un solo color nuevo. Sin basemap publicado el mapa degrada a
 * las comunas sobre el color de tierra, y es un estado válido.
 *
 * El color de la zona vive en `feature-state`, no en los datos: pintar una comuna
 * es un `setFeatureState`, no volver a teselar 52 polígonos. El color nunca es el
 * único canal: la pestaña Lista lleva el mismo contenido en texto.
 *
 * Minas heredadas (ver `mapa-pin.tsx` y la Torre): maplibre-gl NO sube a 6.x; el
 * CSS de maplibre va sin capa y le gana a Tailwind, así que cualquier nodo que
 * MapLibre marque se posiciona en línea; `pmtiles://` se registra una vez.
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
import type { NumeroZona } from "./zonas-tarifas";

let protocoloRegistrado = false;
function registrarProtocolo() {
  if (protocoloRegistrado) return;
  maplibregl.addProtocol("pmtiles", new Protocol().tile);
  protocoloRegistrado = true;
}

const FUENTE = "zonas-comunas";
const CAPA_RELLENO = "zonas-relleno";
const CAPA_BORDE = "zonas-borde";

/** Colores de cada zona, tomados de la paleta del mapa según el tema. */
export function coloresDeZona(tema: "claro" | "oscuro"): Record<NumeroZona, string> {
  const d = paletaDe(tema).datos;
  return { 1: d.cargaComuna[2], 2: d.puntoEnRuta };
}

export function MapaZonas({
  asignacion,
  onPintar,
  onError,
  altura,
  etiqueta,
}: {
  asignacion: Readonly<Record<string, NumeroZona>>;
  /** El usuario tocó una comuna. */
  onPintar: (comuna: string) => void;
  /** La geometría no cargó: la pantalla manda a la Lista. */
  onError: () => void;
  altura: number;
  etiqueta: string;
}) {
  const { resolvedTheme } = useTheme();
  const tema = resolvedTheme === "dark" ? "oscuro" : "claro";
  const contenedor = useRef<HTMLDivElement>(null);
  const mapa = useRef<maplibregl.Map | null>(null);
  const listo = useRef(false);
  const ultimaAsignacion = useRef(asignacion);
  const alPintar = useRef(onPintar);
  const alFallar = useRef(onError);
  const [geometrias, setGeometrias] = useState<MapaGeometrias | null>(null);
  const [cargando, setCargando] = useState(true);

  useEffect(() => {
    alPintar.current = onPintar;
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

  // Creación del mapa (se rehace al cambiar el tema: el estilo depende de él).
  useEffect(() => {
    if (!contenedor.current || !geometrias) return;
    registrarProtocolo();
    const colores = coloresDeZona(tema);
    const paleta = paletaDe(tema);

    const m = new maplibregl.Map({
      container: contenedor.current,
      style: construirEstiloBase({ tema, urlBasemap: urlBasemap(), urlGlifos: urlGlifos() }),
      center: ENCUADRE_RM.centro,
      zoom: ENCUADRE_RM.zoom,
      minZoom: ENCUADRE_RM.zoomMinimo,
      maxZoom: 13,
      maxBounds: ENCUADRE_RM.limites,
      attributionControl: false,
      dragRotate: false,
      pitchWithRotate: false,
      // La rueda es del scroll de la página: el zoom va por los botones.
      scrollZoom: false,
    });
    m.touchZoomRotate.disableRotation();
    m.touchPitch.disable();
    m.addControl(new maplibregl.NavigationControl({ showCompass: false }), "top-right");
    mapa.current = m;
    listo.current = false;

    m.on("load", () => {
      m.addSource(FUENTE, {
        type: "geojson",
        promoteId: "comuna",
        data: {
          type: "FeatureCollection",
          features: [...geometrias.values()],
        },
      });
      m.addLayer({
        id: CAPA_RELLENO,
        type: "fill",
        source: FUENTE,
        paint: {
          "fill-color": [
            "match",
            ["feature-state", "zona"],
            1,
            colores[1],
            2,
            colores[2],
            "rgba(0,0,0,0)",
          ],
          "fill-opacity": 0.55,
        },
      });
      m.addLayer({
        id: CAPA_BORDE,
        type: "line",
        source: FUENTE,
        paint: { "line-color": paleta.datos.comunaBorde, "line-width": 1 },
      });
      aplicarEstados(m, ultimaAsignacion.current);
      listo.current = true;
      setCargando(false);

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
      m.fitBounds(
        [
          [oeste, sur],
          [este, norte],
        ],
        { padding: 12, duration: 0 },
      );
    });

    m.on("click", CAPA_RELLENO, (e) => {
      const comuna = e.features?.[0]?.properties?.comuna;
      if (typeof comuna === "string") alPintar.current(comuna);
    });
    m.on("mouseenter", CAPA_RELLENO, () => {
      m.getCanvas().style.cursor = "pointer";
    });
    m.on("mouseleave", CAPA_RELLENO, () => {
      m.getCanvas().style.cursor = "";
    });

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

  return (
    <div className="relative w-full" style={{ height: altura }}>
      <div
        ref={contenedor}
        role="application"
        aria-label={etiqueta}
        className="size-full overflow-hidden rounded-md border border-line"
      />
      {cargando ? <Skeleton className="absolute inset-0 rounded-md" /> : null}
    </div>
  );
}
