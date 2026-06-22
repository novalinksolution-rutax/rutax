"use client";

import { useState, useTransition } from "react";
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
import { Badge } from "@/components/ui/badge";
import { EmptyState } from "@/components/ui/empty-state";
import { Building2 } from "lucide-react";
import { formatearCLP } from "@/lib/ui/formato-moneda";
import type { SuscripcionConPlan } from "@/modules/plataforma/tipos";
import type { Plan } from "@/modules/plataforma/tipos";
import {
  accionAsignarPlan,
  accionActivarSuscripcion,
  accionSuspenderSuscripcion,
  accionCancelarSuscripcion,
} from "./acciones";

interface TenantSinSuscripcion {
  id: string;
  nombreFantasia: string | null;
}

interface Props {
  suscripciones: SuscripcionConPlan[];
  planes: Plan[];
  tenantsSinSuscripcion: TenantSinSuscripcion[];
}

const COLORES_ESTADO: Record<string, string> = {
  activa: "border-green-300 bg-green-50 text-green-700 dark:border-green-700 dark:bg-green-950/30 dark:text-green-400",
  trial: "border-blue-300 bg-blue-50 text-blue-700 dark:border-blue-700 dark:bg-blue-950/30 dark:text-blue-400",
  suspendida: "border-amber-300 bg-amber-50 text-amber-700 dark:border-amber-700 dark:bg-amber-950/30 dark:text-amber-400",
  cancelada: "text-muted-foreground",
};

const ETIQUETAS_ESTADO: Record<string, string> = {
  activa: "Activa",
  trial: "Trial",
  suspendida: "Suspendida",
  cancelada: "Cancelada",
};

function formatearFecha(iso: string | null): string {
  if (!iso) return "—";
  return new Date(iso).toLocaleDateString("es-CL", {
    day: "2-digit",
    month: "2-digit",
    year: "numeric",
  });
}

function DialogNuevaSuscripcion({
  planes,
  tenants,
  onCreada,
}: {
  planes: Plan[];
  tenants: TenantSinSuscripcion[];
  onCreada: () => void;
}) {
  const [open, setOpen] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [isPending, startTransition] = useTransition();

  function handleSubmit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    setError(null);
    const formData = new FormData(e.currentTarget);

    startTransition(async () => {
      const resultado = await accionAsignarPlan(formData);
      if (!resultado.ok) {
        setError((resultado as { ok: false; mensaje?: string }).mensaje ?? "Error al asignar plan.");
        return;
      }
      setOpen(false);
      onCreada();
    });
  }

  return (
    <Dialog open={open} onOpenChange={(v) => { if (!v) setError(null); setOpen(v); }}>
      <DialogTrigger asChild>
        <Button size="sm">Nueva suscripción</Button>
      </DialogTrigger>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>Asignar plan a courier</DialogTitle>
        </DialogHeader>

        <form onSubmit={handleSubmit} className="space-y-4">
          <div className="space-y-1.5">
            <Label htmlFor="tenant_id">Courier</Label>
            {tenants.length === 0 ? (
              <p className="text-sm text-muted-foreground">
                Todos los couriers ya tienen suscripción asignada.
              </p>
            ) : (
              <select
                id="tenant_id"
                name="tenant_id"
                required
                className="h-9 w-full rounded-md border border-input bg-background px-3 text-sm"
              >
                <option value="">Seleccionar courier…</option>
                {tenants.map((t) => (
                  <option key={t.id} value={t.id}>
                    {t.nombreFantasia ?? t.id}
                  </option>
                ))}
              </select>
            )}
          </div>

          <div className="space-y-1.5">
            <Label htmlFor="plan_id">Plan</Label>
            <select
              id="plan_id"
              name="plan_id"
              required
              className="h-9 w-full rounded-md border border-input bg-background px-3 text-sm"
            >
              <option value="">Seleccionar plan…</option>
              {planes.map((p) => (
                <option key={p.id} value={p.id}>
                  {p.nombre} — {formatearCLP(p.precioMensualClp)}/mes
                </option>
              ))}
            </select>
          </div>

          <div className="grid grid-cols-2 gap-4">
            <div className="space-y-1.5">
              <Label htmlFor="estado">Estado inicial</Label>
              <select
                id="estado"
                name="estado"
                className="h-9 w-full rounded-md border border-input bg-background px-3 text-sm"
                defaultValue="trial"
              >
                <option value="trial">Trial</option>
                <option value="activa">Activa</option>
              </select>
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="trial_hasta">Trial hasta</Label>
              <Input id="trial_hasta" name="trial_hasta" type="date" />
            </div>
          </div>

          <div className="space-y-1.5">
            <Label htmlFor="notas">Notas internas</Label>
            <Input id="notas" name="notas" placeholder="Opcional" />
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
            <Button type="submit" disabled={isPending || tenants.length === 0}>
              {isPending ? "Asignando..." : "Asignar plan"}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}

function AccionesSuscripcion({
  suscripcion,
}: {
  suscripcion: SuscripcionConPlan;
}) {
  const router = useRouter();
  const [isPending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);

  async function ejecutar(accion: (fd: FormData) => Promise<{ ok: boolean; mensaje?: string }>) {
    const fd = new FormData();
    fd.set("suscripcion_id", suscripcion.id);
    startTransition(async () => {
      const resultado = await accion(fd);
      if (!resultado.ok) {
        setError(resultado.mensaje ?? "Error.");
      } else {
        setError(null);
        router.refresh();
      }
    });
  }

  return (
    <div className="flex flex-col items-end gap-1">
      <div className="flex items-center gap-2">
        {(suscripcion.estado === "trial" || suscripcion.estado === "suspendida") && (
          <Button
            variant="outline"
            size="sm"
            disabled={isPending}
            onClick={() => ejecutar(accionActivarSuscripcion)}
          >
            Activar
          </Button>
        )}
        {(suscripcion.estado === "activa" || suscripcion.estado === "trial") && (
          <Button
            variant="outline"
            size="sm"
            disabled={isPending}
            onClick={() => {
              if (!window.confirm(`¿Suspender la suscripción de ${suscripcion.nombreFantasiaTenant ?? "este courier"}?`)) return;
              ejecutar(accionSuspenderSuscripcion);
            }}
          >
            Suspender
          </Button>
        )}
        {suscripcion.estado !== "cancelada" && (
          <Button
            variant="ghost"
            size="sm"
            className="text-destructive hover:text-destructive"
            disabled={isPending}
            onClick={() => {
              if (!window.confirm(`¿Cancelar definitivamente la suscripción de ${suscripcion.nombreFantasiaTenant ?? "este courier"}? Esta acción no se puede deshacer.`)) return;
              ejecutar(accionCancelarSuscripcion);
            }}
          >
            Cancelar
          </Button>
        )}
      </div>
      {error && <p className="text-xs text-destructive">{error}</p>}
    </div>
  );
}

export function TablaSuscripciones({ suscripciones, planes, tenantsSinSuscripcion }: Props) {
  const router = useRouter();

  const activas = suscripciones.filter((s) => s.estado === "activa").length;
  const trial = suscripciones.filter((s) => s.estado === "trial").length;
  const suspendidas = suscripciones.filter((s) => s.estado === "suspendida").length;

  return (
    <div className="space-y-6">
      <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
        <div>
          <h1 className="text-2xl font-bold">Suscripciones</h1>
          <div className="mt-2 flex flex-wrap gap-2">
            {activas > 0 && (
              <Badge variant="outline" className={COLORES_ESTADO.activa}>
                {activas} activa{activas !== 1 ? "s" : ""}
              </Badge>
            )}
            {trial > 0 && (
              <Badge variant="outline" className={COLORES_ESTADO.trial}>
                {trial} trial
              </Badge>
            )}
            {suspendidas > 0 && (
              <Badge variant="outline" className={COLORES_ESTADO.suspendida}>
                {suspendidas} suspendida{suspendidas !== 1 ? "s" : ""}
              </Badge>
            )}
            {suscripciones.length === 0 && (
              <span className="text-sm text-muted-foreground">Sin suscripciones</span>
            )}
          </div>
        </div>
        <DialogNuevaSuscripcion
          planes={planes}
          tenants={tenantsSinSuscripcion}
          onCreada={() => router.refresh()}
        />
      </div>

      {suscripciones.length === 0 ? (
        <EmptyState
          icon={Building2}
          tono="arranque"
          titulo="Sin suscripciones registradas"
          descripcion="Asigna el primer plan a un courier para comenzar."
          accion={
            <DialogNuevaSuscripcion
              planes={planes}
              tenants={tenantsSinSuscripcion}
              onCreada={() => router.refresh()}
            />
          }
        />
      ) : (
        <div className="overflow-hidden rounded-xl border bg-card shadow-sm">
          <div className="overflow-x-auto">
            <table className="w-full text-sm" aria-label="Suscripciones de couriers">
              <thead>
                <tr className="border-b bg-muted/40 text-left text-xs font-medium uppercase tracking-wide text-muted-foreground">
                  <th className="px-4 py-2">Courier</th>
                  <th className="px-4 py-2">Plan</th>
                  <th className="px-4 py-2">Estado</th>
                  <th className="hidden px-4 py-2 sm:table-cell">Activa desde</th>
                  <th className="hidden px-4 py-2 md:table-cell">Trial hasta</th>
                  <th className="hidden px-4 py-2 lg:table-cell">Precio/mes</th>
                  <th className="px-4 py-2 text-right">
                    <span className="sr-only">Acciones</span>
                  </th>
                </tr>
              </thead>
              <tbody className="divide-y divide-border">
                {suscripciones.map((s) => (
                  <tr key={s.id} className="hover:bg-muted/30 transition-colors">
                    <td className="px-4 py-3 font-medium">
                      {s.nombreFantasiaTenant ?? (
                        <span className="font-mono text-xs text-muted-foreground">{s.tenantId.slice(0, 8)}…</span>
                      )}
                    </td>
                    <td className="px-4 py-3">{s.plan.nombre}</td>
                    <td className="px-4 py-3">
                      <Badge
                        variant="outline"
                        className={COLORES_ESTADO[s.estado] ?? "text-muted-foreground"}
                      >
                        {ETIQUETAS_ESTADO[s.estado] ?? s.estado}
                      </Badge>
                    </td>
                    <td className="hidden px-4 py-3 text-muted-foreground sm:table-cell">
                      {formatearFecha(s.activaDesde)}
                    </td>
                    <td className="hidden px-4 py-3 text-muted-foreground md:table-cell">
                      {formatearFecha(s.trialHasta)}
                    </td>
                    <td className="hidden px-4 py-3 tabular-nums font-mono lg:table-cell">
                      {formatearCLP(s.plan.precioMensualClp)}
                    </td>
                    <td className="px-4 py-3">
                      <AccionesSuscripcion suscripcion={s} />
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
