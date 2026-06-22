"use client";

/**
 * Dialog de creación y edición de tarifa (F14).
 * Cubre todos los campos del rate card: base, mínimos y recargo de reprogramación.
 */

import { useState, useTransition, useRef } from "react";
import { useRouter } from "next/navigation";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
  DialogFooter,
  DialogClose,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { accionCrearTarifa, accionEditarTarifa } from "./actions";

interface TarifaExistente {
  id: string;
  sellerId: string | null;
  tipoEntrega: string;
  modoCalculo: string;
  zona: string | null;
  montoClp: number;
  vigenteDesdeFecha: string;
  vigenteHasta: string | null;
  minimoFacturacionClp: number | null;
  minimoRetiroClp: number | null;
  recargoReprogramacionClp: number | null;
}

interface Seller {
  id: string;
  nombre: string;
}

interface Props {
  sellers: Seller[];
  tarifa?: TarifaExistente;
  trigger?: React.ReactNode;
}

export function DialogTarifa({ sellers, tarifa, trigger }: Props) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [isPending, startTransition] = useTransition();
  const formRef = useRef<HTMLFormElement>(null);

  const esEdicion = !!tarifa;

  function handleSubmit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    setError(null);
    const formData = new FormData(e.currentTarget);

    startTransition(async () => {
      const resultado = esEdicion
        ? await accionEditarTarifa(tarifa.id, formData)
        : await accionCrearTarifa(formData);

      if (!resultado.ok) {
        setError(resultado.mensaje);
        return;
      }
      setOpen(false);
      router.refresh();
    });
  }

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        {trigger ?? <Button size="sm">Nueva tarifa</Button>}
      </DialogTrigger>
      <DialogContent className="sm:max-w-lg max-h-[90vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle>{esEdicion ? "Editar tarifa" : "Nueva tarifa"}</DialogTitle>
        </DialogHeader>

        <form ref={formRef} onSubmit={handleSubmit} className="space-y-5">
          {/* Seller y tipo */}
          <div className="grid gap-4 sm:grid-cols-2">
            {!esEdicion && (
              <div className="space-y-1.5">
                <Label htmlFor="seller_id">Seller</Label>
                <select
                  id="seller_id"
                  name="seller_id"
                  className="h-9 w-full rounded-md border border-input bg-background px-3 text-sm"
                  defaultValue=""
                >
                  <option value="">Tarifa por defecto del tenant</option>
                  {sellers.map((s) => (
                    <option key={s.id} value={s.id}>
                      {s.nombre}
                    </option>
                  ))}
                </select>
              </div>
            )}

            {!esEdicion && (
              <div className="space-y-1.5">
                <Label htmlFor="tipo_entrega">Tipo de entrega</Label>
                <select
                  id="tipo_entrega"
                  name="tipo_entrega"
                  required
                  className="h-9 w-full rounded-md border border-input bg-background px-3 text-sm"
                  defaultValue="flex"
                >
                  <option value="flex">Flex (Mercado Libre)</option>
                  <option value="same_day">Same-day propio</option>
                </select>
              </div>
            )}
          </div>

          {/* Cálculo y zona */}
          <div className="grid gap-4 sm:grid-cols-2">
            <div className="space-y-1.5">
              <Label htmlFor="modo_calculo">Modo de cálculo</Label>
              <select
                id="modo_calculo"
                name="modo_calculo"
                required
                className="h-9 w-full rounded-md border border-input bg-background px-3 text-sm"
                defaultValue={tarifa?.modoCalculo ?? "monto_fijo"}
              >
                <option value="monto_fijo">Monto fijo</option>
                <option value="por_zona">Por zona</option>
              </select>
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="zona">Zona (opcional)</Label>
              <Input
                id="zona"
                name="zona"
                placeholder="ej. norte, sur, RM"
                defaultValue={tarifa?.zona ?? ""}
              />
            </div>
          </div>

          {/* Monto y vigencia */}
          <div className="grid gap-4 sm:grid-cols-3">
            <div className="space-y-1.5">
              <Label htmlFor="monto_clp">Monto base neto (CLP)</Label>
              <Input
                id="monto_clp"
                name="monto_clp"
                type="number"
                min={0}
                step={1}
                required
                defaultValue={tarifa?.montoClp ?? ""}
                placeholder="ej. 2500"
              />
              <p className="text-xs text-muted-foreground">Sin IVA — el 19% se agrega al facturar</p>
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="vigente_desde">Vigente desde</Label>
              <Input
                id="vigente_desde"
                name="vigente_desde"
                type="date"
                required
                defaultValue={tarifa?.vigenteDesdeFecha ?? new Date().toISOString().slice(0, 10)}
              />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="vigente_hasta">Vigente hasta</Label>
              <Input
                id="vigente_hasta"
                name="vigente_hasta"
                type="date"
                defaultValue={tarifa?.vigenteHasta ?? ""}
              />
              <p className="text-xs text-muted-foreground">Opcional — vacío = sin vencimiento</p>
            </div>
          </div>

          {/* Mínimos y recargos */}
          <div className="space-y-3 rounded-lg border border-border bg-muted/30 p-4">
            <p className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
              Mínimos y recargos
            </p>
            <div className="grid gap-4 sm:grid-cols-3">
              <div className="space-y-1.5">
                <Label htmlFor="minimo_facturacion_clp">Mínimo facturación (CLP)</Label>
                <Input
                  id="minimo_facturacion_clp"
                  name="minimo_facturacion_clp"
                  type="number"
                  min={0}
                  step={1}
                  defaultValue={tarifa?.minimoFacturacionClp ?? ""}
                  placeholder="ej. 10000"
                />
                <p className="text-xs text-muted-foreground">Total mínimo del período, IVA incluido</p>
              </div>
              <div className="space-y-1.5">
                <Label htmlFor="minimo_retiro_clp">Mínimo por retiro (CLP)</Label>
                <Input
                  id="minimo_retiro_clp"
                  name="minimo_retiro_clp"
                  type="number"
                  min={0}
                  step={1}
                  defaultValue={tarifa?.minimoRetiroClp ?? ""}
                  placeholder="ej. 1000"
                />
                <p className="text-xs text-muted-foreground">Mínimo por línea individual, IVA incluido</p>
              </div>
              <div className="space-y-1.5">
                <Label htmlFor="recargo_reprogramacion_clp">Recargo reprogramación (CLP)</Label>
                <Input
                  id="recargo_reprogramacion_clp"
                  name="recargo_reprogramacion_clp"
                  type="number"
                  min={0}
                  step={1}
                  defaultValue={tarifa?.recargoReprogramacionClp ?? ""}
                  placeholder="ej. 500"
                />
                <p className="text-xs text-muted-foreground">Cobro adicional si reagendan</p>
              </div>
            </div>
          </div>

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
            <Button type="submit" disabled={isPending}>
              {isPending
                ? esEdicion
                  ? "Guardando..."
                  : "Creando..."
                : esEdicion
                  ? "Guardar cambios"
                  : "Crear tarifa"}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
