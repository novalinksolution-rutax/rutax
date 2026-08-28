"use client";

/**
 * Panel de áreas de producto — el interruptor de Rutax por courier.
 * =============================================================================
 *
 * -----------------------------------------------------------------------------
 * 🔴 CADA FILA DICE LA CONSECUENCIA, NO EL NOMBRE TÉCNICO
 * -----------------------------------------------------------------------------
 * «emision_facturas» no le dice a nadie qué pasa si lo apaga. Cada fila lleva
 * **qué deja de poder hacer el courier** y **qué sigue viendo**, porque la
 * decisión que se toma acá no es «activar una bandera»: es quitarle a un cliente
 * que está operando una parte de su producto, y hay que poder verlo antes de
 * pulsar.
 *
 * -----------------------------------------------------------------------------
 * APAGAR PIDE CONFIRMACIÓN; ENCENDER NO
 * -----------------------------------------------------------------------------
 * No son simétricos. Encender abre algo y se deshace apagando; apagar **le quita
 * la opción a todos los usuarios del courier en su siguiente navegación**, sin
 * aviso para ellos. Es la misma asimetría que ya usa el backstage de WhatsApp
 * (revocar vs. eliminar) y la de la conciliación en lote (asignar vs. cerrar).
 *
 * ⚠️ El aviso de arriba dice cuándo surte efecto, porque es la pregunta que se
 * hace cualquiera que pulse: no hay caché ni token que esperar — la sesión del
 * courier lee esto en cada request.
 */

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { AlertTriangle, Check, Info } from "lucide-react";

import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import { DESCRIPCION_AREAS, type AreaProducto } from "@/modules/identidad/areas-producto";

import { accionFijarArea } from "./areas-actions";

export interface AreaEnPanel {
  area: AreaProducto;
  habilitada: boolean;
  nota: string | null;
}

export function PanelAreas({
  tenantId,
  nombreCourier,
  areas,
}: {
  tenantId: string;
  nombreCourier: string;
  areas: readonly AreaEnPanel[];
}) {
  const router = useRouter();
  const [pendiente, iniciar] = useTransition();
  const [error, setError] = useState<string | null>(null);
  const [confirmando, setConfirmando] = useState<AreaProducto | null>(null);

  const estado = new Map(areas.map((a) => [a.area, a]));
  const encendidas = areas.filter((a) => a.habilitada).length;

  function cambiar(area: AreaProducto, habilitar: boolean) {
    setError(null);
    setConfirmando(null);
    const datos = new FormData();
    datos.set("tenant_id", tenantId);
    datos.set("area", area);
    datos.set("habilitar", String(habilitar));
    iniciar(async () => {
      const r = await accionFijarArea(datos);
      if (!r.ok) setError(r.mensaje);
      else router.refresh();
    });
  }

  return (
    <section className="space-y-3" aria-labelledby="areas-titulo">
      <div className="flex flex-wrap items-baseline justify-between gap-x-3 gap-y-1">
        <h2 id="areas-titulo" className="text-sm font-medium text-muted-foreground">
          Áreas del producto
        </h2>
        <span className="text-xs text-muted-foreground">
          {encendidas} de {areas.length} encendidas
        </span>
      </div>

      <div className="flex items-start gap-2 border border-border bg-muted/40 px-4 py-3">
        <Info className="mt-0.5 size-4 shrink-0 text-muted-foreground" aria-hidden="true" />
        <p className="text-sm text-muted-foreground">
          Lo que apagues acá desaparece para <strong>todos</strong> los usuarios de{" "}
          {nombreCourier} —los de hoy y los que cree después— en su siguiente navegación. No
          hay que esperar a que cierren sesión. Un courier nuevo nace con todo apagado.
        </p>
      </div>

      {error ? (
        <p role="alert" className="border border-destructive/40 bg-destructive/5 px-4 py-3 text-sm text-destructive">
          {error}
        </p>
      ) : null}

      <ul className="divide-y divide-border border border-border">
        {DESCRIPCION_AREAS.map((d) => {
          const fila = estado.get(d.clave);
          const encendida = fila?.habilitada ?? false;
          const enConfirmacion = confirmando === d.clave;

          return (
            <li key={d.clave} className="px-4 py-3">
              <div className="flex flex-wrap items-start justify-between gap-3">
                <div className="min-w-0 flex-1 space-y-1">
                  <div className="flex flex-wrap items-center gap-2">
                    <span className="font-medium text-foreground">{d.titulo}</span>
                    <span
                      className={cn(
                        "border px-1.5 py-0.5 text-[11px]",
                        encendida
                          ? "border-balanced-line bg-balanced-bg text-balanced-fg"
                          : "border-border text-muted-foreground",
                      )}
                    >
                      {encendida ? "encendida" : "apagada"}
                    </span>
                  </div>
                  {/* La consecuencia, no el nombre técnico. */}
                  <p className="text-sm text-muted-foreground">
                    {encendida ? `Al apagarla, deja de poder: ${minuscula(d.apaga)}` : d.apaga}
                  </p>
                  {d.conserva ? (
                    <p className="text-sm text-muted-foreground">
                      <span className="text-foreground">Sigue viendo:</span> {d.conserva}
                    </p>
                  ) : null}
                </div>

                <div className="shrink-0">
                  {enConfirmacion ? (
                    <div className="flex items-center gap-2">
                      <span className="flex items-center gap-1.5 text-xs text-attention-fg">
                        <AlertTriangle className="size-3.5" aria-hidden="true" />
                        ¿Seguro?
                      </span>
                      <Button
                        size="sm"
                        variant="destructive"
                        disabled={pendiente}
                        onClick={() => cambiar(d.clave, false)}
                      >
                        Apagar
                      </Button>
                      <Button size="sm" variant="ghost" onClick={() => setConfirmando(null)}>
                        Cancelar
                      </Button>
                    </div>
                  ) : encendida ? (
                    // Apagar pide confirmación: se la quita a todos sus usuarios.
                    <Button
                      size="sm"
                      variant="outline"
                      disabled={pendiente}
                      onClick={() => setConfirmando(d.clave)}
                    >
                      Apagar
                    </Button>
                  ) : (
                    // Encender no la pide: abre algo, y se deshace apagando.
                    <Button size="sm" disabled={pendiente} onClick={() => cambiar(d.clave, true)}>
                      <Check className="size-4" aria-hidden="true" />
                      Encender
                    </Button>
                  )}
                </div>
              </div>
            </li>
          );
        })}
      </ul>
    </section>
  );
}

/** «Emitir DTE…» → «emitir DTE…», para que encaje dentro de la frase. */
function minuscula(frase: string): string {
  return frase.charAt(0).toLowerCase() + frase.slice(1);
}
