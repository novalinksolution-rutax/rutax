"use client";

import { useCallback, useEffect, useReducer } from "react";
import type { EstadoTorre } from "../_fixture/estado-torre";
import { MENSAJES_ESTADO } from "../_fixture/estado-torre";
import { ESTADO_CONSOLA_INICIAL, reducirConsola } from "../_lib/estado-consola";
import { HORIZONTES } from "../_lib/horizontes";
import { DefsPatronesRiesgo } from "./trama-riesgo";
import { R1BarraSuperior } from "./r1-barra-superior";
import { BandaMensajeEstado } from "./banda-mensaje-estado";
import { R2OlaEntrante } from "./r2-ola-entrante";
import { R3Mapa } from "./r3-mapa";
import { Riel } from "./riel/riel";
import { R5LineaDeTiempo } from "./r5-linea-tiempo";
import { PaletaComandos } from "./paleta-comandos";
import { CabeceraSticky } from "./movil/cabecera-sticky";
import { TitularRiesgo } from "./movil/titular-riesgo";
import { ContadorSinUbicar } from "./contador-sin-ubicar";
import { OlaEntranteMovil } from "./movil/ola-entrante-movil";
import { FichaExcepcion } from "./riel/ficha-excepcion";
import { FilaZona } from "./fila-zona";
import { DesgloseZona } from "./riel/desglose-zona";

interface Props {
  estado: EstadoTorre;
  /** Destino del control de salida de R1 (la consola vive fuera del shell). */
  hrefSalida: string;
}

/**
 * Raíz de la consola. Cliente porque gobierna interacción, teclado y la
 * paleta de comandos; el fetch del dato (hoy, la fixture) queda en el
 * Server Component (`page.tsx`).
 *
 * Dos árboles paralelos (regla 7 + README §5): uno de escritorio (R1 + banda
 * + R2 + [lista de zonas | riel] + R5) y uno de móvil (cabecera sticky +
 * titular + contador + excepciones + zonas + ola). Tailwind alterna cuál se
 * ve con `hidden lg:flex` / `flex lg:hidden` — los dos existen en el DOM,
 * pero solo uno es visible (y por lo tanto solo uno entra al árbol de
 * accesibilidad, gracias a `display:none`).
 */
export function TorreConsola({ estado, hrefSalida }: Props) {
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
  // el resto se ignora mientras la paleta está abierta o mientras se escribe
  // en un campo de texto (para no romper la escritura normal).
  useEffect(() => {
    function alTeclear(e: KeyboardEvent) {
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === "k") {
        e.preventDefault();
        dispatch({ tipo: consola.paleta ? "cerrar-paleta" : "abrir-paleta" });
        return;
      }
      if (e.key === "Escape") {
        dispatch({ tipo: "escape" });
        return;
      }
      if (consola.paleta) return;

      const activo = document.activeElement;
      const escribiendo =
        activo instanceof HTMLElement &&
        (activo.tagName === "INPUT" || activo.tagName === "TEXTAREA" || activo.isContentEditable);
      if (escribiendo) return;

      if (["1", "2", "3", "4"].includes(e.key)) {
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
  }, [consola.paleta, consola.marcando]);

  const zonasOrdenadas = [...estado.zonas].sort((a, b) => b.riesgo - a.riesgo);
  const peorZona = zonasOrdenadas[0] ?? null;
  const zonaActiva = consola.zona ? (estado.zonas.find((z) => z.id === consola.zona) ?? null) : null;
  const excepcionesVisibles = estado.excepciones.filter((e) => !consola.descartadas.includes(e.id));

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
        <R1BarraSuperior
          courierNombre={estado.courier.nombre}
          horizonte={consola.horizonte}
          frescura={estado.frescura}
          hrefSalida={hrefSalida}
          onCambiarHorizonte={(horizonte) => dispatch({ tipo: "cambiar-horizonte", horizonte })}
          onAbrirPaleta={() => dispatch({ tipo: "abrir-paleta" })}
        />
        <BandaMensajeEstado estado={estado.estado} mensajes={MENSAJES_ESTADO} />
        <R2OlaEntrante ola={estado.olaEntrante} />
        <div className="flex min-h-0 flex-1 gap-[var(--tc-regla-may)]">
          <div id="zonas-riesgo-escritorio" className="flex flex-1 overflow-hidden">
            <R3Mapa
              estadoPantalla={estado.estado}
              zonas={estado.zonas}
              zonaSeleccionada={consola.zona}
              capas={estado.capas}
              capasActivas={consola.capas}
              zoom={consola.zoom}
              pedidosSinGeocodificar={estado.pedidosSinGeocodificar}
              celdasClima={estado.celdasClima}
              eventosCiudad={estado.eventosCiudad}
              conductores={estado.conductores}
              incidentesTransito={estado.incidentesTransito}
              marcasOperativas={estado.marcasOperativas}
              marcando={consola.marcando}
              marcaProvisional={consola.marcaProv}
              mostrarLista={consola.lista}
              onSeleccionarZona={seleccionarZona}
              onAlternarCapa={(capa) => dispatch({ tipo: "alternar-capa", capa })}
              onCambiarZoom={(zoom) => dispatch({ tipo: "cambiar-zoom", zoom })}
              onAlternarLista={() => dispatch({ tipo: "alternar-lista" })}
              onColocarMarca={(long, lat) =>
                dispatch({ tipo: "colocar-marca-provisional", long, lat })
              }
            />
          </div>
          <Riel
            estado={estado.estado}
            metricas={estado.metricas}
            excepciones={estado.excepciones}
            descartadas={consola.descartadas}
            zonas={estado.zonas}
            zonaSeleccionada={consola.zona}
            factorAbierto={consola.factor}
            senales={estado.senales}
            olaEntrante={estado.olaEntrante}
            ahoraIso={estado.ahora}
            confirmando={consola.confirmando}
            fuentesAbiertas={consola.senal}
            otrasAbiertas={consola.otras}
            onSeleccionarZona={seleccionarZona}
            onCerrarDesglose={() => dispatch({ tipo: "cerrar-desglose" })}
            onAbrirFactor={(factorId) => dispatch({ tipo: "abrir-factor", factorId })}
            onPedirConfirmacion={(accionId) => dispatch({ tipo: "pedir-confirmacion", accionId })}
            onCancelarConfirmacion={() => dispatch({ tipo: "cancelar-confirmacion" })}
            onConfirmarAccion={() => dispatch({ tipo: "confirmar-accion" })}
            onDescartarExcepcion={(excepcionId) => dispatch({ tipo: "descartar-excepcion", excepcionId })}
            onAlternarFuentes={() => dispatch({ tipo: "alternar-fuentes-senal" })}
            onAlternarOtras={() => dispatch({ tipo: "alternar-otras-senales" })}
          />
        </div>
        <R5LineaDeTiempo bloques={estado.timeline} rango={estado.rangoTimeline} ahoraIso={estado.ahora} />
      </div>

      {/* ================= Móvil ================= */}
      {/* Aquí SÍ scrollea la página: no hay mapa que proteger (README §5) y el
          orden es una lista de arriba abajo. El scroll vive en este contenedor
          porque el layout de la ruta fija el alto de la ventana. */}
      <div className="flex h-full flex-col overflow-y-auto lg:hidden">
        <CabeceraSticky
          ahoraIso={estado.ahora}
          frescura={estado.frescura}
          horizonte={consola.horizonte}
          onCambiarHorizonte={(horizonte) => dispatch({ tipo: "cambiar-horizonte", horizonte })}
        />
        <BandaMensajeEstado estado={estado.estado} mensajes={MENSAJES_ESTADO} />

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
                  confirmando={consola.confirmando}
                  onSeleccionarZona={seleccionarZona}
                  onPedirConfirmacion={(accionId) => dispatch({ tipo: "pedir-confirmacion", accionId })}
                  onCancelarConfirmacion={() => dispatch({ tipo: "cancelar-confirmacion" })}
                  onConfirmarAccion={() => dispatch({ tipo: "confirmar-accion" })}
                  onDescartar={() => dispatch({ tipo: "descartar-excepcion", excepcionId: excepcion.id })}
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
      </div>

      <PaletaComandos
        abierto={consola.paleta}
        filtro={consola.filtro}
        zonas={estado.zonas}
        capas={estado.capas}
        capasActivas={consola.capas}
        onCambiarFiltro={(filtro) => dispatch({ tipo: "cambiar-filtro", filtro })}
        onCerrar={() => dispatch({ tipo: "cerrar-paleta" })}
        onIrAZona={(zonaId) => dispatch({ tipo: "ir-a-zona", zonaId })}
        onCambiarHorizonte={(horizonte) => dispatch({ tipo: "cambiar-horizonte", horizonte })}
        onAlternarCapa={(capa) => dispatch({ tipo: "alternar-capa", capa })}
        onAlternarLista={() => dispatch({ tipo: "alternar-lista" })}
        onActivarMarca={() => dispatch({ tipo: "activar-modo-marca" })}
      />

      {consola.marcando ? (
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
