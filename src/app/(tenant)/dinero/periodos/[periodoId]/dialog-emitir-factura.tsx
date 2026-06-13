"use client";

/**
 * Dialog de confirmación para EMITIR la factura (DTE) de un período cerrado.
 *
 * Es la compuerta de aprobación humana del motor entrega→dinero (B1-1): el
 * cierre del período NO factura; emitir el DTE es una acción deliberada,
 * porque un DTE es irreversible ante el SII sin nota de crédito.
 *
 * UX (UX-4 / §A2): previsualización del monto y las líneas + consecuencia
 * escrita + paso de confirmación explícito antes de habilitar el botón.
 *
 * Al confirmar: llama a accionEmitirFactura (gate `emitir_facturas`).
 */

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { FileText } from "lucide-react";
import { Button } from "@/components/ui/button";
import { DialogConfirmacionDinero } from "@/components/ui/dialog-confirmacion-dinero";
import { formatearCLPOGuion } from "@/lib/ui/formato-moneda";
import { accionEmitirFactura } from "./actions";

interface Props {
  periodoId: string;
  sellerNombre: string;
  totalLineas: number;
  montoTotalClp: number | null;
}

export function DialogEmitirFactura({
  periodoId,
  sellerNombre,
  totalLineas,
  montoTotalClp,
}: Props) {
  const router = useRouter();
  const [abierto, setAbierto] = useState(false);
  const [isPending, startTransition] = useTransition();

  function handleConfirmar() {
    startTransition(async () => {
      const resultado = await accionEmitirFactura(periodoId);
      if (resultado.ok) {
        setAbierto(false);
        toast.success(`Factura emitida para ${sellerNombre}`, {
          description:
            "El DTE se generó en modo sandbox (no se envió al SII real). El seller ya puede descargarla.",
        });
        router.refresh();
      } else {
        toast.error("No se pudo emitir la factura", { description: resultado.mensaje });
      }
    });
  }

  return (
    <>
      <Button onClick={() => setAbierto(true)} size="sm">
        <FileText className="size-4" aria-hidden="true" />
        Emitir factura
      </Button>

      <DialogConfirmacionDinero
        open={abierto}
        onOpenChange={setAbierto}
        titulo={`Emitir factura de ${sellerNombre}`}
        consecuencia={
          <>
            Se emitirá un DTE (factura electrónica) bajo el RUT de tu courier. Un
            documento emitido al SII <strong>no se puede anular</strong>:
            corregirlo después exige una nota de crédito.
          </>
        }
        cargando={isPending}
        textoConfirmar="Emitir factura"
        requiereConfirmacionExplicita
        etiquetaConfirmacion="Revisé el monto y las líneas. Entiendo que el DTE es irreversible ante el SII."
        onConfirmar={handleConfirmar}
      >
        <dl className="flex flex-col gap-2">
          <div className="flex items-center justify-between gap-4">
            <dt className="text-muted-foreground">Líneas a facturar</dt>
            <dd className="font-mono font-medium tabular-nums">{totalLineas}</dd>
          </div>
          <div className="flex items-center justify-between gap-4">
            <dt className="text-muted-foreground">Monto total</dt>
            <dd className="font-mono text-base font-semibold tabular-nums">
              {formatearCLPOGuion(montoTotalClp)}
            </dd>
          </div>
        </dl>
      </DialogConfirmacionDinero>
    </>
  );
}
