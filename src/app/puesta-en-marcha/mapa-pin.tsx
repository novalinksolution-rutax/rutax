"use client";

/**
 * Mapa con un pin arrastrable para ubicar la bodega (paso 2, §3.5).
 * =============================================================================
 * Reusa el estilo y la cartografía de la Torre (MapLibre 5.24.0 + PMTiles
 * autohospedado): `construirEstiloBase` con el basemap y los glifos del entorno.
 * Sin basemap el mapa degrada a fondo liso: el pin sigue funcionando, pero se
 * confirma a ciegas (H10) — por eso hay que publicar el basemap antes de lanzar.
 *
 * Minas heredadas de `torre-de-control/_componentes/mapa.tsx`:
 *   · maplibre-gl NO sube a 6.x.
 *   · `maplibre-gl.css` va sin capa y le gana a Tailwind: el marcador se
 *     dibuja con estilos EN LÍNEA, no con utilidades.
 *   · El protocolo `pmtiles://` se registra una sola vez por documento.
 */

import { useEffect, useRef } from "react";
import maplibregl from "maplibre-gl";
import { Protocol } from "pmtiles";
import { useTheme } from "next-themes";
import "maplibre-gl/dist/maplibre-gl.css";
import { urlBasemap, urlGlifos } from "@/app/(tenant)/torre-de-control/_lib/mapa/config";
import { construirEstiloBase } from "@/app/(tenant)/torre-de-control/_lib/mapa/estilo";
import { ENCUADRE_RM } from "@/app/(tenant)/torre-de-control/_lib/mapa/paleta";

let protocoloRegistrado = false;
function registrarProtocolo() {
  if (protocoloRegistrado) return;
  maplibregl.addProtocol("pmtiles", new Protocol().tile);
  protocoloRegistrado = true;
}

export interface PuntoMapa {
  lat: number;
  long: number;
}

export function MapaPin({
  punto,
  onMover,
  etiqueta,
  altura,
}: {
  punto: PuntoMapa | null;
  /** El usuario tocó el mapa o arrastró el pin. */
  onMover: (p: PuntoMapa) => void;
  etiqueta: string;
  altura: number;
}) {
  const { resolvedTheme } = useTheme();
  const tema = resolvedTheme === "dark" ? "oscuro" : "claro";
  const contenedor = useRef<HTMLDivElement>(null);
  const mapa = useRef<maplibregl.Map | null>(null);
  const marcador = useRef<maplibregl.Marker | null>(null);
  const alMover = useRef(onMover);
  const ultimoPunto = useRef<PuntoMapa | null>(punto);
  useEffect(() => {
    alMover.current = onMover;
  });

  function reducido() {
    return typeof window !== "undefined" && window.matchMedia("(prefers-reduced-motion: reduce)").matches;
  }

  function asegurarMarcador(m: maplibregl.Map, p: PuntoMapa) {
    if (!marcador.current) {
      const el = document.createElement("div");
      el.setAttribute("aria-hidden", "true");
      el.style.cssText =
        "width:22px;height:22px;border-radius:50%;background:var(--primary);" +
        "border:3px solid var(--background);box-shadow:0 0 0 1px var(--foreground);cursor:grab;";
      const mk = new maplibregl.Marker({ element: el, draggable: true, anchor: "center" })
        .setLngLat([p.long, p.lat])
        .addTo(m);
      mk.on("dragend", () => {
        const ll = mk.getLngLat();
        const nuevo = { lat: ll.lat, long: ll.lng };
        ultimoPunto.current = nuevo;
        alMover.current(nuevo);
      });
      marcador.current = mk;
    } else {
      marcador.current.setLngLat([p.long, p.lat]);
    }
  }

  // Creación del mapa (se rehace al cambiar el tema: el estilo depende de él).
  useEffect(() => {
    if (!contenedor.current) return;
    registrarProtocolo();
    const m = new maplibregl.Map({
      container: contenedor.current,
      style: construirEstiloBase({ tema, urlBasemap: urlBasemap(), urlGlifos: urlGlifos() }),
      center: ultimoPunto.current ? [ultimoPunto.current.long, ultimoPunto.current.lat] : ENCUADRE_RM.centro,
      zoom: ultimoPunto.current ? 16 : 9.6,
      minZoom: ENCUADRE_RM.zoomMinimo,
      maxZoom: 18,
      maxBounds: ENCUADRE_RM.limites,
      attributionControl: false,
      dragRotate: false,
      pitchWithRotate: false,
    });
    m.touchZoomRotate.disableRotation();
    m.touchPitch.disable();
    m.addControl(new maplibregl.NavigationControl({ showCompass: false }), "top-right");
    m.on("click", (e) => {
      const nuevo = { lat: e.lngLat.lat, long: e.lngLat.lng };
      ultimoPunto.current = nuevo;
      alMover.current(nuevo);
    });
    mapa.current = m;
    marcador.current = null;
    if (ultimoPunto.current) asegurarMarcador(m, ultimoPunto.current);
    return () => {
      marcador.current?.remove();
      marcador.current = null;
      m.remove();
      mapa.current = null;
    };
  }, [tema]);

  // El punto cambió desde afuera (geocoding o clic): mover marcador y cámara.
  useEffect(() => {
    ultimoPunto.current = punto;
    const m = mapa.current;
    if (!m || !punto) return;
    asegurarMarcador(m, punto);
    const centro = m.getCenter();
    const lejos = Math.abs(centro.lat - punto.lat) > 0.0005 || Math.abs(centro.lng - punto.long) > 0.0005;
    if (!lejos) return;
    const destino = { center: [punto.long, punto.lat] as [number, number], zoom: Math.max(m.getZoom(), 16) };
    if (reducido()) m.jumpTo(destino);
    else m.flyTo({ ...destino, duration: 280, essential: true });
  }, [punto]);

  return (
    <div
      ref={contenedor}
      role="application"
      aria-label={etiqueta}
      className="w-full overflow-hidden rounded-md border border-line"
      style={{ height: altura }}
    />
  );
}
