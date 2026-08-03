"use client";

import { Suspense, use, useCallback, useEffect, useReducer, type Dispatch } from "react";
import type { CabeceraTorre } from "@/modules/contexto/composer";
import type {
  CapaMapa,
  EstadoCapa,
  EstadoTorre,
  Horizonte,
  TorreRespuesta,
} from "@/modules/contexto/contrato-torre";
import { MENSAJES_ESTADO_TORRE } from "@/modules/contexto/mensajes-estado";
import {
  ESTADO_CONSOLA_INICIAL,
  reducirConsola,
  type AccionConsola,
  type EstadoConsola,
} from "../_lib/estado-consola";
import { HORIZONTES } from "../_lib/horizontes";
import { DefsPatronesRiesgo } from "./trama-riesgo";
import { EsqueletoRegion } from "./esqueleto-region";
import { R1BarraSuperior } from "./r1-barra-superior";
import { PanelMarca } from "./panel-marca";
import { BandaMensajeEstado } from "./banda-mensaje-estado";
import { R2OlaEntrante } from "./r2-ola-entrante";
import { R3Mapa } from "./r3-mapa";
import { Riel } from "./riel/riel";
import { R5LineaDeTiempo } from "./r5-linea-tiempo";
import { CabeceraSticky } from "./movil/cabecera-sticky";
import { TitularRiesgo } from "./movil/titular-riesgo";
import { ContadorSinUbicar } from "./contador-sin-ubicar";
import { OlaEntranteMovil } from "./movil/ola-entrante-movil";
import { FichaExcepcion } from "./riel/ficha-excepcion";
import { FilaZona } from "./fila-zona";
import { DesgloseZona } from "./riel/desglose-zona";

interface Props {
  /** Courier y frescura de fuentes. Llega antes que el tablero: R1 no espera. */
  cabecera: Promise<CabeceraTorre>;
  /** Los tres horizontes ya calculados. El cambio de horizonte es de cliente. */
  tablero: Promise<TorreRespuesta>;
  /** Destino del control de salida de R1 (la consola vive fuera del shell). */
  hrefSalida: string;
}

/**
 * Raíz de la consola.
 *
 * -----------------------------------------------------------------------------
 * POR QUÉ RECIBE PROMESAS Y NO DATOS
 * -----------------------------------------------------------------------------
 * El handoff (§6) es explícito: **no hay spinner de página**. Cada región llega
 * por su cuenta y ninguna bloquea a otra, y mientras falta, el hueco NOMBRA lo
 * que falta — un rectángulo gris anónimo no le dice al coordinador si lo que no
 * llegó es el mapa o el riel.
 *
 * Eso pide un `<Suspense>` POR REGIÓN, y una región no puede tener su propio
 * límite si su padre ya esperó el dato por ella. Por eso el Server Component
 * pasa las promesas sin resolver y cada región las consume con `use()` dentro de
 * su límite: R1 pinta en cuanto llega la frescura, sin esperar a que el motor de
 * riesgo termine de armar cinco zonas por tres horizontes.
 *
 * El estado de interacción (zona seleccionada, capas, horizonte) sigue
 * viviendo AQUÍ, en un solo reducer, porque es compartido: el mapa y el riel
 * tienen que estar de acuerdo sobre qué zona está seleccionada.
 *
 * -----------------------------------------------------------------------------
 * CAMBIAR DE HORIZONTE NO VIAJA AL SERVIDOR
 * -----------------------------------------------------------------------------
 * `TorreRespuesta` trae `hoy`, `manana` y `72h` calculados. Cambiar de horizonte
 * solo cambia de qué clave del objeto se lee. Nada de `router.refresh()` ni de
 * `revalidatePath`: cualquiera de los dos remontaría el tablero y haría saltar
 * la posición de scroll del riel, que el handoff prohíbe.
 *
 * Dos árboles paralelos (regla 7 + README §5): uno de escritorio y uno de móvil.
 * Tailwind alterna cuál se ve; los dos existen en el DOM, pero solo uno entra al
 * árbol de accesibilidad, gracias a `display:none`.
 */
export function TorreConsola({ cabecera, tablero, hrefSalida }: Props) {
  const [consola, dispatch] = useReducer(reducirConsola, ESTADO_CONSOLA_INICIAL);

  const seleccionarZona = useCallback((zonaId: string) => {
    dispatch({ tipo: "seleccionar-zona", zonaId });
    // Solo en móvil: ahí la página sí se desplaza y el desglose que se abre
    // queda fuera de pantalla. En escritorio la consola es de viewport fijo y
    // no hay nada que desplazar — llamar a `scrollIntoView` ahí solo podría
    // mover contenedores con `overflow` por dentro, que es justo lo que el
    // handoff prohíbe (nunca hacer saltar la posición del riel).
    document.getElementById("zonas-riesgo-movil")?.scrollIntoView({ behavior: "smooth", block: "start" });
  }, []);

  // Atajos de teclado (README §6). Cmd/Ctrl+K y Escape funcionan siempre;
  // el resto se ignora mientras se escribe
  // en un campo de texto (para no romper la escritura normal).
  useEffect(() => {
    function alTeclear(e: KeyboardEvent) {
      if (e.key === "Escape") {
        dispatch({ tipo: "escape" });
        return;
      }

      const activo = document.activeElement;
      const escribiendo =
        activo instanceof HTMLElement &&
        (activo.tagName === "INPUT" || activo.tagName === "TEXTAREA" || activo.isContentEditable);
      if (escribiendo) return;

      if (["1", "2", "3"].includes(e.key)) {
        const horizonte = HORIZONTES[Number(e.key) - 1]?.valor;
        if (horizonte) dispatch({ tipo: "cambiar-horizonte", horizonte });
        return;
      }
      if (e.key.toLowerCase() === "l") {
        dispatch({ tipo: "alternar-lista" });
        return;
      }
      if (e.key.toLowerCase() === "m") {
        dispatch({ tipo: consola.marcando ? "cancelar-modo-marca" : "activar-modo-marca" });
      }
    }
    window.addEventListener("keydown", alTeclear);
    return () => window.removeEventListener("keydown", alTeclear);
  }, [consola.marcando]);

  const comun = { tablero, consola, dispatch, seleccionarZona };

  return (
    <div
      tabIndex={0}
      aria-label="Torre de control — consola de anticipación operativa"
      className="flex h-full flex-col outline-none"
    >
      <DefsPatronesRiesgo />

      {/* ================= Escritorio ================= */}
      {/*
        Viewport fijo, como manda el handoff: la consola ocupa exactamente el
        alto de la ventana y NADA de ella scrollea salvo el riel. Es posible
        porque la ruta vive en el grupo `(consola)` y no dentro del `AppShell`
        de `(tenant)` — ver `src/app/(consola)/layout.tsx`.

        `min-h-0` en la fila del medio no es decorativo: sin él, un hijo flex
        con contenido desbordante reclama su alto intrínseco (`min-height:auto`)
        y empuja R5 fuera de la pantalla en vez de scrollear por dentro. Es el
        detalle que hace que "solo el riel scrollea" sea verdad.
      */}
      <div className="hidden h-full flex-col gap-[var(--tc-regla-may)] overflow-hidden bg-tc-chasis lg:flex">
        <Suspense fallback={<EsqueletoRegion region="R1 · barra superior" alto="var(--tc-h-barra)" />}>
          <RegionR1
            cabecera={cabecera}
            horizonte={consola.horizonte}
            hrefSalida={hrefSalida}
            dispatch={dispatch}
          />
        </Suspense>

        {/* La banda no tiene esqueleto propio: es la única región que puede no
            existir (con_excepciones no tiene mensaje), así que un hueco con
            nombre ahí anunciaría algo que quizá nunca llega. */}
        <Suspense fallback={null}>
          <RegionBanda tablero={tablero} horizonte={consola.horizonte} />
        </Suspense>

        {/* R2 tampoco lleva esqueleto: si no hay ola entrante la región NO se
            dibuja (no se deja un hueco), así que un esqueleto de 132 px
            aparecería y se desplomaría al llegar el dato — el salto de layout
            exacto que los esqueletos existen para evitar. */}
        <Suspense fallback={null}>
          <RegionR2 tablero={tablero} horizonte={consola.horizonte} />
        </Suspense>

        <div className="flex min-h-0 flex-1 gap-[var(--tc-regla-may)]">
          <div id="zonas-riesgo-escritorio" className="flex flex-1 overflow-hidden">
            <Suspense fallback={<EsqueletoRegion region="R3 · mapa" className="flex-1" />}>
              <RegionR3 {...comun} />
            </Suspense>
          </div>
          <Suspense
            fallback={<EsqueletoRegion region="R4 · riel" className="w-[var(--tc-w-riel)] shrink-0" />}
          >
            <RegionRiel {...comun} />
          </Suspense>
        </div>

        <Suspense fallback={<EsqueletoRegion region="R5 · línea de tiempo" alto="var(--tc-h-tiempo)" />}>
          <RegionR5 tablero={tablero} horizonte={consola.horizonte} />
        </Suspense>
      </div>

      {/* ================= Móvil ================= */}
      {/* Aquí SÍ scrollea la página: no hay mapa que proteger (README §5) y el
          orden es una lista de arriba abajo. El scroll vive en este contenedor
          porque el layout de la ruta fija el alto de la ventana. */}
      <div className="flex h-full flex-col overflow-y-auto lg:hidden">
        <Suspense fallback={<EsqueletoRegion region="Cabecera" alto="var(--tc-h-barra)" />}>
          <RegionCabeceraMovil
            cabecera={cabecera}
            horizonte={consola.horizonte}
            dispatch={dispatch}
          />
        </Suspense>
        <Suspense fallback={<EsqueletoRegion region="Zonas y excepciones" alto="60vh" />}>
          <RegionMovil {...comun} />
        </Suspense>
      </div>

      {consola.marcaProv ? (
        <PanelMarca
          posicion={consola.marcaProv}
          onCancelar={() => dispatch({ tipo: "cancelar-modo-marca" })}
          onGuardada={() => dispatch({ tipo: "cancelar-modo-marca" })}
        />
      ) : consola.marcando ? (
        <div
          role="status"
          className="fixed bottom-6 left-1/2 z-50 -translate-x-1/2 border-2 border-tc-tinta bg-tc-tinta px-4 py-2.5 text-[12px] font-semibold text-tc-papel shadow-tc-lg"
        >
          {consola.lista
            ? "Modo marca: estás en la vista de lista. Pulsa L para volver al mapa y dejar la marca. Esc cancela."
            : "Haz clic en el mapa para dejar una marca operativa. Esc cancela."}
        </div>
      ) : null}
    </div>
  );
}

// =============================================================================
// Regiones — cada una consume el dato dentro de SU límite de Suspense
// =============================================================================

interface PropsComunes {
  tablero: Promise<TorreRespuesta>;
  consola: EstadoConsola;
  dispatch: Dispatch<AccionConsola>;
  seleccionarZona: (zonaId: string) => void;
}

/**
 * El `EstadoTorre` del horizonte que el usuario tiene puesto.
 *
 * `olas` no es un horizonte del motor de riesgo: es la proyección de volumen del
 * calendario comercial, que todavía no existe (bloque C). Mientras tanto cae a
 * `hoy` — el tablero sigue siendo verdadero, y R2 ya sabe decir que no hay ola
 * que mostrar. Es preferible a dejar la pantalla en blanco al pulsar `4`.
 */
function useHorizonte(tablero: Promise<TorreRespuesta>, horizonte: Horizonte): EstadoTorre {
  const respuesta = use(tablero);
  return respuesta.horizontes[horizonte];
}

/**
 * Las capas que el usuario dejó encendidas, MENOS las que el servidor declaró
 * no disponibles.
 *
 * El estado inicial del reducer trae Riesgo y Lluvia encendidas (regla del
 * handoff), pero la disponibilidad depende del dato del día: si la fuente de
 * clima nunca corrió, la consola mostraba «Lluvia» marcada como activa y al
 * mismo tiempo bloqueada con su motivo, dos cosas contradictorias en el mismo
 * control. El filtro se aplica al pintar y no borrando del reducer: en cuanto
 * la fuente vuelva, la capa se enciende sola sin que el usuario tenga que
 * acordarse de reactivarla.
 */
function capasEncendibles(
  activas: readonly CapaMapa[],
  capas: readonly EstadoCapa[],
): CapaMapa[] {
  const disponibles = new Set(capas.filter((c) => c.disponible).map((c) => c.id));
  return activas.filter((capa) => disponibles.has(capa));
}

function RegionR1({
  cabecera,
  horizonte,
  hrefSalida,
  dispatch,
}: {
  cabecera: Promise<CabeceraTorre>;
  horizonte: Horizonte;
  hrefSalida: string;
  dispatch: Dispatch<AccionConsola>;
}) {
  const datos = use(cabecera);
  return (
    <R1BarraSuperior
      courierNombre={datos.courier.nombre}
      horizonte={horizonte}
      frescura={datos.frescura}
      hrefSalida={hrefSalida}
      onCambiarHorizonte={(valor) => dispatch({ tipo: "cambiar-horizonte", horizonte: valor })}
    />
  );
}

function RegionBanda({
  tablero,
  horizonte,
}: {
  tablero: Promise<TorreRespuesta>;
  horizonte: Horizonte;
}) {
  const estado = useHorizonte(tablero, horizonte);
  return <BandaMensajeEstado estado={estado.estado} mensajes={MENSAJES_ESTADO_TORRE} />;
}

function RegionR2({
  tablero,
  horizonte,
}: {
  tablero: Promise<TorreRespuesta>;
  horizonte: Horizonte;
}) {
  const estado = useHorizonte(tablero, horizonte);
  return <R2OlaEntrante ola={estado.olaEntrante} />;
}

function RegionR3({ tablero, consola, dispatch, seleccionarZona }: PropsComunes) {
  const estado = useHorizonte(tablero, consola.horizonte);
  return (
    <R3Mapa
      estadoPantalla={estado.estado}
      zonas={estado.zonas}
      zonaSeleccionada={consola.zona}
      capas={estado.capas}
      capasActivas={capasEncendibles(consola.capas, estado.capas)}
      zoom={consola.zoom}
      pedidosSinGeocodificar={estado.pedidosSinGeocodificar}
      celdasClima={estado.celdasClima}
      conductores={estado.conductores}
      marcasOperativas={estado.marcasOperativas}
      pedidos={estado.pedidos}
      marcando={consola.marcando}
      marcaProvisional={consola.marcaProv}
      mostrarLista={consola.lista}
      onSeleccionarZona={seleccionarZona}
      onAlternarCapa={(capa) => dispatch({ tipo: "alternar-capa", capa })}
      onCambiarZoom={(zoom) => dispatch({ tipo: "cambiar-zoom", zoom })}
      onAlternarLista={() => dispatch({ tipo: "alternar-lista" })}
      onColocarMarca={(long, lat) => dispatch({ tipo: "colocar-marca-provisional", long, lat })}
    />
  );
}

function RegionRiel({ tablero, consola, dispatch, seleccionarZona }: PropsComunes) {
  const estado = useHorizonte(tablero, consola.horizonte);
  return (
    <Riel
      estado={estado.estado}
      metricas={estado.metricas}
      excepciones={estado.excepciones}
      zonas={estado.zonas}
      zonaSeleccionada={consola.zona}
      factorAbierto={consola.factor}
      olaEntrante={estado.olaEntrante}
      ahoraIso={estado.ahora}
      onSeleccionarZona={seleccionarZona}
      onCerrarDesglose={() => dispatch({ tipo: "cerrar-desglose" })}
      onAbrirFactor={(factorId) => dispatch({ tipo: "abrir-factor", factorId })}
    />
  );
}

function RegionR5({
  tablero,
  horizonte,
}: {
  tablero: Promise<TorreRespuesta>;
  horizonte: Horizonte;
}) {
  const estado = useHorizonte(tablero, horizonte);
  return (
    <R5LineaDeTiempo
      bloques={estado.timeline}
      rango={estado.rangoTimeline}
      ahoraIso={estado.ahora}
    />
  );
}

// =============================================================================
// Móvil
// =============================================================================

function RegionCabeceraMovil({
  cabecera,
  horizonte,
  dispatch,
}: {
  cabecera: Promise<CabeceraTorre>;
  horizonte: Horizonte;
  dispatch: Dispatch<AccionConsola>;
}) {
  const datos = use(cabecera);
  return (
    <CabeceraSticky
      ahoraIso={datos.ahoraIso}
      frescura={datos.frescura}
      horizonte={horizonte}
      onCambiarHorizonte={(valor) => dispatch({ tipo: "cambiar-horizonte", horizonte: valor })}
    />
  );
}

function RegionMovil({ tablero, consola, dispatch, seleccionarZona }: PropsComunes) {
  const estado = useHorizonte(tablero, consola.horizonte);
  const zonasOrdenadas = [...estado.zonas].sort((a, b) => b.riesgo - a.riesgo);
  const peorZona = zonasOrdenadas[0] ?? null;
  const zonaActiva = consola.zona ? (estado.zonas.find((z) => z.id === consola.zona) ?? null) : null;
  const excepcionesVisibles = estado.excepciones;

  return (
    <>
      <BandaMensajeEstado estado={estado.estado} mensajes={MENSAJES_ESTADO_TORRE} />

      {estado.estado !== "tranquilo" && peorZona ? <TitularRiesgo zona={peorZona} /> : null}

      <div className="border-b-2 border-tc-chasis bg-tc-papel px-4 py-3">
        <ContadorSinUbicar cantidad={estado.pedidosSinGeocodificar} />
      </div>

      {estado.estado !== "sin_pedidos" ? (
        <div className="border-b-2 border-tc-chasis bg-tc-papel">
          <p className="px-4 pt-3 pb-1 text-[9px] font-extrabold tracking-[0.13em] text-tc-ink-600 uppercase">
            Excepciones · {excepcionesVisibles.length}
          </p>
          {excepcionesVisibles.length === 0 ? (
            <p className="px-4 pb-4 text-[12px] text-tc-ink-700">
              Sin excepciones abiertas. El riel se queda vacío a propósito.
            </p>
          ) : (
            excepcionesVisibles.map((excepcion) => (
              <FichaExcepcion
                key={excepcion.id}
                excepcion={excepcion}
                zonaNombre={estado.zonas.find((z) => z.id === excepcion.zonaId)?.nombre ?? null}
                ahoraIso={estado.ahora}
                onSeleccionarZona={seleccionarZona}
                variante="movil"
              />
            ))
          )}
        </div>
      ) : null}

      <div id="zonas-riesgo-movil" className="border-b-2 border-tc-chasis bg-tc-papel">
        <p className="px-4 pt-3 pb-1 text-[9px] font-extrabold tracking-[0.13em] text-tc-ink-600 uppercase">
          Zonas por riesgo
        </p>
        {zonasOrdenadas.map((zona) => (
          <FilaZona
            key={zona.id}
            zona={zona}
            seleccionada={consola.zona === zona.id}
            onSeleccionar={() => seleccionarZona(zona.id)}
            variante="movil"
          />
        ))}
        {zonaActiva ? (
          <DesgloseZona
            zona={zonaActiva}
            factorAbierto={consola.factor}
            onCerrar={() => dispatch({ tipo: "cerrar-desglose" })}
            onAbrirFactor={(factorId) => dispatch({ tipo: "abrir-factor", factorId })}
          />
        ) : null}
      </div>

      <OlaEntranteMovil ola={estado.olaEntrante} />
    </>
  );
}
