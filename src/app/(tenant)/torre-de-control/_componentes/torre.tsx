'use client';

/**
 * La Torre de control — orquestador de la pantalla.
 * =============================================================================
 *
 * Acá vive el estado de NAVEGACIÓN (nivel, comuna activa, punto abierto,
 * pestaña, pantalla completa) y nada más. El dato llega ya armado del composer y
 * este componente no lo toca: **la Torre no ejecuta, solo muestra y enlaza**.
 *
 * Orden vertical, y el porqué del orden: cabecera → banda de ola → cifras →
 * mapa + panel. La ola va **arriba** de las cifras porque es lo único que mira
 * hacia adelante; abajo competiría con lo de hoy.
 *
 * PANTALLA COMPLETA. Es estado local sobre el contenedor, no una ruta nueva ni
 * un layout nuevo. Va sobre la región que contiene **mapa y panel**, no solo el
 * mapa: el panel es el único lugar donde se listan las incidencias, y un modo
 * «mirar en serio» que esconde lo único accionable de la pantalla sería peor que
 * no tenerlo. El `map.resize()` al entrar y salir lo cubre el `ResizeObserver`
 * del propio mapa, que además atrapa el colapso del sidebar y el arrastre de la
 * ventana — los tres producen el mismo lienzo desalineado.
 */

import { useCallback, useEffect, useRef, useState } from 'react';
import type maplibregl from 'maplibre-gl';
import { useTheme } from 'next-themes';
import { ChevronDown, Maximize2, Minimize2 } from 'lucide-react';
import { Skeleton } from '@/components/ui/skeleton';
import { IndicadorEnVivo } from '@/components/tiempo-real/indicador-en-vivo';
import { DistintivoEstado } from '@/components/ui/distintivo-estado';
import { cn } from '@/lib/utils';
import type { EstadoTorre } from '@/modules/contexto/contrato-torre';
import { cargarGeometriaComunal, limitesDe, type MapaGeometrias } from '../_lib/geometria';
import { limitesDeLaCarga } from '../_lib/derivar';
import { claveComuna } from '../_lib/comunas';
import { ENCUADRE_RM, ZOOM_DESTINO, type NivelZoom, type TemaMapa, paletaDe } from '../_lib/mapa/paleta';
import { ATRIBUCIONES, urlBasemap } from '../_lib/mapa/config';
import { MapaTorre, type ControlesMapa } from './mapa';
import { PlacasComuna } from './placas';
import { MarcadoresConductor } from './marcadores-conductor';
import { CapaFichas } from './ficha';
import { PanelTorre, type PestanaPanel } from './panel';
import { CifrasTorre } from './cifras';
import { BandaOlas } from './banda-olas';
import { ListaComunas } from './lista-comunas';
import { LeyendaMapa } from './leyenda-mapa';

/** El número del nivel, para el distintivo sobre el mapa. */
const NUMERO_DE_NIVEL: Record<NivelZoom, number> = { comuna: 1, agrupacion: 2, punto: 3 };
const NOMBRE_DE_NIVEL: Record<NivelZoom, string> = {
  comuna: 'Comuna',
  agrupacion: 'Agrupaciones',
  punto: 'Puntos',
};

/** Qué pestaña sugiere cada nivel. Es un valor por defecto, no una imposición. */
const PESTANA_POR_NIVEL: Record<NivelZoom, PestanaPanel> = {
  // El nivel 1 sugería `incidencias`, que ya no es pestaña: su cifra vive
  // arriba y su bandeja es una pantalla propia. Mirando la región completa, lo
  // que informa es quién está trabajando.
  comuna: 'conductores',
  agrupacion: 'conductores',
  punto: 'comunas',
};

export function Torre({ estado, tenantId }: { estado: EstadoTorre; tenantId: string }) {
  const { resolvedTheme } = useTheme();
  // Plegado del mapa en teléfono. Arranca cerrado: quien entra desde el teléfono
  // viene a ver cuántos faltan, no a navegar cartografía.
  const [mapaAbiertoMovil, setMapaAbiertoMovil] = useState(false);
  const tema: TemaMapa = resolvedTheme === 'dark' ? 'oscuro' : 'claro';

  const [geometrias, setGeometrias] = useState<MapaGeometrias | null>(null);
  const [fallaGeometria, setFallaGeometria] = useState(false);
  const [nivel, setNivel] = useState<NivelZoom>('comuna');
  const [comunaActiva, setComunaActiva] = useState<string | null>(null);
  const [puntoAbierto, setPuntoAbierto] = useState<string | null>(null);
  // Celda de la agrupación que el usuario abrió. Mientras exista, los puntos de
  // las otras se atenúan: es lo que hace legible que una burbuja de 4 pueda ser
  // 2 puntos (un edificio de 3 más un suelto). Ver `atenuar()` en `estilo.ts`.
  const [celdaAbierta, setCeldaAbierta] = useState<string | null>(null);
  const [mapa, setMapa] = useState<maplibregl.Map | null>(null);
  // Los vuelos van SIEMPRE por acá y nunca por `mapa.flyTo()` a pelo: los
  // controles ponen la bandera que impide que el zoom del camino recalcule el
  // nivel y borre la comuna recién elegida. Ver `ControlesMapa`.
  const [controles, setControles] = useState<ControlesMapa | null>(null);
  const [pantallaCompleta, setPantallaCompleta] = useState(false);
  const region = useRef<HTMLDivElement>(null);

  // La pestaña la sugiere el nivel, pero **una vez que el usuario elige, manda
  // su elección**: cambiar de nivel no se la pisa. La pantalla sugiere dónde
  // mirar, no decide por él.
  const [pestanaElegida, setPestanaElegida] = useState<PestanaPanel | null>(null);
  const pestana = pestanaElegida ?? PESTANA_POR_NIVEL[nivel];

  // --- Geometría comunal, independiente del conteo ---------------------------
  useEffect(() => {
    const control = new AbortController();
    cargarGeometriaComunal(control.signal)
      .then(setGeometrias)
      .catch((error: unknown) => {
        if (control.signal.aborted) return;
        // Sin geometría no hay mapa, y eso es un estado declarado: manda la
        // lista de comunas, que dice exactamente lo mismo sin depender del
        // render cartográfico.
        console.error('Torre: no se pudo cargar la geometría comunal', error);
        setFallaGeometria(true);
      });
    return () => control.abort();
  }, []);

  // --- Encuadre de entrada: lo que el courier reparte, no una constante ------
  // Se hace UNA sola vez por montaje. Si se repitiera con cada refresco de
  // realtime, la cámara daría un tirón mientras el usuario está navegando —y el
  // realtime entra cada pocos segundos en una operación activa.
  const encuadrarLaCarga = useCallback(
    (duracion: number) => {
      if (!controles) return;
      const limites = geometrias ? limitesDeLaCarga(geometrias, estado.comunas, estado.puntos) : null;
      if (limites) controles.encuadrarRegion(limites, duracion);
      // Día sin carga, o geometría aún sin cargar: el encuadre por defecto de la
      // RM. Es el único caso en que la constante sigue mandando.
      else controles.volarA(ENCUADRE_RM.centro, ZOOM_DESTINO.region, duracion);
    },
    [controles, geometrias, estado.comunas, estado.puntos],
  );

  const yaEncuadrado = useRef(false);
  useEffect(() => {
    if (yaEncuadrado.current || !geometrias || !controles) return;
    if (!limitesDeLaCarga(geometrias, estado.comunas, estado.puntos)) return;
    yaEncuadrado.current = true;
    encuadrarLaCarga(0);
  }, [geometrias, controles, estado.comunas, estado.puntos, encuadrarLaCarga]);

  // --- Pantalla completa -----------------------------------------------------
  useEffect(() => {
    const alCambiar = () => setPantallaCompleta(document.fullscreenElement === region.current);
    document.addEventListener('fullscreenchange', alCambiar);
    return () => document.removeEventListener('fullscreenchange', alCambiar);
  }, []);

  const alternarPantallaCompleta = useCallback(() => {
    if (document.fullscreenElement) void document.exitFullscreen();
    else void region.current?.requestFullscreen();
  }, []);

  // --- Navegación ------------------------------------------------------------
  const entrarEnComuna = useCallback(
    (nombre: string) => {
      setComunaActiva(nombre);
      setPuntoAbierto(null);
      setCeldaAbierta(null);
      setNivel('agrupacion');

      // Se ENCUADRA la comuna, no se vuela a un zoom fijo: las de la RM van de
      // 7 km² a casi 200, y con un zoom único de la grande solo se ve un pedazo
      // —sin un borde a la vista no hay forma de saber en cuál estás— y la
      // chica queda diminuta entre sus vecinas. Ver `ControlesMapa.encuadrarEn`.
      const geometria = geometrias?.get(claveComuna(nombre));
      if (geometria && controles) {
        controles.encuadrarEn(limitesDe(geometria));
        return;
      }

      // Respaldo cuando la geometría todavía no cargó: el centroide y el zoom
      // de siempre. Peor encuadre, pero la navegación no se queda muerta.
      const destino = estado.comunas.find((c) => c.nombre === nombre);
      if (destino) {
        controles?.volarA([destino.centro.long, destino.centro.lat], ZOOM_DESTINO.comuna);
      }
    },
    [estado.comunas, controles, geometrias],
  );

  const volverALaRegion = useCallback(() => {
    setComunaActiva(null);
    setPuntoAbierto(null);
    setCeldaAbierta(null);
    setNivel('comuna');
    // Al MISMO encuadre con que se entró, no a la constante de la RM: si la
    // vuelta usara `ENCUADRE_RM`, una comuna periférica como Colina aparecería
    // al abrir la pantalla y desaparecería al volver de ella.
    encuadrarLaCarga(700);
  }, [encuadrarLaCarga]);

  // La ficha es del nivel 3 y solo del nivel 3: fuera de ahí quedaría señalando
  // un punto que dejó de dibujarse.
  //
  // Se DERIVA en vez de limpiarse con un efecto. Un efecto que hace `setState`
  // encadena un render extra, y en el intermedio la ficha alcanza a pintarse
  // sobre el nivel equivocado — un parpadeo por cada salida. Derivar no tiene
  // estado intermedio que pueda verse.
  const puntoVisible = nivel === 'punto' ? puntoAbierto : null;
  // La agrupación abierta es del nivel 3 y de la comuna en que se abrió: fuera
  // de ahí, atenuar puntos «ajenos» no significaría nada. Se deriva por el mismo
  // motivo que `puntoVisible` — un efecto con `setState` encadena un render y
  // deja ver un frame con la atenuación puesta en el nivel equivocado.
  const celdaVisible = nivel === 'punto' ? celdaAbierta : null;

  /**
   * Subir un escalón del zoom semántico: puntos → comuna → región.
   *
   * Al volver al nivel 2 se RE-ENCUADRA la comuna. Sin eso la cámara se queda en
   * el zoom de calle con el que se entró al nivel 3 y el usuario aterriza mirando
   * una esquina, con las burbujas repartidas fuera de cuadro: el nivel dice
   * «comuna» y la vista no.
   */
  const subirDeNivel = useCallback(() => {
    if (nivel === 'punto') {
      setPuntoAbierto(null);
      setCeldaAbierta(null);
      setNivel('agrupacion');
      const geometria = comunaActiva ? geometrias?.get(claveComuna(comunaActiva)) : null;
      if (geometria && controles) controles.encuadrarEn(limitesDe(geometria));
      return;
    }
    if (comunaActiva) volverALaRegion();
  }, [nivel, comunaActiva, geometrias, controles, volverALaRegion]);

  /**
   * `Esc` sale del nivel. Antes solo cerraba la ficha, y la salida por rueda casi
   * no tiene recorrido en las comunas grandes (Colina entra a z≈9,5 con el suelo
   * en 8,8), así que quedaba una sola forma de salir: la miga.
   *
   * **Cede ante la ficha.** Si hay una abierta, su propio `Esc` la cierra y este
   * no hace nada — un solo `Esc` no puede cerrar la tarjeta y cambiar el nivel a
   * la vez. El segundo `Esc` ya sube.
   */
  useEffect(() => {
    const alPresionar = (e: KeyboardEvent) => {
      if (e.key !== 'Escape' || puntoVisible) return;
      subirDeNivel();
    };
    window.addEventListener('keydown', alPresionar);
    return () => window.removeEventListener('keydown', alPresionar);
  }, [puntoVisible, subirDeNivel]);

  const etiquetasIncidencia = new Map(
    estado.incidencias.map((i) => [i.pedidoId, i.etiqueta] as const),
  );

  const hayMapa = geometrias !== null && !fallaGeometria;
  const sinPedidos = estado.estado === 'sin_pedidos';
  // Sin basemap publicado el mapa corre degradado: es un estado declarado en
  // `config.ts`, no un error que atajar.
  const sinPlanoUrbano = urlBasemap() === null;

  // Dos derivados que el contrato no trae y la pantalla necesita, sacados de los
  // puntos del mapa: no son dato nuevo, son la misma carga leída por otro eje.
  const comunaPorConductor: Record<string, string> = {};
  const conductoresPorComuna: Record<string, Set<string>> = {};
  for (const punto of estado.puntos) {
    if (!punto.comuna || !punto.conductorId) continue;
    // La primera comuna con carga pendiente de ese conductor; los puntos vienen
    // ordenados por el composer, así que es estable entre renders.
    if (!comunaPorConductor[punto.conductorId]) {
      comunaPorConductor[punto.conductorId] = punto.comuna;
    }
    (conductoresPorComuna[punto.comuna] ??= new Set()).add(punto.conductorId);
  }
  // Cuántos objetos hay dibujados en el nivel actual. Va en el distintivo de
  // nivel: sin la cifra, «NIVEL 1 · COMUNA» dice dónde estás y no cuánto estás
  // mirando, que es la mitad útil.
  const conteoDelNivel =
    nivel === 'comuna'
      ? `${estado.comunas.length} comunas`
      : nivel === 'punto'
        ? `${estado.puntos.length} puntos`
        : `${estado.puntos.length} en la comuna`;

  // Los extremos REALES del día, para la leyenda. La rampa es de cuartiles, así
  // que unos cortes escritos serían inventados; los extremos, en cambio, son
  // una magnitud (regla 3) y se mueven solos con la operación.
  const pendientesConCarga = estado.comunas
    .map((c) => c.pendientes)
    .filter((p) => p > 0);
  const extremosDeCarga = {
    min: pendientesConCarga.length > 0 ? Math.min(...pendientesConCarga) : 0,
    max: pendientesConCarga.length > 0 ? Math.max(...pendientesConCarga) : 0,
  };

  const conteoConductoresPorComuna = Object.fromEntries(
    Object.entries(conductoresPorComuna).map(([comuna, ids]) => [comuna, ids.size]),
  );

  return (
    <div className="space-y-5">
      {/* Cabecera: `h1` + una línea de resumen, igual que toda pantalla de
          `(tenant)`. La Torre es un módulo, no una consola. */}
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h1 className="text-xl font-semibold">Torre de control</h1>
          <p className="text-sm text-muted-foreground">
            {sinPedidos
              ? 'No hay pedidos con compromiso para hoy.'
              : `${estado.courier.nombre} · faltan ${estado.resumen.pendientes} de ${estado.resumen.total} por entregar`}
          </p>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          {/* SOLO LECTURA, con la trama del tono inerte. Es lo que explica por
              qué esta pantalla no tiene un solo control que cambie algo: no es
              que falten botones, es que la Torre lee y enlaza. Sin decirlo,
              quien llega buscando reasignar cree que la pantalla está a medio
              hacer. La trama importa — en monocromo el gris no distingue
              «inerte» de «neutro» (regla 5). */}
          <DistintivoEstado tono="inert" etiqueta="Solo lectura" />
          {/* F5: Realtime como SEÑAL → `router.refresh()`. El dato lo sigue
              leyendo el servidor, así que el aislamiento por RLS no se toca. */}
          <IndicadorEnVivo
            tenantId={tenantId}
            tablas={[
              { schema: 'operacion', tabla: 'pedidos' },
              { schema: 'operacion', tabla: 'incidencias' },
            ]}
          />
        </div>
      </div>

      <BandaOlas olas={estado.olas} />

      <CifrasTorre resumen={estado.resumen} frescura={estado.frescura} />

      {/* La región cartográfica.
          `< lg` **manda la lista y el mapa se pliega**, no se retira.
          El motivo por el que antes se retiraba era el panel de 340 px fijos
          aplastándolo a 124 px a 768 — pero bajo `lg` ese panel no se renderiza,
          así que a ancho completo y con alto propio el mapa sí es un mapa. Se
          abre a pedido («Ver el mapa») y no por omisión: quien entra desde el
          teléfono viene a ver cuántos faltan, no a navegar cartografía. */}
      <div
        ref={region}
        className={cn(
          'overflow-hidden rounded-lg border border-border bg-card',
          // En pantalla completa el contenedor ocupa el viewport; sin esto,
          // conserva su alto calculado y deja el resto en negro.
          pantallaCompleta && 'h-screen rounded-none border-0',
        )}
      >
        <div
          className="flex min-h-0 flex-col lg:flex-row"
          style={{
            height: pantallaCompleta ? '100vh' : 'max(420px, min(68vh, 720px))',
          }}
        >
          {/* --- Mapa --- */}
          <div
            className={cn(
              'relative min-w-0 flex-1 lg:block',
              // En teléfono el mapa tiene alto propio: dentro de un `flex-col`
              // con `flex-1` compartido con la lista quedaría a la mitad de una
              // mitad.
              mapaAbiertoMovil ? 'h-[320px] shrink-0 lg:h-auto' : 'hidden',
            )}
          >
            {hayMapa ? (
              <>
                <MapaTorre
                  tema={tema}
                  geometrias={geometrias}
                  comunas={estado.comunas}
                  puntos={estado.puntos}
                  comunaActiva={comunaActiva}
                  nivel={nivel}
                  onNivel={setNivel}
                  onComuna={setComunaActiva}
                  onPunto={setPuntoAbierto}
                  celdaAbierta={celdaVisible}
                  onCelda={setCeldaAbierta}
                  onMapaListo={setMapa}
                  onControles={setControles}
                />
                <PlacasComuna
                  mapa={mapa}
                  comunas={estado.comunas}
                  visible={nivel === 'comuna'}
                  onComuna={entrarEnComuna}
                />
                {/* El marcador de conductor aparece en el nivel de punto, que es
                    donde el tablero lo pone (§13.2): a zoom de comuna no aporta
                    nada y compite con la rampa de carga.
                    ⚠️ Hoy no dibuja ninguno — el rastreo está apagado por
                    privacidad y `posicion` llega siempre en `null`. */}
                <MarcadoresConductor
                  mapa={mapa}
                  conductores={estado.conductores}
                  visible={nivel === 'punto'}
                />
                {nivel === 'punto' ? (
                  <CapaFichas
                    mapa={mapa}
                    puntos={estado.puntos.filter(
                      (p) =>
                        comunaActiva === null ||
                        (p.comuna !== null && p.comuna === comunaActiva),
                    )}
                    activo={puntoVisible}
                    etiquetasIncidencia={etiquetasIncidencia}
                    celdaAbierta={celdaVisible}
                    onCerrar={() => setPuntoAbierto(null)}
                    onAbrir={setPuntoAbierto}
                  />
                ) : null}

                {/* Migas de pan: siempre visibles arriba a la izquierda. El
                    nombre de la comuna lo produce la SELECCIÓN, no el zoom — con
                    la rueda se baja de nivel sin elegir comuna, y ahí la miga se
                    queda en «Región Metropolitana». */}
                <nav
                  aria-label="Nivel del mapa"
                  // Por encima de las fichas: son la navegación de la pantalla y
                  // no pueden quedar tapadas por una previsualización que asoma.
                  // `data-reserva-placas` le dice al des-solape de las placas que
                  // este rectángulo ya está ocupado.
                  data-reserva-placas
                  className="pointer-events-none absolute top-3 left-3 z-10 flex flex-wrap items-center gap-1 text-xs"
                >
                  {/* El distintivo de nivel va JUNTO a las migas, no en su
                      lugar: el tablero pide decir en qué nivel se está y cuántos
                      objetos hay dibujados, y las migas además NAVEGAN — que es
                      algo que el tablero no dibuja y que no se puede perder. */}
                  <span className="rounded-md border border-border bg-card/90 px-2 py-1 font-medium uppercase tracking-[0.08em] text-[10px] text-muted-foreground backdrop-blur-[2px]">
                    Nivel {NUMERO_DE_NIVEL[nivel]} · {NOMBRE_DE_NIVEL[nivel]} ·
                    <span className="ml-1.5 tabular-nums normal-case tracking-normal">
                      {conteoDelNivel}
                    </span>
                  </span>
                  <button
                    type="button"
                    onClick={volverALaRegion}
                    className="pointer-events-auto rounded-md border border-border bg-card/90 px-2 py-1 font-medium backdrop-blur-[2px] transition-colors hover:bg-card"
                  >
                    Región Metropolitana
                  </button>
                  {comunaActiva ? (
                    <>
                      <span className="text-muted-foreground">/</span>
                      {/*
                        Navegable solo desde el nivel 3, que es cuando queda algo
                        por encima. En el nivel 2 es el sitio donde ya estás, y un
                        botón que no lleva a ninguna parte miente.

                        Antes era siempre un `<span>` dentro de un `<nav>` con
                        `pointer-events-none`: el clic atravesaba la miga y llegaba
                        al mapa, así que «salir por la miga» parecía funcionar por
                        un efecto lateral del clic en el lienzo.
                      */}
                      {nivel === 'punto' ? (
                        <button
                          type="button"
                          onClick={subirDeNivel}
                          className="pointer-events-auto rounded-md border border-border bg-card/90 px-2 py-1 font-medium backdrop-blur-[2px] transition-colors hover:bg-card"
                        >
                          {comunaActiva}
                        </button>
                      ) : (
                        <span className="rounded-md border border-border bg-card/90 px-2 py-1 font-medium backdrop-blur-[2px]">
                          {comunaActiva}
                        </span>
                      )}
                    </>
                  ) : null}
                  {nivel === 'punto' ? (
                    <>
                      <span className="text-muted-foreground">/</span>
                      <span className="rounded-md border border-border bg-card/90 px-2 py-1 text-muted-foreground backdrop-blur-[2px]">
                        Puntos de entrega
                      </span>
                    </>
                  ) : null}
                </nav>

                <button
                  type="button"
                  onClick={alternarPantallaCompleta}
                  data-reserva-placas
                  className="absolute top-3 right-3 z-10 rounded-md border border-border bg-card/90 p-1.5 backdrop-blur-[2px] transition-colors hover:bg-card focus-visible:outline-solid focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring"
                  aria-label={pantallaCompleta ? 'Salir de pantalla completa' : 'Pantalla completa'}
                >
                  {pantallaCompleta ? (
                    <Minimize2 className="size-4" aria-hidden="true" />
                  ) : (
                    <Maximize2 className="size-4" aria-hidden="true" />
                  )}
                </button>

                {/* ⚠️ EL MODO DEGRADADO SE DECLARA, NO SE INSINÚA.
                    Sin plano urbano el mapa se ve raro: comunas y puntos sobre
                    un fondo liso. Es un **estado válido**, no un fallo — el
                    basemap es un recorte auto-hospedado que puede no estar
                    publicado — pero hasta ahora lo único que lo decía era un
                    sufijo de once píxeles pegado a la atribución, abajo a la
                    derecha, donde nadie mira. Quien abría la Torre así no tenía
                    forma de saber si el mapa estaba roto.
                    Va en `attention` y no en `fault`: nada se rompió, y el dato
                    operativo —que es lo que la pantalla existe para contar—
                    está completo. */}
                {/* La leyenda, al pie del mapa. Va dentro del contenedor del
                    lienzo para que también acompañe en pantalla completa. */}
                <LeyendaMapa
                  paleta={paletaDe(tema)}
                  minPendientes={extremosDeCarga.min}
                  maxPendientes={extremosDeCarga.max}
                />

                {sinPlanoUrbano ? (
                  <div
                    role="status"
                    className="pointer-events-none absolute inset-x-0 top-0 z-10 flex flex-wrap items-center gap-x-2 gap-y-0.5 border-b border-attention-line bg-attention-bg px-3 py-1.5 text-xs text-attention-fg"
                  >
                    <span className="font-medium">El plano urbano no cargó.</span>
                    <span>
                      Las comunas, los puntos y las cifras son reales; lo que falta es el mapa
                      de calles de fondo.
                    </span>
                  </div>
                ) : null}

                {sinPedidos ? (
                  // La ciudad no desaparece porque sea domingo: las comunas
                  // siguen dibujadas y encima va una sola frase.
                  <div className="pointer-events-none absolute inset-0 flex items-center justify-center bg-background/70">
                    <p className="rounded-md border border-border bg-card px-3 py-2 text-sm shadow-xs">
                      No hay pedidos con compromiso para hoy
                    </p>
                  </div>
                ) : null}

                {/* Atribución: condición de licencia, no cortesía. No puede
                    esconderse tras un botón de «i». */}
                <p
                  data-reserva-placas
                  className="pointer-events-none absolute right-2 bottom-1 text-[10px] text-muted-foreground"
                >
                  {/* El sufijo «· sin plano urbano» se fue de acá: lo dice la
                      franja de arriba, entera y donde se ve. */}
                  {ATRIBUCIONES.map((a) => a.etiqueta).join(' · ')}
                </p>
              </>
            ) : fallaGeometria ? (
              <div className="flex h-full items-center justify-center p-6 text-center">
                <p className="text-sm text-muted-foreground">
                  No se pudo cargar la geometría comunal. La lista de al lado tiene la misma
                  información.
                </p>
              </div>
            ) : (
              // Esqueleto con la forma final, nunca un spinner de página.
              <Skeleton className="h-full w-full rounded-none" />
            )}
          </div>

          {/* --- Lista de comunas: la superficie principal bajo `lg` --- */}
          <div className="flex min-h-0 flex-1 flex-col overflow-hidden lg:hidden">
            <button
              type="button"
              onClick={() => setMapaAbiertoMovil((v) => !v)}
              aria-expanded={mapaAbiertoMovil}
              className="flex shrink-0 items-center justify-between border-b border-border px-4 py-2.5 text-sm font-medium transition-colors hover:bg-muted/60"
            >
              {mapaAbiertoMovil ? 'Ocultar el mapa' : 'Ver el mapa'}
              <ChevronDown
                className={cn(
                  'size-4 transition-transform',
                  mapaAbiertoMovil && 'rotate-180',
                )}
                aria-hidden="true"
              />
            </button>
            <div className="min-h-0 flex-1 overflow-y-auto">
              <ListaComunas
                comunas={estado.comunas}
                comunaActiva={comunaActiva}
                onComuna={setComunaActiva}
              />
            </div>
          </div>

          {/* --- Panel --- */}
          <div className="hidden min-h-0 w-[340px] shrink-0 border-l border-border lg:flex lg:flex-col">
            <PanelTorre
              pestana={pestana}
              onPestana={setPestanaElegida}
              conductores={estado.conductores}
              comunas={estado.comunas}
              diaCerrado={estado.corte.diaCerrado}
              comunaPorConductor={comunaPorConductor}
              conductoresPorComuna={conteoConductoresPorComuna}
              fichaComuna={
                comunaActiva
                  ? (estado.comunas.find((c) => c.nombre === comunaActiva) ?? null)
                  : null
              }
              comunaActiva={comunaActiva}
              onComuna={entrarEnComuna}
            />
          </div>
        </div>
      </div>
    </div>
  );
}
