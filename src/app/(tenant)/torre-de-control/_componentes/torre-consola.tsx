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
import { ListaZonas } from "./lista-zonas";
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
export function TorreConsola({ estado }: Props) {
  const [consola, dispatch] = useReducer(reducirConsola, ESTADO_CONSOLA_INICIAL);

  const seleccionarZona = useCallback((zonaId: string) => {
    dispatch({ tipo: "seleccionar-zona", zonaId });
    document.getElementById("zonas-riesgo-escritorio")?.scrollIntoView({ behavior: "smooth", block: "nearest" });
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
      className="flex flex-col outline-none"
    >
      <DefsPatronesRiesgo />

      {/* ================= Escritorio ================= */}
      {/*
        Nota de integración (paso B3): el handoff diseña esta consola como una
        app de viewport fijo (1512×982, "el riel es el único con scroll de toda
        la pantalla"). El resto del producto —incluida esta ruta, que vive
        dentro de `(tenant)` y de `AppShell`— usa el modelo contrario: la
        página entera hace scroll normal (`min-h-svh` en la raíz del shell, sin
        contenedor de altura fija). No se fuerza aquí un viewport fijo peleando
        con ese shell compartido: la fila lista/riel recibe una altura acotada
        a la ventana (`h-[70dvh]`) para que el riel SÍ pueda scrollear
        internamente como pide el diseño, pero si el contenido de una región
        fija (R1/R2/R5) empujara más allá, la página se desplaza entera en vez
        de romper el layout. Full-bleed real (sin sidebar ni padding del
        shell) es una decisión de `ux-ui`/`arquitecto`, no de este paso.
      */}
      <div className="hidden flex-col gap-[var(--tc-regla-may)] bg-tc-chasis lg:flex">
        <R1BarraSuperior
          courierNombre={estado.courier.nombre}
          horizonte={consola.horizonte}
          frescura={estado.frescura}
          onCambiarHorizonte={(horizonte) => dispatch({ tipo: "cambiar-horizonte", horizonte })}
          onAbrirPaleta={() => dispatch({ tipo: "abrir-paleta" })}
        />
        <BandaMensajeEstado estado={estado.estado} mensajes={MENSAJES_ESTADO} />
        <R2OlaEntrante ola={estado.olaEntrante} />
        <div className="flex h-[70dvh] min-h-[480px] gap-[var(--tc-regla-may)]">
          <div id="zonas-riesgo-escritorio" className="flex flex-1 overflow-hidden">
            <ListaZonas
              zonas={estado.zonas}
              zonaSeleccionada={consola.zona}
              pedidosSinGeocodificar={estado.pedidosSinGeocodificar}
              onSeleccionarZona={seleccionarZona}
              mostrarLista={consola.lista}
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
      <div className="flex flex-col lg:hidden">
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
          Modo marca: el mapa todavía no está disponible en este paso, así que no hay dónde hacer clic
          todavía. Esc cancela.
        </div>
      ) : null}
    </div>
  );
}
