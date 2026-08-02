"use client";

/**
 * Sección "Entitlements / overrides" del detalle de suscripción (backstage de
 * plataforma, F2 "Ola 1", ítems 6 y 8).
 *
 * Dos bloques independientes, cada uno con su propio guardado:
 * 1. Overrides de entitlements — fuerza `conductores_max` / `api_publica` /
 *    `webhooks` para ESTE courier sin cambiar de plan. Un campo en blanco /
 *    "Usar el plan" borra el override (vuelve a heredar del plan).
 * 2. Emisión DTE real — opt-in/opt-out. Copy deliberadamente insistente: esto
 *    SOLO habilita la capacidad, nunca emite nada (invariante no-negociable
 *    de CLAUDE.md) — la emisión real sigue exigiendo la acción humana
 *    `emitirFacturaPeriodo` + revisión de `seguridad-cumplimiento` para pasar
 *    la plataforma a modo real.
 */

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { AlertTriangle, FileWarning, ShieldCheck } from "lucide-react";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Badge } from "@/components/ui/badge";
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
import type { Plan } from "@/modules/plataforma/tipos";

/**
 * Centinela para la opción "Usar el plan" (el shadcn/Radix Select no admite un
 * `value=""`). Se normaliza de vuelta a `""` antes de enviar, así la acción de
 * servidor sigue recibiendo el mismo contrato de antes (vacío = borrar override).
 */
const USAR_PLAN = "__plan__";
import { TooltipSoloLectura } from "../../tooltip-solo-lectura";
import { accionEstablecerOverride, accionEstablecerEmisionDteReal } from "../acciones";

function valorNumeroOverride(override: Record<string, unknown>, llave: string): string {
  const valor = override[llave];
  return typeof valor === "number" && Number.isFinite(valor) ? String(valor) : "";
}

function valorBoolOverride(override: Record<string, unknown>, llave: string): "" | "true" | "false" {
  if (!Object.prototype.hasOwnProperty.call(override, llave)) return "";
  return override[llave] ? "true" : "false";
}

function valorPlanBool(plan: Plan, llave: string): string {
  return plan.caracteristicas?.[llave] ? "Sí" : "No";
}

interface PropsOverrides {
  tenantId: string;
  plan: Plan;
  overrideActual: Record<string, unknown>;
  puedeEscribir: boolean;
}

function PanelOverrides({ tenantId, plan, overrideActual, puedeEscribir }: PropsOverrides) {
  const router = useRouter();
  const [isPending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);
  const [exito, setExito] = useState(false);

  const conductoresMaxPlan = typeof plan.caracteristicas?.["conductores_max"] === "number"
    ? String(plan.caracteristicas["conductores_max"])
    : "ilimitado";

  function handleSubmit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    setError(null);
    setExito(false);
    const formData = new FormData(e.currentTarget);
    formData.set("tenant_id", tenantId);
    // El centinela "usar el plan" del Select se traduce al "" que la acción
    // espera para borrar el override (mismo contrato que los <select> nativos).
    for (const llave of ["api_publica", "webhooks"]) {
      if (formData.get(llave) === USAR_PLAN) formData.set(llave, "");
    }

    startTransition(async () => {
      const resultado = await accionEstablecerOverride(formData);
      if (!resultado.ok) {
        setError((resultado as { mensaje?: string }).mensaje ?? "Error al guardar el override.");
        return;
      }
      setExito(true);
      router.refresh();
    });
  }

  return (
    <form onSubmit={handleSubmit} className="space-y-4 rounded-lg border bg-card p-5 shadow-sm">
      <div>
        <h2 className="font-semibold">Entitlements / overrides</h2>
        <p className="mt-1 text-sm text-muted-foreground">
          Fuerza features puntuales para este courier sin cambiarle de plan. &ldquo;Usar el
          plan&rdquo; borra el override y vuelve a heredar el valor del plan {plan.nombre}.
        </p>
      </div>

      <fieldset disabled={!puedeEscribir} className="space-y-4 disabled:opacity-60">
        <div className="space-y-1.5">
          <Label htmlFor="conductores_max">Máximo de conductores</Label>
          <Input
            id="conductores_max"
            name="conductores_max"
            type="number"
            min={0}
            step={1}
            defaultValue={valorNumeroOverride(overrideActual, "conductores_max")}
            placeholder={`Vacío = usa el plan (${conductoresMaxPlan})`}
          />
        </div>

        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
          <div className="space-y-1.5">
            <Label htmlFor="api_publica">API pública</Label>
            <Select
              name="api_publica"
              defaultValue={valorBoolOverride(overrideActual, "api_publica") || USAR_PLAN}
              disabled={!puedeEscribir}
            >
              <SelectTrigger id="api_publica" className="h-9 w-full">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value={USAR_PLAN}>Usar el plan (actualmente: {valorPlanBool(plan, "api_publica")})</SelectItem>
                <SelectItem value="true">Forzar: Sí</SelectItem>
                <SelectItem value="false">Forzar: No</SelectItem>
              </SelectContent>
            </Select>
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="webhooks">Webhooks</Label>
            <Select
              name="webhooks"
              defaultValue={valorBoolOverride(overrideActual, "webhooks") || USAR_PLAN}
              disabled={!puedeEscribir}
            >
              <SelectTrigger id="webhooks" className="h-9 w-full">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value={USAR_PLAN}>Usar el plan (actualmente: {valorPlanBool(plan, "webhooks")})</SelectItem>
                <SelectItem value="true">Forzar: Sí</SelectItem>
                <SelectItem value="false">Forzar: No</SelectItem>
              </SelectContent>
            </Select>
          </div>
        </div>
      </fieldset>

      {error && (
        <p role="alert" className="text-sm text-destructive">
          {error}
        </p>
      )}
      {exito && !error && <p className="text-sm text-success">Override guardado.</p>}

      <div className="flex items-center justify-end gap-2">
        {!puedeEscribir && <p className="text-xs text-muted-foreground">Requiere rol Administrador.</p>}
        {puedeEscribir ? (
          <Button type="submit" size="sm" disabled={isPending}>
            {isPending ? "Guardando..." : "Guardar override"}
          </Button>
        ) : (
          <TooltipSoloLectura>
            <Button type="button" size="sm" disabled>
              Guardar override
            </Button>
          </TooltipSoloLectura>
        )}
      </div>
    </form>
  );
}

interface PropsDte {
  tenantId: string;
  tieneConfig: boolean;
  emisionDteRealHabilitada: boolean;
  puedeEscribir: boolean;
}

function PanelDteReal({ tenantId, tieneConfig, emisionDteRealHabilitada, puedeEscribir }: PropsDte) {
  const router = useRouter();
  const [isPending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);

  function ejecutar() {
    const proximoEstado = !emisionDteRealHabilitada;
    const confirmado = window.confirm(
      proximoEstado
        ? "¿Habilitar la CAPACIDAD de emisión DTE real para este courier?\n\nEsto NO emite ningún documento. Solo permite que, si la plataforma entera pasa a modo real (revisión de seguridad-cumplimiento previa), este courier pueda emitir DTE reales al SII cuando un usuario suyo ejecute la acción de emitir factura."
        : "¿Deshabilitar la emisión DTE real de este courier? Volverá a emitir siempre en modo sandbox, sin tocar el SII.",
    );
    if (!confirmado) return;

    setError(null);
    const fd = new FormData();
    fd.set("tenant_id", tenantId);
    fd.set("habilitada", String(proximoEstado));
    startTransition(async () => {
      const resultado = await accionEstablecerEmisionDteReal(fd);
      if (!resultado.ok) {
        setError((resultado as { mensaje?: string }).mensaje ?? "Error al actualizar el opt-in.");
        return;
      }
      router.refresh();
    });
  }

  return (
    <div className="space-y-4 rounded-lg border bg-card p-5 shadow-sm">
      <div>
        <h2 className="font-semibold">Emisión DTE real</h2>
        <p className="mt-1 text-sm text-muted-foreground">
          Este control SOLO habilita la capacidad del courier de emitir DTE reales al SII — no
          emite nada por sí mismo. La emisión real exige, además, que la plataforma completa esté
          en modo real (revisión de seguridad-cumplimiento) y que un usuario del courier ejecute la
          acción humana de emitir factura. No es un botón de &ldquo;emitir&rdquo;.
        </p>
      </div>

      {!tieneConfig ? (
        <Alert className="border-warning bg-warning-subtle text-warning-subtle-foreground">
          <FileWarning className="text-warning" />
          <AlertDescription>
            Este courier todavía no completó el onboarding de facturación (sin proveedor DTE
            elegido) — no se puede habilitar la emisión real hasta que lo haga.
          </AlertDescription>
        </Alert>
      ) : (
        <div className="flex items-center justify-between gap-4">
          <Badge variant={emisionDteRealHabilitada ? "warning" : "neutral"} className="gap-1.5">
            {emisionDteRealHabilitada ? (
              <AlertTriangle className="size-3" aria-hidden="true" />
            ) : (
              <ShieldCheck className="size-3" aria-hidden="true" />
            )}
            {emisionDteRealHabilitada ? "Emisión real habilitada" : "No habilitada (sandbox)"}
          </Badge>
          {puedeEscribir ? (
            <Button
              variant={emisionDteRealHabilitada ? "outline" : "default"}
              size="sm"
              disabled={isPending}
              onClick={ejecutar}
              className={emisionDteRealHabilitada ? "border-destructive text-destructive hover:text-destructive" : ""}
            >
              {isPending ? "..." : emisionDteRealHabilitada ? "Deshabilitar" : "Habilitar capacidad"}
            </Button>
          ) : (
            <TooltipSoloLectura>
              <Button
                variant={emisionDteRealHabilitada ? "outline" : "default"}
                size="sm"
                disabled
              >
                {emisionDteRealHabilitada ? "Deshabilitar" : "Habilitar capacidad"}
              </Button>
            </TooltipSoloLectura>
          )}
        </div>
      )}

      {error && (
        <p role="alert" className="text-sm text-destructive">
          {error}
        </p>
      )}
    </div>
  );
}

interface Props {
  tenantId: string;
  plan: Plan;
  overrideActual: Record<string, unknown>;
  dte: { tieneConfig: boolean; emisionDteRealHabilitada: boolean };
  /** `false` para `soporte_lectura` — oculta/deshabilita los controles de escritura (el gate real vive en el servidor). */
  puedeEscribir: boolean;
}

export function EntitlementsOverrides({ tenantId, plan, overrideActual, dte, puedeEscribir }: Props) {
  return (
    <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
      <PanelOverrides tenantId={tenantId} plan={plan} overrideActual={overrideActual} puedeEscribir={puedeEscribir} />
      <PanelDteReal
        tenantId={tenantId}
        tieneConfig={dte.tieneConfig}
        emisionDteRealHabilitada={dte.emisionDteRealHabilitada}
        puedeEscribir={puedeEscribir}
      />
    </div>
  );
}
