"use client";

/**
 * Dialog de creación y edición de una bodega (seller o courier).
 * Mismo formulario para los dos tipos — los campos de contacto solo se
 * muestran para `tipo === "seller"` (courier_bodegas no los tiene).
 */

import { useState, useTransition, type FormEvent } from "react";
import {
  Dialog,
  DialogClose,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Textarea } from "@/components/ui/textarea";
import { COMUNAS_RM } from "@/lib/ui/comunas-rm";
import { formatearCLP } from "@/lib/ui/formato-moneda";
import {
  accionCrearBodegaCourier,
  accionCrearBodegaSeller,
  accionEditarBodegaCourier,
  accionEditarBodegaSeller,
  type TipoBodega,
} from "./actions";

export interface BodegaParaEditar {
  id: string;
  nombre: string;
  direccion: string;
  comuna: string;
  instruccionesAcceso: string | null;
  contactoNombre: string | null;
  contactoTelefono: string | null;
  esPrincipal: boolean;
  /** Solo tiene sentido para `tipo === "seller"` — `null` = hereda el monto general. */
  montoVisitaClp: number | null;
}

interface Props {
  tipo: TipoBodega;
  /** Requerido al CREAR una bodega de seller (edición no lo necesita). */
  sellerId?: string;
  bodegaExistente?: BodegaParaEditar;
  /** Solo relevante al crear: ¿será la primera bodega de este seller/courier? */
  esPrimera?: boolean;
  /** La OTRA bodega principal (si existe), para avisar "esto la reemplazará". */
  principalActual?: { id: string; nombre: string } | null;
  /**
   * Monto general del courier (`courier_config_retiro.monto_visita_bodega_clp`),
   * solo para mostrarlo en el placeholder del override — nunca se envía en el
   * formulario. `null` si el courier todavía no lo configuró. Ignorado cuando
   * `tipo === "courier"` (esa tabla no tiene el campo).
   */
  montoVisitaDefaultClp?: number | null;
  trigger?: React.ReactNode;
  onGuardada: () => void;
}

export function DialogBodega({
  tipo,
  sellerId,
  bodegaExistente,
  esPrimera = false,
  principalActual = null,
  montoVisitaDefaultClp = null,
  trigger,
  onGuardada,
}: Props) {
  const [open, setOpen] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [isPending, startTransition] = useTransition();
  const [esPrincipal, setEsPrincipal] = useState(bodegaExistente?.esPrincipal ?? false);

  const esEdicion = !!bodegaExistente;
  const conContacto = tipo === "seller";
  const muestraLineaPrimera = esPrimera && !esEdicion;

  function alCambiarApertura(v: boolean) {
    setOpen(v);
    if (v) {
      setError(null);
      setEsPrincipal(bodegaExistente?.esPrincipal ?? false);
    }
  }

  function handleSubmit(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    setError(null);

    if (!esEdicion && tipo === "seller" && !sellerId) {
      setError("Falta el seller.");
      return;
    }

    const formData = new FormData(e.currentTarget);

    startTransition(async () => {
      const resultado = esEdicion
        ? tipo === "seller"
          ? await accionEditarBodegaSeller(bodegaExistente.id, formData)
          : await accionEditarBodegaCourier(bodegaExistente.id, formData)
        : tipo === "seller"
          ? await accionCrearBodegaSeller(sellerId as string, formData)
          : await accionCrearBodegaCourier(formData);

      if (!resultado.ok) {
        setError(resultado.mensaje);
        return;
      }
      setOpen(false);
      onGuardada();
    });
  }

  return (
    <Dialog open={open} onOpenChange={alCambiarApertura}>
      <DialogTrigger asChild>
        {trigger ?? <Button size="sm">Agregar bodega</Button>}
      </DialogTrigger>
      <DialogContent className="max-h-[90vh] overflow-y-auto sm:max-w-lg">
        <DialogHeader>
          <DialogTitle>{esEdicion ? "Editar bodega" : "Nueva bodega"}</DialogTitle>
          <DialogDescription>
            {tipo === "seller"
              ? "Dónde retira el conductor los pedidos de este seller."
              : "De dónde sale tu flota a repartir."}
          </DialogDescription>
        </DialogHeader>

        <form onSubmit={handleSubmit} className="space-y-4">
          {/* Respaldo del checkbox de más abajo — siempre presente, aunque la
              UI no lo muestre cuando es la primera bodega. */}
          <input type="hidden" name="es_principal" value={esPrincipal ? "true" : "false"} />

          <div className="space-y-1.5">
            <Label htmlFor="nombre">Nombre de la bodega</Label>
            <Input
              id="nombre"
              name="nombre"
              required
              placeholder="Ej: Bodega Quilicura"
              defaultValue={bodegaExistente?.nombre ?? ""}
              disabled={isPending}
            />
          </div>

          <div className="grid gap-4 sm:grid-cols-2">
            <div className="space-y-1.5">
              <Label htmlFor="direccion">Dirección</Label>
              <Input
                id="direccion"
                name="direccion"
                required
                placeholder="Calle y número"
                defaultValue={bodegaExistente?.direccion ?? ""}
                disabled={isPending}
              />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="comuna">Comuna</Label>
              <Select name="comuna" required defaultValue={bodegaExistente?.comuna} disabled={isPending}>
                <SelectTrigger id="comuna" className="h-9 w-full">
                  <SelectValue placeholder="Selecciona una comuna" />
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
          </div>

          {conContacto && (
            <div className="grid gap-4 sm:grid-cols-2">
              <div className="space-y-1.5">
                <Label htmlFor="contacto_nombre">A quién llamar (opcional)</Label>
                <Input
                  id="contacto_nombre"
                  name="contacto_nombre"
                  placeholder="Nombre del jefe de bodega"
                  defaultValue={bodegaExistente?.contactoNombre ?? ""}
                  disabled={isPending}
                />
              </div>
              <div className="space-y-1.5">
                <Label htmlFor="contacto_telefono">Teléfono de contacto (opcional)</Label>
                <Input
                  id="contacto_telefono"
                  name="contacto_telefono"
                  type="tel"
                  placeholder="+56 9 1234 5678"
                  defaultValue={bodegaExistente?.contactoTelefono ?? ""}
                  disabled={isPending}
                />
              </div>
            </div>
          )}

          {conContacto && (
            <div className="space-y-1.5">
              <Label htmlFor="monto_visita_clp">Pago por visita a esta bodega (opcional)</Label>
              <Input
                id="monto_visita_clp"
                name="monto_visita_clp"
                type="number"
                min={1}
                step={1}
                defaultValue={bodegaExistente?.montoVisitaClp ?? ""}
                placeholder="Vacío = usa el monto general del courier"
                disabled={isPending}
              />
              <p className="text-xs text-muted-foreground">
                Lo que le pagas al conductor por cerrar una visita en ESTA bodega.{" "}
                {montoVisitaDefaultClp !== null
                  ? `Vacío = usa el monto general del courier (${formatearCLP(montoVisitaDefaultClp)}).`
                  : "Vacío = usa el monto general del courier — todavía no lo configuras en Configuración → Retiro."}
              </p>
            </div>
          )}

          <div className="space-y-1.5">
            <Label htmlFor="instrucciones_acceso">Instrucciones de acceso (opcional)</Label>
            <Textarea
              id="instrucciones_acceso"
              name="instrucciones_acceso"
              rows={2}
              placeholder="Portón, timbre, horario del jefe de bodega, dónde estacionar…"
              defaultValue={bodegaExistente?.instruccionesAcceso ?? ""}
              disabled={isPending}
            />
          </div>

          {muestraLineaPrimera ? (
            <p className="rounded-lg border border-border bg-muted/30 px-3 py-2 text-sm text-muted-foreground">
              Esta será tu bodega principal (es la primera).
            </p>
          ) : (
            <div className="space-y-1.5">
              <label htmlFor="es_principal_check" className="flex cursor-pointer items-start gap-2.5 text-sm">
                <Checkbox
                  id="es_principal_check"
                  checked={esPrincipal}
                  onCheckedChange={(v) => setEsPrincipal(v === true)}
                  disabled={isPending}
                  className="mt-0.5"
                />
                <span className="text-foreground">
                  Marcar como {tipo === "seller" ? "bodega principal de este seller" : "tu bodega principal"}
                </span>
              </label>
              {esPrincipal && principalActual && (
                <p className="pl-6 text-xs text-muted-foreground">
                  Reemplazará a «{principalActual.nombre}» como principal.
                </p>
              )}
              {!esPrincipal && bodegaExistente?.esPrincipal && (
                <p className="pl-6 text-xs text-muted-foreground">
                  Si guardas sin marcarla, quedará sin bodega principal hasta que elijas otra.
                </p>
              )}
            </div>
          )}

          {error && (
            <p role="alert" className="text-sm text-destructive">
              {error}
            </p>
          )}

          <DialogFooter>
            <DialogClose asChild>
              <Button type="button" variant="outline" disabled={isPending}>
                Cancelar
              </Button>
            </DialogClose>
            <Button type="submit" loading={isPending}>
              {esEdicion ? "Guardar cambios" : "Crear bodega"}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
