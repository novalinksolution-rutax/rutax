"use client";

/**
 * Mapa para marcar el punto de término del conductor — UN pin, sin capas de
 * dato, sin zoom semántico. No es una versión resumida de la Torre: es un
 * selector de coordenada, y nada más.
 * =============================================================================
 *
 * Reutiliza `construirEstiloBase` de la Torre de control (el plano + sus dos
 * temas + etiquetas) sin arrastrar el resto del módulo: nada de
 * `contrato-torre`, `derivar.ts` ni las capas de comuna/riesgo — esta pantalla
 * no dibuja dato operativo, solo el plano y un marcador.
 *
 * Comparte dos minas de `torre-de-control/_componentes/mapa.tsx`:
 *  1. `maplibre-gl` está clavado en 5.24.0 — la 6.x rompe MUDO con Turbopack
 *     (Web Worker como archivo suelto). No subir la versión.
 *  2. `maplibre-gl.css` se importa SIN capa y gana SIEMPRE al CSS en capa de
 *     Tailwind: el nodo que MapLibre marca con sus clases se posiciona con
 *     estilos EN LÍNEA, nunca con `className`.
 *
 * Y tiene una decisión propia: como aquí solo hay UN marcador (no 600
 * pedidos), se usa `maplibregl.Marker` — el ancla HTML que la Torre evita a
 * propósito por costo de frame (medido: 600 anclas cuestan 31 ms/frame). Con
 * un solo nodo el costo es cero y el API es mucho más simple que una fuente
 * GeoJSON + capa `circle` para un caso que no necesita clustering ni zoom
 * semántico.
 *
 * -----------------------------------------------------------------------------
 * DOS BOTONES QUE PARECEN LO MISMO Y NO LO SON — no fusionarlos
 * -----------------------------------------------------------------------------
 * "Mi ubicación" SOLO mueve la cámara (`flyTo`). NUNCA toca el marcador ni
 * llama a `onCambiarPin`. Si moviera el pin, un atajo de orientación se
 * convertiría en "usar mi última ubicación conocida" para definir el punto —
 * eso es lo que el documento de privacidad prohíbe explícitamente (§8, ítem
 * 13): el gesto de reconocer dónde estás parado no puede ser la forma de
 * capturar el domicilio. El conductor sigue teniendo que marcar el pin él
 * mismo, a mano, aunque sea justo donde la cámara acaba de centrar.
 *
 * "Marcar el centro del mapa" SÍ coloca el pin — es la alternativa accesible
 * al tap sobre el lienzo (el canvas de MapLibre no tiene equivalente de
 * teclado para "clic"; sus flechas SÍ desplazan la cámara, por soporte nativo
 * de MapLibre). Es un botón real, enfocable, que se activa con Enter/Espacio:
 * un conductor que no puede usar el mouse/dedo con precisión puede desplazar
 * el mapa con las flechas y confirmar con este botón. Sigue siendo un gesto
 * DELIBERADO del conductor —eligió a dónde panear—, no una inferencia desde
 * otra fuente de datos.
 */

import { useEffect, useRef, useState } from "react";
import maplibregl from "maplibre-gl";
import { Protocol } from "pmtiles";
import "maplibre-gl/dist/maplibre-gl.css";
import { LocateFixed, MapPin } from "lucide-react";

import { Button } from "@/components/ui/button";
import { Alert, AlertDescription } from "@/components/ui/alert";
// Reuso deliberado de la cartografía de la Torre — ver el docstring de arriba.
// No se duplica el estilo del plano ni se importa una sola línea de sus capas
// de dato (comunas, agrupaciones, incidencias).
import { urlBasemap, urlGlifos } from "@/app/(tenant)/torre-de-control/_lib/mapa/config";
import { construirEstiloBase } from "@/app/(tenant)/torre-de-control/_lib/mapa/estilo";
import { ENCUADRE_RM, type TemaMapa } from "@/app/(tenant)/torre-de-control/_lib/mapa/paleta";

/** El mismo `--brand` del sistema, en sus dos variantes de tema. */
const COLOR_PIN: Record<TemaMapa, string> = {
  claro: "#2a3ca0",
  oscuro: "#7080f5",
};

/** Zoom cómodo para reconocer una manzana sin perder el plano de calles. */
const ZOOM_PUNTO = 15.2;

/**
 * El protocolo `pmtiles://` se registra UNA vez por documento (es global de la
 * librería, no del mapa). Bandera propia de este archivo: la Torre registra la
 * suya en su propio módulo, y ambos módulos pueden convivir en el DOM sin
 * pisarse porque el nombre de protocolo es el mismo string.
 */
let protocoloRegistrado = false;
function registrarProtocolo() {
  if (protocoloRegistrado) return;
  maplibregl.addProtocol("pmtiles", new Protocol().tile);
  protocoloRegistrado = true;
}

export interface CoordenadaPin {
  lat: number;
  long: number;
}

export interface MapaPuntoTerminoProps {
  tema: TemaMapa;
  /**
   * El punto a mostrar al abrir el mapa: el ya guardado (para reajustarlo) o
   * `null` la primera vez. **Nunca** se rellena desde otra fuente (rastreo,
   * POD, evidencias) — ver §8 del documento de privacidad, ítem 5.
   */
  puntoInicial: CoordenadaPin | null;
  /** `false` en la pantalla "guardado": se puede mirar, no mover. */
  interactivo: boolean;
  /** Se dispara con cada posición nueva del pin (tap, arrastre o el botón de teclado). */
  onCambiarPin: (coords: CoordenadaPin) => void;
}

export function MapaPuntoTermino({
  tema,
  puntoInicial,
  interactivo,
  onCambiarPin,
}: MapaPuntoTerminoProps) {
  const contenedor = useRef<HTMLDivElement>(null);
  const mapa = useRef<maplibregl.Map | null>(null);
  const marcador = useRef<maplibregl.Marker | null>(null);
  /** Coloca o mueve el pin y notifica al padre. Registrado tras crear el mapa. */
  const colocarPinRef = useRef<(lat: number, long: number) => void>(() => undefined);
  const ultimo = useRef({ onCambiarPin, interactivo });
  useEffect(() => {
    ultimo.current = { onCambiarPin, interactivo };
  });

  const [centrando, setCentrando] = useState(false);
  const [avisoUbicacion, setAvisoUbicacion] = useState<string | null>(null);
  const sinBasemap = urlBasemap() === null;

  useEffect(() => {
    if (!contenedor.current) return;
    registrarProtocolo();

    const estilo = construirEstiloBase({
      tema,
      urlBasemap: urlBasemap(),
      urlGlifos: urlGlifos(),
    });

    const centro: [number, number] = puntoInicial
      ? [puntoInicial.long, puntoInicial.lat]
      : ENCUADRE_RM.centro;
    const zoom = puntoInicial ? ZOOM_PUNTO : ENCUADRE_RM.zoom;

    const m = new maplibregl.Map({
      container: contenedor.current,
      style: estilo,
      center: centro,
      zoom,
      minZoom: ENCUADRE_RM.zoomMinimo,
      maxZoom: ENCUADRE_RM.zoomMaximo,
      maxBounds: ENCUADRE_RM.limites,
      attributionControl: false,
      dragRotate: false,
      pitchWithRotate: false,
    });
    mapa.current = m;
    m.addControl(new maplibregl.NavigationControl({ showCompass: false }), "top-left");

    colocarPinRef.current = (lat, long) => {
      if (marcador.current) {
        marcador.current.setLngLat([long, lat]);
      } else {
        marcador.current = new maplibregl.Marker({
          color: COLOR_PIN[tema],
          draggable: interactivo,
        })
          .setLngLat([long, lat])
          .addTo(m);
        marcador.current.on("dragend", () => {
          const ll = marcador.current!.getLngLat();
          ultimo.current.onCambiarPin({ lat: ll.lat, long: ll.lng });
        });
      }
      ultimo.current.onCambiarPin({ lat, long });
    };

    // El pin inicial se dibuja pero NO se reporta como "cambio": ya es lo que
    // el padre tiene. Reportarlo aquí duplicaría el guardado inicial en el
    // estado del padre sin que el conductor haya tocado nada.
    if (puntoInicial) {
      marcador.current = new maplibregl.Marker({
        color: COLOR_PIN[tema],
        draggable: interactivo,
      })
        .setLngLat([puntoInicial.long, puntoInicial.lat])
        .addTo(m);
      marcador.current.on("dragend", () => {
        const ll = marcador.current!.getLngLat();
        ultimo.current.onCambiarPin({ lat: ll.lat, long: ll.lng });
      });
    }

    // `interactivo` no cambia dentro de un mismo montaje: el padre desmonta y
    // vuelve a montar este componente al pasar de la pantalla "guardado" a la
    // de "marcar" (son ramas distintas del JSX). Por eso es seguro leerlo acá
    // sin listarlo en las dependencias del efecto.
    if (interactivo) {
      m.on("click", (evento) => {
        colocarPinRef.current(evento.lngLat.lat, evento.lngLat.lng);
      });
    }

    const observador = new ResizeObserver(() => m.resize());
    observador.observe(contenedor.current);

    return () => {
      observador.disconnect();
      marcador.current?.remove();
      marcador.current = null;
      mapa.current = null;
      m.remove();
    };
    // El estilo (y con él, el mapa entero) se reconstruye al cambiar de tema.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [tema]);

  /** SOLO cámara. Ver el docstring del archivo: nunca toca el pin. */
  function handleCentrarUbicacion() {
    if (typeof navigator === "undefined" || !navigator.geolocation) {
      setAvisoUbicacion("Tu navegador no permite obtener tu ubicación.");
      return;
    }
    setAvisoUbicacion(null);
    setCentrando(true);
    navigator.geolocation.getCurrentPosition(
      (pos) => {
        setCentrando(false);
        mapa.current?.flyTo({
          center: [pos.coords.longitude, pos.coords.latitude],
          zoom: ZOOM_PUNTO,
          duration: 700,
        });
      },
      () => {
        setCentrando(false);
        setAvisoUbicacion("No pudimos obtener tu ubicación. Puedes moverte por el mapa igual.");
      },
      { enableHighAccuracy: true, timeout: 8000 },
    );
  }

  /** El botón accesible: coloca el pin en el centro actual de la cámara. */
  function handleMarcarCentro() {
    const centro = mapa.current?.getCenter();
    if (!centro) return;
    colocarPinRef.current(centro.lat, centro.lng);
  }

  return (
    <div className="relative h-full w-full">
      <div
        ref={contenedor}
        // ⚠️ Posicionado EN LÍNEA, no con utilidades de Tailwind — `maplibre-gl.css`
        // se importa sin capa y gana siempre a Tailwind (que vive en una capa).
        // Ver el docstring del archivo.
        style={{ position: "absolute", inset: 0, background: "transparent" }}
        // `role="region"`, no `"application"`: ese último le pide al lector de
        // pantalla que le ceda TODO el control de teclado al widget, y puede
        // atrapar al usuario dentro sin forma fácil de salir. El panorama con
        // flechas lo maneja MapLibre igual (es el propio `<canvas>` el que
        // recibe el foco), y "Marcar el centro del mapa" es la vía pensada
        // para quien no pueda operar el mapa con precisión — no depende de
        // que el rol ARIA ceda el control.
        aria-label="Mapa para marcar tu punto de término"
        role="region"
      />

      {interactivo && (
        <div
          className="pointer-events-none absolute top-1/2 left-1/2 z-10 -translate-x-1/2 -translate-y-full"
          aria-hidden="true"
        >
          <MapPin className="size-6 text-muted-foreground/60 drop-shadow-sm" />
        </div>
      )}

      <div className="absolute top-2 right-2 z-10 flex flex-col items-end gap-1.5">
        <Button
          type="button"
          size="sm"
          variant="secondary"
          className="shadow-md"
          onClick={handleCentrarUbicacion}
          loading={centrando}
        >
          <LocateFixed className="size-4" aria-hidden="true" />
          Mi ubicación
        </Button>
        {avisoUbicacion && (
          <p className="max-w-44 rounded-md bg-card px-2 py-1 text-right text-xs text-muted-foreground shadow-md">
            {avisoUbicacion}
          </p>
        )}
      </div>

      {interactivo && (
        <div className="absolute bottom-2 left-1/2 z-10 -translate-x-1/2">
          <Button
            type="button"
            size="sm"
            variant="secondary"
            className="shadow-md"
            onClick={handleMarcarCentro}
          >
            <MapPin className="size-4" aria-hidden="true" />
            Marcar el centro del mapa
          </Button>
        </div>
      )}

      {sinBasemap && (
        <div className="absolute inset-x-2 bottom-14 z-10">
          <Alert className="bg-card/95 shadow-md">
            <AlertDescription>
              El plano detallado no está disponible ahora mismo. Igual puedes marcar tu punto: toca el
              mapa o usa &quot;Marcar el centro del mapa&quot;.
            </AlertDescription>
          </Alert>
        </div>
      )}
    </div>
  );
}
