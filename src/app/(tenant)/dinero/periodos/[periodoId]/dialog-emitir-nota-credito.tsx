"use client";

/**
 * Dialog de confirmación para EMITIR una NOTA DE CRÉDITO (DTE 61) que anula
 * TOTALMENTE la factura de un período facturado (RF-038, decisión B7).
 *
 * Compuerta humana espejo de la de emisión: la NC es un documento tributario
 * irreversible, así que exige un motivo obligatorio (queda en la auditoría y
 * en la propia NC) y advierte los efectos antes de confirmar. El motivo vacío
 * mantiene deshabilitado el botón final (confirmDeshabilitado).
 *
 * Al confirmar: llama a accionEmitirNotaCredito (gate `emitir_facturas`).
 */

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { FileX2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { DialogConfirmacionDinero } from "@/components/ui/dialog-confirmacion-dinero";
import { formatearCLP, formatearCLPOGuion } from "@/lib/ui/formato-moneda";
import { accionEmitirNotaCredito } from "./actions";

interface Props {
  periodoId: string;
  sellerNombre: string;
  /** Folio de la factura (DTE 33) que se va a anular. */
  folioFactura: number;
  /** Monto total de la factura a anular (el de la NC es el mismo, copiado). */
  montoTotalClp: number | null;
  /** Pagos ya imputados al período — si > 0 se advierte la desimputación. */
  montoPagadoClp: number;
}

export function DialogEmitirNotaCredito({
  periodoId,
  sellerNombre,
  folioFactura,
  montoTotalClp,
  montoPagadoClp,
}: Props) {
  const router = useRouter();
  const [abierto, setAbierto] = useState(false);
  const [motivo, setMotivo] = useState("");
  const [isPending, startTransition] = useTransition();

  const motivoValido = motivo.trim().length > 0;

  function manejarApertura(open: boolean) {
    setAbierto(open);
    if (!open) setMotivo("");
  }

  function handleConfirmar() {
    if (!motivoValido) return;
    startTransition(async () => {
      const resultado = await accionEmitirNotaCredito(periodoId, motivo.trim());
      if (resultado.ok) {
        manejarApertura(false);
        toast.success("Nota de crédito solicitada", {
          description: `Se anulará la factura folio ${folioFactura} de ${sellerNombre} en unos segundos.`,
        });
        router.refresh();
      } else {
        toast.error("No se pudo emitir la nota de crédito", {
          description: resultado.mensaje,
        });
      }
    });
  }

  return (
    <>
      <Button variant="destructive" size="sm" onClick={() => setAbierto(true)}>
        <FileX2 className="size-4" aria-hidden="true" />
        Emitir nota de crédito
      </Button>

      <DialogConfirmacionDinero
        open={abierto}
        onOpenChange={manejarApertura}
        variante="destructive"
        titulo={`Anular factura de ${sellerNombre}`}
        consecuencia={
          <>
            La nota de crédito es un documento tributario <strong>irreversible</strong>:
            anula la factura completa y el período quedará anulado. Las entregas del
            período volverán al período de facturación en curso.
          </>
        }
        cargando={isPending}
        textoConfirmar="Anular factura"
        confirmDeshabilitado={!motivoValido}
        onConfirmar={handleConfirmar}
      >
        <div className="flex flex-col gap-3">
          <dl className="flex flex-col gap-2">
            <div className="flex items-center justify-between gap-4">
              <dt className="text-muted-foreground">Factura a anular</dt>
              <dd className="font-mono font-medium tabular-nums">Folio {folioFactura}</dd>
            </div>
            <div className="flex items-center justify-between gap-4">
              <dt className="text-muted-foreground">Monto total</dt>
              <dd className="font-mono text-base font-semibold tabular-nums">
                {formatearCLPOGuion(montoTotalClp)}
              </dd>
            </div>
          </dl>

          <div className="flex flex-col gap-1.5">
            <Label htmlFor="nc-motivo">
              Motivo de la anulación <span className="text-destructive">*</span>
            </Label>
            <Textarea
              id="nc-motivo"
              value={motivo}
              onChange={(e) => setMotivo(e.target.value)}
              disabled={isPending}
              required
              rows={3}
              placeholder="Ej.: monto incorrecto, entregas mal imputadas, factura emitida por error…"
            />
            <p className="text-xs text-muted-foreground">
              Queda registrado en la auditoría y en la nota de crédito.
            </p>
          </div>

          {montoPagadoClp > 0 ? (
            <p className="rounded-md bg-warning-subtle px-3 py-2 text-xs text-warning-subtle-foreground">
              Hay <strong className="tabular-nums">{formatearCLP(montoPagadoClp)}</strong> ya
              pagados imputados a este período: volverán a la bandeja de revisión de
              pagos para reimputarse.
            </p>
          ) : null}
        </div>
      </DialogConfirmacionDinero>
    </>
  );
}
