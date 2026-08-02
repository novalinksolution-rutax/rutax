"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
// `maplibre-gl` no tiene default export: solo named. Se importan las piezas
// que se usan, para que el bundle no arrastre el módulo entero por un alias.
//
// ⚠️ VERSIÓN CLAVADA EN LA LÍNEA 5.x — NO subir a 6.x sin comprobarlo en el
// navegador. MapLibre 6.0.0 dejó de empaquetar su Web Worker dentro del bundle
// y pasó a cargarlo como archivo suelto con
// `new Worker(new URL('./maplibre-gl-worker.mjs', import.meta.url), {type:'module'})`.
// Turbopack no resuelve ese patrón dentro de `node_modules`, y el modo en que
// falla es el peor posible: el worker nunca arranca, MapLibre no emite UN SOLO
// evento —ni `error`, ni `render`, ni `style.load`—, `getStyle()` devuelve
// `null` para siempre y el lienzo queda en blanco. Sin errores en consola, sin
// promesas rechazadas, sin nada. Un mapa mínimo de cinco líneas fallaba igual,
// que es lo que permitió descartar el estilo y el código de este módulo.
// Con 5.24 el worker va embebido y todo funciona.
import { Map as MapaLibre, addProtocol, type GeoJSONSource, type MapMouseEvent } from "maplibre-gl";
import { Protocol } from "pmtiles";
import type { Topology } from "topojson-specification";
import type { Feature, FeatureCollection, Geometry } from "geojson";
import "maplibre-gl/dist/maplibre-gl.css";

import type {
  CapaMapa,
  CeldaClima,
  ConductorEnMapa,
  EventoCiudad,
  IncidenteTransito,
  MarcaOperativa,
  NivelZoom,
  Zona,
} from "../../_fixture/estado-torre";
import { urlBasemap } from "../../_lib/mapa/config";
import { CAPAS_POR_ID, IDS_FUENTES, construirEstilo } from "../../_lib/mapa/estilo";
import { dibujarImagenesDelMapa } from "../../_lib/mapa/tramas";
import {
  cajaEnvolvente,
  cargarTopologiaComunas,
  centroideVisual,
  circuloGeodesico,
  geometriaDeComunas,
  geometriaDeZonas,
} from "../../_lib/mapa/geometria";
import { PlacaZona } from "./placa-zona";

export interface PropsMapaZonas {
  zonas: Zona[];
  zonaSeleccionada: string | null;
  /**
   * Ids de las capas encendidas. El mapa NO recibe el catálogo completo de
   * capas ni su disponibilidad: eso es asunto del control, que es quien decide
   * qué se puede encender y por qué no. Aquí solo se obedece.
   */
  capasActivas: CapaMapa[];
  zoom: NivelZoom;
  celdasClima: CeldaClima[];
  eventosCiudad: EventoCiudad[];
  conductores: ConductorEnMapa[];
  incidentesTransito: IncidenteTransito[];
  marcasOperativas: MarcaOperativa[];
  marcando: boolean;
  marcaProvisional: { long: number; lat: number } | null;
  onSeleccionarZona: (zonaId: string) => void;
  onColocarMarca: (long: number, lat: number) => void;
}

/** El protocolo `pmtiles://` se registra una vez por documento, no por montaje. */
let protocoloRegistrado = false;
function registrarProtocoloPmtiles() {
  if (protocoloRegistrado) return;
  const protocolo = new Protocol();
  addProtocol("pmtiles", protocolo.tile);
  protocoloRegistrado = true;
}

/** Ancla de un elemento de la capa HTML sobre el lienzo. */
interface Ancla {
  id: string;
  long: number;
  lat: number;
  /** Desplazamiento en píxeles respecto del punto proyectado. */
  dx: number;
  dy: number;
  /** Solo las placas de zona se acotan al lienzo y se des-solapan entre sí. */
  esZona?: boolean;
}

function coleccion<T extends Geometry>(features: Feature<T>[]): FeatureCollection<T> {
  return { type: "FeatureCollection", features };
}

/**
 * R3 · el mapa.
 *
 * MapLibre + PMTiles con geometría comunal DPA 2023 real, no el SVG geométrico
 * del handoff: la decisión fue del usuario y la razón es la orientación urbana
 * —una partición de Voronoi sobre los centros de zona no le dice a nadie dónde
 * está Vespucio—. Consecuencia asumida: R3 no es pixel-perfect contra las
 * capturas del handoff, porque la forma de las zonas ya no es la de aquel
 * placeholder. Todo lo demás del diseño (placas, controles, leyenda, tramas,
 * tope de 2 capas) se conserva.
 *
 * SEPARACIÓN VECTOR / HTML. El estilo no tiene una sola capa de texto: todos
 * los rótulos —placas de zona incluidas— viven en una capa HTML sobre el
 * lienzo, posicionada proyectando coordenadas con `map.project()`. Es la misma
 * regla que el handoff impone para el SVG («SVG solo geometría, HTML todo el
 * texto») y aquí paga doble: el estilo no necesita glyph PBFs que publicar, y
 * las cifras heredan `tabular-nums` sin trucos (regla de producto 6).
 *
 * El reposicionamiento de esa capa es IMPERATIVO (se escribe `transform` sobre
 * el nodo) y no pasa por el estado de React: un `setState` por frame de
 * paneo volvería a renderizar el tablero entero 60 veces por segundo.
 */
export function MapaZonas({
  zonas,
  zonaSeleccionada,
  capasActivas,
  zoom,
  celdasClima,
  eventosCiudad,
  conductores,
  incidentesTransito,
  marcasOperativas,
  marcando,
  marcaProvisional,
  onSeleccionarZona,
  onColocarMarca,
}: PropsMapaZonas) {
  const contenedorRef = useRef<HTMLDivElement | null>(null);
  const mapaRef = useRef<MapaLibre | null>(null);
  const nodosRef = useRef<Record<string, HTMLDivElement | null>>({});
  const [topologia, setTopologia] = useState<Topology | null>(null);
  const [errorGeometria, setErrorGeometria] = useState<string | null>(null);
  const [mapaListo, setMapaListo] = useState(false);

  // Callbacks en una ref: los handlers de MapLibre se registran UNA vez, al
  // crear el mapa, y no deben re-suscribirse porque el padre recreó una
  // función. La ref se sincroniza en un efecto sin dependencias (corre tras
  // cada render) y no en el cuerpo del componente: escribir una ref durante el
  // render rompe el modelo de React y lo marca el linter del compilador.
  const callbacksRef = useRef({ onSeleccionarZona, onColocarMarca, marcando });
  useEffect(() => {
    callbacksRef.current = { onSeleccionarZona, onColocarMarca, marcando };
  });

  // --- Geometría ------------------------------------------------------------
  useEffect(() => {
    const abortar = new AbortController();
    cargarTopologiaComunas(abortar.signal)
      .then(setTopologia)
      .catch((error: unknown) => {
        if (abortar.signal.aborted) return;
        setErrorGeometria(error instanceof Error ? error.message : "Error desconocido");
      });
    return () => abortar.abort();
  }, []);

  const zonasGeo = useMemo(
    () => (topologia ? geometriaDeZonas(topologia, zonas) : null),
    [topologia, zonas],
  );
  const comunasGeo = useMemo(
    () => (topologia ? geometriaDeComunas(topologia, zonas) : null),
    [topologia, zonas],
  );

  /**
   * Dónde plantar cada placa. Centroide de la geometría fusionada cuando la
   * zona tiene comunas reconocidas; `zona.centro` cuando no las tiene — así una
   * zona con comunas mal escritas se sigue viendo en el mapa en vez de
   * desaparecer sin avisar.
   */
  const anclasZonas = useMemo<Ancla[]>(() => {
    // Ordenadas por riesgo DESCENDENTE, y ese orden importa: cuando dos placas
    // chocan, la primera conserva su posición verdadera y la otra cede. Que la
    // zona más crítica sea la que nunca se mueve no es un detalle estético —
    // es la que el coordinador tiene que poder ubicar sin dudar.
    return [...zonas]
      .sort((a, b) => b.riesgo - a.riesgo)
      .map((zona) => {
        const geo = zonasGeo?.features.find((f) => f.properties.zonaId === zona.id);
        const [long, lat] = geo
          ? centroideVisual(geo.geometry)
          : [zona.centro.long, zona.centro.lat];
        return { id: `zona-${zona.id}`, long, lat, dx: -84, dy: -34, esZona: true };
      });
  }, [zonas, zonasGeo]);

  // --- Creación del mapa ----------------------------------------------------
  useEffect(() => {
    if (!contenedorRef.current || mapaRef.current) return;
    registrarProtocoloPmtiles();

    const mapa = new MapaLibre({
      container: contenedorRef.current,
      style: construirEstilo({ urlBasemap: urlBasemap(), sinZonas: false }),
      center: [-70.65, -33.47],
      zoom: 9.4,
      attributionControl: false,
      // El tablero no es un visor cartográfico: rotar o inclinar el plano no
      // ayuda a decidir nada y sí rompe la lectura de las placas.
      pitchWithRotate: false,
      dragRotate: false,
      touchZoomRotate: false,
    });
    mapaRef.current = mapa;
    // Asa de depuración SOLO en desarrollo. Un mapa de MapLibre no expone nada
    // desde el DOM, así que sin esto no hay forma de preguntarle a la consola
    // del navegador por la cámara, el estilo o el estado de las fuentes — que
    // es exactamente lo que hizo falta para encontrar los dos bugs que ni el
    // typecheck ni los tests veían.
    if (process.env.NODE_ENV !== "production") {
      (window as unknown as { __torreMapa?: unknown }).__torreMapa = mapa;
    }

    // `style.load` y NO `load`.
    //
    // `load` está definido como «después de descargar los recursos necesarios Y
    // de que ocurra el primer renderizado visualmente completo». Ese segundo
    // requisito lo cumple el compositor, no la red: en una pestaña de fondo el
    // navegador no pinta, así que `load` no llega NUNCA y todo el cableado que
    // cuelgue de él —imágenes, datos de las fuentes, encuadre— se queda sin
    // ejecutar. El mapa aparece vacío y sin un solo error.
    //
    // Nada de lo que hacemos aquí necesita un pixel pintado: solo necesita que
    // el estilo esté aplicado, que es exactamente lo que promete `style.load`.
    mapa.on("style.load", () => {
      for (const { id, imagen, pixelRatio } of dibujarImagenesDelMapa()) {
        if (!mapa.hasImage(id)) mapa.addImage(id, imagen, { pixelRatio });
      }
      setMapaListo(true);
    });

    mapa.on("click", (evento: MapMouseEvent) => {
      const { marcando: enModoMarca, onColocarMarca: colocar, onSeleccionarZona: seleccionar } =
        callbacksRef.current;
      if (enModoMarca) {
        colocar(evento.lngLat.lng, evento.lngLat.lat);
        return;
      }
      const encontradas = mapa.queryRenderedFeatures(evento.point, { layers: ["zonas-relleno"] });
      const zonaId = encontradas[0]?.properties?.zonaId;
      if (typeof zonaId === "string") seleccionar(zonaId);
    });

    mapa.on("mousemove", (evento: MapMouseEvent) => {
      if (callbacksRef.current.marcando) return;
      const encontradas = mapa.queryRenderedFeatures(evento.point, { layers: ["zonas-relleno"] });
      mapa.getCanvas().style.cursor = encontradas.length > 0 ? "pointer" : "";
    });

    return () => {
      mapa.remove();
      mapaRef.current = null;
      setMapaListo(false);
    };
  }, []);

  // --- Reposicionamiento de la capa HTML ------------------------------------
  const anclas = useMemo<Ancla[]>(() => {
    const otras: Ancla[] = [
      ...eventosCiudad.map((e) => ({
        id: `evento-${e.id}`,
        long: e.posicion.long,
        lat: e.posicion.lat,
        dx: 10,
        dy: -10,
      })),
      ...conductores.map((c) => ({
        id: `conductor-${c.id}`,
        long: c.posicion.long,
        lat: c.posicion.lat,
        dx: 10,
        dy: -8,
      })),
      ...celdasClima.map((c) => ({
        id: `clima-${c.id}`,
        long: c.centro.long,
        lat: c.centro.lat,
        dx: -60,
        dy: -9,
      })),
      ...incidentesTransito.map((i) => ({
        id: `transito-${i.id}`,
        long: i.posicion.long,
        lat: i.posicion.lat,
        dx: 10,
        dy: -8,
      })),
      ...marcasOperativas.map((m) => ({
        id: `marca-${m.id}`,
        long: m.posicion.long,
        lat: m.posicion.lat,
        dx: 10,
        dy: -8,
      })),
    ];
    return [...anclasZonas, ...otras];
  }, [anclasZonas, eventosCiudad, conductores, celdasClima, incidentesTransito, marcasOperativas]);

  /**
   * Coloca la capa HTML sobre el lienzo.
   *
   * Dos correcciones sobre la proyección cruda, y las dos son de producto:
   *
   * 1. **Se acota al lienzo.** Una placa cuyo centroide cae cerca del borde
   *    —o fuera, si el usuario paneó— quedaría medio cortada o invisible. Una
   *    zona que desaparece del mapa miente sobre la carga real, igual que un
   *    pedido sin geocodificar que no se declara (regla de producto 5).
   * 2. **Se resuelven las colisiones empujando hacia abajo.** El handoff
   *    dibuja cinco zonas bien separadas; la realidad no lo garantiza —un
   *    courier que opera toda la RM encuadra la región entera y el núcleo
   *    urbano queda apretado—. Las placas se colocan por riesgo descendente y
   *    la que llega tarde cede: la crítica nunca se mueve de su sitio.
   *
   * Todo se escribe directo sobre el nodo, sin pasar por el estado de React:
   * esto corre en cada frame de paneo.
   */
  const reposicionar = useCallback(() => {
    const mapa = mapaRef.current;
    if (!mapa) return;
    const lienzo = mapa.getCanvas();
    const anchoMax = lienzo.clientWidth;
    const altoMax = lienzo.clientHeight;
    const MARGEN = 6;
    const colocadas: { x: number; y: number; ancho: number; alto: number }[] = [];

    for (const ancla of anclas) {
      const nodo = nodosRef.current[ancla.id];
      if (!nodo) continue;
      const punto = mapa.project([ancla.long, ancla.lat]);
      const ancho = nodo.offsetWidth || 0;
      const alto = nodo.offsetHeight || 0;

      let x = punto.x + ancla.dx;
      let y = punto.y + ancla.dy;

      if (ancla.esZona) {
        x = Math.min(Math.max(x, MARGEN), Math.max(MARGEN, anchoMax - ancho - MARGEN));
        y = Math.min(Math.max(y, MARGEN), Math.max(MARGEN, altoMax - alto - MARGEN));

        // Empuje DIRECCIONAL: hacia el lado por el que la placa ya venía.
        // Empujar siempre hacia abajo parece más simple y es peor — la placa de
        // la zona Norte terminaba al sur de la de Centro, o sea señalando el
        // lado contrario del mapa. Una etiqueta en el sitio equivocado miente
        // sobre el «dónde», que es la única pregunta que R3 responde.
        // Con tope de intentos: pasados unos pocos, se acepta el solape antes
        // que mandar la placa lejos de la zona que rotula.
        for (let intento = 0; intento < 4; intento += 1) {
          const choque = colocadas.find(
            (c) =>
              x < c.x + c.ancho + MARGEN &&
              x + ancho + MARGEN > c.x &&
              y < c.y + c.alto + MARGEN &&
              y + alto + MARGEN > c.y,
          );
          if (!choque) break;
          const haciaArriba = y + alto / 2 < choque.y + choque.alto / 2;
          y = haciaArriba ? choque.y - alto - MARGEN : choque.y + choque.alto + MARGEN;
        }
        y = Math.min(Math.max(y, MARGEN), Math.max(MARGEN, altoMax - alto - MARGEN));
        colocadas.push({ x, y, ancho, alto });
      }

      nodo.style.transform = `translate3d(${x}px, ${y}px, 0)`;
    }
  }, [anclas]);

  useEffect(() => {
    const mapa = mapaRef.current;
    if (!mapa) return;
    reposicionar();
    mapa.on("move", reposicionar);
    mapa.on("resize", reposicionar);
    return () => {
      mapa.off("move", reposicionar);
      mapa.off("resize", reposicionar);
    };
  }, [reposicionar, mapaListo]);

  // --- Datos de las zonas y encuadre ---------------------------------------
  useEffect(() => {
    const mapa = mapaRef.current;
    if (!mapa || !mapaListo || !zonasGeo || !comunasGeo) return;

    (mapa.getSource(IDS_FUENTES.zonas) as GeoJSONSource | undefined)?.setData(zonasGeo);
    (mapa.getSource(IDS_FUENTES.comunas) as GeoJSONSource | undefined)?.setData(comunasGeo);

    const caja = cajaEnvolvente(zonasGeo);
    if (caja) {
      mapa.fitBounds(
        [
          [caja[0], caja[1]],
          [caja[2], caja[3]],
        ],
        // Los márgenes dejan libre el sitio de los cuatro controles flotantes,
        // que no deben taparle la geometría a ninguna zona.
        { padding: { top: 56, bottom: 88, left: 216, right: 232 }, maxZoom: 12, animate: false },
      );
    }
  }, [zonasGeo, comunasGeo, mapaListo]);

  // --- Selección de zona (feature-state) ------------------------------------
  useEffect(() => {
    const mapa = mapaRef.current;
    if (!mapa || !mapaListo || !zonasGeo) return;
    for (const f of zonasGeo.features) {
      const id = f.properties.zonaId;
      mapa.setFeatureState(
        { source: IDS_FUENTES.zonas, id },
        {
          seleccionada: id === zonaSeleccionada,
          atenuada: zonaSeleccionada !== null && id !== zonaSeleccionada,
        },
      );
    }
  }, [zonaSeleccionada, zonasGeo, mapaListo]);

  // --- Datos de las capas ---------------------------------------------------
  useEffect(() => {
    const mapa = mapaRef.current;
    if (!mapa || !mapaListo) return;

    const asignar = (fuente: string, datos: FeatureCollection) => {
      (mapa.getSource(fuente) as GeoJSONSource | undefined)?.setData(datos);
    };

    asignar(
      IDS_FUENTES.clima,
      coleccion(
        celdasClima.map((celda) => ({
          type: "Feature" as const,
          id: celda.id,
          geometry: circuloGeodesico(celda.centro, celda.radioMetros),
          properties: { id: celda.id, tipo: celda.tipo },
        })),
      ),
    );

    // AIRE. El pronóstico de calidad del aire es regional (un nivel por día,
    // decretado por el MMA), no trae geometría propia. La única señal de aire
    // POR ZONA que existe en el contrato es el factor `aire` del motor de
    // riesgo, así que la capa pinta las zonas cuyo factor supera el umbral
    // «medio». Es la lectura honesta del dato disponible: no inventa una nube
    // de contaminación con forma, dice qué zonas están afectadas.
    asignar(
      IDS_FUENTES.aire,
      coleccion(
        (zonasGeo?.features ?? [])
          .filter((f) => {
            const zona = zonas.find((z) => z.id === f.properties.zonaId);
            const factor = zona?.factores.find((x) => x.id === "aire");
            return (factor?.valor ?? 0) >= 41;
          })
          .map((f) => ({
            type: "Feature" as const,
            id: f.properties.zonaId,
            geometry: f.geometry,
            properties: { zonaId: f.properties.zonaId },
          })),
      ),
    );

    asignar(
      IDS_FUENTES.eventos,
      coleccion(
        eventosCiudad.map((evento) => ({
          type: "Feature" as const,
          id: evento.id,
          geometry: circuloGeodesico(evento.posicion, evento.radioMetros),
          properties: { id: evento.id, nombre: evento.nombre },
        })),
      ),
    );

    asignar(
      IDS_FUENTES.conductores,
      coleccion(
        conductores.map((conductor) => ({
          type: "Feature" as const,
          id: conductor.id,
          geometry: {
            type: "Point" as const,
            coordinates: [conductor.posicion.long, conductor.posicion.lat],
          },
          properties: { id: conductor.id, estado: conductor.estado },
        })),
      ),
    );

    asignar(
      IDS_FUENTES.transito,
      coleccion(
        incidentesTransito.map((incidente) => ({
          type: "Feature" as const,
          id: incidente.id,
          geometry: {
            type: "Point" as const,
            coordinates: [incidente.posicion.long, incidente.posicion.lat],
          },
          properties: { id: incidente.id, via: incidente.via },
        })),
      ),
    );

    // Las marcas operativas nunca se apagan (no son una capa, son una anotación
    // del usuario) y la provisional se dibuja con el mismo par círculo+punto
    // hasta que se guarde.
    const rasgosMarca: Feature<Geometry>[] = [];
    for (const marca of marcasOperativas) {
      rasgosMarca.push({
        type: "Feature",
        geometry: circuloGeodesico(marca.posicion, marca.radioMetros),
        properties: { id: marca.id, provisional: false },
      });
      rasgosMarca.push({
        type: "Feature",
        geometry: { type: "Point", coordinates: [marca.posicion.long, marca.posicion.lat] },
        properties: { id: marca.id, provisional: false },
      });
    }
    if (marcaProvisional) {
      rasgosMarca.push({
        type: "Feature",
        geometry: {
          type: "Point",
          coordinates: [marcaProvisional.long, marcaProvisional.lat],
        },
        properties: { id: "provisional", provisional: true },
      });
    }
    asignar(IDS_FUENTES.marcas, coleccion(rasgosMarca));
  }, [
    mapaListo,
    celdasClima,
    eventosCiudad,
    conductores,
    incidentesTransito,
    marcasOperativas,
    marcaProvisional,
    zonasGeo,
    zonas,
  ]);

  // --- Visibilidad de capas y nivel de zoom ---------------------------------
  useEffect(() => {
    const mapa = mapaRef.current;
    if (!mapa || !mapaListo) return;

    for (const [capaId, capasEstilo] of Object.entries(CAPAS_POR_ID)) {
      // «Comunas» se enciende por la capa homónima O por el nivel de zoom: son
      // dos caminos al mismo dibujo, y el handoff ofrece los dos.
      const activa =
        capasActivas.includes(capaId as CapaMapa) || (capaId === "comunas" && zoom === "comunas");
      for (const idCapa of capasEstilo) {
        if (mapa.getLayer(idCapa)) {
          mapa.setLayoutProperty(idCapa, "visibility", activa ? "visible" : "none");
        }
      }
    }
  }, [capasActivas, zoom, mapaListo]);

  // --- Modo marca -----------------------------------------------------------
  useEffect(() => {
    const mapa = mapaRef.current;
    if (!mapa || !mapaListo) return;
    mapa.getCanvas().style.cursor = marcando ? "crosshair" : "";
  }, [marcando, mapaListo]);

  const mostrarComunas = capasActivas.includes("comunas") || zoom === "comunas";
  const capaClimaActiva = capasActivas.includes("clima");
  const capaEventosActiva = capasActivas.includes("eventos");
  const capaConductoresActiva = capasActivas.includes("conductores");
  const capaTransitoActiva = capasActivas.includes("transito");

  const registrar = useCallback(
    (id: string) => (nodo: HTMLDivElement | null) => {
      nodosRef.current[id] = nodo;
    },
    [],
  );

  return (
    <div className="relative flex-1 overflow-hidden bg-tc-papel">
      {/* ⚠️ El posicionamiento va en `style` y NO en clases de Tailwind.
          `maplibre-gl.css` se importa sin capa, y en Tailwind 4 el CSS SIN capa
          gana SIEMPRE al CSS en capa, sin importar la especificidad. MapLibre
          le pone `.maplibregl-map { position: relative }` a este nodo al
          inicializarse, y esa regla vence a `absolute`; con el nodo en flujo
          normal, `inset-0` no aplica y el contenedor queda con 0 px de alto.
          El mapa entonces se crea sobre un contenedor sin altura: el lienzo no
          crece, `fitBounds` calcula sobre un viewport degenerado y las placas
          se proyectan a coordenadas absurdas. Los estilos en línea ganan a
          cualquier hoja, con capa o sin ella. */}
      <div ref={contenedorRef} style={{ position: "absolute", inset: 0 }} />

      {errorGeometria ? (
        <div className="absolute inset-0 flex items-center justify-center bg-tc-papel px-8 text-center">
          <p className="max-w-sm text-[12.5px] text-tc-ink-700">
            No se pudo cargar la geometría comunal, así que el mapa no puede dibujar tus zonas. La
            vista de lista (tecla <kbd className="font-semibold">L</kbd>) tiene los mismos datos.
          </p>
        </div>
      ) : null}

      {/* Capa HTML: todo el texto del mapa. `pointer-events-none` para no
          robarle el arrastre al lienzo; cada pieza reactiva lo repone. */}
      <div className="pointer-events-none absolute inset-0 overflow-hidden">
        {zonas.map((zona) => (
          <div
            key={zona.id}
            ref={registrar(`zona-${zona.id}`)}
            className="pointer-events-none absolute top-0 left-0 w-[168px] will-change-transform"
          >
            <PlacaZona
              zona={zona}
              seleccionada={zonaSeleccionada === zona.id}
              atenuada={zonaSeleccionada !== null && zonaSeleccionada !== zona.id}
              mostrarComunas={mostrarComunas}
              onSeleccionar={() => onSeleccionarZona(zona.id)}
            />
          </div>
        ))}

        {capaClimaActiva
          ? celdasClima.map((celda) => (
              <div
                key={celda.id}
                ref={registrar(`clima-${celda.id}`)}
                className="absolute top-0 left-0 bg-tc-tinta px-2 py-1 text-[10.5px] font-bold text-tc-papel uppercase"
              >
                <span className="tc-num">
                  {celda.tipo === "lluvia" ? "Lluvia" : "Viento"} {celda.intensidadMmHora} mm/h
                </span>
              </div>
            ))
          : null}

        {capaEventosActiva
          ? eventosCiudad.map((evento) => (
              <div
                key={evento.id}
                ref={registrar(`evento-${evento.id}`)}
                className="absolute top-0 left-0 border border-tc-tinta bg-tc-papel px-1.5 py-1 text-[9.5px] leading-tight text-tc-tinta"
              >
                <span className="block font-extrabold">{evento.nombre}</span>
                <span className="tc-num block text-tc-ink-600">
                  {evento.recinto}
                  {evento.asistenciaEstimada
                    ? ` · ${evento.asistenciaEstimada.toLocaleString("es-CL")}`
                    : ""}
                </span>
              </div>
            ))
          : null}

        {capaConductoresActiva
          ? conductores.map((conductor) => (
              <div
                key={conductor.id}
                ref={registrar(`conductor-${conductor.id}`)}
                className="absolute top-0 left-0 bg-[rgba(243,242,242,.88)] px-1 text-[9.5px] leading-tight text-tc-tinta"
              >
                <span className="font-semibold">{conductor.nombre}</span>{" "}
                <span className="tc-num text-tc-ink-600">
                  {conductor.paradasCompletadas}/{conductor.paradasTotales}
                </span>
                {conductor.estado === "sin_senal" ? (
                  <span className="tc-num block text-tc-senal-text">
                    sin señal {conductor.minutosSinPing}′
                  </span>
                ) : null}
              </div>
            ))
          : null}

        {capaTransitoActiva
          ? incidentesTransito.map((incidente) => (
              <div
                key={incidente.id}
                ref={registrar(`transito-${incidente.id}`)}
                className="absolute top-0 left-0 bg-[rgba(243,242,242,.88)] px-1 text-[9.5px] font-semibold text-tc-tinta"
              >
                {incidente.via}
              </div>
            ))
          : null}

        {marcasOperativas.map((marca) => (
          <div
            key={marca.id}
            ref={registrar(`marca-${marca.id}`)}
            className="absolute top-0 left-0 border border-tc-tinta bg-tc-papel px-1.5 py-0.5 text-[9.5px] text-tc-tinta"
          >
            {marca.nota}
          </div>
        ))}
      </div>
    </div>
  );
}
