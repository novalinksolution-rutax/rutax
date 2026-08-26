'use client';

/**
 * El mapa de la Torre — MapLibre sobre PMTiles, con el zoom semántico de tres
 * niveles.
 * =============================================================================
 *
 * Este componente dibuja y navega; **no decide nada del dato**. Recibe el estado
 * ya armado y avisa hacia arriba cuando el usuario entra en una comuna, abre un
 * punto o vuelve a la región.
 *
 * -----------------------------------------------------------------------------
 * LAS CINCO MINAS DE ESTE ARCHIVO — todas explotaron una vez
 * -----------------------------------------------------------------------------
 * 1. **`maplibre-gl` está clavado en 5.24.0 y NO sube a 6.x.** La 6.0.0 carga su
 *    Web Worker como archivo suelto (`new Worker(new URL(…), {type:'module'})`)
 *    y Turbopack no resuelve ese patrón dentro de `node_modules`. Falla MUDO: ni
 *    un evento, `getStyle()` devuelve `null`, el lienzo en blanco y la consola
 *    limpia.
 * 2. **Ninguna capa se agrega ni se quita al cambiar de nivel.** Todas existen
 *    desde el principio y solo cambian `visibility` y opacidad. Es lo que hace
 *    que el escalón se sienta continuo y evita el clásico «capa duplicada».
 * 3. **El nivel se cambia ANTES de volar y se re-sincroniza en `moveend`.** El
 *    sincronizador está suprimido durante el vuelo y el último evento `zoom`
 *    llega antes de que se libere la bandera: sin re-sincronizar al aterrizar,
 *    cualquier vuelo que cruce un umbral deja el nivel desfasado hasta que el
 *    usuario toque la rueda.
 * 4. **El clic se resuelve por ESPECIFICIDAD, nunca por el orden de
 *    `queryRenderedFeatures`.** El polígono de comuna cubre el mapa entero y por
 *    eso está SIEMPRE entre los resultados: quedarse con el primero hacía que un
 *    clic sobre una burbuja cerca de un borde comunal entrara en la comuna
 *    vecina. Orden correcto: punto → burbuja → comuna.
 * 5. **Tailwind 4 pierde contra el CSS de MapLibre.** `maplibre-gl.css` se
 *    importa sin capa, y el CSS sin capa gana SIEMPRE al CSS en capa —donde vive
 *    todo Tailwind— sin importar la especificidad. Cualquier nodo que MapLibre
 *    marque con sus clases se posiciona con estilos en línea.
 *
 * Y una sexta, que no es de código pero cuesta más caro: **para revisar esto en
 * el navegador la ventana tiene que estar VISIBLE.** Todo el ciclo de render de
 * MapLibre pasa por `requestAnimationFrame`, incluido el parseo del estilo. Con
 * `document.hidden === true` el estilo se queda en 18 de 30 capas y
 * `queryRenderedFeatures` devuelve cero rótulos aunque el dato y los glifos
 * estén sanos. Se diagnostica mal como «faltan glifos».
 */

import { useCallback, useEffect, useMemo, useRef } from 'react';
import maplibregl, { type MapGeoJSONFeature } from 'maplibre-gl';
import { Protocol } from 'pmtiles';
import 'maplibre-gl/dist/maplibre-gl.css';
import type { ComunaEnTorre, PuntoEntrega } from '@/modules/contexto/contrato-torre';
import { urlBasemap, urlGlifos } from '../_lib/mapa/config';
import { capasDatos, construirEstiloBase, IDS_CAPAS, IDS_FUENTES } from '../_lib/mapa/estilo';
import {
  ENCUADRE_RM,
  nivelParaZoom,
  UMBRALES_ZOOM,
  ZOOM_DESTINO,
  type NivelZoom,
  type TemaMapa,
} from '../_lib/mapa/paleta';
import { geoAgrupaciones, geoComunas, geoPuntos, puntosVisibles } from '../_lib/derivar';
import type { MapaGeometrias } from '../_lib/geometria';

/**
 * El protocolo `pmtiles://` se registra UNA vez por documento.
 *
 * `addProtocol` es global de la librería, no del mapa: registrarlo dentro del
 * efecto lo re-registraría en cada montaje (y en dev, con StrictMode, dos veces
 * por montaje). Se hace en el módulo, que corre una sola vez.
 */
let protocoloRegistrado = false;
function registrarProtocolo() {
  if (protocoloRegistrado) return;
  maplibregl.addProtocol('pmtiles', new Protocol().tile);
  protocoloRegistrado = true;
}

export interface MapaTorreProps {
  tema: TemaMapa;
  geometrias: MapaGeometrias;
  comunas: readonly ComunaEnTorre[];
  puntos: readonly PuntoEntrega[];
  comunaActiva: string | null;
  nivel: NivelZoom;
  /** El usuario cambió de nivel con la rueda: el zoom manda, no la selección. */
  onNivel: (nivel: NivelZoom) => void;
  onComuna: (nombre: string | null) => void;
  onPunto: (id: string | null) => void;
  /** Celda de la agrupación abierta, o `null`. Los demás puntos se atenúan. */
  celdaAbierta: string | null;
  onCelda: (celda: string | null) => void;
  /** Se dispara cuando la vista se asienta, para recalcular previsualizaciones. */
  onVistaAsentada?: (mapa: maplibregl.Map) => void;
  /** Se dispara en cada frame de movimiento, para reposicionar lo ya montado. */
  onVistaMovida?: (mapa: maplibregl.Map) => void;
  /** El mapa recién creado, para que la ficha pueda proyectar coordenadas. */
  onMapaListo?: (mapa: maplibregl.Map | null) => void;
  /** Controles de cámara guardados. Ver `ControlesMapa`. */
  onControles?: (controles: ControlesMapa | null) => void;
}

/**
 * Vuelos de cámara, **con la bandera de vuelo puesta**.
 *
 * ⚠️ Existe para que nadie de afuera llame a `map.flyTo()` a pelo, y no es
 * ceremonia: un `flyTo` de z9 a z12 dispara un evento `zoom` por frame, y el
 * primero —todavía en z9— hace que el sincronizador lea «nivel comuna» y
 * **borre la comuna que el usuario acaba de elegir**. Se ve como que el clic no
 * hizo nada: el mapa vuela, entra en la comuna y llega sin selección ni velo.
 *
 * Ya pasó una vez desde dentro del mapa; volvió a pasar desde el orquestador el
 * día que se le pasó el objeto `Map` crudo. Por eso el `Map` crudo sigue
 * saliendo (la ficha y las placas necesitan `project()`), pero **mover la cámara
 * se hace por acá**.
 */
export interface ControlesMapa {
  volarA(centro: [number, number], zoom: number, duracion?: number): void;
  /**
   * Encuadra una caja envolvente — la de una comuna — en vez de volar a un zoom
   * fijo.
   *
   * ⚠️ **El zoom fijo no sirve para las comunas de la RM**, y se vio en pantalla
   * antes que en ningún cálculo: van de 7 km² (Independencia) a casi 200
   * (Pudahuel). Con un solo `ZOOM_DESTINO.comuna` para todas, la grande entra
   * por un pedazo —sin un borde a la vista, imposible saber en cuál estás— y la
   * chica queda diminuta en medio de sus vecinas.
   *
   * El zoom resultante se **topa por debajo del umbral del nivel 3**: entrar en
   * una comuna tiene que aterrizar siempre en el nivel de agrupaciones. Sin el
   * tope, una comuna pequeña encuadraría a z14 y se saltaría un escalón entero
   * del zoom semántico sin que el usuario lo pidiera.
   */
  encuadrarEn(limites: [[number, number], [number, number]], duracion?: number): void;
  /**
   * Encuadra la vista general sobre TODO lo que el courier reparte hoy.
   *
   * ⚠️ **El encuadre de entrada no puede ser una constante.** `ENCUADRE_RM` está
   * centrado en el Gran Santiago, y un courier que reparte en Colina, Buin o
   * Melipilla tiene esa carga **fuera de pantalla**: la comuna no se pinta, su
   * placa no aparece, y solo se descubre entrando a la pestaña de comunas. Un
   * mapa que no muestra una comuna con 30 pendientes está escondiendo carga, que
   * es exactamente lo que prohíbe la regla 5 del alcance.
   *
   * Es hermana de `encuadrarEn` pero con el tope al revés: aquélla tiene que
   * aterrizar en el nivel 2 y ésta **tiene que quedarse en el 1**, o entrar a la
   * pantalla te dejaría en un nivel que nadie pidió.
   */
  encuadrarRegion(limites: [[number, number], [number, number]], duracion?: number): void;
}

/** Las capas de punto que aceptan clic. Ver el orden de especificidad, mina 4. */
const CAPAS_PUNTO: string[] = [
  IDS_CAPAS.puntoIncidencia,
  IDS_CAPAS.puntoCorte,
  IDS_CAPAS.puntoEnRuta,
  IDS_CAPAS.puntoPendiente,
  IDS_CAPAS.puntoEntregado,
];

export function MapaTorre({
  tema,
  geometrias,
  comunas,
  puntos,
  comunaActiva,
  nivel,
  onNivel,
  onComuna,
  onPunto,
  celdaAbierta,
  onCelda,
  onVistaAsentada,
  onVistaMovida,
  onMapaListo,
  onControles,
}: MapaTorreProps) {
  const contenedor = useRef<HTMLDivElement>(null);
  const mapa = useRef<maplibregl.Map | null>(null);
  const listo = useRef(false);
  /** Verdadero mientras la cámara vuela por orden nuestra. Ver mina 3. */
  const volando = useRef(false);
  /**
   * Zoom con el que se entró a la comuna activa, o `null`.
   *
   * ⚠️ **Resuelve un choque real entre el zoom semántico y el encuadre.** El
   * nivel se deriva del zoom (`< 11` es nivel 1), pero **hay comunas que no
   * caben dentro de la banda del nivel 2**: Colina mide 0,42° × 0,40° y necesita
   * z≈9,5 para verse entera. Forzarla a z11 muestra un fragmento sin bordes
   * —justo el problema que el encuadre vino a resolver—, y dejarla en z9,5 hacía
   * que el sincronizador la leyera como nivel 1 y **borrara la selección recién
   * hecha**.
   *
   * La salida: con una comuna seleccionada, **el suelo del nivel 2 es el zoom
   * con el que se entró**, no el umbral global. Se sube de nivel alejándose MÁS
   * de donde entraste, que es lo que el usuario espera igual. Sin comuna
   * seleccionada no aplica: manda el umbral de siempre.
   */
  const zoomEntrada = useRef<number | null>(null);

  // Los callbacks y el estado se leen desde los manejadores de MapLibre, que se
  // registran una sola vez. Sin esta indirección, cada render tendría que
  // desmontar y volver a montar los listeners.
  //
  // La escritura va en un efecto y no en el cuerpo del render: tocar un ref
  // mientras se renderiza rompe la garantía de render puro de React (y la regla
  // `react-hooks/refs` lo caza). Como el efecto corre antes de que el usuario
  // pueda interactuar, los manejadores nunca leen un valor viejo.
  const ultimo = useRef({
    comunas, puntos, comunaActiva, nivel, onNivel, onComuna, onPunto, onCelda,
  });
  useEffect(() => {
    ultimo.current = {
      comunas, puntos, comunaActiva, nivel, onNivel, onComuna, onPunto, onCelda,
    };
  });

  const visibles = useMemo(
    () => puntosVisibles(puntos, comunaActiva),
    [puntos, comunaActiva],
  );

  const fuenteComunas = useMemo(
    () => geoComunas(geometrias, comunas, comunaActiva),
    [geometrias, comunas, comunaActiva],
  );
  const fuenteAgrupaciones = useMemo(
    () => geoAgrupaciones(visibles, comunaActiva),
    [visibles, comunaActiva],
  );
  const fuentePuntos = useMemo(
    () => geoPuntos(visibles, celdaAbierta),
    [visibles, celdaAbierta],
  );

  // --- Creación del mapa -----------------------------------------------------
  // El estilo depende del TEMA, así que este efecto se rehace al cambiarlo. No
  // se usa `setStyle` porque eso descarta las fuentes de dato y habría que
  // volver a agregarlas a mano en el `styledata` — más frágil que recrear.
  useEffect(() => {
    if (!contenedor.current) return;
    registrarProtocolo();

    const estilo = construirEstiloBase({
      tema,
      urlBasemap: urlBasemap(),
      urlGlifos: urlGlifos(),
    });

    const m = new maplibregl.Map({
      container: contenedor.current,
      style: estilo,
      center: ENCUADRE_RM.centro,
      zoom: ENCUADRE_RM.zoom,
      minZoom: ENCUADRE_RM.zoomMinimo,
      maxZoom: ENCUADRE_RM.zoomMaximo,
      maxBounds: ENCUADRE_RM.limites,
      attributionControl: false,
      // Cámara cenital y sin inclinar: la referencia de «premium» es la calidad
      // cartográfica de Uber/Rappi, no el 3D.
      dragRotate: false,
      pitchWithRotate: false,
    });

    /**
     * 🔴 **Las dos opciones de arriba solo apagan el RATÓN.**
     *
     * `dragRotate` y `pitchWithRotate` no tocan los gestos táctiles: en un
     * teléfono el pellizco de MapLibre rota además de acercar, y dos dedos
     * arrastrando hacia arriba inclinan la cámara. O sea que la cámara cenital
     * que el diseño fija se pierde con el gesto más común que hay sobre un mapa,
     * y con el mapa torcido las etiquetas de calle quedan de lado y las placas de
     * comuna dejan de calzar con su forma.
     *
     * Peor: no hay ningún control para volver a poner el norte arriba, así que
     * quien lo rota sin querer se queda así.
     *
     * Se apagan las dos después de construir el mapa, que es donde viven.
     */
    m.touchZoomRotate.disableRotation();
    m.touchPitch.disable();

    mapa.current = m;
    listo.current = false;
    onMapaListo?.(m);
    onControles?.({
      volarA: (centro, zoom, duracion = 700) => volarA(m, centro, zoom, duracion),
      encuadrarEn: (limites, duracion = 700) => {
        // Arriba va más relleno: ahí están las migas y el botón de pantalla
        // completa, y la comuna no puede quedar debajo de ellos.
        const relleno = { top: 52, bottom: 28, left: 28, right: 28 };
        const camara = m.cameraForBounds(limites, { padding: relleno });
        const centro = camara?.center ? maplibregl.LngLat.convert(camara.center) : null;

        if (centro && typeof camara?.zoom === 'number') {
          // Tope por ARRIBA: una comuna chica encuadraría a z14 y se saltaría un
          // escalón entero del zoom semántico sin que nadie lo pida.
          //
          // **Por abajo NO se topa**, y eso costó dos intentos. La primera
          // versión lo subía al umbral del nivel 2, y comunas que no caben ahí
          // —Colina necesita z≈9,5— quedaban mostrando un fragmento sin bordes,
          // que es justo el problema que el encuadre vino a resolver. Quien
          // sostiene el nivel es `zoomEntrada`, no un tope de zoom.
          const zoom = Math.min(camara.zoom, UMBRALES_ZOOM.punto - 0.2);
          zoomEntrada.current = zoom;
          volarA(m, [centro.lng, centro.lat], zoom, duracion);
          return;
        }

        // Sin cámara calculable, el encuadre directo. Peor control del nivel,
        // pero **nunca «no pasa nada»**: la primera versión comprobaba y volvía
        // sin volar, y eso no deja ni un error en consola.
        declararVuelo(m);
        m.fitBounds(limites, {
          padding: relleno,
          maxZoom: UMBRALES_ZOOM.punto - 0.2,
          duration: duracion,
        });
      },
      encuadrarRegion: (limites, duracion = 0) => {
        declararVuelo(m);
        m.fitBounds(limites, {
          padding: { top: 52, bottom: 28, left: 28, right: 28 },
          // Se queda POR DEBAJO del umbral del nivel 2: la vista general es el
          // nivel 1 y entrar a la pantalla no puede dejarte en otro.
          maxZoom: UMBRALES_ZOOM.comuna - 0.15,
          duration: duracion,
        });
      },
    });

    m.on('load', () => {
      m.addSource(IDS_FUENTES.comunas, { type: 'geojson', data: fuenteComunas });
      m.addSource(IDS_FUENTES.agrupaciones, { type: 'geojson', data: fuenteAgrupaciones });
      m.addSource(IDS_FUENTES.puntos, { type: 'geojson', data: fuentePuntos });
      // El segundo parámetro es el mismo `urlGlifos() !== null` del estilo base:
      // sin glifos no puede haber una sola capa `symbol`, o MapLibre descarta la
      // capa entera y lo repite una vez por tesela.
      for (const capa of capasDatos(tema, urlGlifos() !== null)) m.addLayer(capa);
      listo.current = true;
      aplicarNivel(m, ultimo.current.nivel, ultimo.current.comunaActiva !== null);
    });

    // --- Navegación ----------------------------------------------------------
    /** Margen para salir de una comuna alejándose. */
    const HISTERESIS_SALIDA = 0.4;

    const sincronizarNivel = () => {
      if (volando.current) return; // mina 3
      const zoom = m.getZoom();
      let siguiente = nivelParaZoom(zoom);

      // Con una comuna seleccionada, el suelo del nivel 2 es el zoom con que se
      // entró. Ver `zoomEntrada`: sin esto, una comuna grande como Colina —que
      // solo cabe entera por debajo del umbral— se auto-deseleccionaba al
      // aterrizar el vuelo que acababa de seleccionarla.
      const entrada = zoomEntrada.current;
      if (
        siguiente === 'comuna' &&
        ultimo.current.comunaActiva &&
        entrada !== null &&
        zoom >= entrada - HISTERESIS_SALIDA
      ) {
        siguiente = 'agrupacion';
      }

      if (siguiente === ultimo.current.nivel) return;
      ultimo.current.onNivel(siguiente);
      // Al volver a la región, la comuna activa se limpia sola: quedarse
      // seleccionada mientras se mira toda la ciudad dejaría un velo que nadie
      // pidió. El velo lo produce la SELECCIÓN, no el zoom.
      if (siguiente === 'comuna' && ultimo.current.comunaActiva) {
        ultimo.current.onComuna(null);
      }
    };

    m.on('zoom', sincronizarNivel);
    m.on('move', () => onVistaMovida?.(m));
    m.on('moveend', () => onVistaAsentada?.(m));

    m.on('click', (evento) => {
      const capas = [...CAPAS_PUNTO, IDS_CAPAS.agrupacionBurbuja, IDS_CAPAS.comunaCarga].filter(
        (id) => m.getLayer(id),
      );
      const halladas = m.queryRenderedFeatures(evento.point, { layers: capas });
      if (halladas.length === 0) {
        ultimo.current.onPunto(null);
        return;
      }

      // ⚠️ Por especificidad, de lo más pequeño a lo más grande. Ver mina 4.
      const punto = halladas.find((f) => CAPAS_PUNTO.includes(f.layer.id));
      if (punto) {
        ultimo.current.onPunto(String(punto.properties.id));
        return;
      }

      const burbuja = halladas.find((f) => f.layer.id === IDS_CAPAS.agrupacionBurbuja);
      if (burbuja) {
        // La burbuja es un resumen —«acá hay 5»—, así que el clic tiene una sola
        // lectura posible: enséñame cuáles son esos 5. Sus puntos la sustituyen.
        //
        // Se recuerda SU celda para poder atenuar todo lo demás: sin eso, al
        // abrir una burbuja de 4 se veían sus puntos mezclados con los de las
        // vecinas y la cuenta no cerraba a simple vista. Ver `atenuar()`.
        ultimo.current.onCelda(String(burbuja.properties.celda));
        volarA(m, coordenadasDe(burbuja), ZOOM_DESTINO.punto, 600);
        ultimo.current.onNivel('punto');
        return;
      }

      const comuna = halladas.find((f) => f.layer.id === IDS_CAPAS.comunaCarga);
      if (comuna) {
        const nombre = String(comuna.properties.nombre);
        ultimo.current.onComuna(nombre);
        ultimo.current.onNivel('agrupacion');
        const destino = ultimo.current.comunas.find((c) => c.nombre === nombre);
        if (destino) {
          volarA(m, [destino.centro.long, destino.centro.lat], ZOOM_DESTINO.comuna, 700);
        }
      }
    });

    m.on('mousemove', (evento) => {
      const capas = [...CAPAS_PUNTO, IDS_CAPAS.agrupacionBurbuja, IDS_CAPAS.comunaCarga].filter(
        (id) => m.getLayer(id),
      );
      const hay = m.queryRenderedFeatures(evento.point, { layers: capas }).length > 0;
      m.getCanvas().style.cursor = hay ? 'pointer' : '';
    });

    /**
     * Marca que la cámara se mueve por orden nuestra y re-sincroniza el nivel al
     * aterrizar. Ver mina 3: durante el vuelo el sincronizador está suprimido, y
     * el último evento `zoom` llega ANTES de que se libere la bandera.
     */
    function declararVuelo(destino: maplibregl.Map) {
      volando.current = true;
      destino.once('moveend', () => {
        volando.current = false;
        sincronizarNivel();
      });
    }

    /** Vuela a un centro y un zoom concretos. */
    function volarA(
      destino: maplibregl.Map,
      centro: [number, number],
      zoom: number,
      duracion: number,
    ) {
      declararVuelo(destino);
      destino.flyTo({
        center: centro,
        zoom,
        duration: duracion,
        // La misma curva del sistema de movimiento (`--ease-standard`).
        easing: (t) => t * (2 - t),
      });
    }

    // --- Redimensionado ------------------------------------------------------
    // Un `ResizeObserver` y no un manejador de la Fullscreen API: cubre además
    // el colapso del sidebar, el arrastre de la ventana y el cambio de
    // breakpoint, que producen exactamente el mismo lienzo desalineado.
    const observador = new ResizeObserver(() => m.resize());
    observador.observe(contenedor.current);

    return () => {
      observador.disconnect();
      onMapaListo?.(null);
      onControles?.(null);
      mapa.current = null;
      listo.current = false;
      m.remove();
    };
    // El estilo se reconstruye entero al cambiar de tema; las fuentes se
    // sincronizan por sus propios efectos.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [tema]);

  // --- Sincronización de fuentes ---------------------------------------------
  const actualizar = useCallback((id: string, datos: GeoJSON.FeatureCollection) => {
    const m = mapa.current;
    if (!m || !listo.current) return;
    const fuente = m.getSource(id);
    if (fuente && 'setData' in fuente) (fuente as maplibregl.GeoJSONSource).setData(datos);
  }, []);

  useEffect(() => actualizar(IDS_FUENTES.comunas, fuenteComunas), [actualizar, fuenteComunas]);
  useEffect(
    () => actualizar(IDS_FUENTES.agrupaciones, fuenteAgrupaciones),
    [actualizar, fuenteAgrupaciones],
  );
  useEffect(() => actualizar(IDS_FUENTES.puntos, fuentePuntos), [actualizar, fuentePuntos]);

  // --- Nivel -----------------------------------------------------------------
  useEffect(() => {
    const m = mapa.current;
    if (!m || !listo.current) return;
    aplicarNivel(m, nivel, comunaActiva !== null);
  }, [nivel, comunaActiva]);

  return (
    <div
      ref={contenedor}
      // ⚠️ **Posicionado EN LÍNEA, no con utilidades de Tailwind** — mina 5, y
      // muerde exactamente acá. MapLibre le pone la clase `.maplibregl-map` a
      // este nodo, y esa regla trae `position: relative`. Como `maplibre-gl.css`
      // se importa sin capa y todo Tailwind vive en una, la regla de MapLibre
      // gana sin importar la especificidad: un `className="absolute inset-0"`
      // se convierte en `relative` con altura 0, el lienzo queda de 0 px de alto
      // y **el mapa no dibuja nada sin un solo error en consola**. Se diagnostica
      // mal como «el estilo está roto» o «faltan las capas».
      style={{ position: 'absolute', inset: 0, background: 'transparent' }}
      aria-hidden="true"
    />
  );
}

function coordenadasDe(feature: MapGeoJSONFeature): [number, number] {
  const g = feature.geometry;
  if (g.type !== 'Point') throw new Error('Se esperaba una geometría de punto');
  return [g.coordinates[0], g.coordinates[1]];
}

/**
 * Enciende y apaga capas por nivel. **Nada se agrega ni se quita**: solo cambia
 * `visibility` y opacidad, que es lo que permite que el escalón se sienta
 * continuo en vez de un parpadeo (mina 2).
 */
function aplicarNivel(m: maplibregl.Map, nivel: NivelZoom, hayComunaActiva: boolean) {
  const ver = (id: string, visible: boolean) => {
    if (m.getLayer(id)) m.setLayoutProperty(id, 'visibility', visible ? 'visible' : 'none');
  };

  const enComuna = nivel === 'comuna';
  const enAgrupacion = nivel === 'agrupacion';
  const enPunto = nivel === 'punto';

  ver(IDS_CAPAS.agrupacionBurbuja, enAgrupacion);
  ver(IDS_CAPAS.agrupacionCifra, enAgrupacion);
  for (const id of [
    IDS_CAPAS.puntoSombra,
    IDS_CAPAS.puntoAgrupadoAnillo,
    IDS_CAPAS.puntoEntregado,
    IDS_CAPAS.puntoPendiente,
    IDS_CAPAS.puntoEnRuta,
    IDS_CAPAS.puntoCorte,
    IDS_CAPAS.puntoIncidencia,
    IDS_CAPAS.puntoAgrupado,
  ]) {
    ver(id, enPunto);
  }

  // La carga por comuna se atenúa al bajar: adentro manda el punto, no el
  // relleno. Sigue ahí para no perder la referencia de dónde estás parado.
  if (m.getLayer(IDS_CAPAS.comunaCarga)) {
    m.setPaintProperty(IDS_CAPAS.comunaCarga, 'fill-opacity', enComuna ? 1 : 0.45);
  }
  // El velo lo produce la SELECCIÓN, no el zoom: apagar media ciudad porque
  // alguien giró la rueda sería el mapa decidiendo por el usuario.
  if (m.getLayer(IDS_CAPAS.velo)) {
    m.setPaintProperty(IDS_CAPAS.velo, 'fill-opacity', hayComunaActiva ? 1 : 0);
  }
}

export { UMBRALES_ZOOM };
