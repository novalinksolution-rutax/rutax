"use client";

/**
 * Dialog de confirmación para marcar una liquidación como pagada (D-3).
 *
 * Criterio C-1: usa formatearCLPOGuion para el monto.
 */

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { formatearCLPOGuion } from "@/lib/ui/formato-moneda";
import { ModalActoExplicito } from "@/components/ui/modal-acto-explicito";
import { accionMarcarLiquidacionPagada } from "./actions";

interface Props {
  liquidacionId: string;
  conductorNombre: string;
  fechaInicio: string;
  fechaFin: string;
  montoTotalClp: number | null;
}

function formatearFechaCorta(fechaIso: string): string {
  if (!fechaIso || fechaIso.length < 10) return fechaIso;
  const [anio, mes, dia] = fechaIso.slice(0, 10).split("-");
  return `${dia}/${mes}/${anio}`;
}

export function DialogMarcarPagada({
  liquidacionId,
  conductorNombre,
  fechaInicio,
  fechaFin,
  montoTotalClp,
}: Props) {
  const [abierto, setAbierto] = useState(false);
  const router = useRouter();
  const [motivo, setMotivo] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [isPending, startTransition] = useTransition();

  function handleConfirmar() {
    setError(null);
    startTransition(async () => {
      const resultado = await accionMarcarLiquidacionPagada(liquidacionId, motivo);
      if (resultado.ok) {
        setAbierto(false);
        // `router.refresh()` y no `window.location.reload()`: el reload duro
        // pierde el aviso y vuelve a montar la aplicación entera para refrescar
        // una fila.
        router.refresh();
      } else {
        setError(resultado.mensaje);
      }
    });
  }

  return (
    <>
      <button
        type="button"
        onClick={() => setAbierto(true)}
        className="rounded-ctrl bg-primary px-3 py-1 text-xs font-semibold text-primary-foreground transition-colors hover:bg-primary/90"
      >
        Marcar como pagada
      </button>

      <ModalActoExplicito
        open={abierto}
        onOpenChange={(o) => {
          if (isPending) return;
          setAbierto(o);
          if (!o) setError(null);
        }}
        peldano={2}
        titulo={`Vas a marcar como pagada la liquidación de ${conductorNombre}`}
        consecuencia={
          <>
            Esto <strong>no transfiere plata</strong>: solo registra que le pagaste por
            fuera. Si no le pagaste, va a quedar como pagada sin estarlo.
          </>
        }
        resumen={[
          {
            etiqueta: "Período",
            valor: `${formatearFechaCorta(fechaInicio)} – ${formatearFechaCorta(fechaFin)}`,
            mono: true,
          },
        ]}
        total={
          montoTotalClp !== null
            ? { etiqueta: "Monto de la liquidación", monto: montoTotalClp }
            : undefined
        }
        motivo={{
          valor: motivo,
          onCambio: setMotivo,
          etiqueta: "Cómo y cuándo le pagaste",
          ayuda: "Queda en la bitácora, con tu nombre. Es la única constancia de que el pago ocurrió fuera de Rutax.",
          minimo: 10,
        }}
        avisos={
          error
            ? [
                {
                  tono: "fault",
                  texto: (
                    <>
                      <strong>No pudimos marcarla como pagada.</strong> {error} Sigue
                      emitida; puedes volver a intentarlo.
                    </>
                  ),
                },
              ]
            : []
        }
        cargando={isPending}
        textoConfirmar="Marcar como pagada"
        subtextoConfirmar={formatearCLPOGuion(montoTotalClp)}
        onConfirmar={handleConfirmar}
      />
    </>
  );
}
