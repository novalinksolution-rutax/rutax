"use client";

/**
 * Devolver a la bandeja un movimiento descartado. Peldaño 2 con motivo.
 *
 * Es la otra mitad del cajón «Descartados». El copy de
 * `cobranza.descartarMov.conf` promete que descartar «no borra» y que el
 * movimiento «se puede recuperar»; hasta el 23-08-2026 ninguna de las dos cosas
 * era cierta.
 *
 * Pide motivo porque la pregunta que viene después es «¿por qué volvió?»: un
 * movimiento que entra y sale de la bandeja sin explicación es exactamente lo
 * que hace que nadie confíe en el saldo.
 */

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";

import { BotonConfirmado } from "@/components/ui/boton-confirmado";
import { formatearCLP } from "@/lib/ui/formato-moneda";
import { accionRecuperarPagoDescartado } from "./actions";

export function BotonRecuperarPago({
  pagoId,
  montoClp,
  fecha,
}: {
  pagoId: string;
  montoClp: number;
  fecha: string;
}) {
  const router = useRouter();
  const [motivo, setMotivo] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [isPending, startTransition] = useTransition();

  function recuperar() {
    setError(null);
    startTransition(async () => {
      const resultado = await accionRecuperarPagoDescartado(pagoId, motivo);
      if (resultado.ok) {
        setMotivo("");
        router.refresh();
        return;
      }
      setError(resultado.mensaje);
    });
  }

  return (
    <BotonConfirmado
      variant="outline"
      size="sm"
      etiqueta="Devolver a la bandeja"
      deshabilitado={isPending}
      cargando={isPending}
      peldano={2}
      titulo={`Vas a devolver ${formatearCLP(montoClp)} a la bandeja`}
      consecuencia={
        <>
          Vuelve a los movimientos por atribuir como <strong>sin atribuir</strong>, listo para
          asignarlo a un seller y a un período. Ningún período se toca por esto.
          {error ? (
            <>
              {" "}
              <span className="text-fault-fg">No se pudo: {error}</span>
            </>
          ) : null}
        </>
      }
      resumen={[
        { etiqueta: "Movimiento", valor: `${formatearCLP(montoClp)} del ${fecha}`, mono: true },
      ]}
      motivo={{
        valor: motivo,
        onCambio: setMotivo,
        etiqueta: "Por qué lo devuelves",
        ayuda: "Queda en la bitácora, a tu nombre.",
        minimo: 1,
      }}
      textoConfirmar="Devolver a la bandeja"
      onConfirmar={recuperar}
    />
  );
}
