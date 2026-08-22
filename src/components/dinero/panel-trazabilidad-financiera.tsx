"use client";

/**
 * PanelTrazabilidadFinanciera — trazabilidad financiera bidireccional
 * pedido↔dinero (§1.1 P1 del audit externo, jul 2026).
 *
 * Client Component autocontenido: fila-teaser (badges de estado, sin montos)
 * + botón que abre un `Sheet` con dos timelines apiladas que comparten el nodo
 * "Entrega": la pista de cobro al seller (cobro → período → factura → pago del
 * seller → conciliación) y la pista de liquidación al conductor (liquidación →
 * payout). Reutiliza la primitiva `Nodo` de `trazador-lazo.tsx` (mismo
 * vocabulario visual, con un tercer tono "atención" para lo que requiere
 * revisión).
 *
 * Solo lectura — cero mutaciones. Los datos ya llegan cargados por props
 * (`obtenerTrazaDineroPorPedido`, consulta de servidor); este componente no
 * hace fetch propio. El gating por rol lo decide la página que lo monta.
 */

import { useState } from "react";
import { useRouter, usePathname } from "next/navigation";
import Link from "next/link";
import {
  Package,
  Receipt,
  CalendarRange,
  FileText,
  Banknote,
  Scale,
  Wallet,
  CreditCard,
} from "lucide-react";

import type { TrazaDineroPedido } from "@/modules/dinero";
import { esEstadoTerminal } from "@/modules/dinero/conciliacion-clasificacion";
import { formatearCLP } from "@/lib/ui/formato-moneda";
import { Badge } from "@/components/ui/badge";
import { BadgeEstado } from "@/components/ui/badge-estado";
import { Button } from "@/components/ui/button";
import {
  Sheet,
  SheetContent,
  SheetHeader,
  SheetTitle,
  SheetDescription,
  SheetTrigger,
} from "@/components/ui/sheet";
import {
  traducirEstadoPeriodoCobro,
  BADGE_ESTADO_PERIODO,
  traducirEstadoSii,
  badgeEstadoSii,
  traducirEstadoCobroPeriodo,
  BADGE_ESTADO_COBRO_PERIODO,
  traducirEstadoLiquidacion,
  BADGE_ESTADO_LIQUIDACION,
  traducirEstadoPayout,
  BADGE_ESTADO_PAYOUT,
  traducirEstadoMatchPago,
  BADGE_ESTADO_MATCH_PAGO,
  traducirTipoDiferencia,
} from "@/lib/ui/traduccion-estados";
import { Nodo, EtiquetaEstado, type NodoTono } from "./trazador-lazo";
import { PopoverSnapshotRegla } from "./popover-snapshot-regla";

function formatearFechaCorta(fechaIso: string): string {
  if (!fechaIso || fechaIso.length < 10) return fechaIso;
  const [anio, mes, dia] = fechaIso.slice(0, 10).split("-");
  return `${dia}/${mes}/${anio}`;
}

interface Props {
  traza: TrazaDineroPedido;
  pedidoId: string;
  pedidoEntregado: boolean;
  /** true si la página se abrió con `?traza=1` (deep-link) — abre el panel de entrada. */
  abrirPorDefecto: boolean;
}

export function PanelTrazabilidadFinanciera({
  traza,
  pedidoId,
  pedidoEntregado,
  abrirPorDefecto,
}: Props) {
  const router = useRouter();
  const pathname = usePathname();
  const [open, setOpen] = useState(abrirPorDefecto);

  function handleOpenChange(next: boolean) {
    setOpen(next);
    router.replace(next ? `${pathname}?traza=1` : pathname, { scroll: false });
  }

  const { cobro, periodo, factura, liquidacion, pagosRecibidos, conciliacion, payout } = traza;
  const pagado = periodo?.estadoCobro === "pagado";
  const hayMovimientos = !!cobro || !!liquidacion;

  // ---------------------------------------------------------------------
  // Pista "Cobro al seller"
  // ---------------------------------------------------------------------

  let cobroTono: NodoTono;
  let cobroContenido: React.ReactNode;
  if (cobro?.anulada) {
    cobroTono = "atencion";
    cobroContenido = (
      <p className="text-xs text-destructive-subtle-foreground">
        Cobro anulado — {cobro.motivoAnulacion ?? "sin motivo registrado"}
      </p>
    );
  } else if (cobro) {
    cobroTono = "hecho";
    cobroContenido = (
      <div className="flex flex-wrap items-center gap-2">
        <span className="font-mono text-sm font-semibold tabular-nums">
          {formatearCLP(cobro.montoFinalClp)}
        </span>
        <PopoverSnapshotRegla snapshotRegla={cobro.snapshotRegla} />
      </div>
    );
  } else {
    cobroTono = "pendiente";
    cobroContenido = (
      <p className="text-xs text-muted-foreground">
        Aún sin línea de cobro (o es gasto propio del courier).
      </p>
    );
  }

  const eventosNoResueltos = conciliacion.eventos.filter(
    (e) => !esEstadoTerminal(e.estado),
  );

  let concilTono: NodoTono;
  let concilContenido: React.ReactNode;
  if (!conciliacion.evaluada) {
    concilTono = "pendiente";
    concilContenido = <p className="text-xs text-muted-foreground">Aún sin evaluar.</p>;
  } else if (conciliacion.eventos.length === 0) {
    concilTono = "hecho";
    concilContenido = <p className="text-xs text-muted-foreground">Sin discrepancias.</p>;
  } else if (eventosNoResueltos.length > 0) {
    concilTono = "atencion";
    const tipos = Array.from(
      new Set(eventosNoResueltos.map((e) => traducirTipoDiferencia(e.tipoDiferencia))),
    );
    concilContenido = (
      <div className="space-y-1">
        <p className="text-xs text-destructive-subtle-foreground">{tipos.join(" · ")}</p>
        <Link
          href={`/dinero/conciliacion?pedido=${pedidoId}`}
          className="text-xs font-medium text-primary hover:underline"
        >
          Ver en conciliación →
        </Link>
      </div>
    );
  } else {
    concilTono = "hecho";
    concilContenido = <p className="text-xs text-muted-foreground">Discrepancia(s) resuelta(s).</p>;
  }

  // ---------------------------------------------------------------------
  // Pista "Liquidación al conductor"
  // ---------------------------------------------------------------------

  let liquidacionTono: NodoTono;
  let liquidacionContenido: React.ReactNode;
  if (liquidacion?.anulada) {
    liquidacionTono = "atencion";
    liquidacionContenido = (
      <p className="text-xs text-destructive-subtle-foreground">
        Liquidación de esta entrega anulada — {liquidacion.motivoAnulacion ?? "sin motivo registrado"}
      </p>
    );
  } else if (liquidacion) {
    liquidacionTono = "hecho";
    liquidacionContenido = (
      <div className="flex flex-wrap items-center gap-2">
        <span className="font-mono text-sm font-semibold tabular-nums">
          {formatearCLP(liquidacion.montoFinalClp)}
        </span>
        <EtiquetaEstado variante={BADGE_ESTADO_LIQUIDACION[liquidacion.estado]} eje="liquidacion" valor={liquidacion.estado}>
          {traducirEstadoLiquidacion(liquidacion.estado)}
        </EtiquetaEstado>
        <Link
          href={`/dinero/liquidaciones/${liquidacion.id}`}
          className="text-xs font-medium text-primary hover:underline"
        >
          Ver liquidación
        </Link>
        <PopoverSnapshotRegla snapshotRegla={liquidacion.snapshotRegla} />
      </div>
    );
  } else {
    liquidacionTono = "pendiente";
    liquidacionContenido = (
      <p className="text-xs text-muted-foreground">
        Aún sin línea de liquidación para el conductor.
      </p>
    );
  }

  let payoutTono: NodoTono;
  let payoutContenido: React.ReactNode;
  if (!payout) {
    payoutTono = "pendiente";
    payoutContenido = <p className="text-xs text-muted-foreground">Sin solicitud de pago todavía.</p>;
  } else if (payout.estado === "confirmado") {
    payoutTono = "hecho";
    payoutContenido = (
      <div className="flex flex-wrap items-center gap-2">
        <span className="font-mono text-sm font-semibold tabular-nums">
          {formatearCLP(payout.montoLiquidoClp)}
        </span>
        <EtiquetaEstado variante={BADGE_ESTADO_PAYOUT[payout.estado]} eje="payout" valor={payout.estado}>
          {traducirEstadoPayout(payout.estado)}
        </EtiquetaEstado>
      </div>
    );
  } else if (payout.estado === "rechazado" || payout.estado === "fallido") {
    payoutTono = "atencion";
    payoutContenido = (
      <div className="space-y-1">
        <EtiquetaEstado variante={BADGE_ESTADO_PAYOUT[payout.estado]} eje="payout" valor={payout.estado}>
          {traducirEstadoPayout(payout.estado)}
        </EtiquetaEstado>
        {payout.errorDescripcion && (
          <p className="text-xs text-destructive-subtle-foreground">{payout.errorDescripcion}</p>
        )}
      </div>
    );
  } else {
    payoutTono = "pendiente";
    payoutContenido = (
      <EtiquetaEstado variante={BADGE_ESTADO_PAYOUT[payout.estado]} eje="payout" valor={payout.estado}>
        {traducirEstadoPayout(payout.estado)}
      </EtiquetaEstado>
    );
  }

  return (
    <div className="rounded-lg border bg-card p-4 shadow-xs">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="flex flex-wrap items-center gap-x-4 gap-y-1.5 text-sm">
          <span className="flex items-center gap-1.5">
            <span className="text-muted-foreground">Cobro:</span>
            {periodo ? (
              <BadgeEstado
                variante={BADGE_ESTADO_PERIODO[periodo.estado]} eje="periodo" valor={periodo.estado}
                texto={traducirEstadoPeriodoCobro(periodo.estado, factura?.folio)}
              />
            ) : (
              <Badge variant="neutral">—</Badge>
            )}
          </span>
          <span className="flex items-center gap-1.5">
            <span className="text-muted-foreground">Liquidación:</span>
            {liquidacion ? (
              <BadgeEstado variante={BADGE_ESTADO_LIQUIDACION[liquidacion.estado]} eje="liquidacion" valor={liquidacion.estado} texto={traducirEstadoLiquidacion(liquidacion.estado)} />
            ) : (
              <Badge variant="neutral">—</Badge>
            )}
          </span>
        </div>

        <Sheet open={open} onOpenChange={handleOpenChange}>
          <SheetTrigger asChild>
            <Button type="button" variant="outline" size="sm">
              Ver trazabilidad financiera →
            </Button>
          </SheetTrigger>
          <SheetContent side="right" className="w-full data-[side=right]:sm:max-w-lg">
            <SheetHeader>
              <SheetTitle>Trazabilidad financiera</SheetTitle>
              <SheetDescription>
                Recorrido de esta entrega por el motor entrega→dinero, de punta a punta. Solo
                lectura.
              </SheetDescription>
            </SheetHeader>

            <div className="flex-1 space-y-6 overflow-y-auto px-4 pb-6">
              {!hayMovimientos ? (
                <div className="rounded-lg border border-dashed border-border bg-muted/30 p-6 text-center text-sm text-muted-foreground">
                  Este pedido todavía no generó movimientos de dinero. Aparecerán automáticamente
                  cuando el motor registre la entrega.
                </div>
              ) : (
                <>
                  {/* Nodo compartido — Entrega */}
                  <ol>
                    <Nodo
                      icono={Package}
                      titulo="Entrega"
                      tono={pedidoEntregado ? "hecho" : "pendiente"}
                      ultimo
                    >
                      <p className="text-xs text-muted-foreground">
                        {pedidoEntregado
                          ? "Entrega registrada — origen del cobro y la liquidación."
                          : "Aún no entregado: el cobro y la liquidación se generan al entregar."}
                      </p>
                    </Nodo>
                  </ol>

                  {/* Pista 1 — Cobro al seller */}
                  <div>
                    <h3 className="mb-3 text-xs font-semibold uppercase tracking-wide text-muted-foreground">
                      Cobro al seller
                    </h3>
                    <ol>
                      <Nodo icono={Receipt} titulo="Cobro" tono={cobroTono} ultimo={false}>
                        {cobroContenido}
                      </Nodo>

                      <Nodo
                        icono={CalendarRange}
                        titulo="Período de cobro"
                        tono={periodo ? "hecho" : "pendiente"}
                        ultimo={false}
                      >
                        {periodo ? (
                          <div className="flex flex-wrap items-center gap-2">
                            <EtiquetaEstado variante={BADGE_ESTADO_PERIODO[periodo.estado]} eje="periodo" valor={periodo.estado}>
                              {traducirEstadoPeriodoCobro(periodo.estado, factura?.folio)}
                            </EtiquetaEstado>
                            <Link
                              href={`/dinero/periodos/${periodo.id}`}
                              className="text-xs font-medium text-primary hover:underline"
                            >
                              Ver período
                            </Link>
                          </div>
                        ) : (
                          <p className="text-xs text-muted-foreground">
                            Aún no agrupado en un período de cobro.
                          </p>
                        )}
                      </Nodo>

                      <Nodo
                        icono={FileText}
                        titulo="Factura (DTE)"
                        tono={factura ? "hecho" : "pendiente"}
                        ultimo={false}
                      >
                        {factura ? (
                          <div className="flex flex-wrap items-center gap-2">
                            <span className="font-mono text-sm font-medium tabular-nums">
                              Folio {factura.folio}
                            </span>
                            <EtiquetaEstado
                              variante={badgeEstadoSii(traducirEstadoSii(factura.estadoSii).variante)}
                            >
                              {traducirEstadoSii(factura.estadoSii).texto}
                            </EtiquetaEstado>
                          </div>
                        ) : (
                          <p className="text-xs text-muted-foreground">
                            Aún sin factura emitida (requiere aprobación humana).
                          </p>
                        )}
                      </Nodo>

                      <Nodo
                        icono={Banknote}
                        titulo="Pago del seller"
                        tono={pagado ? "hecho" : "pendiente"}
                        ultimo={false}
                      >
                        {periodo ? (
                          <EtiquetaEstado variante={BADGE_ESTADO_COBRO_PERIODO[periodo.estadoCobro]} eje="cobro-periodo" valor={periodo.estadoCobro}>
                            {traducirEstadoCobroPeriodo(periodo.estadoCobro)}
                          </EtiquetaEstado>
                        ) : (
                          <p className="text-xs text-muted-foreground">
                            Pendiente del cierre del período.
                          </p>
                        )}
                        {pagosRecibidos.length > 0 && (
                          <ul className="mt-1.5 space-y-1 border-l border-border pl-2.5">
                            {pagosRecibidos.map((p) => (
                              <li
                                key={p.id}
                                className="flex flex-wrap items-center gap-x-2 gap-y-0.5 text-xs text-muted-foreground"
                              >
                                <span>{formatearFechaCorta(p.fechaMovimiento)}</span>
                                <span className="font-mono tabular-nums">
                                  {formatearCLP(p.montoClp)}
                                </span>
                                <BadgeEstado variante={BADGE_ESTADO_MATCH_PAGO[p.estadoMatch]} eje="match-pago" valor={p.estadoMatch} texto={traducirEstadoMatchPago(p.estadoMatch)} />
                              </li>
                            ))}
                          </ul>
                        )}
                      </Nodo>

                      <Nodo icono={Scale} titulo="Conciliación" tono={concilTono} ultimo>
                        {concilContenido}
                      </Nodo>
                    </ol>
                  </div>

                  {/* Pista 2 — Liquidación al conductor */}
                  <div>
                    <h3 className="mb-3 text-xs font-semibold uppercase tracking-wide text-muted-foreground">
                      Liquidación al conductor
                    </h3>
                    <ol>
                      <Nodo icono={Wallet} titulo="Liquidación" tono={liquidacionTono} ultimo={false}>
                        {liquidacionContenido}
                      </Nodo>

                      <Nodo icono={CreditCard} titulo="Payout" tono={payoutTono} ultimo>
                        {payoutContenido}
                      </Nodo>
                    </ol>
                  </div>
                </>
              )}
            </div>
          </SheetContent>
        </Sheet>
      </div>
    </div>
  );
}
