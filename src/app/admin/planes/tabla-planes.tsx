"use client";

/**
 * CRUD de planes (backstage de plataforma, F2 "Ola 1", ítem D).
 *
 * Un solo dialog de formulario (`DialogFormularioPlan`) sirve tanto para
 * "Nuevo plan" como para "Editar" — la diferencia es si trae `plan` (edición,
 * precargado) o no (alta, en blanco). `activo` NUNCA se edita desde este
 * formulario: tiene su propio botón con confirmación (`activarDesactivarPlan`
 * deja su propio rastro de auditoría, distinguible del resto de ediciones).
 */

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { LayoutGrid, Pencil } from "lucide-react";
import {
  Dialog,
  DialogClose,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Checkbox } from "@/components/ui/checkbox";
import { Badge } from "@/components/ui/badge";
import { BadgeEstado } from "@/components/ui/badge-estado";
import { EmptyState } from "@/components/ui/empty-state";
import { formatearCLP } from "@/lib/ui/formato-moneda";
import type { Plan } from "@/modules/plataforma/tipos";
import { TooltipSoloLectura } from "../tooltip-solo-lectura";
import { accionCrearPlan, accionActualizarPlan, accionActivarDesactivarPlan } from "./acciones";

function conductoresMaxDePlan(plan?: Plan): string {
  const valor = plan?.caracteristicas?.["conductores_max"];
  return typeof valor === "number" && Number.isFinite(valor) ? String(valor) : "";
}

function boolDePlan(plan: Plan | undefined, llave: string): boolean {
  return Boolean(plan?.caracteristicas?.[llave]);
}

interface PropsFormulario {
  plan?: Plan;
  onGuardado: () => void;
  trigger: React.ReactNode;
}

function DialogFormularioPlan({ plan, onGuardado, trigger }: PropsFormulario) {
  const esEdicion = Boolean(plan);
  const [open, setOpen] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [isPending, startTransition] = useTransition();

  function handleSubmit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    setError(null);
    const formData = new FormData(e.currentTarget);

    startTransition(async () => {
      const resultado = esEdicion
        ? await accionActualizarPlan(formData)
        : await accionCrearPlan(formData);
      if (!resultado.ok) {
        setError((resultado as { mensaje?: string }).mensaje ?? "Error al guardar el plan.");
        return;
      }
      setOpen(false);
      onGuardado();
    });
  }

  return (
    <Dialog
      open={open}
      onOpenChange={(v) => {
        if (!v) setError(null);
        setOpen(v);
      }}
    >
      <DialogTrigger asChild>{trigger}</DialogTrigger>
      <DialogContent className="sm:max-w-lg">
        <DialogHeader>
          <DialogTitle>{esEdicion ? `Editar ${plan!.nombre}` : "Nuevo plan"}</DialogTitle>
        </DialogHeader>

        <form onSubmit={handleSubmit} className="space-y-4">
          {esEdicion && <input type="hidden" name="plan_id" value={plan!.id} />}
          {esEdicion && (
            <input
              type="hidden"
              name="caracteristicas_previas"
              value={JSON.stringify(plan!.caracteristicas ?? {})}
            />
          )}

          <div className="space-y-1.5">
            <Label htmlFor="nombre">Nombre del plan</Label>
            <Input
              id="nombre"
              name="nombre"
              required
              defaultValue={plan?.nombre ?? ""}
              placeholder="Ej: Pro"
            />
          </div>

          <div className="space-y-1.5">
            <Label htmlFor="descripcion">Descripción</Label>
            <Textarea
              id="descripcion"
              name="descripcion"
              rows={2}
              defaultValue={plan?.descripcion ?? ""}
              placeholder="Opcional — visible para el courier en el selector de planes"
            />
          </div>

          <div className="grid grid-cols-2 gap-4">
            <div className="space-y-1.5">
              <Label htmlFor="precio_mensual_clp">Precio mensual (CLP)</Label>
              <Input
                id="precio_mensual_clp"
                name="precio_mensual_clp"
                type="number"
                min={0}
                step={1}
                required
                defaultValue={plan?.precioMensualClp ?? 0}
              />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="precio_anual_clp">Precio anual (CLP)</Label>
              <Input
                id="precio_anual_clp"
                name="precio_anual_clp"
                type="number"
                min={0}
                step={1}
                required
                defaultValue={plan?.precioAnualClp ?? 0}
              />
            </div>
          </div>

          <div className="grid grid-cols-2 gap-4">
            <div className="space-y-1.5">
              <Label htmlFor="limite_pedidos_mes">Límite de pedidos/mes</Label>
              <Input
                id="limite_pedidos_mes"
                name="limite_pedidos_mes"
                type="number"
                min={0}
                step={1}
                defaultValue={plan?.limitePedidosMes ?? ""}
                placeholder="Vacío = ilimitado"
              />
              <p className="text-xs text-muted-foreground">
                Informativo: nunca bloquea la ingesta de pedidos, solo avisa al courier.
              </p>
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="conductores_max">Máximo de conductores</Label>
              <Input
                id="conductores_max"
                name="conductores_max"
                type="number"
                min={0}
                step={1}
                defaultValue={conductoresMaxDePlan(plan)}
                placeholder="Vacío = ilimitado"
              />
              <p className="text-xs text-muted-foreground">
                Tope real: bloquea el alta de un conductor nuevo por sobre el cupo.
              </p>
            </div>
          </div>

          <div className="space-y-2 rounded-lg border border-border p-3">
            <p className="text-sm font-medium text-foreground">Características</p>
            <label className="flex cursor-pointer items-center gap-2.5 text-sm">
              <Checkbox name="api_publica" defaultChecked={boolDePlan(plan, "api_publica")} />
              API pública
            </label>
            <label className="flex cursor-pointer items-center gap-2.5 text-sm">
              <Checkbox name="webhooks" defaultChecked={boolDePlan(plan, "webhooks")} />
              Webhooks
            </label>
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
              {isPending ? "Guardando..." : esEdicion ? "Guardar cambios" : "Crear plan"}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}

function BotonActivarDesactivar({
  plan,
  puedeEscribir,
  onCambiado,
}: {
  plan: Plan;
  puedeEscribir: boolean;
  onCambiado: () => void;
}) {
  const [isPending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);

  if (!puedeEscribir) {
    return (
      <TooltipSoloLectura>
        <Button variant="ghost" size="sm" disabled>
          {plan.activo ? "Desactivar" : "Reactivar"}
        </Button>
      </TooltipSoloLectura>
    );
  }

  function ejecutar() {
    if (plan.activo) {
      const confirmado = window.confirm(
        `¿Desactivar "${plan.nombre}"? Solo se saca del catálogo público (el alta self-serve dejará de ofrecerlo). Las suscripciones que ya lo usan siguen operando sin cambios.`,
      );
      if (!confirmado) return;
    }
    setError(null);
    const fd = new FormData();
    fd.set("plan_id", plan.id);
    fd.set("activo", String(!plan.activo));
    startTransition(async () => {
      const resultado = await accionActivarDesactivarPlan(fd);
      if (!resultado.ok) {
        setError((resultado as { mensaje?: string }).mensaje ?? "Error.");
        return;
      }
      onCambiado();
    });
  }

  return (
    <div className="flex flex-col items-end gap-1">
      <Button
        variant={plan.activo ? "ghost" : "outline"}
        size="sm"
        className={plan.activo ? "text-destructive hover:text-destructive" : ""}
        disabled={isPending}
        onClick={ejecutar}
      >
        {isPending ? "..." : plan.activo ? "Desactivar" : "Reactivar"}
      </Button>
      {error && <p className="text-xs text-destructive">{error}</p>}
    </div>
  );
}

interface Props {
  planes: Plan[];
  /** `false` para `soporte_lectura` — oculta los controles de escritura (el gate real vive en el servidor). */
  puedeEscribir: boolean;
}

function BotonNuevoPlan({ puedeEscribir, onGuardado }: { puedeEscribir: boolean; onGuardado: () => void }) {
  if (!puedeEscribir) {
    return (
      <TooltipSoloLectura>
        <Button size="sm" disabled>
          Nuevo plan
        </Button>
      </TooltipSoloLectura>
    );
  }
  return <DialogFormularioPlan onGuardado={onGuardado} trigger={<Button size="sm">Nuevo plan</Button>} />;
}

export function TablaPlanes({ planes, puedeEscribir }: Props) {
  const router = useRouter();
  const activos = planes.filter((p) => p.activo).length;
  const inactivos = planes.length - activos;

  return (
    <div className="space-y-6">
      <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
        <div className="flex flex-wrap gap-2">
          {activos > 0 && (
            <Badge variant="success">
              {activos} activo{activos !== 1 ? "s" : ""}
            </Badge>
          )}
          {inactivos > 0 && (
            <Badge variant="neutral">
              {inactivos} inactivo{inactivos !== 1 ? "s" : ""}
            </Badge>
          )}
          {planes.length === 0 && (
            <span className="text-sm text-muted-foreground">Sin planes en el catálogo</span>
          )}
        </div>
        <BotonNuevoPlan puedeEscribir={puedeEscribir} onGuardado={() => router.refresh()} />
      </div>

      {planes.length === 0 ? (
        <EmptyState
          icon={LayoutGrid}
          tono="arranque"
          titulo="Sin planes en el catálogo"
          descripcion="Crea el primer plan para que los couriers puedan darse de alta o para asignarlo manualmente desde Suscripciones."
          accion={<BotonNuevoPlan puedeEscribir={puedeEscribir} onGuardado={() => router.refresh()} />}
        />
      ) : (
        <div className="overflow-hidden rounded-lg border bg-card shadow-sm">
          <div className="overflow-x-auto">
            <table className="w-full text-sm" aria-label="Catálogo de planes">
              <thead>
                <tr className="border-b bg-muted/40 text-left text-xs font-medium uppercase tracking-wide text-muted-foreground">
                  <th className="px-4 py-2">Plan</th>
                  <th className="px-4 py-2">Estado</th>
                  <th className="hidden px-4 py-2 sm:table-cell">Precio/mes</th>
                  <th className="hidden px-4 py-2 md:table-cell">Precio/año</th>
                  <th className="hidden px-4 py-2 lg:table-cell">Límite pedidos</th>
                  <th className="hidden px-4 py-2 lg:table-cell">Conductores</th>
                  <th className="px-4 py-2 text-right">
                    <span className="sr-only">Acciones</span>
                  </th>
                </tr>
              </thead>
              <tbody className="divide-y divide-border">
                {planes.map((p) => (
                  <tr key={p.id} className="hover:bg-muted/30 transition-colors">
                    <td className="px-4 py-3">
                      <p className="font-medium">{p.nombre}</p>
                      {p.descripcion && (
                        <p className="max-w-xs truncate text-xs text-muted-foreground">{p.descripcion}</p>
                      )}
                    </td>
                    <td className="px-4 py-3">
                      <BadgeEstado
                        variante={p.activo ? "success" : "neutral"}
                        texto={p.activo ? "Activo" : "Inactivo"}
                      />
                    </td>
                    <td className="hidden px-4 py-3 tabular-nums font-mono sm:table-cell">
                      {formatearCLP(p.precioMensualClp)}
                    </td>
                    <td className="hidden px-4 py-3 tabular-nums font-mono md:table-cell">
                      {formatearCLP(p.precioAnualClp)}
                    </td>
                    <td className="hidden px-4 py-3 text-muted-foreground lg:table-cell">
                      {p.limitePedidosMes === null ? "Ilimitado" : p.limitePedidosMes.toLocaleString("es-CL")}
                    </td>
                    <td className="hidden px-4 py-3 text-muted-foreground lg:table-cell">
                      {conductoresMaxDePlan(p) || "Ilimitado"}
                    </td>
                    <td className="px-4 py-3">
                      <div className="flex items-center justify-end gap-2">
                        {puedeEscribir ? (
                          <DialogFormularioPlan
                            plan={p}
                            onGuardado={() => router.refresh()}
                            trigger={
                              <Button variant="outline" size="sm">
                                <Pencil className="size-3.5" aria-hidden="true" />
                                Editar
                              </Button>
                            }
                          />
                        ) : (
                          <TooltipSoloLectura>
                            <Button variant="outline" size="sm" disabled>
                              <Pencil className="size-3.5" aria-hidden="true" />
                              Editar
                            </Button>
                          </TooltipSoloLectura>
                        )}
                        <BotonActivarDesactivar plan={p} puedeEscribir={puedeEscribir} onCambiado={() => router.refresh()} />
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}
    </div>
  );
}
