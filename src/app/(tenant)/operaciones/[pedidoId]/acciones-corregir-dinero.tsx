"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Button } from "@/components/ui/button";
import { ModalActoExplicito } from "@/components/ui/modal-acto-explicito";
import { accionAnularCobroPedido, accionAnularLiquidacionPedido } from "./acciones-dinero";

type Accion = (pedidoId: string, motivo: string) => Promise<{ ok: boolean; mensaje?: string }>;

/**
 * DialogAnular — anular una línea de dinero. Peldaño 2 · motivo.
 *
 * ⚠️ **El motivo lo va a leer alguien de afuera**, y la regla 24 pide que el
 * formulario lo declare: el conductor ve el motivo de una línea de liquidación
 * anulada en su liquidación y en su PDF. Escribir «error» ahí es escribírselo a
 * él.
 *
 * Una línea anulada **no se borra**: queda con su autor y su motivo, en tono
 * inerte con su trama (registro §16.4).
 */
export function DialogAnular({
  pedidoId,
  titulo,
  descripcion,
  accion,
  etiquetaBoton,
  ayudaMotivo,
  textoConfirmar,
}: {
  pedidoId: string;
  titulo: string;
  descripcion: React.ReactNode;
  accion: Accion;
  etiquetaBoton: string;
  /** Quién va a leer el motivo. Se declara cuando es un externo. */
  ayudaMotivo?: string;
  textoConfirmar: string;
}) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [motivo, setMotivo] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [isPending, startTransition] = useTransition();

  function handleConfirmar() {
    setError(null);
    startTransition(async () => {
      const r = await accion(pedidoId, motivo);
      if (!r.ok) {
        setError(r.mensaje ?? "No se pudo completar la acción.");
        return;
      }
      setOpen(false);
      setMotivo("");
      router.refresh();
    });
  }

  return (
    <>
      <Button variant="outline" size="sm" onClick={() => setOpen(true)}>
        {etiquetaBoton}
      </Button>

      <ModalActoExplicito
        open={open}
        onOpenChange={(v) => {
          if (isPending) return;
          if (!v) setError(null);
          setOpen(v);
        }}
        peldano={2}
        variante="destructive"
        titulo={titulo}
        consecuencia={descripcion}
        motivo={{
          valor: motivo,
          onCambio: setMotivo,
          etiqueta: "Motivo",
          ayuda: ayudaMotivo ?? "Queda en la bitácora, con tu nombre.",
          // 10 caracteres: lo pide el copy de `cobro.anular.conf`. Es el mínimo
          // con el que un motivo dice algo — «error» no lo alcanza.
          minimo: 10,
        }}
        avisos={
          error
            ? [
                {
                  tono: "fault",
                  texto: (
                    <>
                      <strong>No pudimos anularla.</strong> {error} Nada cambió; puedes
                      volver a intentarlo.
                    </>
                  ),
                },
              ]
            : []
        }
        cargando={isPending}
        textoConfirmar={textoConfirmar}
        onConfirmar={handleConfirmar}
      />
    </>
  );
}

/**
 * Acciones de corrección manual del dinero de un pedido (B2). Cada botón se
 * muestra solo si la línea correspondiente es anulable (la página ya evaluó el
 * estado del período/liquidación y el RBAC del usuario).
 */
export function AccionesCorregirDinero({
  pedidoId,
  puedeAnularCobro,
  puedeAnularLiquidacion,
}: {
  pedidoId: string;
  puedeAnularCobro: boolean;
  puedeAnularLiquidacion: boolean;
}) {
  if (!puedeAnularCobro && !puedeAnularLiquidacion) return null;

  return (
    <div className="mt-3 flex flex-wrap items-center gap-2">
      <span className="text-xs text-muted-foreground">Corregir:</span>
      {puedeAnularCobro && (
        <DialogAnular
          pedidoId={pedidoId}
          titulo="Vas a anular el cobro de este pedido"
          descripcion={
            <>
              La línea sale del período y el seller deja de verla. Queda registrada
              como anulada con tu nombre y tu motivo, <strong>no se borra</strong>. Si
              el período ya estuviera facturado, esto no se puede hacer.
            </>
          }
          ayudaMotivo="Queda en la bitácora, con tu nombre."
          accion={accionAnularCobroPedido}
          etiquetaBoton="Anular cobro"
          textoConfirmar="Anular el cobro"
        />
      )}
      {puedeAnularLiquidacion && (
        <DialogAnular
          pedidoId={pedidoId}
          titulo="Vas a quitarle esta línea a la liquidación del conductor"
          descripcion={
            <>
              El conductor va a ver la línea anulada <strong>con tu motivo</strong> en su
              liquidación y en su PDF. Si ya le pagaste este período, esto no lo
              devuelve: hay que ajustarlo en el próximo.
            </>
          }
          ayudaMotivo="Lo lee el conductor, en su liquidación y en su PDF."
          accion={accionAnularLiquidacionPedido}
          etiquetaBoton="Anular liquidación"
          textoConfirmar="Anular la línea"
        />
      )}
    </div>
  );
}
