"use client";

/**
 * Alta y edición de una bodega, desde el portal del seller.
 * =============================================================================
 * Es el mismo panel lateral que usa el courier —`PanelAccion`, hoja inferior en
 * teléfono y lateral desde tablet— con dos diferencias que vienen del rol:
 *
 * · **No existe el pago por visita.** Es lo que el courier le paga al conductor
 *   por venir hasta acá; el seller ni lo ve ni lo escribe. Ver `actions.ts`.
 * · **No hay selector de seller.** Él es el seller: el `seller_id` sale de la
 *   sesión en el servidor y no viaja en el formulario.
 *
 * ⚠️ El campo de contacto NO es opcional de adorno: es «a quién llama el
 * conductor cuando llega y el portón está cerrado». Por eso su ayuda dice eso y
 * no «contacto», que no le dice a nadie para qué sirve.
 */

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { PanelAccion } from "@/components/ui/panel-accion";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { COMUNAS_RM } from "@/lib/ui/comunas-rm";
import { accionCrearMiBodega, accionEditarMiBodega } from "./actions";

export interface BodegaEditable {
  id: string;
  nombre: string;
  direccion: string;
  comuna: string;
  instruccionesAcceso: string | null;
  contactoNombre: string | null;
  contactoTelefono: string | null;
}

export function PanelMiBodega({
  bodega,
  abierto,
  onOpenChange,
  disparador,
}: {
  /** `undefined` = alta. */
  bodega?: BodegaEditable;
  abierto: boolean;
  onOpenChange: (abierto: boolean) => void;
  disparador?: React.ReactNode;
}) {
  const router = useRouter();
  const esEdicion = !!bodega;
  const [error, setError] = useState<string | null>(null);
  const [comuna, setComuna] = useState(bodega?.comuna ?? "");
  const [guardando, iniciar] = useTransition();

  function guardar(fd: FormData) {
    // El `Select` de shadcn no es un control nativo: su valor no entra solo en
    // el FormData. Se inyecta acá o el servidor recibe la comuna vacía.
    fd.set("comuna", comuna);
    setError(null);
    iniciar(async () => {
      const r = esEdicion
        ? await accionEditarMiBodega(bodega.id, fd)
        : await accionCrearMiBodega(fd);
      if (!r.ok) {
        setError(r.mensaje);
        return;
      }
      onOpenChange(false);
      router.refresh();
    });
  }

  return (
    <PanelAccion
      abierto={abierto}
      onOpenChange={(a) => {
        if (!a) setError(null);
        onOpenChange(a);
      }}
      disparador={disparador}
      titulo={esEdicion ? bodega.nombre : "Nueva bodega"}
      subtitulo="Desde acá retira tu courier. La dirección y el contacto son los que va a usar el conductor."
      pie={
        <div className="flex items-center gap-2">
          <Button type="submit" form="form-mi-bodega" disabled={guardando}>
            {guardando ? "Guardando…" : esEdicion ? "Guardar" : "Agregar la bodega"}
          </Button>
          <Button
            type="button"
            variant="outline"
            disabled={guardando}
            onClick={() => onOpenChange(false)}
          >
            Volver
          </Button>
        </div>
      }
    >
      <form id="form-mi-bodega" action={guardar} className="space-y-4">
        <div className="space-y-1.5">
          <Label htmlFor="nombre">Nombre</Label>
          <Input
            id="nombre"
            name="nombre"
            defaultValue={bodega?.nombre ?? ""}
            placeholder="Ej: Bodega Quilicura"
            disabled={guardando}
          />
          <p className="text-xs text-fg-muted">
            Con este nombre la vas a reconocer tú y la va a ver el conductor.
          </p>
        </div>

        <div className="space-y-1.5">
          <Label htmlFor="direccion">Dirección</Label>
          <Input
            id="direccion"
            name="direccion"
            defaultValue={bodega?.direccion ?? ""}
            placeholder="Calle, número, y el detalle que haga falta"
            disabled={guardando}
          />
        </div>

        <div className="space-y-1.5">
          <Label htmlFor="comuna">Comuna</Label>
          <Select value={comuna} onValueChange={setComuna} disabled={guardando}>
            <SelectTrigger id="comuna" className="w-full">
              <SelectValue placeholder="Elige una comuna" />
            </SelectTrigger>
            <SelectContent>
              {COMUNAS_RM.map((c) => (
                <SelectItem key={c} value={c}>
                  {c}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>

        <div className="space-y-1.5">
          <Label htmlFor="contacto_nombre">A quién llamar</Label>
          <Input
            id="contacto_nombre"
            name="contacto_nombre"
            defaultValue={bodega?.contactoNombre ?? ""}
            placeholder="Nombre de quien recibe al conductor"
            disabled={guardando}
          />
          <Input
            name="contacto_telefono"
            defaultValue={bodega?.contactoTelefono ?? ""}
            placeholder="+56 9 …"
            inputMode="tel"
            disabled={guardando}
          />
          <p className="text-xs text-fg-muted">
            Es a quien llama el conductor si llega y no puede entrar.
          </p>
        </div>

        <div className="space-y-1.5">
          <Label htmlFor="instrucciones_acceso">Cómo se entra</Label>
          <Textarea
            id="instrucciones_acceso"
            name="instrucciones_acceso"
            defaultValue={bodega?.instruccionesAcceso ?? ""}
            rows={3}
            placeholder="Portón, andén, horarios de retiro, dónde estacionar…"
            disabled={guardando}
          />
          <p className="text-xs text-fg-muted">
            Lo lee el conductor en su app, antes de llegar.
          </p>
        </div>

        {error && (
          <p
            role="alert"
            className="border border-fault-line bg-fault-bg px-3 py-2 text-sm text-fault-fg"
          >
            {error}
          </p>
        )}
      </form>
    </PanelAccion>
  );
}
