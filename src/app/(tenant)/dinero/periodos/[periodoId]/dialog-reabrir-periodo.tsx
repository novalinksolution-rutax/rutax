"use client";

/**
 * Reabrir un período cerrado. Peldaño 2 con motivo.
 *
 * Existe porque el tablero `B2a` la dibuja y el copy de `periodos.cerrar.conf`
 * la promete —«se puede reabrir mientras no esté facturado»—, y hasta el
 * 22-08-2026 no existía: el cierre era irreversible sin ninguna razón técnica
 * que lo justificara, y la pantalla de cierre tenía que decir lo contrario de lo
 * que el sistema de mensajes tenía escrito.
 *
 * El botón **no se esconde** cuando no se puede: el dominio explica por qué
 * (facturado, o con una emisión en curso) y ese motivo llega al aviso embebido.
 * Un botón que desaparece hace pensar que la pantalla está incompleta.
 */

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { RotateCcw } from "lucide-react";

import { Button } from "@/components/ui/button";
import { ModalActoExplicito } from "@/components/ui/modal-acto-explicito";
import { accionReabrirPeriodo } from "../actions";

export function DialogReabrirPeriodo({
  periodoId,
  sellerNombre,
}: {
  periodoId: string;
  sellerNombre: string;
}) {
  const router = useRouter();
  const [abierto, setAbierto] = useState(false);
  const [motivo, setMotivo] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [isPending, startTransition] = useTransition();

  function handleConfirmar() {
    setError(null);
    startTransition(async () => {
      const resultado = await accionReabrirPeriodo(periodoId, motivo);
      if (resultado.ok) {
        setAbierto(false);
        setMotivo("");
        router.refresh();
        return;
      }
      setError(resultado.mensaje);
    });
  }

  return (
    <>
      <Button variant="outline" size="sm" onClick={() => setAbierto(true)}>
        <RotateCcw className="size-4" aria-hidden="true" />
        Volver a abrir
      </Button>

      <ModalActoExplicito
        open={abierto}
        onOpenChange={(o) => {
          if (isPending) return;
          setAbierto(o);
          if (!o) setError(null);
        }}
        peldano={2}
        titulo={`Vas a volver a abrir el período de ${sellerNombre}`}
        consecuencia={
          <>
            Las líneas vuelven al período en curso y las entregas nuevas de este seller
            caen otra vez acá. <strong>Sus totales se recalculan al cerrarlo de nuevo.</strong>
          </>
        }
        motivo={{
          valor: motivo,
          onCambio: setMotivo,
          etiqueta: "Por qué lo reabres",
          ayuda: "Queda en la bitácora, con tu nombre.",
          minimo: 10,
        }}
        avisos={
          error
            ? [
                {
                  tono: "fault",
                  texto: (
                    <>
                      <strong>No se pudo reabrir.</strong> {error}
                    </>
                  ),
                },
              ]
            : []
        }
        cargando={isPending}
        textoConfirmar="Volver a abrir el período"
        onConfirmar={handleConfirmar}
      />
    </>
  );
}
