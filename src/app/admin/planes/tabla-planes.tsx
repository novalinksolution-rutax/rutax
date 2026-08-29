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

import { EmptyState } from "@/components/ui/empty-state";
import { FichaFila390 } from "@/components/ui/ficha-fila-390";
import { DistintivoEstado } from "@/components/ui/distintivo-estado";
import { formatearCLP } from "@/lib/ui/formato-moneda";
import type { Plan } from "@/modules/plataforma/tipos";
import { textoTarifaPlan } from "../tarifa-plan";
import { TooltipSoloLectura } from "../tooltip-solo-lectura";
import { accionCrearPlan, accionActualizarPlan, accionActivarDesactivarPlan } from "./acciones";
import { ModalActoExplicito } from "@/components/ui/modal-acto-explicito";

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

          {/* 🔴 Un plan es «tarifa por pedido + mínimo». Las cuotas mensual y
              anual se retiraron del formulario con la modalidad plana: dejarlas
              a la vista invitaba a llenar un precio que ya no se cobra. */}
          <div className="grid grid-cols-2 gap-4">
            <div className="space-y-1.5">
              <Label htmlFor="precio_por_pedido_clp">Por pedido entregado (CLP)</Label>
              <Input
                id="precio_por_pedido_clp"
                name="precio_por_pedido_clp"
                type="number"
                min={0}
                step={1}
                required
                defaultValue={plan?.precioPorPedidoClp ?? ""}
                placeholder="40"
              />
              <p className="text-xs text-muted-foreground">
                Se cobra por cada pedido que el courier entregó y que fue asignado en Rutax. Los
                que ML reporta como entregados pero despachó el propio seller no cuentan.
              </p>
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="minimo_mensual_clp">Mínimo mensual (CLP)</Label>
              <Input
                id="minimo_mensual_clp"
                name="minimo_mensual_clp"
                type="number"
                min={0}
                step={1}
                defaultValue={plan?.minimoMensualClp ?? ""}
                placeholder="Vacío = sin mínimo"
              />
              <p className="text-xs text-muted-foreground">
                Se cobra el mayor entre esto y las entregas del mes. No se aplica el primer mes
                del courier.
              </p>
            </div>
          </div>

          <div className="grid grid-cols-2 gap-4">
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
  // La ceremonia solo aparece al DESACTIVAR: activar es reversible en un clic,
  // y pedir confirmación para encender algo gasta la fricción.
  const [confirmando, setConfirmando] = useState(false);

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
    <>
      <ModalActoExplicito
        open={confirmando}
        onOpenChange={(o) => {
          if (isPending) return;
          setConfirmando(o);
        }}
        peldano={2}
        titulo={`Vas a desactivar el plan "${plan.nombre}"`}
        consecuencia={
          <>
            Solo se saca del catálogo público: el alta self-serve deja de ofrecerlo.{" "}
            <strong>Las suscripciones que ya lo usan siguen operando sin cambios.</strong>
          </>
        }
        variante="destructive"
        cargando={isPending}
        textoConfirmar="Desactivar el plan"
        onConfirmar={() => {
          setConfirmando(false);
          ejecutar();
        }}
      />
      <div className="flex flex-col items-end gap-1">
      <Button
        variant={plan.activo ? "ghost" : "outline"}
        size="sm"
        className={plan.activo ? "text-destructive hover:text-destructive" : ""}
        disabled={isPending}
        onClick={() => (plan.activo ? setConfirmando(true) : ejecutar())}
      >
        {isPending ? "..." : plan.activo ? "Desactivar" : "Reactivar"}
      </Button>
      {error && <p className="text-xs text-destructive">{error}</p>}
      </div>
    </>
  );
}

interface Props {
  planes: Plan[];
  /** `false` para `soporte_lectura` — oculta los controles de escritura (el gate real vive en el servidor). */
  puedeEscribir: boolean;
}

/**
 * Editar + activar/desactivar. Extraído porque lo usan la ficha del teléfono y
 * la fila de escritorio: duplicarlo garantizaba que un día uno de los dos se
 * quedara sin el gate de `puedeEscribir` y el rol de solo lectura pudiera
 * apretar un botón que no le corresponde.
 */
function AccionesPlan({
  plan,
  puedeEscribir,
  onCambiado,
  alineadoALaDerecha = false,
}: {
  plan: Plan;
  puedeEscribir: boolean;
  onCambiado: () => void;
  alineadoALaDerecha?: boolean;
}) {
  return (
    <div
      className={`flex flex-wrap items-center gap-2 ${alineadoALaDerecha ? "justify-end" : ""}`}
    >
      {puedeEscribir ? (
        <DialogFormularioPlan
          plan={plan}
          onGuardado={onCambiado}
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
      <BotonActivarDesactivar plan={plan} puedeEscribir={puedeEscribir} onCambiado={onCambiado} />
    </div>
  );
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
        <>
          {/* Teléfono: una ficha por plan, con sus acciones debajo. La fila no
              es un enlace, así que dos botones no compiten con nada. */}
          <ul className="divide-y divide-border overflow-hidden rounded-lg border bg-card shadow-sm sm:hidden">
            {planes.map((p) => (
              <li key={p.id} className="space-y-2 px-4 py-2">
                <FichaFila390
                  estado={
                    <DistintivoEstado
                      tono={p.activo ? "neutral" : "inert"}
                      etiqueta={p.activo ? "Activo" : "Inactivo"}
                    />
                  }
                  clasificacion={`${conductoresMaxDePlan(p) || "∞"} conductores`}
                  titulo={p.nombre}
                  // La tarifa es lo que define a un plan: va en la línea de
                  // detalle antes que la descripción, que es texto de venta.
                  detalle={textoTarifaPlan(p)}
                />
                {p.descripcion && (
                  <p className="text-xs text-muted-foreground">{p.descripcion}</p>
                )}
                <AccionesPlan
                  plan={p}
                  puedeEscribir={puedeEscribir}
                  onCambiado={() => router.refresh()}
                />
              </li>
            ))}
          </ul>

          <div className="hidden overflow-hidden rounded-lg border bg-card shadow-sm sm:block">
            <div className="overflow-x-auto">
              <table className="w-full text-sm" aria-label="Catálogo de planes">
                <thead>
                  <tr className="border-b bg-muted/40 text-left text-xs font-medium uppercase tracking-wide text-muted-foreground">
                    <th className="px-4 py-2">Plan</th>
                    <th className="px-4 py-2">Estado</th>
                    <th className="px-4 py-2">Por pedido</th>
                    <th className="px-4 py-2">Mínimo/mes</th>
                    <th className="px-4 py-2">Conductores</th>
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
                        <DistintivoEstado
                          tono={p.activo ? "neutral" : "inert"}
                          etiqueta={p.activo ? "Activo" : "Inactivo"}
                        />
                      </td>
                      {/* Los planes de cuota plana quedaron desactivados el
                          2026-08-28 y no tienen tarifa por pedido. Se muestra su
                          cuota en vez de un guion: siguen explicando las boletas
                          que ya se cobraron con ellos. */}
                      <td className="px-4 py-3 whitespace-nowrap tabular-nums font-mono">
                        {p.precioPorPedidoClp === null ? (
                          <span className="text-muted-foreground">
                            cuota {formatearCLP(p.precioMensualClp)}
                          </span>
                        ) : (
                          formatearCLP(p.precioPorPedidoClp)
                        )}
                      </td>
                      <td className="px-4 py-3 whitespace-nowrap tabular-nums font-mono">
                        {p.minimoMensualClp === null ? (
                          <span className="text-muted-foreground">sin mínimo</span>
                        ) : (
                          formatearCLP(p.minimoMensualClp)
                        )}
                      </td>
                      <td className="px-4 py-3 text-muted-foreground">
                        {conductoresMaxDePlan(p) || "Ilimitado"}
                      </td>
                      <td className="px-4 py-3">
                        <AccionesPlan
                          plan={p}
                          puedeEscribir={puedeEscribir}
                          onCambiado={() => router.refresh()}
                          alineadoALaDerecha
                        />
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        </>
      )}
    </div>
  );
}
