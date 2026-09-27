"use client";

/**
 * El menú ⋯ de un período: en la fila del listado y en el encabezado de su
 * ficha lateral.
 *
 * Solo lista lo que aplica a ESE período según su estado. Las acciones de
 * dinero abren **el mismo diálogo de siempre** (con su verificación, su
 * confirmación y su bitácora); el menú solo lo abre desde otro lugar.
 *
 * 🔴 Emitir factura, emitir nota de crédito y reabrir se ofrecen SOLO en la
 * ficha, no en la fila: son irreversibles o casi, y la ficha es donde están a la
 * vista el total, su composición y lo que lo bloquea. Emitir es siempre un acto
 * humano deliberado (compuerta de facturación, CLAUDE.md).
 */

import { useState } from "react";
import { useRouter } from "next/navigation";
import { MoreHorizontal } from "lucide-react";

import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { useVistaPreviaLateral } from "@/components/ui/vista-previa-lateral";
import type { EstadoPeriodo } from "@/modules/dinero/tipos";
import type { ModoDte } from "@/modules/dinero/modo-dte";

import { DialogCerrarPeriodo } from "./dialog-cerrar-periodo";
import { DialogReabrirPeriodo } from "./[periodoId]/dialog-reabrir-periodo";
import { DialogEmitirFactura } from "./[periodoId]/dialog-emitir-factura";
import { DialogEmitirNotaCredito } from "./[periodoId]/dialog-emitir-nota-credito";

export interface PeriodoParaMenu {
  id: string;
  sellerId: string;
  sellerNombre: string;
  estado: EstadoPeriodo;
  fechaInicio: string;
  fechaFin: string;
  totalLineas: number;
  montoTotalClp: number | null;
  excepcionesBloqueantes: number;
}

/** Lo que solo tiene la ficha, y habilita las acciones de dinero. */
export interface DatosAccionesFicha {
  puedeEmitir: boolean;
  autorNombre: string;
  modoDte: ModoDte;
  montoPagado: number;
  folioFactura: number | null;
  composicion: { concepto: string; monto: number; resta?: boolean }[] | null;
}

type Dialogo = "cerrar" | "reabrir" | "emitir" | "nota" | null;
const ITEM = "min-h-11 md:min-h-0";

export function MenuPeriodo({
  periodo,
  ficha,
}: {
  periodo: PeriodoParaMenu;
  /** Presente en la ficha: habilita emitir, reabrir y nota de crédito. */
  ficha?: DatosAccionesFicha;
}) {
  const router = useRouter();
  const vista = useVistaPreviaLateral();
  const [dialogo, setDialogo] = useState<Dialogo>(null);
  const cerrarDialogo = (abierto: boolean) => !abierto && setDialogo(null);

  const { estado } = periodo;
  const sinFactura = ficha ? ficha.folioFactura === null : true;
  const puedeEmitir = Boolean(ficha?.puedeEmitir);

  return (
    <>
      <DropdownMenu>
        <DropdownMenuTrigger asChild>
          <Button
            type="button"
            variant="ghost"
            size="icon-sm"
            aria-label={`Acciones del período de ${periodo.sellerNombre}`}
            className="size-11 shrink-0 md:size-8"
          >
            <MoreHorizontal className="size-4" aria-hidden="true" />
          </Button>
        </DropdownMenuTrigger>
        <DropdownMenuContent align="end" className="min-w-48">
          {!ficha && vista ? (
            <DropdownMenuItem className={ITEM} onSelect={() => vista.abrir(periodo.id)}>
              Ver ficha
            </DropdownMenuItem>
          ) : null}
          <DropdownMenuItem
            className={ITEM}
            onSelect={() => router.push(`/dinero/periodos/${periodo.id}`)}
          >
            Ver sus líneas
          </DropdownMenuItem>
          {periodo.excepcionesBloqueantes > 0 ? (
            <DropdownMenuItem
              className={ITEM}
              onSelect={() => router.push(`/dinero/conciliacion?seller=${periodo.sellerId}`)}
            >
              Ver lo que lo bloquea
            </DropdownMenuItem>
          ) : null}

          {estado === "abierto" ? (
            <>
              <DropdownMenuSeparator />
              <DropdownMenuItem className={ITEM} onSelect={() => setDialogo("cerrar")}>
                Cerrar período
              </DropdownMenuItem>
            </>
          ) : null}

          {ficha && puedeEmitir && estado === "cerrado" && sinFactura ? (
            <>
              <DropdownMenuSeparator />
              <DropdownMenuItem className={ITEM} onSelect={() => setDialogo("emitir")}>
                Emitir factura
              </DropdownMenuItem>
              <DropdownMenuItem className={ITEM} onSelect={() => setDialogo("reabrir")}>
                Volver a abrir
              </DropdownMenuItem>
            </>
          ) : null}

          {ficha && puedeEmitir && estado === "facturado" && ficha.folioFactura !== null ? (
            <>
              <DropdownMenuSeparator />
              <DropdownMenuItem
                className={ITEM}
                variant="destructive"
                onSelect={() => setDialogo("nota")}
              >
                Emitir nota de crédito
              </DropdownMenuItem>
            </>
          ) : null}
        </DropdownMenuContent>
      </DropdownMenu>

      {/* Los diálogos de siempre, abiertos desde el menú. Montados solo cuando
          se piden: la emisión hace su verificación previa al abrirse. */}
      {dialogo === "cerrar" ? (
        <DialogCerrarPeriodo
          abierto
          onAbiertoChange={cerrarDialogo}
          periodoId={periodo.id}
          sellerNombre={periodo.sellerNombre}
          fechaInicio={periodo.fechaInicio}
          fechaFin={periodo.fechaFin}
          totalLineas={periodo.totalLineas}
          montoTotalClp={periodo.montoTotalClp}
        />
      ) : null}
      {dialogo === "reabrir" ? (
        <DialogReabrirPeriodo
          abierto
          onAbiertoChange={cerrarDialogo}
          periodoId={periodo.id}
          sellerNombre={periodo.sellerNombre}
        />
      ) : null}
      {dialogo === "emitir" && ficha ? (
        <DialogEmitirFactura
          abierto
          onAbiertoChange={cerrarDialogo}
          periodoId={periodo.id}
          sellerNombre={periodo.sellerNombre}
          composicion={ficha.composicion ?? undefined}
          autorNombre={ficha.autorNombre}
          totalLineas={periodo.totalLineas}
          montoTotalClp={periodo.montoTotalClp}
          modoDte={ficha.modoDte}
        />
      ) : null}
      {dialogo === "nota" && ficha && ficha.folioFactura !== null ? (
        <DialogEmitirNotaCredito
          abierto
          onAbiertoChange={cerrarDialogo}
          periodoId={periodo.id}
          sellerNombre={periodo.sellerNombre}
          folioFactura={ficha.folioFactura}
          montoTotalClp={periodo.montoTotalClp}
          montoPagadoClp={ficha.montoPagado}
          modoDte={ficha.modoDte}
        />
      ) : null}
    </>
  );
}
