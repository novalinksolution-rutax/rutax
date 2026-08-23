"use client";

/**
 * Cerrar un período de cobro. Peldaño 2 de la escalera de fricción.
 *
 * El copy dice «se puede volver a abrir mientras no esté facturado» y **ahora es
 * cierto**: hasta el 22-08-2026 la reapertura no existía en el código, así que
 * esta pantalla no la prometía (regla 35). Se construyó —`reabrirPeriodo`, con
 * su botón en el detalle— y la frase entró tal como estaba escrita en el sistema
 * de mensajes.
 */

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { formatearCLPOGuion } from "@/lib/ui/formato-moneda";
import { ModalActoExplicito } from "@/components/ui/modal-acto-explicito";
import { accionCerrarPeriodo } from "./actions";

interface Props {
  periodoId: string;
  sellerNombre: string;
  fechaInicio: string;
  fechaFin: string;
  totalLineas: number;
  montoTotalClp: number | null;
}

function formatearFechaCorta(fechaIso: string): string {
  if (!fechaIso || fechaIso.length < 10) return fechaIso;
  const [anio, mes, dia] = fechaIso.slice(0, 10).split("-");
  return `${dia}/${mes}/${anio}`;
}

export function DialogCerrarPeriodo({
  periodoId,
  sellerNombre,
  fechaInicio,
  fechaFin,
  totalLineas,
  montoTotalClp,
}: Props) {
  const router = useRouter();
  const [abierto, setAbierto] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [isPending, startTransition] = useTransition();

  function handleConfirmar() {
    setError(null);
    startTransition(async () => {
      const resultado = await accionCerrarPeriodo(periodoId);
      if (resultado.ok) {
        setAbierto(false);
        // Regla 57: todo mensaje de éxito de dinero lleva monto y contraparte.
        // «Período cerrado» a secas no dice de quién ni por cuánto.
        toast.success(`Cerraste el período de ${sellerNombre}`, {
          description: `${totalLineas} líneas por ${formatearCLPOGuion(montoTotalClp)}. Ya puedes revisar el detalle y emitir la factura.`,
        });
        // Refresco suave: re-renderiza la tabla con el nuevo estado SIN perder el
        // toast (un reload duro lo borraría).
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
        Cerrar período
      </button>

      <ModalActoExplicito
        open={abierto}
        onOpenChange={(o) => {
          if (isPending) return;
          setAbierto(o);
          if (!o) setError(null);
        }}
        // Peldaño 2: tiene consecuencia y no es reversible, pero no mueve plata
        // hacia afuera. El nombre escrito se reserva para el peldaño 3.
        peldano={2}
        titulo={`Vas a cerrar el período de ${sellerNombre}`}
        consecuencia={
          <>
            Después de cerrarlo, las entregas nuevas de este seller van al período
            siguiente. <strong>Todavía no se factura nada</strong>: eso es un paso
            aparte. Se puede volver a abrir mientras no esté facturado.
          </>
        }
        resumen={[
          {
            etiqueta: "Período",
            valor: `${formatearFechaCorta(fechaInicio)} – ${formatearFechaCorta(fechaFin)}`,
            mono: true,
          },
          { etiqueta: "Líneas que se consolidan", valor: totalLineas, mono: true },
        ]}
        total={
          montoTotalClp !== null ? { etiqueta: "Total del período", monto: montoTotalClp } : undefined
        }
        avisos={
          error
            ? [
                {
                  tono: "fault",
                  texto: (
                    <>
                      <strong>No pudimos cerrar el período.</strong> {error} Sigue abierto
                      y puedes volver a intentarlo.
                    </>
                  ),
                },
              ]
            : []
        }
        cargando={isPending}
        textoConfirmar="Cerrar el período"
        subtextoConfirmar={formatearCLPOGuion(montoTotalClp)}
        onConfirmar={handleConfirmar}
      />
    </>
  );
}
