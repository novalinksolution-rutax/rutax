"use client";

/**
 * "Reactivar" una cuenta suspendida, desde `/admin/cuentas`.
 *
 * Sin diálogo previo: reactivar es la acción de baja fricción del par (la de
 * peso es "Dar de baja", con su propia ceremonia). El resultado sí necesita
 * espacio propio — `noReenganchado` puede traer varias líneas (conexiones,
 * consentimiento de WhatsApp, bodegas) — así que se muestra bajo el botón, no
 * en un toast que nadie vuelve a leer.
 */

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Button } from "@/components/ui/button";
import type { CuentaListada } from "@/modules/plataforma/panel-cuentas";
import { reactivarCuentaAction } from "./acciones";

type Resultado = { ok: true; noReenganchado: string[] } | { ok: false; motivo: string };

export function BotonReactivarCuenta({ cuenta }: { cuenta: CuentaListada }) {
  const router = useRouter();
  const [isPending, startTransition] = useTransition();
  const [resultado, setResultado] = useState<Resultado | null>(null);

  function reactivar() {
    setResultado(null);
    startTransition(async () => {
      const r = await reactivarCuentaAction(cuenta.usuarioId);
      if (r.ok) {
        setResultado({ ok: true, noReenganchado: r.noReenganchado });
        router.refresh();
      } else {
        setResultado({ ok: false, motivo: r.motivo ?? "No se pudo reactivar la cuenta." });
      }
    });
  }

  return (
    <div className="space-y-1.5">
      <Button variant="outline" size="sm" disabled={isPending} onClick={reactivar}>
        {isPending ? "Reactivando…" : "Reactivar"}
      </Button>
      {resultado && !resultado.ok ? <p className="text-xs text-destructive">{resultado.motivo}</p> : null}
      {resultado?.ok && resultado.noReenganchado.length > 0 ? (
        <ul className="max-w-xs list-disc space-y-0.5 pl-4 text-xs text-muted-foreground">
          {resultado.noReenganchado.map((texto) => (
            <li key={texto}>{texto}</li>
          ))}
        </ul>
      ) : null}
    </div>
  );
}
