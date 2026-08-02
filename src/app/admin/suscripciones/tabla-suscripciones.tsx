"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
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
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Badge } from "@/components/ui/badge";
import { BadgeEstado } from "@/components/ui/badge-estado";
import { EmptyState } from "@/components/ui/empty-state";
import { Building2 } from "lucide-react";
import { formatearCLP } from "@/lib/ui/formato-moneda";
import { BADGE_ESTADO_SUSCRIPCION, traducirEstadoSuscripcion } from "@/lib/ui/traduccion-estados";
import type { SuscripcionConPlan } from "@/modules/plataforma/tipos";
import type { Plan } from "@/modules/plataforma/tipos";
import { TooltipSoloLectura } from "../tooltip-solo-lectura";
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
  /** `false` para `soporte_lectura` — oculta los controles de escritura (el gate real vive en el servidor). */
  puedeEscribir: boolean;
}

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
              <Select name="tenant_id" required>
                <SelectTrigger id="tenant_id" className="w-full">
                  <SelectValue placeholder="Seleccionar courier…" />
                </SelectTrigger>
                <SelectContent>
                  {tenants.map((t) => (
                    <SelectItem key={t.id} value={t.id}>
                      {t.nombreFantasia ?? t.id}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            )}
          </div>

          <div className="space-y-1.5">
            <Label htmlFor="plan_id">Plan</Label>
            <Select name="plan_id" required>
              <SelectTrigger id="plan_id" className="w-full">
                <SelectValue placeholder="Seleccionar plan…" />
              </SelectTrigger>
              <SelectContent>
                {planes.map((p) => (
                  <SelectItem key={p.id} value={p.id}>
                    {p.nombre} — {formatearCLP(p.precioMensualClp)}/mes
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>

          <div className="grid grid-cols-2 gap-4">
            <div className="space-y-1.5">
              <Label htmlFor="estado">Estado inicial</Label>
              <Select name="estado" defaultValue="trial">
                <SelectTrigger id="estado" className="w-full">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="trial">Prueba</SelectItem>
                  <SelectItem value="activa">Activa</SelectItem>
                </SelectContent>
              </Select>
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
  puedeEscribir,
}: {
  suscripcion: SuscripcionConPlan;
  puedeEscribir: boolean;
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
        <Button variant="outline" size="sm" asChild>
          <Link href={`/admin/suscripciones/${suscripcion.id}`}>Cobros</Link>
        </Button>
        {(suscripcion.estado === "trial" || suscripcion.estado === "suspendida") &&
          (puedeEscribir ? (
            <Button
              variant="outline"
              size="sm"
              disabled={isPending}
              onClick={() => ejecutar(accionActivarSuscripcion)}
            >
              Activar
            </Button>
          ) : (
            <TooltipSoloLectura>
              <Button variant="outline" size="sm" disabled>
                Activar
              </Button>
            </TooltipSoloLectura>
          ))}
        {(suscripcion.estado === "activa" || suscripcion.estado === "trial") &&
          (puedeEscribir ? (
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
          ) : (
            <TooltipSoloLectura>
              <Button variant="outline" size="sm" disabled>
                Suspender
              </Button>
            </TooltipSoloLectura>
          ))}
        {suscripcion.estado !== "cancelada" &&
          (puedeEscribir ? (
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
          ) : (
            <TooltipSoloLectura>
              <Button variant="ghost" size="sm" className="text-destructive" disabled>
                Cancelar
              </Button>
            </TooltipSoloLectura>
          ))}
      </div>
      {error && <p className="text-xs text-destructive">{error}</p>}
    </div>
  );
}

function BotonNuevaSuscripcion({
  puedeEscribir,
  planes,
  tenants,
  onCreada,
}: {
  puedeEscribir: boolean;
  planes: Plan[];
  tenants: TenantSinSuscripcion[];
  onCreada: () => void;
}) {
  if (!puedeEscribir) {
    return (
      <TooltipSoloLectura>
        <Button size="sm" disabled>
          Nueva suscripción
        </Button>
      </TooltipSoloLectura>
    );
  }
  return <DialogNuevaSuscripcion planes={planes} tenants={tenants} onCreada={onCreada} />;
}

export function TablaSuscripciones({ suscripciones, planes, tenantsSinSuscripcion, puedeEscribir }: Props) {
  const router = useRouter();

  const activas = suscripciones.filter((s) => s.estado === "activa").length;
  const trial = suscripciones.filter((s) => s.estado === "trial").length;
  const suspendidas = suscripciones.filter((s) => s.estado === "suspendida").length;

  return (
    <div className="space-y-6">
      <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
        <div>
          <h1 className="text-2xl font-semibold">Suscripciones</h1>
          <div className="mt-2 flex flex-wrap gap-2">
            {activas > 0 && (
              <Badge variant="success">
                {activas} activa{activas !== 1 ? "s" : ""}
              </Badge>
            )}
            {trial > 0 && (
              <Badge variant="info">
                {trial} en prueba
              </Badge>
            )}
            {suspendidas > 0 && (
              <Badge variant="warning">
                {suspendidas} suspendida{suspendidas !== 1 ? "s" : ""}
              </Badge>
            )}
            {suscripciones.length === 0 && (
              <span className="text-sm text-muted-foreground">Sin suscripciones</span>
            )}
          </div>
        </div>
        <BotonNuevaSuscripcion
          puedeEscribir={puedeEscribir}
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
            <BotonNuevaSuscripcion
              puedeEscribir={puedeEscribir}
              planes={planes}
              tenants={tenantsSinSuscripcion}
              onCreada={() => router.refresh()}
            />
          }
        />
      ) : (
        <div className="overflow-hidden rounded-lg border bg-card shadow-sm">
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
                      <BadgeEstado
                        variante={BADGE_ESTADO_SUSCRIPCION[s.estado]}
                        texto={traducirEstadoSuscripcion(s.estado)}
                      />
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
                      <AccionesSuscripcion suscripcion={s} puedeEscribir={puedeEscribir} />
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
