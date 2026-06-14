import Link from "next/link";
import {
  Package,
  Receipt,
  CalendarRange,
  FileText,
  Banknote,
  Wallet,
  type LucideIcon,
} from "lucide-react";

import { cn } from "@/lib/utils";
import type { TrazaDineroPedido } from "@/modules/dinero";
import { formatearCLP } from "@/lib/ui/formato-moneda";
import { Badge } from "@/components/ui/badge";
import {
  traducirEstadoPeriodoCobro,
  BADGE_ESTADO_PERIODO,
  traducirEstadoSii,
  badgeEstadoSii,
  traducirEstadoCobroPeriodo,
  BADGE_ESTADO_COBRO_PERIODO,
  traducirEstadoLiquidacion,
  BADGE_ESTADO_LIQUIDACION,
  type BadgeVariante,
} from "@/lib/ui/traduccion-estados";

/**
 * TrazadorLazo — trazabilidad visible del lazo entrega→dinero (UX-1 / §A6).
 *
 * Hace *sentir* el diferenciador: desde una entrega se ve su línea de cobro al
 * seller, el período y la factura donde aterrizó, su pago, y su liquidación al
 * conductor — de punta a punta. Cada nodo está "hecho" o "pendiente" (lazo en
 * curso). Solo presentación; los datos llegan ya cargados (consulta de dominio).
 *
 * Contiene montos: mostrarlo solo a roles financieros/dueño (gating en la página).
 */

function EtiquetaEstado({
  variante,
  children,
}: {
  variante: BadgeVariante;
  children: React.ReactNode;
}) {
  return <Badge variant={variante}>{children}</Badge>;
}

interface NodoProps {
  icono: LucideIcon;
  titulo: string;
  hecho: boolean;
  ultimo: boolean;
  children?: React.ReactNode;
}

function Nodo({ icono: Icono, titulo, hecho, ultimo, children }: NodoProps) {
  return (
    <li className="relative flex gap-3 pb-5 last:pb-0">
      {!ultimo && (
        <span
          className="absolute top-6 bottom-0 left-[11px] w-px bg-border"
          aria-hidden="true"
        />
      )}
      <span
        className={cn(
          "z-10 flex size-6 shrink-0 items-center justify-center rounded-full",
          hecho
            ? "bg-primary text-primary-foreground"
            : "border border-dashed border-border bg-background text-muted-foreground"
        )}
      >
        <Icono className="size-3.5" aria-hidden="true" />
      </span>
      <div className="flex flex-1 flex-col gap-1 pt-0.5">
        <p className={cn("text-sm font-medium", !hecho && "text-muted-foreground")}>{titulo}</p>
        {children}
      </div>
    </li>
  );
}

interface Props {
  traza: TrazaDineroPedido;
  pedidoEntregado: boolean;
}

export function TrazadorLazo({ traza, pedidoEntregado }: Props) {
  const { cobro, periodo, factura, liquidacion } = traza;
  const pagado = periodo?.estadoCobro === "pagado";

  return (
    <div className="rounded-xl border border-border bg-card p-4">
      <ol>
        {/* 1 — Entrega */}
        <Nodo icono={Package} titulo="Entrega" hecho={pedidoEntregado} ultimo={false}>
          <p className="text-xs text-muted-foreground">
            {pedidoEntregado
              ? "Entrega registrada — origen del cobro y la liquidación."
              : "Aún no entregado: el cobro y la liquidación se generan al entregar."}
          </p>
        </Nodo>

        {/* 2 — Cobro al seller */}
        <Nodo icono={Receipt} titulo="Cobro al seller" hecho={!!cobro} ultimo={false}>
          {cobro ? (
            <p className="font-mono text-sm font-semibold tabular-nums">
              {formatearCLP(cobro.montoFinalClp)}
            </p>
          ) : (
            <p className="text-xs text-muted-foreground">
              Aún sin línea de cobro (o es gasto propio del courier).
            </p>
          )}
        </Nodo>

        {/* 3 — Período de cobro */}
        <Nodo icono={CalendarRange} titulo="Período de cobro" hecho={!!periodo} ultimo={false}>
          {periodo ? (
            <div className="flex flex-wrap items-center gap-2">
              <EtiquetaEstado variante={BADGE_ESTADO_PERIODO[periodo.estado]}>
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

        {/* 4 — Factura (DTE) */}
        <Nodo icono={FileText} titulo="Factura (DTE)" hecho={!!factura} ultimo={false}>
          {factura ? (
            <div className="flex flex-wrap items-center gap-2">
              <span className="font-mono text-sm font-medium tabular-nums">
                Folio {factura.folio}
              </span>
              <EtiquetaEstado variante={badgeEstadoSii(traducirEstadoSii(factura.estadoSii).variante)}>
                {traducirEstadoSii(factura.estadoSii).texto}
              </EtiquetaEstado>
            </div>
          ) : (
            <p className="text-xs text-muted-foreground">
              Aún sin factura emitida (requiere aprobación humana).
            </p>
          )}
        </Nodo>

        {/* 5 — Pago del seller */}
        <Nodo icono={Banknote} titulo="Pago del seller" hecho={pagado} ultimo={false}>
          {periodo ? (
            <EtiquetaEstado variante={BADGE_ESTADO_COBRO_PERIODO[periodo.estadoCobro]}>
              {traducirEstadoCobroPeriodo(periodo.estadoCobro)}
            </EtiquetaEstado>
          ) : (
            <p className="text-xs text-muted-foreground">Pendiente del cierre del período.</p>
          )}
        </Nodo>

        {/* 6 — Liquidación al conductor */}
        <Nodo icono={Wallet} titulo="Liquidación al conductor" hecho={!!liquidacion} ultimo>
          {liquidacion ? (
            <div className="flex flex-wrap items-center gap-2">
              <span className="font-mono text-sm font-semibold tabular-nums">
                {formatearCLP(liquidacion.montoFinalClp)}
              </span>
              <EtiquetaEstado variante={BADGE_ESTADO_LIQUIDACION[liquidacion.estado]}>
                {traducirEstadoLiquidacion(liquidacion.estado)}
              </EtiquetaEstado>
              <Link
                href="/dinero/liquidaciones"
                className="text-xs font-medium text-primary hover:underline"
              >
                Ver liquidaciones
              </Link>
            </div>
          ) : (
            <p className="text-xs text-muted-foreground">
              Aún sin línea de liquidación para el conductor.
            </p>
          )}
        </Nodo>
      </ol>
    </div>
  );
}
