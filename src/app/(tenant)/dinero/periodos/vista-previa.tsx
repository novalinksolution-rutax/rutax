"use client";

/**
 * La ficha del período, en el panel lateral.
 * =============================================================================
 *
 * Mismo patrón que la ficha del seller (decisión del usuario, 2026-09-27): el
 * panel ES la ficha, con cifras arriba, tarjetas con título y un menú ⋯ con las
 * acciones que aplican a este período. La página `/dinero/periodos/[id]` queda
 * solo para ver sus líneas, que pueden ser cientos.
 *
 * 🔴 Las cifras salen de las LÍNEAS, no de lo guardado al cerrar; si discrepan,
 * se dice (el detalle y la factura usan la suma de las líneas).
 */

import { Suspense, useEffect, type ReactNode } from "react";
import { useSearchParams } from "next/navigation";

import { BadgeEstado } from "@/components/ui/badge-estado";
import { Button } from "@/components/ui/button";
import { BloqueTrazabilidad } from "@/components/ui/bloque-trazabilidad";
import {
  CifraFicha,
  FilaDato,
  FranjaCifras,
  TarjetaFicha,
} from "@/components/ui/ficha-lateral";
import {
  EnlaceQueCierra,
  ProveedorVistaPreviaLateral,
  useVistaPreviaLateral,
} from "@/components/ui/vista-previa-lateral";
import { formatearCLP } from "@/lib/ui/formato-moneda";
import { formatearFechaCivilCorta } from "@/lib/formato-cl";
import {
  BADGE_ESTADO_PERIODO,
  BADGE_ESTADO_SII,
  BADGE_ESTADO_COBRO_PERIODO,
  traducirEstadoPeriodoCobro,
  traducirEstadoSiiTexto,
  traducirEstadoCobroPeriodo,
} from "@/lib/ui/traduccion-estados";
import { etiquetaPeriodo } from "@/modules/dinero/listado-periodos";

import type { FichaPeriodo } from "./_ficha/datos";
import { accionVistaPreviaPeriodo } from "./vista-previa-actions";
import { MenuPeriodo } from "./menu-periodo";
import { BotonDescargaDocumento } from "./[periodoId]/boton-descarga-documento";

export function ProveedorVistaPreviaPeriodo({
  children,
}: {
  children: ReactNode;
}) {
  return (
    <ProveedorVistaPreviaLateral<FichaPeriodo>
      etiqueta="Ficha del período de cobro"
      cargar={accionVistaPreviaPeriodo}
      tituloFalla="No se pudo abrir"
      textoFalla="Vuelve a intentarlo."
      render={RENDER_FICHA_PERIODO}
    >
      <Suspense fallback={null}>
        <AbrirDesdeUrl />
      </Suspense>
      {children}
    </ProveedorVistaPreviaLateral>
  );
}

/** `?periodo=<id>` abre la ficha: para enlazar a un período desde otra pantalla. */
function AbrirDesdeUrl() {
  const params = useSearchParams();
  const vista = useVistaPreviaLateral();
  const id = params.get("periodo");
  const abrir = vista?.abrir;
  useEffect(() => {
    if (id && abrir) abrir(id);
  }, [id, abrir]);
  return null;
}

function Encabezado(d: FichaPeriodo) {
  return (
    <div className="flex items-start gap-2">
      <div className="min-w-0 flex-1">
        <p className="truncate font-heading text-lg font-semibold">
          {d.sellerNombre}
        </p>
        <p className="rx-num mt-0.5 text-xs text-fg-muted">
          {etiquetaPeriodo(d.fechaInicio, d.fechaFin)}
          {d.sellerRut ? ` · ${d.sellerRut}` : ""}
        </p>
        <div className="mt-1.5 flex flex-wrap items-center gap-1.5">
          <BadgeEstado
            variante={BADGE_ESTADO_PERIODO[d.estado]}
            eje="periodo"
            valor={d.estado}
            texto={traducirEstadoPeriodoCobro(d.estado)}
          />
          {d.excepcionesBloqueantes > 0 ? (
            <span className="border border-fault-line bg-fault-bg px-1.5 py-0.5 text-[11px] font-medium text-fault-fg">
              Bloqueado
            </span>
          ) : null}
        </div>
      </div>
      <MenuPeriodo
        periodo={{
          id: d.id,
          sellerId: d.sellerId,
          sellerNombre: d.sellerNombre,
          estado: d.estado,
          fechaInicio: d.fechaInicio,
          fechaFin: d.fechaFin,
          totalLineas: d.totalLineas,
          montoTotalClp: d.montoTotalClp,
          excepcionesBloqueantes: d.excepcionesBloqueantes,
        }}
        ficha={{
          puedeEmitir: d.puedeEmitir,
          autorNombre: d.autorNombre,
          modoDte: d.modoDte,
          montoPagado: d.montoPagado,
          folioFactura: d.documento?.folio ?? null,
          composicion: d.composicion,
        }}
      />
    </div>
  );
}

function Cuerpo(d: FichaPeriodo, cerrar: () => void) {
  const saldo = d.brutoDesdeLineas - (d.montoPagadoClp ?? 0);
  const discrepa =
    d.brutoGuardado !== null && d.brutoGuardado !== d.brutoDesdeLineas;

  return (
    <div className="space-y-3">
      {/* Regla 18: cada cifra dice qué es. El total es CON IVA: lo que paga el
          seller y lo que dice la factura. */}
      <FranjaCifras>
        <CifraFicha rotulo="Total con IVA">
          {formatearCLP(d.brutoDesdeLineas)}
        </CifraFicha>
        <CifraFicha rotulo="Neto">{formatearCLP(d.netoDesdeLineas)}</CifraFicha>
        {/* El saldo solo existe una vez facturado; antes, la tercera cifra es
            cuántas líneas lleva. */}
        {d.estado === "facturado" ? (
          <CifraFicha rotulo="Saldo" tono={saldo > 0 ? "atencion" : undefined}>
            {formatearCLP(saldo)}
          </CifraFicha>
        ) : (
          <CifraFicha rotulo="Líneas">{d.lineasVigentes}</CifraFicha>
        )}
      </FranjaCifras>

      {discrepa ? (
        <p className="border border-attention-line bg-attention-bg px-3 py-2 text-xs text-attention-fg">
          Al cerrarlo se guardó {formatearCLP(d.brutoGuardado ?? 0)}; sus líneas
          suman hoy {formatearCLP(d.brutoDesdeLineas)}. La factura usa la suma
          de las líneas.
        </p>
      ) : null}

      {d.excepcionesBloqueantes > 0 ? (
        <TarjetaFicha titulo="Lo bloquea">
          <p className="text-sm text-fault-fg">
            {d.excepcionesBloqueantes}{" "}
            {d.excepcionesBloqueantes === 1
              ? "excepción abierta"
              : "excepciones abiertas"}
          </p>
          <Button
            asChild
            variant="outline"
            className="mt-2 min-h-11 w-full md:min-h-9"
          >
            <EnlaceQueCierra
              href={`/dinero/conciliacion?seller=${d.sellerId}`}
              onCerrar={cerrar}
            >
              Ver excepciones
            </EnlaceQueCierra>
          </Button>
        </TarjetaFicha>
      ) : null}

      <TarjetaFicha titulo="Composición">
        {d.lineasVigentes === 0 ? (
          <p className="text-sm text-fg-muted">Sin líneas.</p>
        ) : (
          <>
            {d.porTipoPedido.flex > 0 ? (
              <FilaDato rotulo="Flex">{d.porTipoPedido.flex}</FilaDato>
            ) : null}
            {d.porTipoPedido.sameDay > 0 ? (
              <FilaDato rotulo="Propios">{d.porTipoPedido.sameDay}</FilaDato>
            ) : null}
            {d.lineasConAjuste > 0 ? (
              <FilaDato rotulo="Con ajuste">
                {d.lineasConAjuste} · {formatearCLP(d.ajusteTotalClp)}
              </FilaDato>
            ) : null}
            {d.lineasAnuladas > 0 ? (
              <FilaDato rotulo="Anuladas">{d.lineasAnuladas}</FilaDato>
            ) : null}
            <FilaDato rotulo="IVA">{formatearCLP(d.ivaDesdeLineas)}</FilaDato>
            {d.primerHecho && d.ultimoHecho ? (
              <FilaDato rotulo="Entregas">
                {formatearFechaCivilCorta(d.primerHecho)} –{" "}
                {formatearFechaCivilCorta(d.ultimoHecho)}
              </FilaDato>
            ) : null}
          </>
        )}
      </TarjetaFicha>

      {d.documento ? (
        <TarjetaFicha titulo="Factura">
          <div className="flex flex-wrap items-center gap-2">
            <span className="rx-num text-sm">Folio {d.documento.folio}</span>
            {d.estadoSii ? (
              <BadgeEstado
                variante={BADGE_ESTADO_SII[d.estadoSii]}
                eje="sii"
                valor={d.estadoSii}
                texto={traducirEstadoSiiTexto(d.estadoSii)}
              />
            ) : null}
          </div>
          <div className="mt-2 flex flex-wrap gap-2">
            {d.documento.pdfRef ? (
              <BotonDescargaDocumento
                tipo="pdf-dte"
                referencia={d.documento.pdfRef}
              />
            ) : null}
            {d.documento.xmlRef ? (
              <BotonDescargaDocumento
                tipo="xml-dte"
                referencia={d.documento.xmlRef}
              />
            ) : null}
          </div>
          {d.notaCredito ? (
            <div className="mt-3 border-t border-line-subtle pt-2">
              <p className="rx-num text-sm">
                Nota de crédito · folio {d.notaCredito.folio}
              </p>
              <div className="mt-2 flex flex-wrap gap-2">
                {d.notaCredito.pdfRef ? (
                  <BotonDescargaDocumento
                    tipo="pdf-dte"
                    referencia={d.notaCredito.pdfRef}
                  />
                ) : null}
                {d.notaCredito.xmlRef ? (
                  <BotonDescargaDocumento
                    tipo="xml-dte"
                    referencia={d.notaCredito.xmlRef}
                  />
                ) : null}
              </div>
            </div>
          ) : null}
        </TarjetaFicha>
      ) : null}

      {d.estado === "facturado" ? (
        <TarjetaFicha
          titulo="Pago del seller"
          accion={
            <BadgeEstado
              variante={BADGE_ESTADO_COBRO_PERIODO[d.estadoCobro]}
              eje="cobro-periodo"
              valor={d.estadoCobro}
              texto={traducirEstadoCobroPeriodo(d.estadoCobro)}
            />
          }
        >
          <FilaDato rotulo="Pagado">
            {formatearCLP(d.montoPagadoClp ?? 0)}
          </FilaDato>
        </TarjetaFicha>
      ) : null}

      <TarjetaFicha titulo="El seller ve">
        <p className="text-sm text-fg">{d.vistaSeller.ve}</p>
      </TarjetaFicha>

      {d.bitacora.length > 0 ? (
        <TarjetaFicha titulo="Bitácora">
          <BloqueTrazabilidad hechos={d.bitacora} />
        </TarjetaFicha>
      ) : null}
    </div>
  );
}

function Pie(d: FichaPeriodo, cerrar: () => void) {
  return (
    <Button asChild variant="outline" className="min-h-11 w-full lg:min-h-9">
      <EnlaceQueCierra href={`/dinero/periodos/${d.id}`} onCerrar={cerrar}>
        Ver{" "}
        {d.lineasVigentes === 1 ? "su línea" : `sus ${d.lineasVigentes} líneas`}
      </EnlaceQueCierra>
    </Button>
  );
}

export const RENDER_FICHA_PERIODO = {
  encabezado: Encabezado,
  cuerpo: Cuerpo,
  pie: Pie,
};
