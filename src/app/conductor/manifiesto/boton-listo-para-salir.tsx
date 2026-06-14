"use client";

/**
 * Botón "Listo para salir" — confirmar recepción del manifiesto.
 * Solo visible cuando el manifiesto está en estado 'confirmado' (B-2).
 * Ancho completo, altura mínima 56px, al fondo de la pantalla.
 */

import { useState, useTransition } from "react";
import { CheckCircle2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { actionConductorListoParaSalir } from "./actions";

interface Props {
  manifiestoId: string;
  totalPedidos: number;
  estaEnRuta: boolean;
}

export function BotonListoParaSalir({ manifiestoId, totalPedidos, estaEnRuta }: Props) {
  const [abierto, setAbierto] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [horaPartida, setHoraPartida] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();

  // Si ya está en ruta, mostrar el estado sin botón de acción
  if (estaEnRuta || horaPartida) {
    const hora = horaPartida ?? new Date().toLocaleTimeString("es-CL", { hour: "2-digit", minute: "2-digit" });
    return (
      <div
        role="status"
        className="fixed inset-x-0 bottom-0 z-40 border-t border-border bg-success px-4 py-4"
        aria-live="polite"
      >
        <div className="mx-auto flex max-w-lg items-center justify-center gap-2 text-success-foreground">
          <CheckCircle2 className="size-5" aria-hidden="true" />
          <p className="text-base font-semibold">En ruta — saliste a las {hora}</p>
        </div>
      </div>
    );
  }

  function handleConfirmar() {
    setError(null);
    const formData = new FormData();
    formData.set("manifiestoId", manifiestoId);

    startTransition(async () => {
      const resultado = await actionConductorListoParaSalir(formData);
      if (resultado?.error) {
        setError(resultado.error);
        setAbierto(false);
      } else {
        const ahora = new Date().toLocaleTimeString("es-CL", { hour: "2-digit", minute: "2-digit" });
        setHoraPartida(ahora);
        setAbierto(false);
      }
    });
  }

  return (
    <>
      {/* Botón sticky al fondo */}
      <div className="fixed bottom-0 left-0 right-0 z-40 border-t bg-card px-4 py-4 shadow-lg">
        <div className="mx-auto max-w-lg">
          {error && (
            <p role="alert" className="mb-3 rounded-lg bg-destructive-subtle px-3 py-2 text-sm text-destructive-subtle-foreground">
              {error}
            </p>
          )}
          <Button
            type="button"
            onClick={() => setAbierto(true)}
            disabled={pending}
            className="min-h-14 w-full rounded-xl text-base font-bold"
          >
            Listo para salir
          </Button>
        </div>
      </div>

      {/* Dialog de confirmación */}
      {abierto && (
        <div
          role="dialog"
          aria-modal="true"
          aria-labelledby="dialog-salir-titulo"
          className="fixed inset-0 z-50 flex items-end justify-center sm:items-center p-4"
        >
          {/* Overlay */}
          <div
            className="absolute inset-0 bg-black/50"
            onClick={() => !pending && setAbierto(false)}
            aria-hidden="true"
          />

          {/* Panel — bottom sheet en móvil */}
          <div className="relative z-10 w-full max-w-md rounded-t-2xl sm:rounded-xl bg-card shadow-xl border p-6 space-y-4">
            <h2 id="dialog-salir-titulo" className="text-lg font-semibold">
              Confirmar recepción de paquetes
            </h2>
            <p className="text-sm text-muted-foreground">
              ¿Confirmas que recibiste los{" "}
              <span className="font-semibold text-foreground">{totalPedidos} paquete{totalPedidos !== 1 ? "s" : ""}</span>{" "}
              de este manifiesto y estás listo para salir?
            </p>

            <div className="flex flex-col gap-2 pt-2">
              <Button
                type="button"
                loading={pending}
                onClick={handleConfirmar}
                className="min-h-13 w-full rounded-xl text-base font-bold"
              >
                {pending ? "Registrando..." : "Sí, estoy listo para salir"}
              </Button>
              <Button
                type="button"
                variant="outline"
                disabled={pending}
                onClick={() => setAbierto(false)}
                className="min-h-12 w-full rounded-xl"
              >
                Cancelar
              </Button>
            </div>
          </div>
        </div>
      )}
    </>
  );
}
